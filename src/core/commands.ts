import { DATA } from '../data';
import { dayIndex } from './calendar';
import {
  automateCost,
  createFacility,
  defaultAutomation,
  defOf,
  facilityById,
  isProduction,
  levelUpCost,
  levelUpDays,
  machinePrice,
  maxMachines,
} from './facilities';
import { invalidateCosts, updateProblems } from './engine';
import { divisionOfHead, ensureDivision, headProblem, members, subsidiaryCost, subsidiaryName } from './divisions';
import { chooseEvent } from './events';
import { acceptOrder, cancelOrder, declineOrder, deliverNow } from './orders';
import { divisionName, inSubsidiary } from './org';
import { sellSurplus } from './surplus';
import { loanLimit } from './finance';
import { refreshLogistics } from './logistics';
import { buyQuote, executeBuy, executeSell, unitPrice } from './market';
import { contractAvailable, fuelAllowed, isPlant } from './power';
import { startTap } from './production';
import { checkGoals } from './progress';
import { techAvailable } from './research';
import { SPECIALTY_NAME, employeesAt, rolesFor, staffCapacity, baseSalary } from './staff';
import type { Command, CommandResult, Employee, FacilityState, GameState } from './types';
import { addHistory, hasFeature, milestone, newId, notify, pay, techDone, unlocked } from './util';

const OK: CommandResult = { ok: true };
const fail = (message: string): CommandResult => ({ ok: false, message });

const yen = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}億円` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}万円` : `${Math.round(v)}円`);

function need(s: GameState, feature: string, msg: string): CommandResult | null {
  return hasFeature(s, feature) ? null : fail(msg);
}

function spendCapex(s: GameState, f: FacilityState | null, yenAmount: number): CommandResult | null {
  if (s.cash < yenAmount) return fail(`資金が足りません（必要 ${yen(yenAmount)}）`);
  pay(s, 'capex', yenAmount);
  if (f) f.invested += yenAmount;
  return null;
}

function unassign(s: GameState, e: Employee) {
  if (e.assignedTo !== null) {
    const f = facilityById(s, e.assignedTo);
    if (f && f.managerId === e.id) f.managerId = null;
  }
  e.assignedTo = null;
  s.staffRev++;
}

function assignOk(s: GameState, e: Employee, f: FacilityState): string | null {
  if (!rolesFor(f).includes(e.role)) {
    if (e.role === 'manager') return '工場長は施設の「工場長」枠に任命します';
    if (e.role === 'researcher') return '研究員は研究所で働きます';
    return 'この施設では働けません';
  }
  if (f.building && f.building.kind === 'build') return '建設中です';
  const cap = staffCapacity(s, f);
  const have = employeesAt(s, f.id).filter((x) => x.id !== e.id).length;
  if (have >= cap) return cap === 0 ? (f.stage === 'auto' ? '自動化した施設に人は要りません' : 'この施設には今は人を置けません') : '定員に達しています';
  return null;
}

/** idle staff to facilities with room, best-paying work first */
function autoAssign(s: GameState): number {
  const idle = s.employees.filter((e) => e.assignedTo === null && e.role !== 'manager');
  if (!idle.length) return 0;
  const value = (f: FacilityState) => {
    if (f.type === 'research_lab') return 5e5;
    if (isPlant(f)) return 1e6;
    if (!f.recipe) return 0;
    const r = DATA.recipe[f.recipe];
    return r.valueAdded / r.time + (f.stage !== 'manual' ? 2e5 : 0);
  };
  const targets = s.facilities
    .filter((f) => !(f.building && f.building.kind === 'build') && !inSubsidiary(s, f))
    .sort((a, b) => value(b) - value(a));
  let n = 0;
  for (const e of idle) {
    for (const f of targets) {
      if (assignOk(s, e, f)) continue;
      // prefer the specialty match when there is a choice
      e.assignedTo = f.id;
      s.staffRev++;
      n++;
      break;
    }
  }
  return n;
}

