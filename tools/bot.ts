/**
 * A scripted player for balance runs and "feel" tests. It only uses
 * applyCommand, like the UI, and plays greedily: sell surplus, keep inputs
 * stocked, hire for open slots, research down a priority list, and invest in
 * whatever pays back fastest.
 */
import { DATA } from '../src/data';
import { applyCommand, dayOf, runTicks, type Command, type GameState } from '../src/core';
import { consumptionPerDay } from '../src/core/automation';
import { capacity, levelUpCost, machinePrice, maxMachines, automateCost, defOf } from '../src/core/facilities';
import { loanLimit } from '../src/core/finance';
import { managementCapacity, managementLoad } from '../src/core/logistics';
import { buyQuote, unitPrice } from '../src/core/market';
import { contractAvailable } from '../src/core/power';
import { storageCapacity, storedWeight, tapAmount } from '../src/core/production';
import { plannedFlows } from '../src/core/rates';
import { techAvailable } from '../src/core/research';
import { employeesAt, staffCapacity } from '../src/core/staff';
import { hasFeature, techDone } from '../src/core/util';
import { recipeUnlocked, facilityUnlocked } from '../src/core/visibility';

export const RESEARCH_ORDER = [
  'p_tools', 'p_mech', 'pw_grid', 'm_steel', 'g_hr', 'a_auto', 'g_finance', 'a_rules', 'p_line', 'l_center', 'pw_ehv',
  'g_contract', 'm_ceramics', 's_eco1', 'pw_plant', 'm_parts', 'm_nonferrous', 'a_trade', 'a_managers', 'm_paper',
  'el_motor', 'p_quality', 'm_building', 'm_petro', 'l_mgmt', 'g_org', 'm_engine', 'm_rubber', 'a_advanced',
  'g_recruit', 'e_circuit', 'v_bicycle', 'pw_gas', 's_eco2', 'e_semi', 'el_appliance', 'm_saving', 'e_display',
  'e_battery', 'p_lean', 'a_robot', 'pw_grid3', 'l_rail', 'e_mobile', 'v_ebike', 'v_truck', 'pw_eff', 'g_org2', 's_eco3', 'a_ai', 'g_market',
];

export interface BotLog {
  day: number;
  text: string;
}

export interface BotOptions {
  /** decisions per game day */
  decisionsPerDay?: number;
  log?: (e: BotLog) => void;
  /** keep playing when the game pauses itself (a player would read the problem and continue) */
  resumeOnPause?: boolean;
}

const SALARY = DATA.balance.staff.roles.worker.salary / 30;

export class Bot {
  s: GameState;
  opts: Required<BotOptions>;
  events: BotLog[] = [];
  firsts: Record<string, number> = {};
  failures: Record<string, number> = {};

  constructor(s: GameState, opts: BotOptions = {}) {
    this.s = s;
    this.opts = {
      decisionsPerDay: opts.decisionsPerDay ?? 4,
      log: opts.log ?? (() => {}),
      resumeOnPause: opts.resumeOnPause ?? true,
    };
  }

  private cmd(c: Command, why = ''): boolean {
    const r = applyCommand(this.s, c);
    if (r.ok) {
      const text = `${c.type} ${JSON.stringify(c).slice(0, 120)} ${why}`;
      const e = { day: dayOf(this.s.tick), text };
      this.events.push(e);
      this.opts.log(e);
    } else {
      this.failures[c.type + ':' + (r.message ?? '')] = (this.failures[c.type + ':' + (r.message ?? '')] ?? 0) + 1;
    }
    return r.ok;
  }

  private mark(key: string) {
    if (this.firsts[key] === undefined) this.firsts[key] = dayOf(this.s.tick);
  }

  /** play for n game days */
  play(days: number) {
    const tpd = DATA.balance.time.ticksPerDay;
    const step = Math.max(1, Math.round(tpd / this.opts.decisionsPerDay));
    const end = this.s.tick + Math.round(days * tpd);
    while (this.s.tick < end) {
      this.decide();
      if (this.s.paused && this.opts.resumeOnPause) this.cmd({ type: 'resumeFromAutoPause' });
      runTicks(this.s, Math.min(step, end - this.s.tick), false);
      this.observe();
    }
  }

