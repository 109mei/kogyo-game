/**
 * View models for the screens, computed from the live state. Read-only.
 */
import { DATA } from '../data';
import type { FacilityState, GameState } from '../core';
import { dayOf } from '../core/calendar';
import { consumptionPerDay, recipeMargin } from '../core/automation';
import { capacity, defOf, isProduction } from '../core/facilities';
import { avgProfit, automationRate, companyValue } from '../core/finance';
import { managementCapacity, managementLoad } from '../core/logistics';
import { demandStars, supplyStars, trend, unitPrice } from '../core/market';
import { isPlant, plantCapacity } from '../core/power';
import { canTap, managerBonus, storageCapacity, storedWeight, tapSeconds } from '../core/production';
import { actualRates, plannedFlows } from '../core/rates';
import { divisionFor, inSubsidiary } from '../core/org';
import { employeesAt, staffCapacity } from '../core/staff';
import { hasFeature } from '../core/util';
import { visibleItems } from '../core/visibility';

export type Tone = 'green' | 'yellow' | 'red' | 'gray';

export function profitPerDay(s: GameState): number {
  if (s.finance.days.length) return avgProfit(s, 7);
  const t = s.finance.today;
  const frac = dayOf(s.tick) % 1 || 1;
  return (t.sales - t.purchases - t.salaries - t.power - t.logistics - t.upkeep - t.interest - t.other) / frac;
}

export interface FacilityView {
  id: number;
  type: string;
  name: string;
  level: number;
  stage: FacilityState['stage'];
  machines: number;
  recipe: string | null;
  util: number;
  outPerDay: number;
  profit: number | null;
  status: { tone: Tone; text: string };
  staff: number;
  staffCap: number;
  /** progress: this facility's job in hand; queued: taps waiting here; busy: the owner is working somewhere */
  tap: { can: boolean; why: string | null; progress: number | null; seconds: number; queued: number; busy: boolean };
  building: { progress: number; kind: 'build' | 'level'; daysLeft: number } | null;
  managed: boolean;
  /** run by a division head or a subsidiary */
  org: 'division' | 'sub' | null;
  auto: boolean;
}

export function facilityStatus(s: GameState, f: FacilityState): { tone: Tone; text: string } {
  if (f.building) {
    const left = (f.building.until - s.tick) / DATA.balance.time.ticksPerDay;
    const when = left < 1 ? '1日未満' : `${Math.ceil(left)}日`;
    if (f.building.kind === 'build') return { tone: 'gray', text: `🏗 建設中（あと${when}）` };
    // an expansion does not stop the work
    const st = runningStatus(s, f);
    return { tone: st.tone, text: `${st.text}・🏗 拡張中（あと${when}）` };
  }
  return runningStatus(s, f);
}

function runningStatus(s: GameState, f: FacilityState): { tone: Tone; text: string } {
  const def = defOf(f);
  if (f.type === 'research_lab') {
    const n = employeesAt(s, f.id).length;
    return n ? { tone: 'green', text: `🔬 研究員${n}人` } : { tone: 'yellow', text: '👤 研究員がいません' };
  }
  if (isPlant(f)) {
    if (f.machines === 0) return { tone: 'yellow', text: '⚙ 発電機がありません' };
    if (f.blocked === 'fuel') return { tone: 'red', text: `🔴 燃料（${DATA.item[f.fuel ?? 'coal'].name}）がありません` };
    if (plantCapacity(s, f) <= 0) return { tone: 'yellow', text: '👤 運転員がいません' };
    return { tone: 'green', text: `⚡ 発電中 ${Math.round(f.util * 100)}%` };
  }
  if (!isProduction(def)) return { tone: 'green', text: '🟢 稼働中' };
  switch (f.blocked) {
    case 'switching':
      return { tone: 'gray', text: '🔄 段取り替え中' };
    case 'noRecipe':
      return { tone: 'yellow', text: '⚪ 作る物を選んでください' };
    case 'noStaff':
      return f.stage === 'manual'
        ? { tone: f.level === 0 ? 'gray' : 'yellow', text: f.level === 0 ? '✋ あなたの手作業のみ' : '👤 人がいません' }
        : f.machines === 0
          ? { tone: 'yellow', text: '⚙ 機械がありません' }
          : { tone: 'yellow', text: '👤 操作員が足りません' };
    case 'inputs': {
      const r = f.recipe ? DATA.recipe[f.recipe] : null;
      const lack = r ? Object.keys(r.inputs).find((i) => (s.inventory[i] ?? 0) < r.inputs[i]) : null;
      return { tone: 'red', text: `🔴 ${lack ? DATA.item[lack].name : '材料'}不足` };
    }
    case 'storage':
      return { tone: 'red', text: '📦 倉庫が満杯' };
    case 'power':
      return { tone: 'red', text: `⚡ 電力不足（効率 ${Math.round(s.power.ratio * 100)}%）` };
    case 'stopped':
      return { tone: 'gray', text: '💤 自動運転で停止中' };
    case 'fuel':
      return { tone: 'red', text: '🔴 燃料不足' };
    case 'down':
      return { tone: 'red', text: '🔧 修理中' };
  }
  if (f.util >= 0.85) return { tone: 'green', text: '🟢 正常' };
  if (f.util > 0.02) return { tone: 'yellow', text: `🟡 稼働率 ${Math.round(f.util * 100)}%` };
  return { tone: 'gray', text: '⚪ 停止中' };
}

