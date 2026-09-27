import { DATA } from '../data';
import { dayOf } from './calendar';
import type { GameState, HistoryEntry, Ledger, Link, Notice } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function newId(s: GameState): number {
  return s.nextId++;
}

export function today(s: GameState): number {
  return dayOf(s.tick);
}

export function techDone(s: GameState, id: string): boolean {
  return s.research.done.includes(id);
}

/** 'start', a research id, or a feature name */
export function unlocked(s: GameState, unlock: string): boolean {
  if (unlock === 'start') return true;
  if (DATA.tech[unlock]) return techDone(s, unlock);
  return !!s.features[unlock];
}

export function hasFeature(s: GameState, f: string): boolean {
  return !!s.features[f];
}

export function emptyLedger(): Ledger {
  return { sales: 0, purchases: 0, salaries: 0, power: 0, logistics: 0, upkeep: 0, interest: 0, other: 0, capex: 0 };
}

type Flow = keyof Ledger;

/** money coming in */
export function earn(s: GameState, kind: Flow, yen: number) {
  if (!(yen > 0)) return;
  s.cash += yen;
  s.finance.today[kind] += yen;
  s.finance.monthAcc[kind] += yen;
}

/** money going out (may drive cash negative: overdraft) */
export function pay(s: GameState, kind: Flow, yen: number) {
  if (!(yen > 0)) return;
  s.cash -= yen;
  s.finance.today[kind] += yen;
  s.finance.monthAcc[kind] += yen;
}

export function notify(
  s: GameState,
  level: Notice['level'],
  icon: string,
  title: string,
  body = '',
  link: Link | null = null,
) {
  s.notices.push({ id: newId(s), day: today(s), level, icon, title, body, link, read: false });
  if (s.notices.length > 120) s.notices.splice(0, s.notices.length - 120);
}

export function addHistory(s: GameState, icon: string, text: string) {
  const e: HistoryEntry = { day: Math.floor(today(s)), icon, text };
  s.history.push(e);
}

/** write a history entry the first time a milestone key is reached */
export function milestone(s: GameState, key: string, icon: string, text: string) {
  if (s.milestones[key]) return false;
  s.milestones[key] = true;
  addHistory(s, icon, text);
  return true;
}

export function marketPrice(s: GameState, item: string): number {
  return DATA.basePrice[item] * (s.market[item]?.index ?? 1);
}

export function round(v: number, digits = 0) {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
