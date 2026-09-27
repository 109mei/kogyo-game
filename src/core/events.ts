/**
 * Events that ask for a decision: a blackout, a strike, a typhoon, a broken
 * machine, a rival poaching a star, a TV crew, a university, a shortage.
 * Each comes with two or three choices (events.json). If nobody decides in
 * time, the first choice is taken, so a company left alone keeps running.
 */
import { DATA, type EventEffect, type GameEventDef } from '../data';
import { consumptionPerDay } from './automation';
import { dayIndex } from './calendar';
import { defOf, isProduction, machinePrice } from './facilities';
import { buyQuote, executeBuy } from './market';
import { researchPerDay } from './research';
import { randInt, random } from './rng';
import { addCandidates, makeCandidate } from './staff';
import type { Effect, FacilityState, GameState, PendingEvent } from './types';
import { hasFeature, notify, pay, yenText } from './util';
import { contractDef } from './power';

const E = () => DATA.balance.events;

// ---- targets -----------------------------------------------------------------------------------

function running(f: FacilityState): boolean {
  return isProduction(defOf(f)) && !(f.building && f.building.kind === 'build') && f.recipe !== null;
}

function workers(s: GameState): number {
  return s.employees.filter((e) => (e.role === 'worker' || e.role === 'engineer') && e.assignedTo !== null).length;
}

/** what the event is about, or undefined when there is nothing it could be about */
function findTarget(s: GameState, def: GameEventDef): { target: number | null; item: string | null } | undefined {
  const weighted = <T>(xs: T[], w: (x: T) => number): T | undefined => {
    const total = xs.reduce((t, x) => t + w(x), 0);
    if (!(total > 0)) return undefined;
    let r = random(s) * total;
    for (const x of xs) {
      r -= w(x);
      if (r < 0) return x;
    }
    return xs[xs.length - 1];
  };
  switch (def.target) {
    case 'none':
      return { target: null, item: null };
    case 'facility': {
      const f = weighted(s.facilities.filter((x) => running(x) && x.level >= 1), () => 1);
      return f ? { target: f.id, item: null } : undefined;
    }
    case 'machineFacility': {
      const f = weighted(s.facilities.filter((x) => running(x) && x.stage !== 'manual' && x.machines > 0), (x) => x.machines);
      return f ? { target: f.id, item: null } : undefined;
    }
    case 'bestEmployee': {
      const best = s.employees
        .filter((e) => e.skill >= 4 && e.role !== 'director')
        .sort((a, b) => b.skill - a.skill || b.salary - a.salary)[0];
      return best ? { target: best.id, item: null } : undefined;
    }
    case 'product': {
      const made = DATA.items.filter((it) => it.category !== 'raw' && (s.itemHist[it.id]?.produced.slice(-14).reduce((t, x) => t + x, 0) ?? 0) > 0);
      const it = weighted(made, (x) => DATA.basePrice[x.id]);
      return it ? { target: null, item: it.id } : undefined;
    }
    case 'input': {
      const used = DATA.items.filter((it) => it.id !== 'water' && consumptionPerDay(s, it.id) > 0);
      const it = weighted(used, (x) => consumptionPerDay(s, x.id) * DATA.basePrice[x.id]);
      return it ? { target: null, item: it.id } : undefined;
    }
    case 'research':
      return s.research.current && researchPerDay(s) > 0 && hasFeature(s, 'research') ? { target: null, item: null } : undefined;
  }
}

function eligible(s: GameState, def: GameEventDef): boolean {
  const n = def.needs;
  if (n.feature && !hasFeature(s, n.feature)) return false;
  if (n.grid && !(contractDef(s.power.contract).capacity > 0 && s.power.gridOutput > 0)) return false;
  if (n.staff && workers(s) < n.staff) return false;
  if (n.facilities && s.facilities.filter((f) => running(f) && f.level >= 1).length < n.facilities) return false;
  return true;
}

// ---- costs -------------------------------------------------------------------------------------

function costOf(s: GameState, def: GameEventDef, choiceId: string, target: number | null, item: string | null): number {
  const c = def.choices.find((x) => x.id === choiceId)?.cost;
  if (!c) return 0;
  const f = target !== null ? s.facilities.find((x) => x.id === target) : undefined;
  let v = 0;
  switch (c.type) {
    case 'fixed':
      v = c.value;
      break;
    case 'powerDays': {
      const k = contractDef(s.power.contract);
      v = c.value * (s.power.gridOutput * 24 * k.energyPrice + (k.capacity * k.basicFee) / 30);
      break;
    }
    case 'workerPayrollDays':
      v = (c.value * s.employees.filter((e) => e.role === 'worker' || e.role === 'engineer').reduce((t, e) => t + e.salary, 0)) / 30;
      break;
    case 'researchPayrollDays':
      v = (c.value * s.employees.filter((e) => e.role === 'researcher').reduce((t, e) => t + e.salary, 0)) / 30;
      break;
    case 'buildShare':
      v = f ? c.value * Math.max(f.invested, defOf(f).buildCost) : 0;
      break;
    case 'machineShare':
      v = f ? c.value * machinePrice(f) * Math.max(1, f.machines) : 0;
      break;
    case 'buyDays':
      v = item ? buyQuote(s, item, c.value * consumptionPerDay(s, item)).total : 0;
      break;
  }
  return Math.round(Math.max(c.min, v) / 1000) * 1000;
}

