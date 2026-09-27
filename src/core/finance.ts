import { DATA } from '../data';
import { dateOf, dayIndex } from './calendar';
import { upkeepPerDay } from './facilities';
import { mods } from './mods';
import { contractDef } from './power';
import type { DayRecord, GameState, Ledger } from './types';
import { emptyLedger, pay } from './util';

export function inventoryValue(s: GameState): number {
  let v = 0;
  for (const [item, qty] of Object.entries(s.inventory)) {
    if (qty > 0) v += qty * DATA.basePrice[item] * (s.market[item]?.index ?? 1);
  }
  return v;
}

export function bookValue(s: GameState): number {
  let v = 0;
  for (const f of s.facilities) v += f.invested * 0.6;
  return v;
}

export function netAssets(s: GameState): number {
  return s.cash - s.loan + inventoryValue(s) + bookValue(s);
}

export function operatingProfit(l: Ledger): number {
  return l.sales - l.purchases - l.salaries - l.power - l.logistics - l.upkeep - l.interest - l.other;
}

/** average operating profit per day over the last n closed days */
export function avgProfit(s: GameState, n = 7): number {
  const d = s.finance.days;
  if (!d.length) return 0;
  const slice = d.slice(-n);
  let t = 0;
  for (const r of slice) t += operatingProfit(r);
  return t / slice.length;
}

export function companyValue(s: GameState): number {
  const annual = avgProfit(s, 30) * 365;
  return netAssets(s) + Math.max(0, annual) * DATA.balance.finance.valueProfitYears;
}

export function loanLimit(s: GameState): number {
  const f = DATA.balance.finance;
  return f.loanBase * mods(s).loanLimit + Math.max(0, netAssets(s) + s.loan) * f.loanEquityMul;
}

export function dailyUpkeep(s: GameState): number {
  let u = DATA.balance.hq[s.hq.level - 1].upkeep;
  for (const f of s.facilities) if (!f.building || f.building.kind === 'level') u += upkeepPerDay(f);
  return u;
}

export function dailyPayroll(s: GameState): number {
  let t = 0;
  for (const e of s.employees) t += e.salary;
  return t / 30;
}

/** what the company pays per day whether it sells anything or not: wages, upkeep, interest, the power basic fee */
export function fixedCostPerDay(s: GameState): number {
  const f = DATA.balance.finance;
  const c = contractDef(s.power.contract);
  return dailyPayroll(s) + dailyUpkeep(s) + (s.loan * f.loanRateYear) / 365 + (c.capacity * c.basicFee) / 30;
}

/** yen to borrow so that cash covers `days` of fixed costs after spending `spend` (0 if it already does) */
export function borrowFor(s: GameState, spend: number, days: number, extraPerDay = 0): number {
  const want = days * (fixedCostPerDay(s) + extraPerDay) - (s.cash - spend);
  if (want <= 0) return 0;
  const room = Math.max(0, loanLimit(s) - s.loan);
  return Math.min(room, Math.ceil(want / 1e5) * 1e5);
}

/** wages, upkeep and interest for dt days */
export function tickFinance(s: GameState, dt: number, payroll: number, upkeep: number) {
  pay(s, 'salaries', payroll * dt);
  pay(s, 'upkeep', upkeep * dt);
  const f = DATA.balance.finance;
  let interest = (s.loan * f.loanRateYear * dt) / 365;
  if (s.cash < 0) interest += (-s.cash * f.overdraftRateYear * dt) / 365;
  pay(s, 'interest', interest);
}

export function closeDay(s: GameState, production: number, value: number) {
  const fin = s.finance;
  const day = dayIndex(s.tick) - 1;
  const rec: DayRecord = { ...fin.today, day, cash: s.cash, value, production };
  fin.days.push(rec);
  if (fin.days.length > DATA.balance.finance.ledgerDays) fin.days.splice(0, fin.days.length - DATA.balance.finance.ledgerDays);
  fin.today = emptyLedger();
  // month rollover: the day we just closed was the last of its month
  const closed = dateOf(day);
  const next = dateOf(day + 1);
  if (next.month !== closed.month) {
    const autoShare = automationRate(s);
    fin.months.push({
      ...fin.monthAcc,
      year: closed.year,
      month: closed.month,
      cash: s.cash,
      value,
      employees: s.employees.length,
      facilities: s.facilities.filter((f) => f.level > 0).length,
      automation: autoShare,
    });
    fin.monthAcc = emptyLedger();
  }
}

/** share of production value made by machines (half) and automatic machines (full) */
export function automationRate(s: GameState): number {
  const w = DATA.balance.production.automationWeight;
  let num = 0;
  let den = 0;
  for (const f of s.facilities) {
    const val = Math.max(0, f.stats.lastOut);
    if (!f.recipe || val <= 0) continue;
    const weight = f.stage === 'auto' ? w.auto : f.stage === 'machine' ? w.machine : w.manual;
    const share = f.managerId !== null && f.stage !== 'auto' ? Math.max(weight, 0.75) : weight;
    num += val * share;
    den += val;
  }
  return den > 0 ? num / den : 0;
}
