import { DATA } from '../data';
import { createFacility, defaultAutomation } from './facilities';
import { initMarket } from './market';
import { recordFounding } from './progress';
import { seedRng } from './rng';
import { makeCandidate } from './staff';
import type { GameState, ItemDay } from './types';
import { emptyLedger } from './util';

export const STATE_VERSION = 1;

export interface NewGameOptions {
  seed?: number;
  companyName?: string;
}

export function createInitialState(opts: NewGameOptions = {}): GameState {
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const b = DATA.balance;
  const itemToday: Record<string, ItemDay> = {};
  const itemHist: GameState['itemHist'] = {};
  const inventory: Record<string, number> = {};
  for (const it of DATA.items) {
    itemToday[it.id] = { produced: 0, consumed: 0, sold: 0, bought: 0 };
    itemHist[it.id] = { produced: [], consumed: [], sold: [], bought: [], stock: [] };
    inventory[it.id] = 0;
  }
  const s: GameState = {
    version: STATE_VERSION,
    seed,
    rng: seedRng(seed),
    nextId: 1,
    companyName: opts.companyName?.trim() || b.start.companyName,
    tick: 0,
    speed: 1,
    paused: false,
    pauseReason: null,
    cash: b.start.cash,
    loan: 0,
    inventory,
    itemToday,
    itemHist,
    facilities: [],
    employees: [],
    staffRev: 0,
    candidates: [],
    market: {},
    contracts: [],
    autoTrade: {},
    power: {
      contract: 'none',
      demand: 0,
      supply: 0,
      gridCapacity: 0,
      plantCapacity: 0,
      plantOutput: 0,
      gridOutput: 0,
      ratio: 1,
      avgPrice: 0,
      kwhToday: 0,
      costToday: 0,
    },
    logistics: {
      trucks: 0,
      rail: false,
      load: 0,
      capacity: b.hq[0].logistics,
      ratio: 1,
      movedToday: 0,
      wantToday: 0,
    },
    research: { done: [], current: null, progress: 0, rpPerDay: 0 },
    features: {},
    goals: { index: 0, done: [] },
    hq: { level: 1, building: null },
    owner: { job: null, taps: 0 },
    totals: { produced: {}, sold: {}, salesValue: 0, maxValue: 0, everHired: 0 },
    finance: { today: emptyLedger(), days: [], months: [], monthAcc: emptyLedger() },
    notices: [],
    history: [],
    milestones: {},
    problems: [],
    pausedFor: {},
    settings: {
      autoPause: true,
      offlineDays: b.time.offlineMaxDays,
      theme: 'auto',
      world3d: true,
      compactInventory: false,
      automationLevel: 'easy',
    },
  };
  initMarket(s);
  for (const w of b.start.workyards) {
    const f = createFacility(s, w.facility, { place: w.place, level: 0, recipe: w.recipe });
    f.name = `${w.place}の${DATA.facility[w.facility].short}作業場`;
    f.auto = defaultAutomation(w.recipe);
  }
  // the first people to answer the "help wanted" sign
  for (let i = 0; i < b.hq[0].candidates; i++) s.candidates.push(makeCandidate(s, 'worker'));
  recordFounding(s);
  return s;
}
