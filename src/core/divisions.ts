/**
 * Divisions and subsidiaries: the steps after factory managers.
 *
 * A division is every facility of one kind. A division head (a promoted
 * factory manager) runs them together: keeps them staffed, buys inputs and
 * sells what is not needed (like a manager), and puts part of the division's
 * profit back into machines, automation and expansions.
 *
 * A subsidiary goes one step further: it no longer uses the head office's
 * management, builds new facilities of its kind by itself when the old ones
 * are full, and the player no longer steers its facilities one by one.
 */
import { DATA } from '../data';
import { recipeMargin } from './automation';
import { execCommand } from './commands';
import { automateCost, defOf, isProduction, levelUpCost, machinePrice, maxMachines } from './facilities';
import { fixedCostPerDay } from './finance';
import { mods } from './mods';
import { divisionName, headOf } from './org';
import { pick, random } from './rng';
import { baseSalary, employeesAt, randomName, rolesFor, staffCapacity } from './staff';
import type { Command, Division, Employee, FacilityState, GameState } from './types';
import { addHistory, hasFeature, newId, notify, pay, yenText } from './util';
import { dayIndex } from './calendar';

export function ensureDivision(s: GameState, type: string): Division {
  let d = s.divisions[type];
  if (!d) {
    d = { type, headId: null, hire: true, invest: 0.25, budget: 0, spent: 0, last: null, sub: null };
    s.divisions[type] = d;
  }
  return d;
}

export function members(s: GameState, type: string): FacilityState[] {
  return s.facilities.filter((f) => f.type === type);
}

/** yesterday's profit of every facility of the kind (yen) */
export function divisionProfit(s: GameState, type: string): number {
  let t = 0;
  for (const f of members(s, type)) {
    const h = f.stats.profitHist;
    if (h.length) t += h[h.length - 1];
  }
  return t;
}

export function subsidiaryCost(s: GameState, type: string): number {
  const b = DATA.balance.divisions;
  return b.subsidiaryBase + b.subsidiaryPerFacility * members(s, type).length;
}

/** facility kinds that can be a division */
export function canBeDivision(type: string): boolean {
  const def = DATA.facility[type];
  return !!def && isProduction(def);
}

/** average use over the last few days (0..1) */
function recentUtil(f: FacilityState): number {
  const h = f.stats.utilHist;
  if (!h.length) return f.util;
  const n = Math.min(3, h.length);
  let t = 0;
  for (let i = h.length - n; i < h.length; i++) t += h[i];
  return t / n;
}

/** kW one more machine would draw */
function machineKw(s: GameState, f: FacilityState): number {
  const def = defOf(f);
  const per = f.stage === 'auto' ? (def.auto?.power ?? 0) : (def.machine?.power ?? 0);
  const recipe = f.recipe ? DATA.recipe[f.recipe] : null;
  return per * (recipe?.powerMul ?? 1) * mods(s).power * (mods(s).powerByFacility[def.id] ?? 1);
}

function powerRoom(s: GameState, kw: number): boolean {
  if (kw <= 0) return true;
  return s.power.supply - s.power.demand >= kw * 1.2;
}

/** the head acts through the same commands the player uses, paid from the division's allowance */
function act(s: GameState, d: Division, cmd: Command, cost: number, text: string): boolean {
  const res = execCommand(s, cmd);
  if (!res.ok) return false;
  d.budget = Math.max(0, d.budget - cost);
  d.spent += cost;
  d.last = text;
  return true;
}

