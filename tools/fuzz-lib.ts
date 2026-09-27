/**
 * Random-command fuzzing for the rule engine (used by tools/fuzz.ts and the
 * unit tests). Commands are the kinds the UI can send, including refused ones.
 */
import { DATA } from '../src/data';
import { applyCommand, createInitialState, runTicks, type Command, type GameState } from '../src/core';
import { completeResearch } from '../src/core/research';
import { deserialize, serialize } from '../src/save/SaveStore';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function check(s: GameState, where: string) {
  const bad = (msg: string) => {
    throw new Error(`${where}: ${msg}`);
  };
  const fin = (v: number, name: string) => {
    if (!Number.isFinite(v)) bad(`${name} is ${v}`);
  };
  fin(s.cash, 'cash');
  fin(s.loan, 'loan');
  if (s.loan < -1e-6) bad(`loan ${s.loan}`);
  for (const [k, v] of Object.entries(s.inventory)) {
    fin(v, `inventory.${k}`);
    if (v < -1e-6) bad(`inventory.${k} = ${v}`);
  }
  for (const [k, m] of Object.entries(s.market)) {
    fin(m.index, `market.${k}.index`);
    fin(m.flow, `market.${k}.flow`);
    fin(m.shock, `market.${k}.shock`);
    if (m.index < DATA.balance.market.priceFloor - 1e-9 || m.index > DATA.balance.market.priceCeil + 1e-9) bad(`market.${k}.index ${m.index}`);
  }
  for (const [k, v] of Object.entries(s.power)) if (typeof v === 'number') fin(v, `power.${k}`);
  for (const [k, v] of Object.entries(s.logistics)) if (typeof v === 'number') fin(v, `logistics.${k}`);
  if (s.logistics.trucks < 0) bad('negative trucks');
  fin(s.research.progress, 'research.progress');
  if (s.research.current && s.research.done.includes(s.research.current)) bad(`researching finished ${s.research.current}`);
  for (const [t, v] of Object.entries(s.research.saved)) {
    fin(v, `research.saved.${t}`);
    if (s.research.done.includes(t)) bad(`saved progress kept for finished ${t}`);
  }
  const fids = new Set<number>();
  for (const f of s.facilities) {
    if (fids.has(f.id)) bad(`duplicate facility ${f.id}`);
    fids.add(f.id);
    fin(f.util, `f${f.id}.util`);
    fin(f.rate, `f${f.id}.rate`);
    if (f.machines < 0) bad(`f${f.id}.machines ${f.machines}`);
    if (f.level < 0 || f.level > DATA.facility[f.type].maxLevel) bad(`f${f.id}.level ${f.level}`);
    for (const [k, v] of Object.entries(f.stats)) if (typeof v === 'number') fin(v, `f${f.id}.stats.${k}`);
  }
  const eids = new Set<number>();
  for (const e of s.employees) {
    if (eids.has(e.id)) bad(`duplicate employee ${e.id}`);
    eids.add(e.id);
    if (e.assignedTo !== null && !fids.has(e.assignedTo)) bad(`employee ${e.id} assigned to missing facility ${e.assignedTo}`);
    fin(e.salary, `e${e.id}.salary`);
  }
  for (const f of s.facilities) {
    if (f.managerId === null) continue;
    const m = s.employees.find((e) => e.id === f.managerId);
    if (!m) bad(`f${f.id} manager ${f.managerId} is gone`);
    else if (m.role !== 'manager') bad(`f${f.id} manager ${m.id} has role ${m.role}`);
    else if (m.assignedTo !== f.id) bad(`f${f.id} manager ${m.id} assignedTo ${m.assignedTo}`);
  }
  for (const e of s.employees) {
    if (e.role !== 'manager' || e.assignedTo === null) continue;
    const f = s.facilities.find((x) => x.id === e.assignedTo);
    if (f && f.managerId !== e.id) bad(`manager ${e.id} sits at f${f.id} without being its manager`);
  }
  if (s.candidates.length > 24) bad(`${s.candidates.length} candidates`);
  if (s.notices.length > 120) bad(`${s.notices.length} notices`);
  for (const c of s.contracts) fin(c.price, `contract ${c.id} price`);
  for (const d of s.finance.days) for (const [k, v] of Object.entries(d)) if (typeof v === 'number') fin(v, `finance.day.${k}`);
}