/** a subsidiary runs its own facilities and people: the player's commands on them are refused */
function subsidiaryLock(s: GameState, cmd: Command): string | null {
  const locked = (fid: number | null | undefined) => {
    if (fid === null || fid === undefined) return null;
    const f = facilityById(s, fid);
    if (!f || !inSubsidiary(s, f)) return null;
    return `「${s.divisions[f.type].sub!.name}」（子会社）の施設です。子会社の画面から本社に戻せます`;
  };
  const person = (eid: number) => {
    const e = s.employees.find((x) => x.id === eid);
    if (!e) return null;
    const d = divisionOfHead(s, e.id);
    if (d?.sub && cmd.type !== 'setDivisionHead') return `${d.sub.name}の社長です`;
    return locked(e.assignedTo);
  };
  switch (cmd.type) {
    case 'gather':
    case 'upgradeLevel':
    case 'buyMachine':
    case 'automate':
    case 'setRecipe':
    case 'setManager':
    case 'setAutomation':
      return locked(cmd.facilityId);
    case 'assign':
      return person(cmd.employeeId) ?? locked(cmd.facilityId);
    case 'fire':
    case 'promote':
      return person(cmd.employeeId);
    default:
      return null;
  }
}

/** the rule engine's own actions (division heads, subsidiaries): same checks, no lock, problems are updated once a day */
export function execCommand(s: GameState, cmd: Command): CommandResult {
  const res = run(s, cmd);
  if (res.ok) invalidateCosts(s);
  return res;
}

export function applyCommand(s: GameState, cmd: Command): CommandResult {
  checkGoals(s);
  const lock = subsidiaryLock(s, cmd);
  if (lock) return fail(lock);
  const res = run(s, cmd);
  if (res.ok) {
    invalidateCosts(s);
    checkGoals(s);
    if (cmd.type !== 'readNotices' && cmd.type !== 'setSpeed' && cmd.type !== 'setSetting') updateProblems(s);
  }
  return res;
}

