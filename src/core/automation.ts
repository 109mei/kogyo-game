import { DATA } from '../data';
import { defOf } from './facilities';
import { affordable, executeBuy, executeSell, unitPrice } from './market';
import { mods } from './mods';
import { gridPrice, powerUse } from './power';
import { capacityCached, managerBonus } from './production';
import { divisionFor } from './org';
import { employeesAt } from './staff';
import type { Cond, FacilityState, GameState } from './types';
import { hasFeature, orderNeed } from './util';

/** average daily consumption over the last week (0 if unknown) */
export function consumptionPerDay(s: GameState, item: string): number {
  const h = s.itemHist[item];
  if (!h || !h.consumed.length) return 0;
  const n = Math.min(7, h.consumed.length);
  let t = 0;
  for (let i = h.consumed.length - n; i < h.consumed.length; i++) t += h.consumed[i];
  return t / n;
}

export function productionPerDay(s: GameState, item: string): number {
  const h = s.itemHist[item];
  if (!h || !h.produced.length) return 0;
  const n = Math.min(7, h.produced.length);
  let t = 0;
  for (let i = h.produced.length - n; i < h.produced.length; i++) t += h.produced[i];
  return t / n;
}

/** gross margin of a facility's recipe at today's prices, as a fraction of revenue */
export function recipeMargin(s: GameState, f: FacilityState): number {
  if (!f.recipe) return 0;
  const r = DATA.recipe[f.recipe];
  const revenue = r.output * unitPrice(s, r.id) * (1 - DATA.balance.market.sellSpread);
  let cost = 0;
  for (const [inp, q] of Object.entries(r.inputs)) cost += q * mods(s).inputs * unitPrice(s, inp);
  const c = capacityCached(s, f);
  const perDay = c.slots / r.time;
  if (perDay > 0) {
    // wages and power per batch
    let wages = 0;
    for (const e of employeesAt(s, f.id)) wages += e.salary / 30;
    cost += wages / perDay;
    if (c.power > 0) cost += (c.power * 24 * gridPrice(s)) / perDay;
  } else if (f.stage === 'manual') {
    cost += DATA.balance.staff.roles.worker.salary / 30;
  }
  return revenue > 0 ? (revenue - cost) / revenue : -1;
}

function condValue(s: GameState, f: FacilityState, c: Cond): number {
  const item = c.item ?? f.recipe ?? '';
  switch (c.v) {
    case 'stock':
      return s.inventory[item] ?? 0;
    case 'stockDays': {
      const use = consumptionPerDay(s, item);
      return use > 0 ? (s.inventory[item] ?? 0) / use : 9999;
    }
    case 'price':
      return (s.market[item]?.index ?? 1) * 100;
    case 'demand':
      return Math.exp(s.market[item]?.shock ?? 0) * 100;
    case 'margin':
      return recipeMargin(s, f) * 100;
    case 'powerUse':
      return powerUse(s) * 100;
    case 'powerPrice':
      return gridPrice(s);
    case 'cash':
      return s.cash;
  }
}

export function condHolds(s: GameState, f: FacilityState, c: Cond): boolean {
  const v = condValue(s, f, c);
  return c.op === '<' ? v < c.value : v > c.value;
}

function hysteresis(prev: number, stock: number, low: number, high: number): number {
  if (stock <= low) return 1;
  if (stock >= high) return 0;
  return prev > 0 ? 1 : 0;
}

/** the output rate (0..1.5) automation asks for */
export function automationRate(s: GameState, f: FacilityState): number {
  const a = f.auto;
  const manager = (f.managerId !== null && hasFeature(s, 'managers')) || divisionFor(s, f) !== null;
  if (!f.recipe) return 1;
  const out = f.recipe;
  const stock = s.inventory[out] ?? 0;
  if (!a.enabled) {
    if (!manager) return 1;
    // a manager without instructions keeps a few days of what we use and only sells at a profit
    const use = consumptionPerDay(s, out);
    if (use > 0) return hysteresis(f.rate, stock, use * 4, use * 7);
    return recipeMargin(s, f) > 0 ? 1 : 0;
  }
  const maxRate = hasFeature(s, 'advancedRules') ? DATA.balance.production.overdriveMax : 1;
  if (a.mode === 'advanced' || a.policy === 'custom') {
    for (const rule of a.rules) {
      if (rule.conds.every((c) => condHolds(s, f, c))) return Math.max(0, Math.min(maxRate, rule.rate));
    }
    return 1;
  }
  if (a.mode === 'standard') {
    let r = hysteresis(f.rate, stock, a.startBelow, a.stopAbove);
    if (r > 0 && powerUse(s) > a.powerCap) r = 0.5;
    return r;
  }
  switch (a.policy) {
    case 'stable':
      return hysteresis(f.rate, stock, a.targetStock, a.targetStock * 1.2);
    case 'profit':
      return recipeMargin(s, f) > 0.02 ? 1 : 0;
    case 'max':
      return 1;
    case 'eco':
      return powerUse(s) > a.powerCap ? 0.5 : 1;
  }
  return 1;
}

/** managers buy missing inputs and sell what nobody inside the company needs */
function manage(s: GameState, f: FacilityState) {
  if (!f.recipe) return;
  const r = DATA.recipe[f.recipe];
  const c = capacityCached(s, f);
  const perDay = (c.slots / r.time) * managerBonus(s, f) * Math.max(f.rate, 0.01);
  for (const [inp, q] of Object.entries(r.inputs)) {
    const need = q * mods(s).inputs * perDay;
    const have = s.inventory[inp] ?? 0;
    if (need > 0 && have < need * 2 && s.market[inp].index <= 1.3 && s.cash > 0) {
      const qty = Math.min(need * 4 - have, affordable(s, inp) * 0.5);
      if (qty > 0) executeBuy(s, inp, qty);
    }
  }
  const out = r.id;
  const use = consumptionPerDay(s, out);
  const keep = Math.max(use * 5, f.auto.enabled ? f.auto.targetStock : 0, r.output * perDay * 0.5) + orderNeed(s, out);
  const stock = s.inventory[out] ?? 0;
  if (stock > keep && s.market[out].index >= 0.7) executeSell(s, out, stock - keep);
}

export function hourlyAutomation(s: GameState) {
  for (const f of s.facilities) {
    const def = defOf(f);
    if (def.category === 'infrastructure') continue;
    f.rate = automationRate(s, f);
    if ((f.managerId !== null && hasFeature(s, 'managers')) || divisionFor(s, f) !== null) manage(s, f);
  }
}
