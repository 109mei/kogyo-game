/**
 * What the simulation worker sends to the page. The page keeps a copy of the
 * game state for drawing; sending all of it ten times a second would cost as
 * much as simulating, so each part goes only as often as it can change:
 *
 * - hot parts (cash, stock, facilities, ...) every frame
 * - cold parts (price history, staff, the ledger, notices, ...) when the day
 *   or hour turns, a command ran, something new was created, or every few
 *   seconds as a safety net
 *
 * Every key of GameState is listed below, so a new key has to be sorted into
 * one of the groups before the code compiles.
 */
import { dayIndex, type GameState } from '../core';
import { DATA } from '../data';

type When = 'hot' | 'day' | 'hour' | 'staff' | 'news' | 'command' | 'finance';

const PLAN: Record<keyof GameState, When> = {
  // every frame
  tick: 'hot',
  speed: 'hot',
  paused: 'hot',
  pauseReason: 'hot',
  cash: 'hot',
  loan: 'hot',
  nextId: 'hot',
  staffRev: 'hot',
  rng: 'hot',
  inventory: 'hot',
  itemToday: 'hot',
  facilities: 'hot',
  power: 'hot',
  logistics: 'hot',
  research: 'hot',
  owner: 'hot',
  totals: 'hot',
  goals: 'hot',
  features: 'hot',
  hq: 'hot',
  problems: 'hot',
  pausedFor: 'hot',
  candidates: 'hot',
  contracts: 'hot',
  divisions: 'hot',
  orders: 'hot',
  events: 'hot',
  effects: 'hot',
  // split: today's running ledger every frame, the closed days with the day
  finance: 'finance',
  // when the day turns
  itemHist: 'day',
  // when the hour turns (trades by managers and auto-trade happen hourly)
  market: 'hour',
  // when staff change (hires, skills) or the day turns (experience)
  employees: 'staff',
  // when something new was written (every notice takes a new id)
  notices: 'news',
  history: 'news',
  milestones: 'news',
  // only commands change these
  autoTrade: 'command',
  settings: 'command',
  companyName: 'command',
  seed: 'command',
  version: 'command',
};

const KEYS = Object.keys(PLAN) as (keyof GameState)[];
/** everything is resent at least this often, in case a change slipped past the rules above */
export const FULL_EVERY_MS = 5000;

export interface Marks {
  day: number;
  hour: number;
  nextId: number;
  staffRev: number;
  fullAt: number;
}

export function freshMarks(): Marks {
  return { day: -1, hour: -1, nextId: -1, staffRev: -1, fullAt: -Infinity };
}

export interface Snapshot {
  parts: Partial<GameState>;
  /** finance goes in pieces: today's ledger always, closed days and months with the day */
  finance: Partial<GameState['finance']>;
  full: boolean;
}

/**
 * The parts of the state that may have changed since the marks were taken.
 * `force` (after a command, on request) sends everything.
 */
export function takeSnapshot(s: GameState, marks: Marks, force: boolean, now: number): Snapshot {
  const day = dayIndex(s.tick);
  const hour = Math.floor(s.tick / DATA.balance.time.hourTicks);
  const full = force || now - marks.fullAt >= FULL_EVERY_MS;
  const due: Record<When, boolean> = {
    hot: true,
    finance: true,
    day: full || day !== marks.day,
    hour: full || hour !== marks.hour || day !== marks.day,
    staff: full || day !== marks.day || s.staffRev !== marks.staffRev || s.nextId !== marks.nextId,
    news: full || day !== marks.day || s.nextId !== marks.nextId,
    command: full,
  };
  const parts: Partial<GameState> = {};
  const rec = parts as Record<string, unknown>;
  for (const k of KEYS) {
    const when = PLAN[k];
    if (when === 'finance' || !due[when]) continue;
    rec[k] = s[k];
  }
  const finance: Partial<GameState['finance']> = { today: s.finance.today, monthAcc: s.finance.monthAcc };
  if (due.day) {
    finance.days = s.finance.days;
    finance.months = s.finance.months;
  }
  marks.day = day;
  marks.hour = hour;
  marks.nextId = s.nextId;
  marks.staffRev = s.staffRev;
  if (full) marks.fullAt = now;
  return { parts, finance, full };
}

/** the page's copy with a snapshot applied (a new object, so views see the change) */
export function mergeSnapshot(view: GameState, snap: Snapshot): GameState {
  return { ...view, ...snap.parts, finance: { ...view.finance, ...snap.finance } };
}