function run(s: GameState, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'gather': {
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const err = startTap(s, f);
      return err ? fail(err) : OK;
    }

    case 'build': {
      const gate = need(s, 'build', '「社員を3人にしよう」を達成すると建設できます');
      if (gate) return gate;
      const def = DATA.facility[cmd.facility];
      if (!def || def.id === 'headquarters') return fail('建設できない施設です');
      if (!unlocked(s, def.unlock)) return fail('研究でまだ解放されていません');
      if (cmd.recipe !== undefined && !def.recipes.includes(cmd.recipe)) return fail('この施設では作れません');
      let recipe = cmd.recipe ?? def.recipes.find((r) => unlocked(s, DATA.recipe[r].unlock)) ?? null;
      if (recipe && !unlocked(s, DATA.recipe[recipe].unlock)) recipe = null;
      if (s.cash < def.buildCost) return fail(`資金が足りません（必要 ${yen(def.buildCost)}）`);
      const f = createFacility(s, def.id, {
        recipe,
        buildingUntil: s.tick + Math.round(def.buildDays * DATA.balance.time.ticksPerDay),
      });
      spendCapex(s, f, def.buildCost);
      notify(s, 'info', 'ui_construction', `${f.name}の建設を開始`, `${def.buildDays}日で完成します`, { screen: 'facility', id: f.id });
      milestone(s, 'firstBuild', def.id, `初めての施設「${f.name}」を建設`);
      return OK;
    }

    case 'upgradeLevel': {
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const def = defOf(f);
      if (f.building) return fail('工事中です');
      if (f.level >= def.maxLevel) return fail('これ以上拡張できません');
      if (f.level > 0 && !hasFeature(s, 'build')) return fail('まだ拡張できません');
      const cost = levelUpCost(f);
      const err = spendCapex(s, f, cost);
      if (err) return err;
      f.building = { kind: 'level', start: s.tick, until: s.tick + Math.round(levelUpDays(f) * DATA.balance.time.ticksPerDay) };
      notify(s, 'info', 'ui_construction', `${f.name}の拡張工事を開始`, `Lv${f.level} → Lv${f.level + 1}`, { screen: 'facility', id: f.id });
      return OK;
    }

    case 'buyMachine': {
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const def = defOf(f);
      const count = Math.max(1, Math.floor(cmd.count ?? 1));
      if (!def.machine && !def.generator) return fail('機械を置けない施設です');
      if (!def.generator && def.manualWorkers && !hasFeature(s, 'machine')) return fail('研究「機械化の基礎」で解放されます');
      if (f.level === 0) return fail('先に施設を拡張（Lv1）してください');
      if (f.building && f.building.kind === 'build') return fail('建設中です');
      if (f.machines + count > maxMachines(s, f)) return fail(`Lv${f.level}では最大${maxMachines(s, f)}台です。拡張してください`);
      const price = machinePrice(f) * count;
      const err = spendCapex(s, f, price);
      if (err) return err;
      const first = f.stage === 'manual';
      if (first) f.stage = 'machine';
      f.machines += count;
      s.staffRev++;
      if (first) {
        // workers become operators; the rest wait
        const staff = employeesAt(s, f.id);
        const cap = staffCapacity(s, f);
        for (const e of staff.slice(cap)) unassign(s, e);
        notify(s, 'good', 'auto_machine', `${f.name}を機械化`, '作業員は機械の操作員になりました', { screen: 'facility', id: f.id });
        milestone(s, 'firstMachine', 'auto_machine', `初めての機械化（${f.name}）`);
      }
      return OK;
    }

    case 'automate': {
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const gate = need(s, 'auto', '研究「自動制御」で解放されます');
      if (gate) return gate;
      if (f.stage === 'auto') return fail('すでに自動化されています');
      if (f.stage !== 'machine' || f.machines <= 0) return fail('先に機械を入れてください');
      const err = spendCapex(s, f, automateCost(f));
      if (err) return err;
      f.stage = 'auto';
      const freed = employeesAt(s, f.id);
      for (const e of freed) unassign(s, e);
      s.staffRev++;
      notify(s, 'good', 'auto_robot', `${f.name}を自動化`, freed.length ? `${freed.length}人の手が空きました。別の仕事に回せます` : '人がいなくても動きます', { screen: 'facility', id: f.id });
      milestone(s, 'firstAuto', 'auto_robot', `初めての自動化（${f.name}）`);
      return OK;
    }

    case 'setRecipe': {
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const def = defOf(f);
      if (!def.recipes.includes(cmd.recipe)) return fail('この施設では作れません');
      if (!unlocked(s, DATA.recipe[cmd.recipe].unlock)) return fail('研究でまだ解放されていません');
      if (f.recipe === cmd.recipe) return OK;
      f.recipe = cmd.recipe;
      f.switchUntil = s.tick + Math.round(DATA.balance.production.recipeSwitchDays * DATA.balance.time.ticksPerDay);
      const a = defaultAutomation(cmd.recipe);
      f.auto = { ...f.auto, targetStock: a.targetStock, startBelow: a.startBelow, stopAbove: a.stopAbove };
      s.staffRev++;
      return OK;
    }

    case 'hire': {
      const gate = need(s, 'hire', '原木を売ると人を雇えるようになります');
      if (gate) return gate;
      const c = s.candidates.find((x) => x.id === cmd.candidateId);
      if (!c) return fail('応募者がいません');
      const fee = DATA.balance.staff.hireFee;
      if (s.cash < fee) return fail(`資金が足りません（採用費 ${yen(fee)}）`);
      pay(s, 'other', fee);
      s.candidates = s.candidates.filter((x) => x.id !== c.id);
      const e: Employee = {
        id: c.id,
        name: c.name,
        role: c.role,
        skill: c.skill,
        exp: 0,
        specialty: c.specialty,
        salary: c.salary,
        assignedTo: null,
        hiredDay: dayIndex(s.tick),
      };
      s.employees.push(e);
      s.totals.everHired++;
      s.staffRev++;
      if (milestone(s, 'firstHire', 'ppl_worker', `最初の社員 ${e.name}さんを採用`)) {
        notify(s, 'good', 'ppl_worker', `${e.name}さんを採用しました`, '施設に配置すると、あなたの代わりに働きます', { screen: 'staff' });
      }
      return OK;
    }

    case 'bulkHire': {
      const gate = need(s, 'bulkHire', '研究「採用強化」で解放されます');
      if (gate) return gate;
      const b = DATA.balance.staff.bulkHire;
      const cost = b.size * b.costPerHead;
      if (s.cash < cost) return fail(`資金が足りません（${yen(cost)}）`);
      pay(s, 'other', cost);
      for (let i = 0; i < b.size; i++) {
        const skill = 1 + (i % 3 === 0 ? 1 : 0);
        const id = newId(s);
        s.employees.push({
          id,
          name: '',
          role: 'worker',
          skill,
          exp: 0,
          specialty: (['extraction', 'processing', 'manufacturing'] as const)[i % 3],
          salary: baseSalary('worker', skill),
          assignedTo: null,
          hiredDay: dayIndex(s.tick),
        });
      }
      // name them with the seeded generator
      for (const e of s.employees) if (!e.name) e.name = `${DATA.names.surnames[e.id % DATA.names.surnames.length]} ${DATA.names.given[(e.id * 7) % DATA.names.given.length]}`;
      s.totals.everHired += b.size;
      s.staffRev++;
      notify(s, 'good', 'nav_staff', `採用キャンペーンで${b.size}人が入社`, '自動配置で空いている施設へ回せます', { screen: 'staff' });
      return OK;
    }

    case 'fire': {
      const e = s.employees.find((x) => x.id === cmd.employeeId);
      if (!e) return fail('社員がいません');
      pay(s, 'salaries', e.salary * DATA.balance.staff.severanceMonths);
      unassign(s, e);
      const led = divisionOfHead(s, e.id);
      if (led) led.headId = null;
      s.employees = s.employees.filter((x) => x.id !== e.id);
      s.staffRev++;
      return OK;
    }

    case 'assign': {
      const e = s.employees.find((x) => x.id === cmd.employeeId);
      if (!e) return fail('社員がいません');
      if (cmd.facilityId === null) {
        unassign(s, e);
        return OK;
      }
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const err = assignOk(s, e, f);
      if (err) return fail(err);
      unassign(s, e);
      e.assignedTo = f.id;
      s.staffRev++;
      return OK;
    }

    case 'autoAssign': {
      const n = autoAssign(s);
      return n > 0 ? { ok: true, message: `${n}人を配置しました` } : fail('配置できる空きがありません');
    }

    case 'promote': {
      const e = s.employees.find((x) => x.id === cmd.employeeId);
      if (!e) return fail('社員がいません');
      if (cmd.role === e.role) return OK;
      if (cmd.role === 'engineer') {
        if (e.role !== 'worker') return fail('技術者になれるのは作業員です');
        if (e.skill < 3) return fail('熟練度★3から技術者になれます');
      } else if (cmd.role === 'manager') {
        if (!hasFeature(s, 'managers')) return fail('研究「工場長制度」で解放されます');
        if (e.role === 'researcher' || e.role === 'director') return fail('研究員と部門長は工場長になれません');
        if (e.skill < 4) return fail('熟練度★4から工場長になれます');
      } else if (cmd.role === 'director') {
        if (!hasFeature(s, 'divisions')) return fail('研究「部門制」で解放されます');
        if (e.role !== 'manager') return fail('部門長になれるのは工場長です');
      } else return fail('その役職にはできません');
      unassign(s, e);
      e.role = cmd.role;
      if (cmd.role === 'manager' || cmd.role === 'director') e.specialty = 'management';
      e.salary = Math.max(e.salary, baseSalary(cmd.role, e.skill));
      s.staffRev++;
      const icon = cmd.role === 'director' ? 'ppl_manager' : cmd.role === 'manager' ? 'ppl_foreman' : 'ppl_engineer';
      notify(s, 'good', icon, `${e.name}さんが${DATA.balance.staff.roles[cmd.role].name}に昇進`, cmd.role === 'director' ? '部門を任せると、同じ種類の施設をまとめて運営します' : '', { screen: 'staff' });
      addHistory(s, icon, `${e.name}さんが${DATA.balance.staff.roles[cmd.role].name}に`);
      return OK;
    }

    case 'setManager': {
      const gate = need(s, 'managers', '研究「工場長制度」で解放されます');
      if (gate) return gate;
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      if (!isProduction(defOf(f))) return fail('生産施設だけに置けます');
      if (cmd.employeeId === null) {
        const cur = s.employees.find((x) => x.id === f.managerId);
        if (cur) unassign(s, cur);
        f.managerId = null;
        s.staffRev++;
        return OK;
      }
      const e = s.employees.find((x) => x.id === cmd.employeeId);
      if (!e || e.role !== 'manager') return fail('工場長を選んでください');
      const prev = s.employees.find((x) => x.id === f.managerId);
      if (prev) unassign(s, prev);
      unassign(s, e);
      e.assignedTo = f.id;
      f.managerId = e.id;
      s.staffRev++;
      milestone(s, 'firstManager', 'ppl_foreman', `初めて工場長に施設を任せる（${f.name}）`);
      return OK;
    }

    case 'sell': {
      const gate = need(s, 'market', '原木を3回集めると市場で売れます');
      if (gate) return gate;
      const qty = Math.min(cmd.qty, s.inventory[cmd.item] ?? 0);
      if (!(qty > 0)) return fail('在庫がありません');
      const got = executeSell(s, cmd.item, qty);
      milestone(s, 'firstSale', 'fin_cash', `初めての販売（${DATA.item[cmd.item].name}）`);
      return { ok: true, message: `${yen(got)}で売りました` };
    }

    case 'buy': {
      const gate = need(s, 'market', 'まだ市場を使えません');
      if (gate) return gate;
      if (!(cmd.qty > 0)) return fail('数量を入れてください');
      const q = buyQuote(s, cmd.item, cmd.qty);
      if (q.total > s.cash) return fail(`資金が足りません（${yen(q.total)}）`);
      executeBuy(s, cmd.item, cmd.qty);
      return { ok: true, message: `${yen(q.total)}で買いました` };
    }

    case 'contract': {
      const gate = need(s, 'contracts', '研究「長期契約」で解放されます');
      if (gate) return gate;
      if (!(cmd.perDay > 0) || !(cmd.days > 0)) return fail('数量と期間を入れてください');
      const prem = DATA.balance.market.contractPremium;
      const price = unitPrice(s, cmd.item) * (cmd.side === 'buy' ? 1 + prem : 1 - prem);
      const d = dayIndex(s.tick);
      s.contracts.push({ id: newId(s), item: cmd.item, side: cmd.side, perDay: cmd.perDay, price, startDay: d, endDay: d + cmd.days, done: 0 });
      milestone(s, 'firstContract', 'fin_contract', `初めての長期契約（${DATA.item[cmd.item].name}）`);
      return OK;
    }

    case 'cancelContract': {
      const c = s.contracts.find((x) => x.id === cmd.contractId);
      if (!c) return fail('契約がありません');
      // breaking a contract costs a week of its value
      pay(s, 'other', c.perDay * c.price * 7 * 0.2);
      s.contracts = s.contracts.filter((x) => x.id !== c.id);
      return OK;
    }

    case 'setAutoTrade': {
      const gate = need(s, 'autotrade', '研究「自動売買」で解放されます');
      if (gate) return gate;
      if (cmd.rule === null) delete s.autoTrade[cmd.item];
      else s.autoTrade[cmd.item] = { ...cmd.rule };
      return OK;
    }

    case 'setAutomation': {
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const gate = need(s, 'rules', '研究「運営ルール」で解放されます');
      if (gate) return gate;
      const st = cmd.settings;
      if (st.mode === 'advanced' && !hasFeature(s, 'advancedRules')) return fail('研究「高度な条件制御」で解放されます');
      f.auto = {
        ...st,
        targetStock: Math.max(0, st.targetStock),
        powerCap: Math.min(1, Math.max(0.1, st.powerCap)),
        startBelow: Math.max(0, st.startBelow),
        stopAbove: Math.max(st.startBelow, st.stopAbove),
        rules: st.rules.map((r) => ({ rate: Math.max(0, Math.min(1.5, r.rate)), conds: r.conds.map((c) => ({ ...c })) })),
      };
      if (!f.auto.enabled) f.rate = 1;
      return OK;
    }

    case 'setPowerContract': {
      if (!contractAvailable(s, cmd.contract)) return fail('この契約はまだ結べません');
      s.power.contract = cmd.contract;
      const c = DATA.balance.power.contracts.find((x) => x.id === cmd.contract)!;
      s.power.gridCapacity = c.capacity;
      s.power.supply = c.capacity + s.power.plantCapacity;
      s.power.ratio = s.power.demand > 0 ? Math.min(1, s.power.supply / s.power.demand) : 1;
      if (c.capacity > 0) milestone(s, 'firstPower', 'nav_power', `電力会社と${c.name}契約`);
      return OK;
    }

    case 'setFuel': {
      const f = facilityById(s, cmd.facilityId);
      if (!f || !isPlant(f)) return fail('発電所を選んでください');
      if (!defOf(f).generator!.fuels[cmd.fuel]) return fail('その燃料は使えません');
      if (!fuelAllowed(s, cmd.fuel)) return fail('研究「ガス火力」で解放されます');
      f.fuel = cmd.fuel;
      return OK;
    }

    case 'addTrucks': {
      const n = Math.max(1, Math.floor(cmd.count));
      const own = Math.min(n, Math.floor(s.inventory.small_truck ?? 0));
      const buy = n - own;
      if (buy > 0) {
        const q = buyQuote(s, 'small_truck', buy);
        if (q.total > s.cash) return fail(`資金が足りません（トラック${buy}台 ${yen(q.total)}）`);
        executeBuy(s, 'small_truck', buy);
      }
      s.inventory.small_truck = (s.inventory.small_truck ?? 0) - n;
      if (s.inventory.small_truck < 1e-9) s.inventory.small_truck = 0;
      s.logistics.trucks += n;
      refreshLogistics(s);
      return { ok: true, message: own ? `在庫から${own}台、市場から${buy}台を配車` : `${buy}台を購入して配車` };
    }

    case 'removeTrucks': {
      const n = Math.min(s.logistics.trucks, Math.max(1, Math.floor(cmd.count)));
      if (n <= 0) return fail('トラックがありません');
      s.logistics.trucks -= n;
      s.inventory.small_truck = (s.inventory.small_truck ?? 0) + n;
      refreshLogistics(s);
      return OK;
    }

    case 'setRail': {
      const gate = need(s, 'rail', '研究「貨物鉄道」で解放されます');
      if (gate) return gate;
      s.logistics.rail = cmd.on;
      refreshLogistics(s);
      return OK;
    }

    case 'research': {
      const gate = need(s, 'research', '研究所に研究員を置くと研究できます');
      if (gate) return gate;
      if (techDone(s, cmd.tech)) return fail('研究済みです');
      if (!techAvailable(s, cmd.tech)) return fail('前提の研究がまだです');
      if (s.research.current !== cmd.tech) {
        // switching keeps what was done so far on the old theme
        const r = s.research;
        if (r.current && r.progress > 0) r.saved[r.current] = r.progress;
        r.current = cmd.tech;
        r.progress = r.saved[cmd.tech] ?? 0;
        delete r.saved[cmd.tech];
      }
      return OK;
    }

    case 'borrow': {
      const room = loanLimit(s) - s.loan;
      const amt = Math.floor(Math.min(cmd.amount, room));
      if (!(amt > 0)) return fail('借入枠がありません');
      s.loan += amt;
      s.cash += amt;
      milestone(s, 'firstLoan', 'fin_bank', `銀行から初めての借入（${yen(amt)}）`);
      return { ok: true, message: `${yen(amt)}を借りました` };
    }

    case 'repay': {
      const amt = Math.floor(Math.min(cmd.amount, s.loan, Math.max(0, s.cash)));
      if (!(amt > 0)) return fail('返せる資金がありません');
      s.loan -= amt;
      s.cash -= amt;
      return { ok: true, message: `${yen(amt)}を返しました` };
    }

    case 'upgradeHQ': {
      const next = DATA.balance.hq[s.hq.level];
      if (!next) return fail('これ以上拡張できません');
      if (s.hq.building) return fail('工事中です');
      if (s.cash < next.cost) return fail(`資金が足りません（${yen(next.cost)}）`);
      pay(s, 'capex', next.cost);
      s.hq.building = { start: s.tick, until: s.tick + Math.round(next.days * DATA.balance.time.ticksPerDay) };
      notify(s, 'info', 'headquarters', `本社「${next.name}」の工事を開始`, `${next.days}日で完成`, { screen: 'company' });
      return OK;
    }

    case 'rename': {
      const f = facilityById(s, cmd.facilityId);
      if (!f) return fail('施設がありません');
      const name = cmd.name.trim().slice(0, 24);
      if (!name) return fail('名前を入れてください');
      f.name = name;
      return OK;
    }

    case 'renameCompany': {
      const name = cmd.name.trim().slice(0, 32);
      if (!name) return fail('名前を入れてください');
      s.companyName = name;
      return OK;
    }

    case 'setSpeed': {
      if (!DATA.balance.time.speeds.includes(cmd.speed)) return fail('その速度はありません');
      if (cmd.speed > 1 && !hasFeature(s, 'speed')) return fail('最初の社員を配置すると早送りできます');
      if (cmd.speed === 0) s.paused = true;
      else {
        s.paused = false;
        s.speed = cmd.speed;
        s.pauseReason = null;
      }
      return OK;
    }

    case 'resumeFromAutoPause': {
      s.paused = false;
      s.pauseReason = null;
      return OK;
    }

    case 'readNotices': {
      for (const n of s.notices) n.read = true;
      return OK;
    }

    case 'setSetting': {
      (s.settings as unknown as Record<string, unknown>)[cmd.key] = cmd.value;
      return OK;
    }

    case 'sellSurplus': {
      const gate = need(s, 'market', 'まだ市場を使えません');
      if (gate) return gate;
      const r = sellSurplus(s);
      if (!r.lines) return fail('売れる余りがありません（使う分は残しています）');
      milestone(s, 'firstSale', 'fin_cash', '初めての販売');
      return { ok: true, message: `${r.lines}品目を${yen(r.value)}で売りました${r.capped ? '（値崩れしないよう一部だけ）' : ''}` };
    }

    case 'setDivisionHead': {
      const err = headProblem(s, cmd.facilityType, cmd.employeeId);
      if (err) return fail(err);
      const d = ensureDivision(s, cmd.facilityType);
      if (cmd.employeeId === null) {
        if (d.sub) return fail('子会社には社長が必要です（交代はできます）');
        d.headId = null;
        s.staffRev++;
        return OK;
      }
      const e = s.employees.find((x) => x.id === cmd.employeeId)!;
      const other = divisionOfHead(s, e.id);
      if (other && other !== d) {
        if (other.sub) return fail(`${e.name}さんは${other.sub.name}の社長です`);
        other.headId = null;
      }
      unassign(s, e);
      d.headId = e.id;
      s.staffRev++;
      milestone(s, 'firstDivision', 'ppl_manager', `初めての部門長（${e.name}さんに${divisionName(cmd.facilityType)}を任せる）`);
      return OK;
    }

    case 'setDivision': {
      const gate = need(s, 'divisions', '研究「部門制」で解放されます');
      if (gate) return gate;
      if (!DATA.facility[cmd.facilityType]) return fail('施設の種類がありません');
      const d = ensureDivision(s, cmd.facilityType);
      if (cmd.hire !== undefined) d.hire = d.sub ? true : cmd.hire;
      if (cmd.invest !== undefined) {
        if (!(cmd.invest >= 0 && cmd.invest <= 1)) return fail('0〜100%で選んでください');
        d.invest = cmd.invest;
      }
      return OK;
    }

    case 'makeSubsidiary': {
      const gate = need(s, 'subsidiaries', '研究「子会社」で解放されます');
      if (gate) return gate;
      const d = s.divisions[cmd.facilityType];
      if (!d || d.headId === null) return fail('先に部門長を任命してください');
      if (d.sub) return fail('すでに子会社です');
      const minN = DATA.balance.divisions.minFacilities;
      if (members(s, cmd.facilityType).length < minN) return fail(`${minN}施設以上ある部門を子会社にできます`);
      const cost = subsidiaryCost(s, cmd.facilityType);
      if (s.cash < cost) return fail(`資金が足りません（設立費 ${yen(cost)}）`);
      pay(s, 'other', cost);
      d.sub = { name: subsidiaryName(s, cmd.facilityType), since: dayIndex(s.tick) };
      d.hire = true;
      if (d.invest < 0.5) d.invest = 0.5;
      s.staffRev++;
      const head = s.employees.find((x) => x.id === d.headId);
      notify(s, 'good', 'fin_merger', `子会社「${d.sub.name}」を設立`, `${head ? `${head.name}さんが社長です。` : ''}${divisionName(d.type)}は本社の管理を離れ、利益で自ら育ちます`, { screen: 'division', id: d.type });
      addHistory(s, 'fin_merger', `子会社「${d.sub.name}」を設立`);
      return OK;
    }

    case 'dissolveSubsidiary': {
      const d = s.divisions[cmd.facilityType];
      if (!d?.sub) return fail('子会社ではありません');
      const name = d.sub.name;
      d.sub = null;
      s.staffRev++;
      notify(s, 'info', 'fin_merger', `「${name}」を本社に戻しました`, `${divisionName(d.type)}として部門長が運営します`, { screen: 'division', id: d.type });
      addHistory(s, 'fin_merger', `「${name}」を本社の部門に戻す`);
      return OK;
    }

    case 'acceptOrder': {
      const gate = need(s, 'orders', '「製材所を建てて製材を作ろう」を達成すると注文が来ます');
      if (gate) return gate;
      const err = acceptOrder(s, cmd.orderId);
      return err ? fail(err) : { ok: true, message: '注文を受けました。在庫から毎日納品します' };
    }

    case 'declineOrder': {
      const err = declineOrder(s, cmd.orderId);
      return err ? fail(err) : OK;
    }

    case 'deliverOrder': {
      const r = deliverNow(s, cmd.orderId);
      return r.error ? fail(r.error) : { ok: true, message: `${Math.round(r.qty).toLocaleString()}を納品しました` };
    }

    case 'cancelOrder': {
      const err = cancelOrder(s, cmd.orderId);
      return err ? fail(err) : OK;
    }

    case 'chooseEvent': {
      const err = chooseEvent(s, cmd.eventId, cmd.choice);
      return err ? fail(err) : OK;
    }
  }
}

export function describeEmployee(e: Employee): string {
  return `${DATA.balance.staff.roles[e.role].name}・★${e.skill}・得意 ${SPECIALTY_NAME[e.specialty]}`;
}