export function facilityView(s: GameState, f: FacilityState): FacilityView {
  const r = f.recipe ? DATA.recipe[f.recipe] : null;
  const cap = capacity(s, f);
  const job = s.owner.job;
  const tapWhy = r ? canTap(s, f) : 'レシピがありません';
  const hist = f.stats.utilHist;
  const util = hist.length ? hist[hist.length - 1] : f.util;
  const outPerDay = r ? (cap.slots / r.time) * r.output * Math.max(0, f.rate) * managerBonus(s, f) * (cap.power > 0 ? s.power.ratio : 1) : 0;
  const profit = f.stats.profitHist.length ? f.stats.profitHist[f.stats.profitHist.length - 1] : null;
  return {
    id: f.id,
    type: f.type,
    name: f.name,
    level: f.level,
    stage: f.stage,
    machines: f.machines,
    recipe: f.recipe,
    util: Math.min(1, f.building?.kind === 'build' ? 0 : util),
    outPerDay,
    profit,
    status: facilityStatus(s, f),
    staff: employeesAt(s, f.id).length,
    staffCap: staffCapacity(s, f),
    tap: {
      can: !tapWhy,
      why: tapWhy,
      progress: job && job.facilityId === f.id ? (s.tick - job.start) / (job.until - job.start) : null,
      seconds: r ? tapSeconds(r.id) : 0,
      queued: s.owner.queue.filter((x) => x === f.id).length,
      busy: !!job,
    },
    building: f.building
      ? {
          kind: f.building.kind,
          progress: (s.tick - f.building.start) / Math.max(1, f.building.until - f.building.start),
          daysLeft: (f.building.until - s.tick) / DATA.balance.time.ticksPerDay,
        }
      : null,
    managed: f.managerId !== null,
    org: inSubsidiary(s, f) ? 'sub' : divisionFor(s, f) ? 'division' : null,
    auto: f.auto.enabled,
  };
}

export interface StatusTile {
  key: string;
  label: string;
  icon: string;
  tone: Tone;
  value: string;
  link: 'production' | 'power' | 'assets' | 'logistics' | 'staff' | 'finance' | 'company';
}