  private observe() {
    const s = this.s;
    if (s.employees.length) this.mark('firstHire');
    if (s.facilities.some((f) => f.level >= 1 && !f.building && f.recipe && defOf(f).category !== 'infrastructure' && f.builtDay >= 0 && f.id > 3)) this.mark('firstBuild');
    if (s.facilities.some((f) => f.machines > 0 && defOf(f).category !== 'infrastructure')) this.mark('firstMachine');
    if (s.facilities.some((f) => f.stage === 'auto' && f.machines > 0)) this.mark('firstAuto');
    if (s.facilities.some((f) => f.auto.enabled)) this.mark('firstRules');
    if ((s.totals.produced.steel ?? 0) > 0) this.mark('firstSteel');
    if ((s.totals.produced.furniture ?? 0) > 0) this.mark('firstFurniture');
    if ((s.totals.produced.motor ?? 0) > 0) this.mark('firstMotor');
    if ((s.totals.produced.semiconductor ?? 0) > 0) this.mark('firstSemi');
    if ((s.totals.produced.smartphone ?? 0) > 0) this.mark('firstPhone');
    if ((s.totals.produced.small_truck ?? 0) > 0) this.mark('firstTruck');
    if (s.facilities.some((f) => f.type === 'power_plant' && !f.building && f.machines > 0)) this.mark('firstPlant');
    const worth = s.cash + this.assets();
    if (worth >= 28_400_000) this.mark('worth2840man');
    if (worth >= 284_200_000) this.mark('worth2.84oku');
  }

  assets(): number {
    let v = 0;
    for (const f of this.s.facilities) v += f.invested;
    return v - this.s.loan;
  }

  decide() {
    const s = this.s;
    this.tutorial();
    if (!hasFeature(s, 'market')) return;
    this.trade();
    if (hasFeature(s, 'hire')) this.staff();
    if (hasFeature(s, 'research')) this.research();
    this.power();
    this.logistics();
    this.finance();
    if (hasFeature(s, 'build')) {
      this.goalBuild();
      for (let i = 0; i < 3; i++) if (!this.invest()) break;
    }
    if (hasFeature(s, 'rules')) this.automation();
    if (hasFeature(s, 'managers')) this.managers();
  }

  // ---------------------------------------------------------------------------------------------

  private tutorial() {
    const s = this.s;
    if (!s.owner.job) {
      // the owner keeps working with their hands while there is manual work
      const manual = s.facilities.filter((f) => f.stage === 'manual' && f.recipe && !f.building);
      const best = manual
        .filter((f) => {
          const r = DATA.recipe[f.recipe!];
          return Object.entries(r.inputs).every(([i, q]) => (s.inventory[i] ?? 0) >= q * tapAmount(r.id));
        })
        .sort((a, b) => DATA.recipe[b.recipe!].valueAdded - DATA.recipe[a.recipe!].valueAdded)[0];
      if (best && (s.owner.taps < 3 || s.employees.length < 12)) this.cmd({ type: 'gather', facilityId: best.id });
    }
    if (hasFeature(s, 'market') && !hasFeature(s, 'hire') && (s.inventory.log ?? 0) >= 1) {
      this.cmd({ type: 'sell', item: 'log', qty: s.inventory.log });
    }
    if (hasFeature(s, 'speed') && s.speed < 4) this.cmd({ type: 'setSpeed', speed: 4 });
  }

  /** like a player following the on-screen goal: build what it asks for once affordable */
  private goalBuild() {
    const s = this.s;
    const g = DATA.goals.find((x) => !s.goals.done.includes(x.id));
    if (!g) return;
    const c = g.condition;
    let facility: string | null = null;
    let recipe: string | undefined;
    if (c.type === 'produced') {
      const r = DATA.recipe[c.item];
      if (!r || !recipeUnlocked(s, r.id) || !facilityUnlocked(s, r.facility)) return;
      if (s.facilities.some((f) => f.recipe === r.id)) return;
      facility = r.facility;
      recipe = r.id;
    } else if (c.type === 'researchers') {
      if (s.facilities.some((f) => f.type === 'research_lab')) return;
      facility = 'research_lab';
    }
    if (!facility) return;
    if (s.cash >= DATA.facility[facility].buildCost + 3e5) this.cmd({ type: 'build', facility, recipe }, `goal ${g.id}`);
  }