/** people for open places: idle staff first, then applicants, then an agency */
function staffDivision(s: GameState, d: Division, list: FacilityState[]) {
  const b = DATA.balance.divisions;
  const def = DATA.facility[d.type];
  const open: { f: FacilityState; room: number }[] = [];
  for (const f of list) {
    if (f.building && f.building.kind === 'build') continue;
    if (!rolesFor(f).includes('worker')) continue;
    const room = staffCapacity(s, f) - employeesAt(s, f.id).length;
    if (room > 0) open.push({ f, room });
  }
  if (!open.length) return;
  const place = (e: Employee) => {
    const slot = open.find((o) => o.room > 0);
    if (!slot) return false;
    if (!execCommand(s, { type: 'assign', employeeId: e.id, facilityId: slot.f.id }).ok) return false;
    slot.room--;
    return true;
  };
  let placed = 0;
  // idle hands of the company first (matching specialty first)
  const idle = s.employees
    .filter((e) => e.assignedTo === null && (e.role === 'worker' || e.role === 'engineer'))
    .sort((a, b2) => Number(b2.specialty === def.category) - Number(a.specialty === def.category) || b2.skill - a.skill);
  for (const e of idle) {
    if (!open.some((o) => o.room > 0)) break;
    if (place(e)) placed++;
  }
  const need = open.reduce((t, o) => t + o.room, 0);
  if (need <= 0) {
    if (placed) d.last = `待機中の${placed}人を配置`;
    return;
  }
  const reserve = fixedCostPerDay(s) * b.cashReserveDays;
  // applicants who fit
  const apps = s.candidates.filter((c) => c.role === 'worker' || c.role === 'engineer').sort((a, b2) => b2.skill - a.skill);
  let hired = 0;
  for (const c of apps) {
    if (!open.some((o) => o.room > 0)) break;
    if (s.cash - DATA.balance.staff.hireFee < reserve) break;
    if (!execCommand(s, { type: 'hire', candidateId: c.id }).ok) break;
    const e = s.employees.find((x) => x.id === c.id);
    if (e && place(e)) hired++;
  }
  // an agency for the rest: costs more, but finds people who know the trade
  const fee = DATA.balance.staff.hireFee * b.hireFeeMul;
  let agency = 0;
  while (open.some((o) => o.room > 0) && agency < 5 && s.cash - fee >= reserve) {
    pay(s, 'other', fee);
    const skill = random(s) < 0.3 ? 2 : 1;
    const e: Employee = {
      id: newId(s),
      name: randomName(s),
      role: 'worker',
      skill,
      exp: 0,
      specialty: def.category === 'infrastructure' ? pick(s, ['extraction', 'processing', 'manufacturing'] as const) : def.category,
      salary: baseSalary('worker', skill),
      assignedTo: null,
      hiredDay: dayIndex(s.tick),
    };
    s.employees.push(e);
    s.totals.everHired++;
    s.staffRev++;
    place(e);
    agency++;
  }
  const n = placed + hired + agency;
  if (n) d.last = `${n}人を配置${hired + agency ? `（うち採用${hired + agency}人）` : ''}`;
}