// ---- text ----------------------------------------------------------------------------------------

/** fill {facility}, {item}, {employee}, {stars}, {tech} and {cost} */
export function eventText(s: GameState, e: PendingEvent, text: string, choiceId?: string): string {
  const f = e.target !== null ? s.facilities.find((x) => x.id === e.target) : undefined;
  const who = e.target !== null ? s.employees.find((x) => x.id === e.target) : undefined;
  const tech = s.research.current ? DATA.tech[s.research.current]?.name : '';
  return text
    .replaceAll('{facility}', f?.name ?? '施設')
    .replaceAll('{item}', e.item ? DATA.item[e.item].name : '')
    .replaceAll('{employee}', who?.name ?? '社員')
    .replaceAll('{stars}', String(who?.skill ?? ''))
    .replaceAll('{tech}', tech ?? '')
    .replaceAll('{cost}', choiceId ? yenText(e.costs[choiceId] ?? 0) : '');
}

// ---- effects -------------------------------------------------------------------------------------

function addEffect(s: GameState, kind: Effect['kind'], days: number, value: number, target: number | null, label: string) {
  const until = s.tick + Math.round(days * DATA.balance.time.ticksPerDay);
  // the same kind on the same target is replaced, not stacked
  s.effects = s.effects.filter((x) => !(x.kind === kind && x.target === target));
  s.effects.push({ kind, until, value, target, label });
}

function applyEffect(s: GameState, e: PendingEvent, eff: EventEffect) {
  const f = e.target !== null ? s.facilities.find((x) => x.id === e.target) : undefined;
  switch (eff.type) {
    case 'gridCut':
      addEffect(s, 'gridCut', eff.days, eff.value, null, `停電：電力会社からの供給 ${Math.round(eff.value * 100)}%`);
      break;
    case 'strike':
      addEffect(s, 'strike', eff.days, eff.value, null, `ストライキ：手作業と機械の生産 ${Math.round(eff.value * 100)}%`);
      break;
    case 'down':
      if (f) addEffect(s, 'down', eff.days, 0, f.id, `修理中：${f.name}`);
      break;
    case 'raise':
      for (const x of s.employees) if (x.role === 'worker' || x.role === 'engineer') x.salary = Math.round(x.salary * (1 + eff.value));
      s.staffRev++;
      break;
    case 'raiseTarget': {
      const x = s.employees.find((y) => y.id === e.target);
      if (x) x.salary = Math.round(x.salary * (1 + eff.value));
      s.staffRev++;
      break;
    }
    case 'leave': {
      const x = s.employees.find((y) => y.id === e.target);
      if (!x) break;
      for (const g of s.facilities) if (g.managerId === x.id) g.managerId = null;
      for (const d of Object.values(s.divisions)) if (d.headId === x.id) d.headId = null;
      s.employees = s.employees.filter((y) => y.id !== x.id);
      s.staffRev++;
      break;
    }
    case 'demand':
      if (e.item) s.market[e.item].shock += eff.value;
      break;
    case 'applicants':
      addCandidates(s, Array.from({ length: eff.value }, () => makeCandidate(s)));
      break;
    case 'rp':
      if (s.research.current) s.research.progress += eff.days * researchPerDay(s);
      break;
    case 'stockUp':
      if (e.item) {
        const qty = eff.days * consumptionPerDay(s, e.item);
        if (qty > 0) executeBuy(s, e.item, qty);
      }
      break;
  }
}

/** multiplier on the grid contract (1 = normal) */
export function gridFactor(s: GameState): number {
  let v = 1;
  for (const x of s.effects) if (x.kind === 'gridCut' && x.until > s.tick) v = Math.min(v, x.value);
  return v;
}

/** multiplier for hand work and machines with operators (1 = normal) */
export function strikeFactor(s: GameState): number {
  let v = 1;
  for (const x of s.effects) if (x.kind === 'strike' && x.until > s.tick) v = Math.min(v, x.value);
  return v;
}

export function isDown(s: GameState, f: FacilityState): boolean {
  for (const x of s.effects) if (x.kind === 'down' && x.target === f.id && x.until > s.tick) return true;
  return false;
}