export function randomCommand(s: GameState, r: () => number): Command {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const fac = () => (s.facilities.length ? pick(s.facilities) : null);
  const emp = () => (s.employees.length ? pick(s.employees) : null);
  const item = () => pick(DATA.items).id;
  const qty = () => pick([0, 0.5, 1, 3, 10, 100, 1000, 1e5, 1e9]);
  const roll = Math.floor(r() * 34);
  switch (roll) {
    case 0:
      return { type: 'gather', facilityId: fac()?.id ?? -1 };
    case 1: {
      const d = pick(DATA.facilities);
      return { type: 'build', facility: d.id, recipe: r() < 0.7 ? pick(d.recipes.length ? d.recipes : ['x']) : undefined };
    }
    case 2:
      return { type: 'upgradeLevel', facilityId: fac()?.id ?? -1 };
    case 3:
      return { type: 'buyMachine', facilityId: fac()?.id ?? -1, count: pick([1, 1, 2, 5, 50]) };
    case 4:
      return { type: 'automate', facilityId: fac()?.id ?? -1 };
    case 5: {
      const f = fac();
      const recipes = f ? DATA.facility[f.type].recipes : [];
      return { type: 'setRecipe', facilityId: f?.id ?? -1, recipe: recipes.length && r() < 0.8 ? pick(recipes) : pick(DATA.recipes).id };
    }
    case 6:
    case 7:
      return { type: 'hire', candidateId: s.candidates.length ? pick(s.candidates).id : -1 };
    case 8:
      return { type: 'bulkHire' };
    case 9:
      return { type: 'fire', employeeId: emp()?.id ?? -1 };
    case 10:
    case 11:
      return { type: 'assign', employeeId: emp()?.id ?? -1, facilityId: r() < 0.15 ? null : fac()?.id ?? -1 };
    case 12:
      return { type: 'autoAssign' };
    case 13:
      return { type: 'promote', employeeId: emp()?.id ?? -1, role: pick(['worker', 'engineer', 'researcher', 'manager'] as const) };
    case 14: {
      const managers = s.employees.filter((e) => e.role === 'manager');
      return { type: 'setManager', facilityId: fac()?.id ?? -1, employeeId: r() < 0.2 ? null : managers.length ? pick(managers).id : emp()?.id ?? -1 };
    }
    case 15:
    case 16:
      return { type: 'sell', item: item(), qty: qty() };
    case 17:
      return { type: 'buy', item: item(), qty: qty() };
    case 18:
      return { type: 'contract', item: item(), side: pick(['buy', 'sell'] as const), perDay: pick([0, 1, 10, 500]), days: pick([0, 1, 7, 30, 90]) };
    case 19:
      return { type: 'cancelContract', contractId: s.contracts.length ? pick(s.contracts).id : -1 };
    case 20:
      return {
        type: 'setAutoTrade',
        item: item(),
        rule: r() < 0.2 ? null : { sellAbove: r() < 0.5 ? null : qty(), buyBelow: r() < 0.5 ? null : qty(), minIndex: pick([0, 0.5, 0.9, 1.2]), maxIndex: pick([0.8, 1.1, 1.5, 3]) },
      };
    case 21: {
      const f = fac();
      const vars = ['stock', 'stockDays', 'price', 'demand', 'margin', 'powerUse', 'powerPrice', 'cash'] as const;
      return {
        type: 'setAutomation',
        facilityId: f?.id ?? -1,
        settings: {
          enabled: r() < 0.8,
          mode: pick(['easy', 'standard', 'advanced'] as const),
          policy: pick(['stable', 'profit', 'max', 'eco', 'custom'] as const),
          targetStock: qty(),
          powerCap: pick([0, 0.5, 0.9, 2]),
          startBelow: qty(),
          stopAbove: qty(),
          rules: Array.from({ length: Math.floor(r() * 3) }, () => ({
            rate: pick([0, 0.5, 1, 1.5, 3]),
            conds: Array.from({ length: Math.floor(r() * 3) }, () => ({ v: pick(vars), item: r() < 0.5 ? item() : undefined, op: pick(['<', '>'] as const), value: pick([0, 0.5, 1, 100, 1e6]) })),
          })),
        },
      };
    }
    case 22:
      return { type: 'setPowerContract', contract: pick(DATA.balance.power.contracts).id };
    case 23:
      return { type: 'setFuel', facilityId: fac()?.id ?? -1, fuel: pick(['coal', 'natural_gas', 'fuel', 'log']) };
    case 24:
      return { type: 'addTrucks', count: pick([1, 1, 5, 40]) };
    case 25:
      return { type: 'removeTrucks', count: pick([1, 5, 100]) };
    case 26:
      return { type: 'setRail', on: r() < 0.5 };
    case 27:
      return { type: 'research', tech: pick(DATA.techs).id };
    case 28:
      return { type: 'borrow', amount: pick([1e5, 1e7, 1e9, 1e12]) };
    case 29:
      return { type: 'repay', amount: pick([1e5, 1e7, 1e12]) };
    case 30:
      return { type: 'upgradeHQ' };
    case 31:
      return { type: 'rename', facilityId: fac()?.id ?? -1, name: pick(['', '  ', '新工場', 'x'.repeat(100)]) };
    case 32:
      return { type: 'setSpeed', speed: pick([0, 1, 4, 12, 48, 3]) };
    default:
      return pick<Command>([{ type: 'resumeFromAutoPause' }, { type: 'readNotices' }, { type: 'renameCompany', name: pick(['', '新社名']) }]);
  }
}