export function statusTiles(s: GameState): StatusTile[] {
  const out: StatusTile[] = [];
  const prod = s.facilities.filter((f) => isProduction(defOf(f)) && !f.building && f.level > 0);
  const stopped = prod.filter((f) => ['inputs', 'storage', 'power', 'fuel'].includes(f.blocked ?? ''));
  out.push({
    key: 'production',
    label: '生産',
    icon: 'nav_production',
    tone: stopped.length === 0 ? 'green' : stopped.length * 3 > prod.length ? 'red' : 'yellow',
    value: stopped.length === 0 ? '正常' : `${stopped.length}施設が停滞`,
    link: 'production',
  });
  const p = s.power;
  const use = p.supply > 0 ? p.demand / p.supply : p.demand > 0 ? 9 : 0;
  out.push({
    key: 'power',
    label: '電力',
    icon: 'nav_power',
    tone: !hasFeature(s, 'machine') ? 'gray' : p.ratio < 0.999 ? 'red' : use > DATA.balance.problems.powerYellow ? 'yellow' : 'green',
    value: !hasFeature(s, 'machine') ? '未使用' : p.ratio < 0.999 ? `不足 ${Math.round(p.ratio * 100)}%` : `${Math.round(use * 100)}%`,
    link: 'power',
  });
  const cap = storageCapacity(s);
  const st = cap > 0 ? storedWeight(s) / cap : 1;
  out.push({ key: 'storage', label: '倉庫', icon: 'nav_assets', tone: st >= 0.999 ? 'red' : st > 0.9 ? 'yellow' : 'green', value: `${Math.round(st * 100)}%`, link: 'assets' });
  const l = s.logistics;
  const lu = l.capacity > 0 ? l.load / l.capacity : 0;
  out.push({ key: 'logistics', label: '物流', icon: 'nav_logistics', tone: lu > 1.001 ? 'red' : lu > 0.9 ? 'yellow' : 'green', value: lu > 1.001 ? `超過 ${Math.round(lu * 100)}%` : `${Math.round(lu * 100)}%`, link: 'logistics' });
  const idle = s.employees.filter((e) => e.assignedTo === null && e.role !== 'manager').length;
  let vacancies = 0;
  for (const f of s.facilities) if (!f.building && (f.stage !== 'manual' || f.level > 0)) vacancies += Math.max(0, staffCapacity(s, f) - employeesAt(s, f.id).length);
  out.push({
    key: 'staff',
    label: '人員',
    icon: 'nav_staff',
    tone: idle > 0 ? 'yellow' : vacancies > 0 && hasFeature(s, 'hire') ? 'yellow' : 'green',
    value: idle > 0 ? `待機 ${idle}人` : vacancies > 0 && hasFeature(s, 'hire') ? `${vacancies}人不足` : `${s.employees.length}人`,
    link: 'staff',
  });
  const profit = profitPerDay(s);
  out.push({
    key: 'cash',
    label: '資金',
    icon: 'nav_finance',
    tone: s.cash < 0 ? 'red' : profit < 0 && s.cash / -profit < 30 ? 'yellow' : 'green',
    value: s.cash < 0 ? 'マイナス' : profit < 0 ? `${Math.max(0, Math.floor(s.cash / -profit))}日分` : '健全',
    link: 'finance',
  });
  const ml = managementLoad(s) / managementCapacity(s);
  out.push({ key: 'mgmt', label: '管理', icon: 'nav_company', tone: ml > 1.2 ? 'red' : ml > 1 ? 'yellow' : 'green', value: `${Math.round(ml * 100)}%`, link: 'company' });
  return out;
}

export interface InvRow {
  item: string;
  stock: number;
  produced: number;
  consumed: number;
  net: number;
  daysLeft: number | null;
  value: number;
  stockHist: number[];
}

export function inventoryRows(s: GameState): InvRow[] {
  const vis = visibleItems(s);
  const flows = plannedFlows(s);
  const rows: InvRow[] = [];
  for (const it of DATA.items) {
    if (!vis.has(it.id)) continue;
    const stock = s.inventory[it.id] ?? 0;
    const a = actualRates(s, it.id);
    const produced = Math.max(a.produced + a.bought, flows.prod[it.id] ?? 0);
    const consumed = Math.max(a.consumed, flows.cons[it.id] ?? 0);
    const net = produced - consumed - a.sold;
    if (stock <= 1e-9 && produced <= 0 && consumed <= 0) continue;
    rows.push({
      item: it.id,
      stock,
      produced,
      consumed,
      net,
      daysLeft: net < -1e-9 ? stock / -net : null,
      value: stock * unitPrice(s, it.id),
      stockHist: s.itemHist[it.id]?.stock ?? [],
    });
  }
  return rows;
}

export interface MarketRow {
  item: string;
  price: number;
  change: number;
  spark: number[];
  demand: number;
  supply: number;
  hot: '供給不足' | '供給過剰' | null;
  stock: number;
}

export function marketRows(s: GameState): MarketRow[] {
  const vis = visibleItems(s);
  return DATA.items
    .filter((it) => vis.has(it.id))
    .map((it) => {
      const m = s.market[it.id];
      return {
        item: it.id,
        price: unitPrice(s, it.id),
        change: trend(s, it.id, 7),
        spark: m.hist.slice(-30),
        demand: demandStars(s, it.id),
        supply: supplyStars(s, it.id),
        hot: m.index > 1.25 ? '供給不足' : m.index < 0.8 ? '供給過剰' : null,
        stock: s.inventory[it.id] ?? 0,
      };
    });
}

export function kpis(s: GameState) {
  return {
    value: companyValue(s),
    employees: s.employees.length,
    facilities: s.facilities.filter((f) => f.level > 0).length,
    automation: automationRate(s),
    profit: profitPerDay(s),
  };
}

/** how well each input of an item is covered: production vs consumption */
export function coverage(s: GameState, item: string): number {
  const flows = plannedFlows(s);
  const use = Math.max(flows.cons[item] ?? 0, consumptionPerDay(s, item));
  const made = flows.prod[item] ?? 0;
  const stock = s.inventory[item] ?? 0;
  if (use <= 0) return stock > 0 || made > 0 ? 1 : 0;
  return Math.min(1, (made + stock / 14) / use);
}

export { recipeMargin };
