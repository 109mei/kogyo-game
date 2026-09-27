import { DATA } from '../data';
import { defOf } from './facilities';
import { managementFactor } from './logistics';
import { mods } from './mods';
import { fuelPerKwh, isPlant } from './power';
import { isDown, strikeFactor } from './events';
import { capacityCached, managerBonus } from './production';
import type { GameState } from './types';

export interface Flows {
  /** units/day each item is being made at the current settings */
  prod: Record<string, number>;
  /** units/day each item is being used */
  cons: Record<string, number>;
}

/** what the factory is set up to make and use per day right now */
export function plannedFlows(s: GameState): Flows {
  const prod: Record<string, number> = {};
  const cons: Record<string, number> = {};
  const mgmt = managementFactor(s);
  const inputsMul = mods(s).inputs;
  const strike = s.effects.length ? strikeFactor(s) : 1;
  for (const f of s.facilities) {
    const def = defOf(f);
    if (isPlant(f)) {
      const fuel = f.fuel ?? 'coal';
      cons[fuel] = (cons[fuel] ?? 0) + s.power.plantOutput * 24 * fuelPerKwh(s, f) * (s.power.plantCapacity > 0 ? plantShare(s, f) : 0);
      continue;
    }
    if (def.category === 'infrastructure' || !f.recipe) continue;
    if (f.building && f.building.kind === 'build') continue;
    if (s.effects.length && isDown(s, f)) continue;
    const r = DATA.recipe[f.recipe];
    const c = capacityCached(s, f);
    const truck = DATA.item[r.id].transport === 'truck';
    const eff = mgmt * managerBonus(s, f) * (c.power > 0 ? s.power.ratio : 1) * (truck ? s.logistics.ratio : 1) * (f.stage === 'auto' ? 1 : strike);
    const bpd = (c.slots / r.time) * Math.max(0, f.rate) * eff;
    if (bpd <= 0) continue;
    prod[r.id] = (prod[r.id] ?? 0) + bpd * r.output;
    for (const [inp, q] of Object.entries(r.inputs)) cons[inp] = (cons[inp] ?? 0) + bpd * q * inputsMul;
  }
  for (const c of s.contracts) {
    if (c.side === 'buy') prod[c.item] = (prod[c.item] ?? 0) + c.perDay;
    else cons[c.item] = (cons[c.item] ?? 0) + c.perDay;
  }
  return { prod, cons };
}

function plantShare(s: GameState, f: import('./types').FacilityState): number {
  const g = defOf(f).generator;
  if (!g || s.power.plantCapacity <= 0) return 0;
  return (f.machines * g.capacity) / s.power.plantCapacity;
}

function avgLast(arr: number[] | undefined, n: number): number {
  if (!arr || !arr.length) return 0;
  const k = Math.min(n, arr.length);
  let t = 0;
  for (let i = arr.length - k; i < arr.length; i++) t += arr[i];
  return t / k;
}

export interface ItemRates {
  produced: number;
  consumed: number;
  sold: number;
  bought: number;
}

/** 7-day average of what actually happened */
export function actualRates(s: GameState, item: string, days = 7): ItemRates {
  const h = s.itemHist[item];
  return {
    produced: avgLast(h?.produced, days),
    consumed: avgLast(h?.consumed, days),
    sold: avgLast(h?.sold, days),
    bought: avgLast(h?.bought, days),
  };
}