export interface FuzzResult {
  failure: string | null;
  counts: Record<string, { ok: number; no: number }>;
}

/**
 * One company: mode 0 fresh, 1 mid-way (every goal feature, research open),
 * 2 with everything researched. Throws nothing; returns the first broken invariant.
 */
export function fuzzRun(run: number, steps: number, mode = run % 3): FuzzResult {
  const counts: Record<string, { ok: number; no: number }> = {};
  const r = rng(1000 + run);
  const s = createInitialState({ seed: run + 1 });
  if (mode > 0) {
    for (const g of DATA.goals) for (const f of g.unlocks) s.features[f] = true;
    s.cash = mode === 1 ? 1e9 : 5e10;
  }
  if (mode === 2) for (const t of DATA.techs) completeResearch(s, t.id);
  let last = '';
  try {
    for (let i = 0; i < steps; i++) {
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const cmd = randomCommand(s, r);
        last = JSON.stringify(cmd);
        const res = applyCommand(s, cmd);
        const c = (counts[cmd.type] ??= { ok: 0, no: 0 });
        if (res.ok) c.ok++;
        else c.no++;
        check(s, `run ${run} step ${i} after ${cmd.type}`);
      }
      runTicks(s, Math.floor(r() * 480), false);
      last = 'runTicks';
      check(s, `run ${run} step ${i} after ticks`);
    }
    const back = deserialize(serialize(s)).state;
    if (JSON.stringify(back) !== JSON.stringify(s)) throw new Error(`run ${run}: save round trip changed the state`);
    return { failure: null, counts };
  } catch (e) {
    return { failure: `${e instanceof Error ? e.stack?.split('\n').slice(0, 4).join('\n') : e}\n    last: ${last}`, counts };
  }
}
