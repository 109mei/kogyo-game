/**
 * "Sell what is not needed" in one tap: keep a few days of what the company
 * itself uses, and sell the rest, but never so much at once that the price
 * falls more than a set share (tap again later for more).
 */
import { DATA } from '../data';
import { consumptionPerDay } from './automation';
import { executeSell, sellQuote } from './market';
import { plannedFlows } from './rates';
import type { GameState } from './types';
import { clamp } from './util';

export interface SurplusLine {
  item: string;
  qty: number;
  /** yen expected */
  value: number;
  /** stock kept back for the company's own use */
  keep: number;
  /** more is left over than one tap sells (the price would drop too far) */
  capped: boolean;
}

/** the most that can be sold before the price index drops by `drop` (market impact curve) */
export function maxSaleForDrop(item: string, drop: number): number {
  const m = DATA.balance.market;
  const a = m.immediateImpact / m.elasticity;
  const f = clamp(1 - drop, 1 - m.maxImpact + 1e-9, 1);
  return DATA.item[item].demand * (Math.pow(f, -1 / a) - 1);
}

/** how much of an item the company keeps for itself */
export function ownUse(s: GameState, item: string, flows = plannedFlows(s)): number {
  return Math.max(flows.cons[item] ?? 0, consumptionPerDay(s, item));
}

export function surplusPlan(s: GameState): SurplusLine[] {
  const b = DATA.balance.surplus;
  const flows = plannedFlows(s);
  const out: SurplusLine[] = [];
  for (const it of DATA.items) {
    const stock = s.inventory[it.id] ?? 0;
    if (stock <= 1e-6) continue;
    const keep = ownUse(s, it.id, flows) * b.keepDays;
    const extra = stock - keep;
    if (extra <= 1e-6) continue;
    const cap = maxSaleForDrop(it.id, b.maxPriceDrop);
    let qty = Math.min(extra, cap);
    // whole units for things counted in pieces
    if (qty >= 1) qty = Math.floor(qty);
    if (qty <= 1e-6) continue;
    const q = sellQuote(s, it.id, qty);
    if (q.total < 1) continue;
    out.push({ item: it.id, qty, value: q.total, keep, capped: extra > cap + 1e-6 });
  }
  return out.sort((a, b) => b.value - a.value);
}

export function sellSurplus(s: GameState): { lines: number; value: number; capped: boolean } {
  const plan = surplusPlan(s);
  let value = 0;
  for (const l of plan) value += executeSell(s, l.item, l.qty);
  return { lines: plan.length, value, capped: plan.some((l) => l.capped) };
}