/** one investment a day at most: the busiest facility first */
function investDivision(s: GameState, d: Division, list: FacilityState[]) {
  const b = DATA.balance.divisions;
  const def = DATA.facility[d.type];
  const reserve = fixedCostPerDay(s) * b.cashReserveDays;
  const afford = (yen: number) => d.budget >= yen && s.cash - yen >= reserve;
  const ready = list.filter((f) => !f.building && f.recipe && recipeMargin(s, f) > 0).sort((a, b2) => recentUtil(b2) - recentUtil(a));
  let blockedByPower = false;
  for (const f of ready) {
    const busy = recentUtil(f) >= b.busyUtil;
    // 1. a busy facility with room for another machine
    if (busy && f.stage !== 'manual' && f.machines < maxMachines(s, f)) {
      const price = machinePrice(f);
      if (!powerRoom(s, machineKw(s, f))) blockedByPower = true;
      else if (afford(price) && act(s, d, { type: 'buyMachine', facilityId: f.id }, price, `${f.name}に機械を追加`)) return;
    }
    // 2. busy and full: expand while that is still cheaper than a new building
    if (busy && f.stage !== 'manual' && f.machines >= maxMachines(s, f) && f.level < def.maxLevel && levelUpCost(f) <= def.buildCost * 3) {
      const cost = levelUpCost(f);
      if (afford(cost) && act(s, d, { type: 'upgradeLevel', facilityId: f.id }, cost, `${f.name}を拡張`)) return;
    }
    // 3. a busy starting workyard is made a proper facility first (Lv1 takes machines)
    if (busy && f.stage === 'manual' && f.level === 0) {
      const cost = levelUpCost(f);
      if (afford(cost) && act(s, d, { type: 'upgradeLevel', facilityId: f.id }, cost, `${f.name}を整備`)) return;
    }
    // 4. hand work that keeps up with nothing: the first machine
    if (busy && f.stage === 'manual' && f.level >= 1 && hasFeature(s, 'machine') && def.machine) {
      const price = machinePrice(f);
      if (!powerRoom(s, machineKw(s, f))) blockedByPower = true;
      else if (afford(price) && act(s, d, { type: 'buyMachine', facilityId: f.id }, price, `${f.name}を機械化`)) return;
    }
  }
  // 5. automatic machines free the operators for other work
  if (hasFeature(s, 'auto')) {
    for (const f of ready) {
      if (f.stage !== 'machine' || f.machines <= 0) continue;
      const cost = automateCost(f);
      if (afford(cost) && act(s, d, { type: 'automate', facilityId: f.id }, cost, `${f.name}を自動化`)) return;
    }
  }
  // 6. a subsidiary builds a new facility when every one it has is full and busy
  if (d.sub && list.length && !list.some((f) => f.building)) {
    // a small starting workyard never counts as room to grow
    const sites = list.filter((f) => f.level > 0);
    const full = sites.length > 0 && sites.every((f) => f.stage !== 'manual' && f.machines >= maxMachines(s, f) && (f.level >= def.maxLevel || levelUpCost(f) > def.buildCost * 3));
    const busy = sites.length > 0 && sites.reduce((t, f) => t + recentUtil(f), 0) / sites.length >= b.busyUtil;
    const recipe = mostCommonRecipe(list);
    const cost = def.buildCost;
    const outIndex = recipe ? (s.market[recipe]?.index ?? 1) : 1;
    if (full && busy && recipe && outIndex >= 0.8 && afford(cost)) {
      if (act(s, d, { type: 'build', facility: d.type, recipe }, cost, `新しい${def.name}を建設`)) {
        const f = s.facilities[s.facilities.length - 1];
        notify(s, 'good', 'fin_merger', `${d.sub.name}が${f.name}を建設`, `子会社が利益で工場を増やしています（${yenText(cost)}）`, { screen: 'division', id: d.type });
        addHistory(s, 'fin_merger', `${d.sub.name}が${f.name}を建設`);
      }
      return;
    }
  }
  if (blockedByPower) d.last = '電力に余裕がないため機械の追加を見送り';
}

function mostCommonRecipe(list: FacilityState[]): string | null {
  const n = new Map<string, number>();
  for (const f of list) if (f.recipe) n.set(f.recipe, (n.get(f.recipe) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [r, k] of n) {
    if (k > bestN) {
      best = r;
      bestN = k;
    }
  }
  return best;
}

/** end of day: every division with a head saves up its allowance, staffs and invests */
export function dailyDivisions(s: GameState) {
  for (const d of Object.values(s.divisions)) {
    if (d.headId === null) continue;
    const head = headOf(s, d.type);
    if (!head) {
      d.headId = null;
      continue;
    }
    const list = members(s, d.type);
    if (!list.length) continue;
    d.budget += d.invest * Math.max(0, divisionProfit(s, d.type));
    if (d.hire || d.sub) staffDivision(s, d, list);
    if (d.invest > 0) investDivision(s, d, list);
  }
}

/** checks for putting someone in charge of a division */
export function headProblem(s: GameState, type: string, employeeId: number | null): string | null {
  if (!hasFeature(s, 'divisions')) return '研究「部門制」で解放されます';
  if (!canBeDivision(type)) return '生産施設の部門だけに置けます';
  if (employeeId === null) return null;
  const e = s.employees.find((x) => x.id === employeeId);
  if (!e || e.role !== 'director') return '部門長を選んでください（工場長を部門長に昇進させます）';
  if (members(s, type).length === 0) return 'この種類の施設がありません';
  return null;
}

/** the division a director leads, if any */
export function divisionOfHead(s: GameState, employeeId: number): Division | null {
  return Object.values(s.divisions).find((d) => d.headId === employeeId) ?? null;
}

export function subsidiaryName(s: GameState, type: string): string {
  const place = pick(s, DATA.names.places);
  return `${place}${DATA.facility[type].short}株式会社`;
}

export { divisionName };
