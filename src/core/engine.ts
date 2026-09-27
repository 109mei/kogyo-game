import { DATA } from '../data';
import { hourlyAutomation } from './automation';
import { dateOf, dayIndex } from './calendar';
import { defOf, isProduction, upkeepPerDay } from './facilities';
import { closeDay, companyValue, dailyPayroll, dailyUpkeep, tickFinance } from './finance';
import { dailyLogistics } from './logistics';
import { dailyMarket, hourlyAutoTrade, hourlyContracts } from './market';
import { tickPower } from './power';
import { detectProblems } from './problems';
import { tickOwner, tickProduction } from './production';
import { checkGoals, checkMilestones } from './progress';
import { tickResearch } from './research';
import { addCandidates, dailyStaff, employeesAt, makeCandidate, refreshCandidates } from './staff';
import { dailyDivisions } from './divisions';
import { dailyEvents } from './events';
import { dailyOrders, hourlyOrders } from './orders';
import type { GameState } from './types';
import { addHistory, notify } from './util';
import { visibleItems } from './visibility';

/**
 * Payroll and upkeep only change on commands, construction and skill-ups.
 * They are cached per state and dropped at every hour and after any change,
 * so a loaded save computes exactly the same numbers.
 */
const costCache = new WeakMap<GameState, { payroll: number; upkeep: number }>();

function costs(s: GameState) {
  let c = costCache.get(s);
  if (!c) {
    c = { payroll: dailyPayroll(s), upkeep: dailyUpkeep(s) };
    costCache.set(s, c);
  }
  return c;
}

export function invalidateCosts(s: GameState) {
  costCache.delete(s);
}

function completeConstruction(s: GameState) {
  for (const f of s.facilities) {
    const b = f.building;
    if (!b || s.tick < b.until) continue;
    f.building = null;
    if (b.kind === 'level') {
      f.level += 1;
      notify(s, 'good', 'ui_done', `${f.name}の拡張が完了`, `Lv${f.level}になりました`, { screen: 'facility', id: f.id });
    } else {
      notify(s, 'good', 'ui_done', `${f.name}が完成`, isProduction(defOf(f)) ? '人を配置すると動き出します' : '', { screen: 'facility', id: f.id });
      addHistory(s, f.type, `${f.name} 完成`);
      // word of a new lab gets around: a researcher applies at once instead of next week
      if (f.type === 'research_lab' && !s.employees.some((e) => e.role === 'researcher') && !s.candidates.some((c) => c.role === 'researcher')) {
        const c = makeCandidate(s, 'researcher');
        addCandidates(s, [c]);
        notify(s, 'info', 'ppl_researcher', '研究員の応募がありました', `${c.name}さん。人材画面で採用できます`, { screen: 'staff' });
      }
    }
    s.staffRev++;
    invalidateCosts(s);
  }
  if (s.hq.building && s.tick >= s.hq.building.until) {
    s.hq.building = null;
    s.hq.level += 1;
    const hq = DATA.balance.hq[s.hq.level - 1];
    notify(s, 'good', 'headquarters', `本社が「${hq.name}」に`, `管理能力${hq.management}・毎週の応募者${hq.candidates}人`, { screen: 'company' });
    addHistory(s, 'headquarters', `本社を「${hq.name}」へ`);
    invalidateCosts(s);
  }
}

function oneTick(s: GameState) {
  const dt = 1 / DATA.balance.time.ticksPerDay;
  s.tick += 1;
  completeConstruction(s);
  tickOwner(s);
  const totals = tickProduction(s, dt);
  s.logistics.wantToday += totals.wantMoved;
  tickPower(s, dt, totals.powerDemand);
  const c = costs(s);
  tickFinance(s, dt, c.payroll, c.upkeep);
  tickResearch(s, dt);
  if (s.tick % DATA.balance.time.hourTicks === 0) {
    invalidateCosts(s);
    hourlyOrders(s);
    hourlyAutomation(s);
    hourlyContracts(s);
    hourlyAutoTrade(s);
  }
  if (s.tick % DATA.balance.time.ticksPerDay === 0) endOfDay(s);
}

