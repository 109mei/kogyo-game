import { DATA, type Facility } from '../data';
import { dayOf } from './calendar';
import { mods, rateMod } from './mods';
import { pick } from './rng';
import { employeesAt, skillMult, workerPower } from './staff';
import type { AutomationSettings, FacilityState, GameState } from './types';
import { newId } from './util';

export function defOf(f: FacilityState): Facility {
  return DATA.facility[f.type];
}

export function isProduction(def: Facility): boolean {
  return def.category !== 'infrastructure';
}

export function maxMachines(s: GameState, f: FacilityState): number {
  const def = defOf(f);
  if (def.generator) return def.machinesPerLevel * f.level;
  if (!isProduction(def)) return 0;
  return (def.machinesPerLevel + mods(s).machinesPerLevel) * f.level;
}

/** cost to go from the current level to the next (level 0 is the starting workyard) */
export function levelUpCost(f: FacilityState): number {
  const def = defOf(f);
  if (f.level === 0) return def.buildCost;
  return Math.round(def.buildCost * Math.pow(def.levelCostMul, f.level));
}

export function levelUpDays(f: FacilityState): number {
  const def = defOf(f);
  return def.buildDays * (1 + 0.5 * f.level);
}

/** price of one more machine (automatic machines include the conversion) */
export function machinePrice(f: FacilityState): number {
  const def = defOf(f);
  if (def.generator) return def.generator.unitCost + (f.stage === 'auto' ? def.generator.autoCost : 0);
  if (!def.machine) return Infinity;
  return def.machine.cost + (f.stage === 'auto' ? (def.auto?.cost ?? 0) : 0);
}

export function automateCost(f: FacilityState): number {
  const def = defOf(f);
  if (def.generator) return def.generator.autoCost * f.machines;
  return (def.auto?.cost ?? Infinity) * f.machines;
}

export function upkeepPerDay(f: FacilityState): number {
  if (f.level === 0) return 0;
  const def = defOf(f);
  const p = DATA.balance.production;
  let u = def.upkeep * Math.pow(p.levelUpkeepMul, f.level - 1);
  if (def.generator) u += f.machines * DATA.balance.power.plantUpkeepPerUnit;
  else if (def.machine && f.stage !== 'manual') {
    u += f.machines * def.machine.cost * p.machineUpkeepRate;
    if (f.stage === 'auto') u += f.machines * (def.auto?.cost ?? 0) * p.autoUpkeepRate;
  }
  return u;
}

export interface Capacity {
  /** batch slots per day at 100% (before power/logistics/management) */
  slots: number;
  staff: number;
  staffNeeded: number;
  /** machines that have operators */
  runningMachines: number;
  /** kW at full activity */
  power: number;
}

/** production capacity from staff and machines */
export function capacity(s: GameState, f: FacilityState): Capacity {
  const def = defOf(f);
  const out: Capacity = { slots: 0, staff: 0, staffNeeded: 0, runningMachines: 0, power: 0 };
  if (!isProduction(def)) return out;
  const staff = employeesAt(s, f.id);
  out.staff = staff.length;
  if (f.stage === 'manual') {
    out.staffNeeded = f.level === 0 ? DATA.balance.start.workyardWorkers : (def.manualWorkers ?? 0) * f.level;
    let p = 0;
    for (const e of staff) p += workerPower(e, def.category);
    out.slots = p * rateMod(s, def, 'manual');
    return out;
  }
  const recipe = f.recipe ? DATA.recipe[f.recipe] : null;
  const powerMul = (recipe?.powerMul ?? 1) * mods(s).power * (mods(s).powerByFacility[def.id] ?? 1);
  if (f.stage === 'machine' && def.machine) {
    const ops = def.machine.operators;
    out.staffNeeded = f.machines * ops;
    const running = ops === 0 ? f.machines : Math.min(f.machines, staff.length / ops);
    out.runningMachines = running;
    let skill = 0;
    for (const e of staff) skill += skillMult(e.skill) * (e.role === 'engineer' ? 1.1 : 1);
    const avg = staff.length ? skill / staff.length : 1;
    const opEffect = 1 + (avg - 1) * DATA.balance.staff.operatorSkillEffect;
    out.slots = running * def.machine.rate * opEffect * rateMod(s, def, 'machine');
    out.power = running * def.machine.power * powerMul;
    return out;
  }
  if (f.stage === 'auto' && def.auto) {
    out.runningMachines = f.machines;
    out.slots = f.machines * def.auto.rate * rateMod(s, def, 'auto');
    out.power = f.machines * def.auto.power * powerMul;
  }
  return out;
}

export function defaultAutomation(recipe: string | null): AutomationSettings {
  const r = recipe ? DATA.recipe[recipe] : null;
  // a week of full manual output as a starting target
  const target = r ? Math.max(10, Math.round(r.output * 7)) : 100;
  return {
    enabled: false,
    mode: 'easy',
    policy: 'stable',
    targetStock: target,
    powerCap: 0.9,
    startBelow: target,
    stopAbove: target * 2,
    rules: [],
  };
}

export function placeName(s: GameState): string {
  const used = new Set(s.facilities.map((f) => f.place));
  const free = DATA.names.places.filter((p) => !used.has(p));
  return pick(s, free.length ? free : DATA.names.places);
}

export function facilityName(s: GameState, type: string, place: string): string {
  const def = DATA.facility[type];
  const same = s.facilities.filter((f) => f.type === type && f.place === place).length;
  return `${place}${same ? `第${same + 1}` : ''}${def.name}`;
}

export function createFacility(
  s: GameState,
  type: string,
  opts: { place?: string; level?: number; recipe?: string | null; buildingUntil?: number } = {},
): FacilityState {
  const def = DATA.facility[type];
  const place = opts.place ?? placeName(s);
  const recipe = opts.recipe !== undefined ? opts.recipe : (def.recipes[0] ?? null);
  const generator = def.generator;
  const f: FacilityState = {
    id: newId(s),
    type,
    name: facilityName(s, type, place),
    place,
    level: opts.level ?? 1,
    // facilities without hand work start as machine plants; infrastructure has no stage to speak of
    stage: def.manualWorkers || def.category === 'infrastructure' && !generator ? 'manual' : 'machine',
    machines: 0,
    recipe,
    switchUntil: 0,
    building: opts.buildingUntil ? { kind: 'build', until: opts.buildingUntil, start: s.tick } : null,
    builtDay: Math.floor(dayOf(s.tick)),
    invested: 0,
    auto: defaultAutomation(recipe),
    managerId: null,
    fuel: generator ? Object.keys(generator.fuels)[0] : null,
    rate: 1,
    util: 0,
    blocked: null,
    stats: {
      produced: {},
      maxUtil: 0,
      outValue: 0,
      inValue: 0,
      wages: 0,
      powerCost: 0,
      upkeep: 0,
      profitHist: [],
      utilHist: [],
      batchesToday: 0,
      capacityToday: 0,
      lastOut: 0,
    },
  };
  s.facilities.push(f);
  return f;
}

export function facilityById(s: GameState, id: number): FacilityState | undefined {
  return s.facilities.find((f) => f.id === id);
}

/** facilities that can make an item */
export function producersOf(item: string): string[] {
  const r = DATA.recipe[item];
  return r ? [r.facility] : [];
}