  private trade() {
    const s = this.s;
    const flows = plannedFlows(s);
    for (const it of DATA.items) {
      const stock = s.inventory[it.id] ?? 0;
      const use = Math.max(consumptionPerDay(s, it.id), flows.cons[it.id] ?? 0);
      const keep = use * 4;
      if (stock > keep + 1e-6) {
        // do not flood a market: at most a day's worth of its size at once
        const qty = Math.min(stock - keep, it.demand * 0.5);
        if (qty > 0 && (s.market[it.id].index > 0.6 || stock > keep * 3 + it.demand * 0.2)) this.cmd({ type: 'sell', item: it.id, qty });
      } else if (use > 0 && stock < use * 2) {
        const made = flows.prod[it.id] ?? 0;
        if (made >= use * 1.05) continue;
        const qty = use * 3 - stock;
        const q = buyQuote(s, it.id, qty);
        if (s.market[it.id].index < 1.4 && q.total < s.cash * 0.3) this.cmd({ type: 'buy', item: it.id, qty }, 'restock');
      }
    }
  }

  private openSlots(): number {
    let n = 0;
    for (const f of this.s.facilities) {
      if (f.building && f.building.kind === 'build') continue;
      if (defOf(f).category === 'infrastructure' && f.type !== 'research_lab' && f.type !== 'power_plant') continue;
      n += Math.max(0, staffCapacity(this.s, f) - employeesAt(this.s, f.id).length);
    }
    return n;
  }

  private staff() {
    const s = this.s;
    const idle = s.employees.filter((e) => e.assignedTo === null && e.role !== 'manager');
    if (idle.length) this.cmd({ type: 'autoAssign' });
    const labs = s.facilities.filter((f) => f.type === 'research_lab' && !(f.building && f.building.kind === 'build'));
    const labRoom = labs.reduce((t, f) => t + staffCapacity(s, f) - employeesAt(s, f.id).length, 0);
    const prodRoom = this.openSlots() - labRoom;
    const payroll = s.employees.reduce((t, e) => t + e.salary, 0) / 30;
    const profit = this.recentProfit();
    for (const c of [...s.candidates]) {
      if (s.cash < DATA.balance.staff.hireFee + payroll * 20) break;
      if (c.role === 'researcher' && labRoom > 0 && s.employees.filter((e) => e.role === 'researcher').length < this.researcherTarget()) {
        this.cmd({ type: 'hire', candidateId: c.id }, 'researcher');
        continue;
      }
      const workersIdle = s.employees.filter((e) => e.assignedTo === null && e.role !== 'manager' && e.role !== 'researcher').length;
      if ((c.role === 'worker' || c.role === 'engineer') && prodRoom + 1 > workersIdle && (profit > -payroll || s.cash > payroll * 60)) {
        this.cmd({ type: 'hire', candidateId: c.id }, 'worker');
        continue;
      }
      if (c.role === 'manager' && hasFeature(s, 'managers') && s.facilities.filter((f) => f.managerId === null && f.stage !== 'manual' && f.recipe).length > 2 && s.cash > 5e7) {
        this.cmd({ type: 'hire', candidateId: c.id }, 'manager');
      }
    }
    if (s.employees.some((e) => e.assignedTo === null && e.role !== 'manager')) this.cmd({ type: 'autoAssign' });
    if (hasFeature(s, 'bulkHire') && prodRoom > 15 && s.cash > 5e8) this.cmd({ type: 'bulkHire' });
  }

  private researcherTarget(): number {
    const d = dayOf(this.s.tick);
    return d < 120 ? 2 : d < 400 ? 6 : d < 900 ? 14 : 30;
  }

  private recentProfit(): number {
    const d = this.s.finance.days.slice(-7);
    if (!d.length) return 0;
    return d.reduce((t, r) => t + r.sales - r.purchases - r.salaries - r.power - r.logistics - r.upkeep - r.interest - r.other, 0) / d.length;
  }