function endEffects(s: GameState) {
  const over = s.effects.filter((x) => x.until <= s.tick);
  if (!over.length) return;
  s.effects = s.effects.filter((x) => x.until > s.tick);
  for (const x of over) {
    if (x.kind === 'gridCut') notify(s, 'good', 'nav_power', '停電が復旧しました', '電力会社からの供給が元に戻りました', { screen: 'power' });
    else if (x.kind === 'strike') notify(s, 'good', 'ppl_worker', 'ストライキが終わりました', '現場が元どおり動いています', { screen: 'production' });
    else if (x.kind === 'down') {
      const f = s.facilities.find((y) => y.id === x.target);
      if (f) notify(s, 'good', 'ui_done', `${f.name}の修理が終わりました`, '', { screen: 'facility', id: f.id });
    }
  }
}

// ---- the day ----------------------------------------------------------------------------------------

/** a cost paid when the choice is made (a purchase pays for itself: its cost is only the estimate shown) */
function payable(def: GameEventDef, choiceId: string, e: PendingEvent): number {
  const c = def.choices.find((x) => x.id === choiceId)?.cost;
  if (!c || c.type === 'buyDays') return 0;
  return e.costs[choiceId] ?? 0;
}

function resolve(s: GameState, e: PendingEvent, choiceId: string, auto: boolean) {
  const def = DATA.event[e.kind];
  const choice = def.choices.find((c) => c.id === choiceId) ?? def.choices[0];
  const cost = payable(def, choice.id, e);
  if (cost > 0) pay(s, 'other', cost);
  for (const eff of choice.effects) applyEffect(s, e, eff);
  s.events.pending = s.events.pending.filter((x) => x.id !== e.id);
  if (auto) notify(s, 'info', def.icon, `${eventText(s, e, def.title)}：「${choice.label}」にしました`, '期限までに決めなかったため', null);
}

export function chooseEvent(s: GameState, id: number, choiceId: string): string | null {
  const e = s.events.pending.find((x) => x.id === id);
  if (!e) return 'この出来事はもう終わりました';
  const def = DATA.event[e.kind];
  if (!def.choices.some((c) => c.id === choiceId)) return 'その選択肢はありません';
  const cost = e.costs[choiceId] ?? 0;
  if (cost > 0 && s.cash < cost) return `資金が足りません（${yenText(cost)}）`;
  resolve(s, e, choiceId, false);
  return null;
}

export function dailyEvents(s: GameState) {
  const today = dayIndex(s.tick);
  endEffects(s);
  for (const e of [...s.events.pending]) if (today > e.until) resolve(s, e, DATA.event[e.kind].choices[0].id, true);
  if (!s.settings.events || s.events.pending.length || today < s.events.next || today < E().startDay) return;
  if (!hasFeature(s, 'build')) {
    s.events.next = today + 5;
    return;
  }
  const options: { def: GameEventDef; t: { target: number | null; item: string | null } }[] = [];
  for (const def of DATA.events) {
    const last = s.events.last[def.id];
    if (last !== undefined && today - last < E().repeatDays) continue;
    if (!eligible(s, def)) continue;
    const t = findTarget(s, def);
    if (t) options.push({ def, t });
  }
  if (!options.length) {
    s.events.next = today + 3;
    return;
  }
  let r = random(s) * options.reduce((t, o) => t + o.def.weight, 0);
  let pick = options[options.length - 1];
  for (const o of options) {
    r -= o.def.weight;
    if (r < 0) {
      pick = o;
      break;
    }
  }
  startEvent(s, pick.def, pick.t);
  s.events.next = today + randInt(s, E().gapDays[0], E().gapDays[1]);
}

/** an event comes up: costs are fixed now, its first effects happen at once */
export function startEvent(s: GameState, def: GameEventDef, t: { target: number | null; item: string | null }): PendingEvent {
  const today = dayIndex(s.tick);
  const e: PendingEvent = { id: s.nextId++, kind: def.id, day: today, until: today + E().decideDays, target: t.target, item: t.item, costs: {} };
  for (const c of def.choices) e.costs[c.id] = costOf(s, def, c.id, t.target, t.item);
  for (const eff of def.onArrive) applyEffect(s, e, eff);
  s.events.pending.push(e);
  s.events.last[def.id] = today;
  notify(s, 'warn', def.icon, eventText(s, e, def.title), `${E().decideDays}日のうちに、ホームで対応を選んでください`, { screen: 'home' });
  return e;
}

/** tests: bring up an event now, about the thing it would pick itself */
export function forceEvent(s: GameState, kind: string): PendingEvent | null {
  const def = DATA.event[kind];
  if (!def) return null;
  const t = findTarget(s, def);
  if (!t) return null;
  s.events.pending = [];
  return startEvent(s, def, t);
}

