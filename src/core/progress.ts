import { DATA, type GoalCondition } from '../data';
import { companyValue } from './finance';
import type { GameState } from './types';
import { addHistory, milestone, notify, techDone } from './util';

export function goalMet(s: GameState, c: GoalCondition): boolean {
  switch (c.type) {
    case 'taps':
      return s.owner.taps >= c.count;
    case 'sold':
      return c.item ? (s.totals.sold[c.item] ?? 0) >= c.amount : s.totals.salesValue > 0;
    case 'employees': {
      const n = c.assigned ? s.employees.filter((e) => e.assignedTo !== null).length : s.employees.length;
      return n >= c.count;
    }
    case 'produced':
      return (s.totals.produced[c.item] ?? 0) >= c.amount - 1e-6;
    case 'facility':
      return s.facilities.filter((f) => f.type === c.facility && f.level >= c.level && !(f.building && f.building.kind === 'build')).length >= c.count;
    case 'researchers':
      return s.employees.filter((e) => e.role === 'researcher' && e.assignedTo !== null).length >= c.count;
    case 'tech':
      return techDone(s, c.tech);
    case 'stage':
      return s.facilities.filter((f) => (c.stage === 'machine' ? f.stage !== 'manual' : f.stage === 'auto') && f.machines > 0).length >= c.count;
    case 'automation':
      return s.facilities.filter((f) => f.auto.enabled).length >= c.count;
    case 'powerOk':
      return s.power.demand > 0 && s.power.ratio >= 0.999 && s.power.demand / Math.max(1, s.power.supply) < 0.9;
    case 'value':
      return companyValue(s) >= c.amount;
  }
}

/** marks every met goal as done (in any order) and grants its features */
export function checkGoals(s: GameState): boolean {
  let changed = false;
  for (let i = 0; i < DATA.goals.length; i++) {
    const g = DATA.goals[i];
    if (s.goals.done.includes(g.id)) continue;
    if (!goalMet(s, g.condition)) continue;
    s.goals.done.push(g.id);
    for (const f of g.unlocks) s.features[f] = true;
    changed = true;
    notify(s, 'good', 'auto_flag', `目標達成：${g.title}`, nextGoalText(s));
  }
  if (changed) {
    const idx = DATA.goals.findIndex((g) => !s.goals.done.includes(g.id));
    s.goals.index = idx < 0 ? DATA.goals.length : idx;
  }
  return changed;
}

function nextGoalText(s: GameState): string {
  const next = DATA.goals.find((g) => !s.goals.done.includes(g.id));
  return next ? `次の目標：${next.title}` : 'すべての目標を達成しました';
}

const MONEY_STEPS: [number, string][] = [
  [1e7, '1,000万円'],
  [1e8, '1億円'],
  [1e9, '10億円'],
  [1e10, '100億円'],
  [1e11, '1,000億円'],
  [1e12, '1兆円'],
  [1e13, '10兆円'],
];

/** daily: long-run milestones for the company history */
export function checkMilestones(s: GameState) {
  for (const [v, label] of MONEY_STEPS) {
    if (s.totals.salesValue >= v) milestone(s, `sales_${v}`, 'fin_up', `累計売上${label}突破`);
  }
  const value = companyValue(s);
  s.totals.maxValue = Math.max(s.totals.maxValue, value);
  for (const [v, label] of MONEY_STEPS) {
    if (v >= 1e8 && value >= v) milestone(s, `value_${v}`, 'ev_trophy', `企業価値${label}突破`);
  }
  for (const n of [10, 100, 1000, 10000]) {
    if (s.employees.length >= n) milestone(s, `emp_${n}`, 'nav_staff', `社員${n.toLocaleString()}人に`);
  }
  for (const [item, qty] of Object.entries(s.totals.produced)) {
    if (qty <= 0) continue;
    const it = DATA.item[item];
    if (it.category === 'raw') continue;
    if (milestone(s, `made_${item}`, item, `初めて${it.name}を生産`)) {
      if (it.category === 'product') notify(s, 'good', item, `${it.name}の生産を開始`, '新しい事業が始まりました', { screen: 'item', id: item });
    }
  }
}

export function recordFounding(s: GameState) {
  addHistory(s, 'nav_home', `${s.companyName} 設立`);
  s.milestones.founded = true;
}