  /** research that fixes a shortage the company is already feeling */
  private urgentResearch(): string | null {
    const s = this.s;
    const pick = (ids: string[]) => ids.find((id) => !techDone(s, id) && techAvailable(s, id)) ?? null;
    // once the company can build power plants, generators fix shortages; research is not the answer
    if (s.power.demand > this.maxPowerSupply() * 0.8 && !techDone(s, 'pw_plant')) {
      const t = pick(['pw_grid', 'pw_ehv', 'pw_plant']);
      if (t) return t;
    }
    // trucks carry most of the load; only the cheap logistics centre is worth rushing
    if (s.logistics.load > s.logistics.capacity * 0.9) {
      const t = pick(['l_center']);
      if (t) return t;
    }
    return null;
  }

  /** the most power the company can get today: best contract on offer plus its own plants */
  private maxPowerSupply(): number {
    const s = this.s;
    const best = DATA.balance.power.contracts.filter((c) => contractAvailable(s, c.id)).reduce((m, c) => Math.max(m, c.capacity), 0);
    return best + s.power.plantCapacity;
  }

  private research() {
    const s = this.s;
    if (s.research.current) {
      // drop everything for an urgent fix; progress on the old theme is kept
      const urgent = this.urgentResearch();
      if (urgent && urgent !== s.research.current && !['pw_grid', 'pw_ehv', 'pw_plant', 'l_center'].includes(s.research.current)) {
        this.cmd({ type: 'research', tech: urgent }, 'urgent');
      }
      return;
    }
    const urgent = this.urgentResearch();
    if (urgent) {
      this.cmd({ type: 'research', tech: urgent }, 'urgent');
      return;
    }
    for (const id of RESEARCH_ORDER) {
      if (!techDone(s, id) && techAvailable(s, id)) {
        this.cmd({ type: 'research', tech: id });
        return;
      }
    }
  }

  private power() {
    const s = this.s;
    if (!hasFeature(s, 'machine')) return;
    const want = s.power.demand * 1.25 + this.pendingPower();
    const contracts = DATA.balance.power.contracts;
    const cur = contracts.find((c) => c.id === s.power.contract)!;
    const own = s.power.plantCapacity;
    if (cur.capacity + own < want) {
      const next = contracts.find((c) => c.capacity + own >= want && contractAvailable(s, c.id)) ?? [...contracts].reverse().find((c) => contractAvailable(s, c.id));
      if (next && next.id !== cur.id && next.capacity > cur.capacity) this.cmd({ type: 'setPowerContract', contract: next.id }, 'power');
    }
    // fuel for plants
    for (const f of s.facilities.filter((x) => x.type === 'power_plant')) {
      const fuel = f.fuel ?? 'coal';
      const perDay = s.power.plantOutput * 24 * (defOf(f).generator!.fuels[fuel] ?? 0);
      if ((s.inventory[fuel] ?? 0) < perDay * 3) {
        const qty = perDay * 5;
        if (buyQuote(s, fuel, qty).total < s.cash * 0.5) this.cmd({ type: 'buy', item: fuel, qty }, 'fuel');
      }
    }
  }

  /** kW of machines we are about to switch on (ordered, not yet powered) */
  private pendingPower(): number {
    return 0;
  }

  private logistics() {
    const s = this.s;
    const l = s.logistics;
    if (l.load > l.capacity * 0.85) {
      const center = DATA.facility.logistics_center;
      const building = s.facilities.some((f) => f.type === 'logistics_center' && f.building);
      if (facilityUnlocked(s, 'logistics_center') && !building && l.load > l.capacity * 1.1 && center.buildCost < s.cash * 0.6) {
        this.cmd({ type: 'build', facility: 'logistics_center' }, 'logistics center');
      } else {
        const each = unitPrice(s, 'small_truck') * 1.1;
        const want = Math.ceil((l.load * 1.3 - l.capacity) / DATA.balance.logistics.truckCapacity);
        const n = Math.min(want, Math.floor((s.cash * 0.6) / each));
        if (n > 0) this.cmd({ type: 'addTrucks', count: n }, 'logistics');
      }
    }
    if (storedWeight(s) > storageCapacity(s) * 0.85) {
      const wh = s.facilities.find((f) => f.type === 'warehouse' && !f.building && f.level < DATA.facility.warehouse.maxLevel);
      if (wh && levelUpCost(wh) < s.cash * 0.3) this.cmd({ type: 'upgradeLevel', facilityId: wh.id }, 'storage');
      else if (!wh && hasFeature(s, 'build') && DATA.facility.warehouse.buildCost < s.cash * 0.3) this.cmd({ type: 'build', facility: 'warehouse' }, 'storage');
    }
    if (managementLoad(s) > managementCapacity(s) * 0.95 && !s.hq.building) {
      const next = DATA.balance.hq[s.hq.level];
      if (next && next.cost < s.cash * 0.4) this.cmd({ type: 'upgradeHQ' }, 'management');
    }
  }

