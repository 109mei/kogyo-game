import { DATA } from '../data';
import { capacity, defOf, type Capacity } from './facilities';
import { managementFactor } from './logistics';
import { mods } from './mods';
import { gridPrice } from './power';
import { skillMult } from './staff';
import type { FacilityState, GameState } from './types';
import { checkGoals } from './progress';
import { milestone, notify } from './util';

// ---- caches that are not part of the save ------------------------------------------------

const orderCache = new WeakMap<GameState, { n: number; list: FacilityState[] }>();

/** production facilities, upstream first so materials flow down within a tick */
function productionOrder(s: GameState): FacilityState[] {
  const hit = orderCache.get(s);
  // facilities are only ever added, so the length tells us when to rebuild
  if (hit && hit.n === s.facilities.length) return hit.list;
  const rank = new Map(DATA.productionOrder.map((id, i) => [id, i]));
  const list = s.facilities
    .filter((f) => rank.has(f.type))
    .sort((a, b) => rank.get(a.type)! - rank.get(b.type)! || a.id - b.id);
  orderCache.set(s, { n: s.facilities.length, list });
  return list;
}

const capCache = new WeakMap<GameState, Map<number, { key: string; cap: Capacity }>>();

export function capacityCached(s: GameState, f: FacilityState): Capacity {
  let m = capCache.get(s);
  if (!m) {
    m = new Map();
    capCache.set(s, m);
  }
  const key = `${s.staffRev}|${s.research.done.length}|${f.stage}|${f.machines}|${f.level}|${f.recipe}`;
  const hit = m.get(f.id);
  if (hit && hit.key === key) return hit.cap;
  const cap = capacity(s, f);
  m.set(f.id, { key, cap });
  return cap;
}

// ---- storage ------------------------------------------------------------------------------------

export function storageCapacity(s: GameState): number {
  let cap = DATA.balance.hq[s.hq.level - 1].storage;
  for (const f of s.facilities) {
    if (f.type === 'warehouse' && !(f.building && f.building.kind === 'build')) cap += (DATA.facility.warehouse.storage ?? 0) * f.level;
  }
  return cap;
}

/** tonnes in the warehouse; water, crude oil and gas sit in tanks instead */
export function storedWeight(s: GameState): number {
  let w = 0;
  for (const [item, qty] of Object.entries(s.inventory)) {
    const it = DATA.item[item];
    if (qty > 0 && it.transport === 'truck') w += qty * it.weight;
  }
  return w;
}

// ---- manager bonus -------------------------------------------------------------------------------

export function managerBonus(s: GameState, f: FacilityState): number {
  if (f.managerId === null) return 1;
  const m = s.employees.find((e) => e.id === f.managerId);
  if (!m) return 1;
  return 1 + DATA.balance.staff.managerBonusPerStar * m.skill + mods(s).managerBonus;
}

// ---- the tick --------------------------------------------------------------------------------------

export interface TickTotals {
  powerDemand: number;
  /** tonnes this tick that production wanted to move by truck */
  wantMoved: number;
  /** yen of output made this tick (at market price) */
  outputValue: number;
}

export function tickProduction(s: GameState, dt: number): TickTotals {
  const bal = DATA.balance;
  const pr = s.power.ratio;
  const lr = s.logistics.ratio;
  const mgmt = managementFactor(s);
  const inputsMul = mods(s).inputs;
  const kwhPrice = gridPrice(s);
  const cap = storageCapacity(s);
  let stored = storedWeight(s);
  const totals: TickTotals = { powerDemand: 0, wantMoved: 0, outputValue: 0 };

  for (const f of productionOrder(s)) {
    if (f.building && f.building.kind === 'build') {
      f.blocked = 'building';
      f.util = 0;
      continue;
    }
    if (!f.recipe) {
      f.blocked = 'noRecipe';
      f.util = 0;
      continue;
    }
    if (s.tick < f.switchUntil) {
      f.blocked = 'switching';
      f.util = 0;
      continue;
    }
    const r = DATA.recipe[f.recipe];
    const c = capacityCached(s, f);
    const full = (c.slots / r.time) * dt;
    f.stats.capacityToday += full;
    if (full <= 0) {
      f.blocked = 'noStaff';
      f.util = 0;
      continue;
    }
    const rate = f.rate;
    if (rate <= 0) {
      f.blocked = 'stopped';
      f.util = 0;
      continue;
    }
    const want = full * rate * mgmt * managerBonus(s, f);
    let limit = want;
    let limiter: FacilityState['blocked'] = null;
    for (const inp in r.inputs) {
      const need = r.inputs[inp] * inputsMul;
      const can = (s.inventory[inp] ?? 0) / need;
      if (can < limit) {
        limit = can;
        limiter = 'inputs';
      }
    }
    const outItem = DATA.item[r.id];
    const truckW = (id: string) => (DATA.item[id].transport === 'truck' ? DATA.item[id].weight : 0);
    let netW = r.output * truckW(r.id);
    for (const inp in r.inputs) netW -= r.inputs[inp] * inputsMul * truckW(inp);
    if (netW > 0) {
      const room = Math.max(0, cap - stored) / netW;
      if (room < limit) {
        limit = room;
        limiter = 'storage';
      }
    }
    const desired = Math.max(0, limit);
    // demand is taken before power and logistics limits so the ratios stay stable
    const activity = want > 0 ? desired / want : 0;
    const kw = c.power * activity * (rate <= 1 ? rate : 1 + (rate - 1) * bal.production.overdrivePowerMul);
    totals.powerDemand += kw;
    const truck = outItem.transport === 'truck';
    if (truck) totals.wantMoved += desired * r.output * outItem.weight;
    let batches = desired;
    if (c.power > 0) batches *= pr;
    if (truck) batches *= lr;
    if (!limiter && c.power > 0 && pr < 0.999) limiter = 'power';
    f.blocked = limiter;
    f.util = full > 0 ? batches / full : 0;
    if (batches <= 0) continue;

    for (const inp in r.inputs) {
      const used = batches * r.inputs[inp] * inputsMul;
      s.inventory[inp] -= used;
      if (s.inventory[inp] < 1e-9) s.inventory[inp] = 0;
      s.itemToday[inp].consumed += used;
      f.stats.inValue += used * DATA.basePrice[inp] * s.market[inp].index;
    }
    const made = batches * r.output;
    s.inventory[r.id] = (s.inventory[r.id] ?? 0) + made;
    s.itemToday[r.id].produced += made;
    s.totals.produced[r.id] = (s.totals.produced[r.id] ?? 0) + made;
    f.stats.produced[r.id] = (f.stats.produced[r.id] ?? 0) + made;
    const value = made * DATA.basePrice[r.id] * s.market[r.id].index;
    f.stats.outValue += value;
    totals.outputValue += value;
    f.stats.batchesToday += batches;
    f.stats.powerCost += kw * (c.power > 0 ? pr : 0) * 24 * dt * kwhPrice;
    if (truck) s.logistics.movedToday += made * outItem.weight;
    stored += netW * batches;
  }
  return totals;
}

