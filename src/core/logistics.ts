import { DATA } from '../data';
import { mods } from './mods';
import type { GameState } from './types';
import { hasFeature, pay } from './util';

export function logisticsCapacity(s: GameState): number {
  const b = DATA.balance.logistics;
  let cap = DATA.balance.hq[s.hq.level - 1].logistics + s.logistics.trucks * b.truckCapacity;
  for (const f of s.facilities) {
    if (f.type === 'logistics_center' && !f.building) cap += (DATA.facility[f.type].logistics ?? 0) * f.level;
  }
  if (s.logistics.rail && hasFeature(s, 'rail')) cap += b.railCapacity;
  return cap * mods(s).logistics;
}

/** share of the truck cost we still pay after logistics centres */
function costCut(s: GameState): number {
  let cut = 0;
  for (const f of s.facilities) {
    if (f.type === 'logistics_center' && !f.building) cut += DATA.facility[f.type].logisticsCostCut ?? 0;
  }
  return Math.max(0.3, 1 - cut) * mods(s).logisticsCost;
}

export function costPerTon(s: GameState): number {
  return DATA.balance.logistics.costPerTon * costCut(s);
}

export function refreshLogistics(s: GameState) {
  const b = DATA.balance.logistics;
  const l = s.logistics;
  l.capacity = logisticsCapacity(s);
  // overflow ships with outside carriers; deliveries slow down a little
  const over = l.capacity > 0 ? l.load / l.capacity - 1 : l.load > 0 ? 10 : 0;
  l.ratio = over > 0 ? 1 - Math.min(b.maxDelayPenalty, over * b.delaySlope) : 1;
}

/** tonnes per day over our own capacity (shipped by outside carriers) */
export function outsourcedTons(s: GameState): number {
  return Math.max(0, s.logistics.load - s.logistics.capacity);
}

/** end of day: pay freight and truck upkeep, update the load estimate */
export function dailyLogistics(s: GameState, wantedToday: number) {
  const b = DATA.balance.logistics;
  const l = s.logistics;
  const moved = l.movedToday;
  const own = Math.min(moved, l.capacity);
  const outside = moved - own;
  let freight = outside * costPerTon(s) * b.outsourcePremium;
  if (l.rail && hasFeature(s, 'rail')) {
    const railCap = b.railCapacity * mods(s).logistics;
    const railTons = Math.min(own, railCap);
    freight += (own - railTons) * costPerTon(s) + railTons * b.railCostPerTon * mods(s).logisticsCost;
    pay(s, 'logistics', b.railMonthlyFee / 30);
  } else {
    freight += own * costPerTon(s);
  }
  pay(s, 'logistics', freight + l.trucks * b.truckUpkeep);
  // smooth the wanted load so a single big purchase does not choke production
  l.load = l.load * 0.5 + wantedToday * 0.5;
  l.movedToday = 0;
  refreshLogistics(s);
}

/** management points: facilities and head count against the head office's capacity */
export function managementLoad(s: GameState): number {
  const m = DATA.balance.management;
  let pts = 0;
  for (const f of s.facilities) {
    if (f.level === 0) pts += 0.5 * m.perFacility;
    else pts += f.managerId !== null ? m.perFacilityWithManager : m.perFacility;
  }
  pts += s.employees.length / m.employeesPerPoint;
  return pts;
}

export function managementCapacity(s: GameState): number {
  return DATA.balance.hq[s.hq.level - 1].management * mods(s).management;
}

export function managementFactor(s: GameState): number {
  const m = DATA.balance.management;
  const over = managementLoad(s) / managementCapacity(s) - 1;
  if (over <= 0) return 1;
  return 1 - Math.min(m.maxPenalty, over * m.penaltySlope);
}