  private finance() {
    const s = this.s;
    if (s.cash < 0) {
      const room = loanLimit(s) - s.loan;
      if (room > 0) this.cmd({ type: 'borrow', amount: Math.min(room, -s.cash + 5e6) }, 'overdraft');
    } else if (s.loan > 0 && s.cash > s.loan * 2 + 5e7) {
      this.cmd({ type: 'repay', amount: s.loan }, 'repay');
    }
  }

  // ---- investment ------------------------------------------------------------------------------

  /** yen of value a batch of this recipe adds at today's prices (after the sell spread) */
  private batchMargin(recipeId: string): number {
    const s = this.s;
    const r = DATA.recipe[recipeId];
    let v = r.output * unitPrice(s, r.id) * (1 - DATA.balance.market.sellSpread);
    for (const [inp, q] of Object.entries(r.inputs)) v -= q * unitPrice(s, inp);
    return v;
  }

  private invest(): boolean {
    const s = this.s;
    const reserve = Math.max(3e5, (s.employees.reduce((t, e) => t + e.salary, 0) / 30) * 7);
    const budget = s.cash - reserve;
    if (budget <= 0) return false;
    type Option = { score: number; cost: number; cmd: Command; why: string; kw?: number };
    const opts: Option[] = [];
    const flows = plannedFlows(s);
    const powerRoom = this.maxPowerSupply() * 0.9 - s.power.demand;

    // research lab
    if (!s.facilities.some((f) => f.type === 'research_lab')) {
      const made = (s.totals.produced.furniture ?? 0) + (s.totals.produced.lumber ?? 0);
      if (made > 0) opts.push({ score: 10, cost: DATA.facility.research_lab.buildCost, cmd: { type: 'build', facility: 'research_lab' }, why: 'lab' });
    } else if (s.employees.filter((e) => e.role === 'researcher').length >= this.researcherTarget()) {
      const lab = s.facilities.find((f) => f.type === 'research_lab' && !f.building && staffCapacity(s, f) <= employeesAt(s, f.id).length && f.level < DATA.facility.research_lab.maxLevel);
      if (lab && dayOf(s.tick) > 150) opts.push({ score: 0.02, cost: levelUpCost(lab), cmd: { type: 'upgradeLevel', facilityId: lab.id }, why: 'lab level' });
    }

    for (const f of s.facilities) {
      const def = defOf(f);
      if (def.category === 'infrastructure' || !f.recipe || f.building) continue;
      const r = DATA.recipe[f.recipe];
      const margin = this.batchMargin(r.id);
      if (margin <= 0) continue;
      // upgrade workyards / levels when full
      const cap = capacity(s, f);
      const staffFull = employeesAt(s, f.id).length >= staffCapacity(s, f);
      if (f.stage === 'manual' && f.level < def.maxLevel && (staffFull || f.level === 0) && (!hasFeature(s, 'machine') || f.level === 0)) {
        const gain = (def.manualWorkers ?? 3) * ((margin / r.time) - SALARY);
        const cost = levelUpCost(f);
        if (gain > 0) opts.push({ score: gain / cost, cost, cmd: { type: 'upgradeLevel', facilityId: f.id }, why: `level ${f.name}` });
      }
      // machines (not while the ones already there stand idle, e.g. waiting for inputs)
      const idleMachines = f.machines > 0 && f.stage !== 'manual' && f.blocked === 'inputs' && f.util < 0.75;
      const canMachine = def.machine && (hasFeature(s, 'machine') || !def.manualWorkers) && f.level >= 1 && !idleMachines;
      if (canMachine) {
        if (f.machines < maxMachines(s, f)) {
          const rate = f.stage === 'auto' ? def.auto!.rate : def.machine!.rate;
          const power = (f.stage === 'auto' ? def.auto!.power : def.machine!.power) * 24 * 25;
          const ops = f.stage === 'auto' ? 0 : def.machine!.operators * SALARY;
          const gain = (rate / r.time) * margin - power - ops - (f.stage === 'manual' ? (staffCapacity(s, f) * margin) / r.time / 4 : 0);
          const cost = machinePrice(f);
          const kw = f.stage === 'auto' ? def.auto!.power : def.machine!.power;
          if (gain > 0) opts.push({ score: gain / cost, cost, cmd: { type: 'buyMachine', facilityId: f.id }, why: `machine ${f.name}`, kw });
        } else if (f.level < def.maxLevel && f.stage !== 'manual') {
          const rate = f.stage === 'auto' ? def.auto!.rate : def.machine!.rate;
          const gain = ((rate / r.time) * margin - def.machine!.power * 24 * 25) * def.machinesPerLevel;
          const cost = levelUpCost(f) + machinePrice(f) * def.machinesPerLevel;
          if (gain > 0) opts.push({ score: (gain / cost) * 0.8, cost: levelUpCost(f), cmd: { type: 'upgradeLevel', facilityId: f.id }, why: `expand ${f.name}` });
        }
      }
      // automation frees operators
      if (hasFeature(s, 'auto') && f.stage === 'machine' && f.machines > 0) {
        const short = this.openSlots();
        const saved = def.machine!.operators * f.machines * (short > 0 ? Math.max(SALARY, (def.machine!.rate / r.time) * margin * 0.5) : SALARY);
        const extra = f.machines * ((def.auto!.rate - def.machine!.rate) / r.time) * margin;
        const cost = automateCost(f);
        const gain = saved + extra - f.machines * (def.auto!.power - def.machine!.power) * 24 * 25;
        if (gain > 0) opts.push({ score: gain / cost, cost, cmd: { type: 'automate', facilityId: f.id }, why: `automate ${f.name}`, kw: f.machines * (def.auto!.power - def.machine!.power) });
      }
      void cap;
    }

    // new facilities: recipes whose output we lack or that earn well on the market
    const open = this.openSlots();
    for (const r of DATA.recipes) {
      if (!recipeUnlocked(s, r.id) || !facilityUnlocked(s, r.facility)) continue;
      const def = DATA.facility[r.facility];
      const margin = this.batchMargin(r.id);
      if (margin <= 0) continue;
      const existing = s.facilities.filter((f) => f.recipe === r.id);
      if (def.manualWorkers && open > 1 && existing.length) continue;
      const made = flows.prod[r.id] ?? 0;
      const used = flows.cons[r.id] ?? 0;
      const lacking = used > made * 1.02;
      const saturated = existing.every((f) => {
        if (f.building) return false;
        if (employeesAt(s, f.id).length < staffCapacity(s, f)) return false;
        if (f.stage === 'manual') return !hasFeature(s, 'machine') ? f.level >= 2 : false;
        return f.machines >= maxMachines(s, f) && f.level >= Math.min(defOf(f).maxLevel, 3);
      });
      if (existing.length && !saturated) continue;
      // inputs must be available somewhere (made or cheap on the market)
      const inputsOk = Object.keys(r.inputs).every((inp) => (flows.prod[inp] ?? 0) > 0 || s.market[inp].index < 1.3);
      if (!inputsOk) continue;
      const perDay = def.manualWorkers ? def.manualWorkers : def.machine!.rate;
      const gain = (perDay / r.time) * margin - (def.manualWorkers ? def.manualWorkers * SALARY : def.machine!.power * 24 * 25 + def.machine!.operators * SALARY);
      const cost = def.buildCost + (def.manualWorkers ? 0 : def.machine!.cost);
      if (gain <= 0) continue;
      const bonus = lacking ? 2 : existing.length ? 0.5 : 1;
      opts.push({ score: (gain / cost) * bonus, cost: def.buildCost, cmd: { type: 'build', facility: def.id, recipe: r.id }, why: `build ${r.id}${lacking ? ' (lacking)' : ''}`, kw: def.manualWorkers ? 0 : def.machine!.power });
    }

    // power plant when the grid bill is large
    if (facilityUnlocked(s, 'power_plant') && s.power.demand > 3000) {
      const plant = s.facilities.find((f) => f.type === 'power_plant');
      if (!plant) opts.push({ score: 0.01, cost: DATA.facility.power_plant.buildCost, cmd: { type: 'build', facility: 'power_plant' }, why: 'plant' });
      else if (!plant.building && plant.machines < maxMachines(s, plant) && s.power.demand > s.power.plantCapacity * 0.8) {
        opts.push({ score: 0.02, cost: machinePrice(plant), cmd: { type: 'buyMachine', facilityId: plant.id }, why: 'generator' });
      }
    }

    // machines need power: without room, the best blocked option turns into a power plant
    let blocked = 0;
    for (const o of opts) if ((o.kw ?? 0) > powerRoom) blocked = Math.max(blocked, o.score);
    const usable = opts.filter((o) => (o.kw ?? 0) <= powerRoom);
    if (blocked > 0 && facilityUnlocked(s, 'power_plant')) {
      const plant = s.facilities.find((f) => f.type === 'power_plant');
      if (!plant) usable.push({ score: blocked, cost: DATA.facility.power_plant.buildCost, cmd: { type: 'build', facility: 'power_plant' }, why: 'plant (power short)' });
      else if (!plant.building && plant.machines < maxMachines(s, plant)) usable.push({ score: blocked, cost: machinePrice(plant), cmd: { type: 'buyMachine', facilityId: plant.id }, why: 'generator (power short)' });
      else if (!plant.building && plant.level < defOf(plant).maxLevel) usable.push({ score: blocked * 0.8, cost: levelUpCost(plant), cmd: { type: 'upgradeLevel', facilityId: plant.id }, why: 'plant level (power short)' });
    }
    opts.length = 0;
    opts.push(...usable);
    opts.sort((a, b) => b.score - a.score);
    const good = opts.filter((o) => o.score >= 1 / 400);
    if (!good.length) return false;
    const best = good[0];
    if (best.cost <= budget) return this.cmd(best.cmd, best.why);
    // like a sensible owner, borrow for an investment that pays back within two months
    const room = loanLimit(s) * 0.5 - s.loan;
    const healthy = s.power.ratio >= 0.999 && s.logistics.load <= s.logistics.capacity && this.recentProfit() > 0;
    if (healthy && best.score >= 1 / 60 && best.cost <= budget + room && hasFeature(s, 'machine')) {
      this.cmd({ type: 'borrow', amount: best.cost - budget + reserve }, 'invest loan');
      return this.cmd(best.cmd, `${best.why} (loan)`);
    }
    // save up for the best option unless it is far away; meanwhile only take nearly-as-good ones
    const saving = best.cost <= budget * 6;
    for (const o of good.slice(1, 6)) {
      if (o.cost > budget) continue;
      if (saving && o.score < best.score * 0.75) continue;
      if (this.cmd(o.cmd, o.why)) return true;
    }
    return false;
  }

  private automation() {
    const s = this.s;
    for (const f of s.facilities) {
      if (!f.recipe || f.auto.enabled || defOf(f).category === 'infrastructure') continue;
      const use = consumptionPerDay(s, f.recipe);
      if (use <= 0) continue;
      // keep a week of what the next step uses
      this.cmd({ type: 'setAutomation', facilityId: f.id, settings: { ...f.auto, enabled: true, mode: 'easy', policy: 'stable', targetStock: Math.max(10, use * 7) } }, 'stable');
    }
  }

  private managers() {
    const s = this.s;
    const free = s.employees.filter((e) => e.role === 'manager' && e.assignedTo === null);
    for (const m of free) {
      const f = s.facilities.find((x) => x.managerId === null && x.stage !== 'manual' && x.recipe);
      if (!f) break;
      this.cmd({ type: 'setManager', facilityId: f.id, employeeId: m.id }, 'manager');
    }
    for (const e of s.employees) {
      if (e.role === 'worker' && e.skill >= 4 && s.employees.filter((x) => x.role === 'manager').length < s.facilities.length / 4) {
        this.cmd({ type: 'promote', employeeId: e.id, role: 'manager' }, 'promote');
      }
    }
  }
}