// ---- the owner's own hands ---------------------------------------------------------------------

export function tapAmount(recipeId: string): number {
  return DATA.recipe[recipeId].tap ?? DATA.balance.time.tapDays;
}

/** real seconds at x1 one tap takes */
export function tapSeconds(recipeId: string): number {
  const r = DATA.recipe[recipeId];
  return tapAmount(recipeId) * r.time * DATA.balance.time.realSecondsPerDay;
}

export function canTap(s: GameState, f: FacilityState): string | null {
  const def = defOf(f);
  if (!def.manualWorkers) return 'この施設は手作業できません';
  if (f.stage !== 'manual') return '機械化した施設は手作業しません';
  if (f.building && f.building.kind === 'build') return '建設中です';
  if (!f.recipe) return 'レシピを選んでください';
  if (s.tick < f.switchUntil) return '段取り替え中です';
  if (s.owner.job) return 'いま別の作業をしています';
  const r = DATA.recipe[f.recipe];
  const amt = tapAmount(r.id);
  for (const [inp, q] of Object.entries(r.inputs)) {
    if ((s.inventory[inp] ?? 0) < q * amt * mods(s).inputs - 1e-9) return `${DATA.item[inp].name}が足りません`;
  }
  return null;
}

export function startTap(s: GameState, f: FacilityState): string | null {
  const err = canTap(s, f);
  if (err) return err;
  const r = DATA.recipe[f.recipe!];
  const amt = tapAmount(r.id);
  for (const [inp, q] of Object.entries(r.inputs)) {
    const used = q * amt * mods(s).inputs;
    s.inventory[inp] -= used;
    s.itemToday[inp].consumed += used;
    f.stats.inValue += used * DATA.basePrice[inp] * s.market[inp].index;
  }
  const ticks = Math.max(1, Math.round(amt * r.time * DATA.balance.time.ticksPerDay));
  s.owner.job = { facilityId: f.id, recipe: r.id, amount: amt, start: s.tick, until: s.tick + ticks };
  return null;
}

export function tickOwner(s: GameState) {
  const job = s.owner.job;
  if (!job || s.tick < job.until) return;
  s.owner.job = null;
  s.owner.taps += 1;
  const r = DATA.recipe[job.recipe];
  const made = job.amount * r.output;
  s.inventory[r.id] = (s.inventory[r.id] ?? 0) + made;
  s.itemToday[r.id].produced += made;
  s.totals.produced[r.id] = (s.totals.produced[r.id] ?? 0) + made;
  const f = s.facilities.find((x) => x.id === job.facilityId);
  if (f) {
    f.stats.produced[r.id] = (f.stats.produced[r.id] ?? 0) + made;
    f.stats.outValue += made * DATA.basePrice[r.id] * s.market[r.id].index;
  }
  if (milestone(s, 'firstTap', 'auto_manual', 'あなたが最初の原料を手に入れた')) {
    notify(s, 'good', 'auto_manual', `${DATA.item[r.id].name}を手に入れました`, '市場で売れば資金になります');
  }
  checkGoals(s);
}

/** productivity of a manager-free facility for the bot and UI: batches/day at full rate */
export function batchesPerDay(s: GameState, f: FacilityState): number {
  if (!f.recipe) return 0;
  const c = capacityCached(s, f);
  return c.slots / DATA.recipe[f.recipe].time;
}

export function skillOf(s: GameState, employeeId: number): number {
  const e = s.employees.find((x) => x.id === employeeId);
  return e ? skillMult(e.skill) : 1;
}
