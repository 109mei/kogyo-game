import { DATA, type PowerContract } from '../data';
import { defOf } from './facilities';
import { mods } from './mods';
import { employeesAt } from './staff';
import { gridFactor } from './events';
import type { FacilityState, GameState } from './types';
import { hasFeature, pay, unlocked } from './util';

export function contractDef(id: string): PowerContract {
  const c = DATA.balance.power.contracts.find((x) => x.id === id);
  if (!c) throw new Error(`unknown power contract ${id}`);
  return c;
}

export function contractAvailable(s: GameState, id: string): boolean {
  const c = contractDef(id);
  if (c.id === 'none') return true;
  if (!hasFeature(s, 'machine')) return false;
  return unlocked(s, c.unlock);
}

export function isPlant(f: FacilityState): boolean {
  return !!defOf(f).generator;
}

export function fuelAllowed(s: GameState, fuel: string): boolean {
  if (fuel === 'coal') return true;
  return hasFeature(s, 'gasPower');
}

/** kW a plant can deliver with its staff (ignoring fuel) */
export function plantCapacity(s: GameState, f: FacilityState): number {
  const g = defOf(f).generator;
  // an expansion keeps the plant running; only a plant still being built is dark
  if (!g || (f.building && f.building.kind === 'build') || f.machines <= 0) return 0;
  if (f.stage === 'auto') return f.machines * g.capacity;
  const staff = employeesAt(s, f.id).length;
  const running = g.operators === 0 ? f.machines : Math.min(f.machines, staff / g.operators);
  return running * g.capacity;
}

export function fuelPerKwh(s: GameState, f: FacilityState): number {
  const g = defOf(f).generator!;
  return (g.fuels[f.fuel ?? 'coal'] ?? 0) * mods(s).fuel;
}

/**
 * Serve this tick's demand: own plants first (fuel only), then the grid up to
 * the contract. Sets the ratio used by production on the next tick.
 */
export function tickPower(s: GameState, dt: number, demandKw: number) {
  const p = s.power;
  const contract = contractDef(p.contract);
  const hours = 24 * dt;
  const plants = s.facilities.filter(isPlant);
  let plantCap = 0;
  let plantOut = 0;
  let remaining = demandKw;
  for (const f of plants) {
    const cap = plantCapacity(s, f);
    plantCap += cap;
    if (cap <= 0 || remaining <= 0) {
      f.util = 0;
      f.blocked = f.building && f.building.kind === 'build' ? 'building' : cap <= 0 ? 'noStaff' : null;
      continue;
    }
    const perKwh = fuelPerKwh(s, f);
    const fuel = f.fuel ?? 'coal';
    let out = Math.min(cap, remaining);
    const need = out * hours * perKwh;
    const have = s.inventory[fuel] ?? 0;
    if (need > have) {
      out = perKwh > 0 ? have / (hours * perKwh) : out;
      f.blocked = 'fuel';
    } else f.blocked = null;
    const used = out * hours * perKwh;
    s.inventory[fuel] = Math.max(0, have - used);
    s.itemToday[fuel].consumed += used;
    f.stats.inValue += used * DATA.basePrice[fuel] * (s.market[fuel]?.index ?? 1);
    f.util = cap > 0 ? out / cap : 0;
    plantOut += out;
    remaining -= out;
  }
  // a blackout cuts what the grid can deliver (the basic fee is still due)
  const gridCap = contract.capacity * (s.effects.length ? gridFactor(s) : 1);
  const gridOut = Math.min(Math.max(0, remaining), gridCap);
  const supplied = plantOut + gridOut;
  // grid bill: energy plus the monthly basic fee spread per tick
  const energyCost = gridOut * hours * contract.energyPrice;
  const basic = (contract.capacity * contract.basicFee * dt) / 30;
  pay(s, 'power', energyCost + basic);
  p.kwhToday += supplied * hours;
  p.costToday += energyCost + basic;
  p.demand = demandKw;
  p.supply = plantCap + gridCap;
  p.gridCapacity = gridCap;
  p.plantCapacity = plantCap;
  p.plantOutput = plantOut;
  p.gridOutput = gridOut;
  p.ratio = demandKw > 1e-9 ? Math.min(1, supplied / demandKw) : 1;
}

/** yen per kWh we pay on the grid right now */
export function gridPrice(s: GameState): number {
  return contractDef(s.power.contract).energyPrice;
}

export function powerUse(s: GameState): number {
  return s.power.supply > 0 ? s.power.demand / s.power.supply : s.power.demand > 0 ? Infinity : 0;
}