function endOfDay(s: GameState) {
  const day = dayIndex(s.tick);
  dailyMarket(s, visibleItems(s));
  dailyLogistics(s, s.logistics.wantToday);
  s.logistics.wantToday = 0;

  for (const it of DATA.items) {
    const t = s.itemToday[it.id];
    const h = s.itemHist[it.id];
    h.produced.push(t.produced);
    h.consumed.push(t.consumed);
    h.sold.push(t.sold);
    h.bought.push(t.bought);
    h.stock.push(s.inventory[it.id] ?? 0);
    for (const k of ['produced', 'consumed', 'sold', 'bought', 'stock'] as const) if (h[k].length > 30) h[k].shift();
    t.produced = t.consumed = t.sold = t.bought = 0;
  }

  let production = 0;
  for (const f of s.facilities) {
    const st = f.stats;
    let wages = 0;
    for (const e of employeesAt(s, f.id)) wages += e.salary / 30;
    if (f.managerId !== null) {
      const m = s.employees.find((e) => e.id === f.managerId);
      if (m) wages += m.salary / 30;
    }
    st.wages = wages;
    st.upkeep = f.building && f.building.kind === 'build' ? 0 : upkeepPerDay(f);
    const profit = st.outValue - st.inValue - st.wages - st.powerCost - st.upkeep;
    st.profitHist.push(Math.round(profit));
    if (st.profitHist.length > 30) st.profitHist.shift();
    const util = st.capacityToday > 0 ? st.batchesToday / st.capacityToday : 0;
    st.utilHist.push(Math.round(util * 1000) / 1000);
    if (st.utilHist.length > 30) st.utilHist.shift();
    st.maxUtil = Math.max(st.maxUtil, Math.min(1, util));
    st.lastOut = st.outValue;
    production += st.outValue;
    st.outValue = st.inValue = st.powerCost = 0;
    st.batchesToday = st.capacityToday = 0;
  }

  s.power.kwhToday = 0;
  s.power.costToday = 0;

  dailyStaff(s);
  // division heads use yesterday's figures; orders and events book into today's ledger
  dailyDivisions(s);
  dailyOrders(s);
  dailyEvents(s);
  invalidateCosts(s);
  const date = dateOf(day);
  if (date.weekday === 1) refreshCandidates(s);

  closeDay(s, production, companyValue(s));
  if (date.month === 1 && date.day === 1) addHistory(s, 'misc_time', `${date.year}年を迎える`);

  checkMilestones(s);
  checkGoals(s);
  updateProblems(s);
}

export function updateProblems(s: GameState) {
  const probs = detectProblems(s);
  s.problems = probs;
  const active = new Set(probs.map((p) => p.key));
  for (const k of Object.keys(s.pausedFor)) if (!active.has(k)) delete s.pausedFor[k];
  if (!s.settings.autoPause) return;
  for (const p of probs) {
    if (p.level !== 'red' || s.pausedFor[p.key]) continue;
    s.pausedFor[p.key] = true;
    if (!s.paused) {
      s.paused = true;
      s.pauseReason = p.title;
      notify(s, 'bad', 'st_alert', `${p.title}：時間を止めました`, p.detail, null);
    }
  }
}

/** run whole ticks; stops early when the game pauses itself */
export function runTicks(s: GameState, n: number, stopOnPause = true): number {
  let i = 0;
  while (i < n) {
    oneTick(s);
    i++;
    if (stopOnPause && s.paused) break;
  }
  return i;
}

export function runDays(s: GameState, days: number, stopOnPause = true): number {
  return runTicks(s, Math.round(days * DATA.balance.time.ticksPerDay), stopOnPause);
}
