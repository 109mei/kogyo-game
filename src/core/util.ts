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
  return { sales: 0, grants: 0, purchases: 0, salaries: 0, power: 0, logistics: 0, upkeep: 0, interest: 0, other: 0, capex: 0 };
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

/** 3億2,000万円 / 45万円 style for notices and problem cards */
export function yenText(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(1)}兆円`;
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(a >= 1e10 ? 0 : 1)}億円`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString()}万円`;
  return `${sign}${Math.round(a).toLocaleString()}円`;
}

/** a count with its unit, rounded for reading */
export function qtyText(v: number, unit: string): string {
  const a = Math.abs(v);
  const s = a >= 100 ? Math.round(v).toLocaleString() : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')}${unit}`;
}

export function round(v: number, digits = 0) {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
