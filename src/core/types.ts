/**
 * Game state. Plain JSON-serialisable data; the rule engine (src/core) is its
 * only writer. The UI reads it through snapshots and changes it only by
 * dispatching commands.
 */
import type { RoleId } from '../data';

export type Stage = 'manual' | 'machine' | 'auto';
export type Specialty = 'extraction' | 'processing' | 'manufacturing' | 'research' | 'management';
export type Policy = 'stable' | 'profit' | 'max' | 'eco' | 'custom';
export type AutoMode = 'easy' | 'standard' | 'advanced';
export type CondVar = 'stock' | 'stockDays' | 'price' | 'demand' | 'margin' | 'powerUse' | 'powerPrice' | 'cash';

export interface Cond {
  v: CondVar;
  /** item for stock / stockDays / price / demand; defaults to the facility output */
  item?: string;
  op: '<' | '>';
  value: number;
}

export interface Rule {
  conds: Cond[];
  /** production rate 0..1.5 when every condition holds */
  rate: number;
}

export interface AutomationSettings {
  enabled: boolean;
  mode: AutoMode;
  policy: Policy;
  /** stable policy: keep the output stock around this */
  targetStock: number;
  /** eco policy: company power use (0..1) above which the facility runs at half speed */
  powerCap: number;
  /** standard mode: produce while output stock < startBelow, stop once > stopAbove */
  startBelow: number;
  stopAbove: number;
  rules: Rule[];
}

export interface FacilityStats {
  /** cumulative output per item */
  produced: Record<string, number>;
  maxUtil: number;
  /** today's economics (yen) */
  outValue: number;
  inValue: number;
  wages: number;
  powerCost: number;
  upkeep: number;
  /** last days' profit (yen/day), newest last */
  profitHist: number[];
  utilHist: number[];
  /** batches done today (for utilisation) */
  batchesToday: number;
  capacityToday: number;
  /** output value (yen) of the last closed day */
  lastOut: number;
}

export interface FacilityState {
  id: number;
  type: string;
  name: string;
  place: string;
  /** 0 = the starting workyard (manual only, few workers) */
  level: number;
  stage: Stage;
  machines: number;
  recipe: string | null;
  /** production pauses until this tick after a recipe change */
  switchUntil: number;
  building: { kind: 'build' | 'level'; until: number; start: number } | null;
  builtDay: number;
  invested: number;
  auto: AutomationSettings;
  managerId: number | null;
  /** power plant fuel */
  fuel: string | null;
  /** automation output 0..1.5 */
  rate: number;
  /** last tick utilisation 0..1 */
  util: number;
  /** why output is limited, if it is */
  blocked: BlockReason | null;
  stats: FacilityStats;
}

export type BlockReason = 'building' | 'switching' | 'noRecipe' | 'noStaff' | 'inputs' | 'storage' | 'power' | 'stopped' | 'fuel';

export interface Employee {
  id: number;
  name: string;
  role: RoleId;
  skill: number;
  exp: number;
  specialty: Specialty;
  salary: number;
  assignedTo: number | null;
  hiredDay: number;
}

export interface Candidate {
  id: number;
  name: string;
  role: RoleId;
  skill: number;
  specialty: Specialty;
  salary: number;
  expires: number;
}

export interface MarketItem {
  /** log demand shock (mean reverting) */
  shock: number;
  /** price index: market price = base price * index */
  index: number;
  /** EMA of our net sales (units/day, sales positive) */
  flow: number;
  /** our net sales so far today */
  todayNet: number;
  /** closing index for past days, newest last */
  hist: number[];
}

export interface Contract {
  id: number;
  item: string;
  side: 'buy' | 'sell';
  perDay: number;
  price: number;
  startDay: number;
  endDay: number;
  done: number;
}

export interface AutoTrade {
  sellAbove: number | null;
  buyBelow: number | null;
  /** do not sell below this price index */
  minIndex: number;
  /** do not buy above this price index */
  maxIndex: number;
}

export interface Ledger {
  sales: number;
  purchases: number;
  salaries: number;
  power: number;
  logistics: number;
  upkeep: number;
  interest: number;
  other: number;
  capex: number;
}

export interface DayRecord extends Ledger {
  day: number;
  cash: number;
  value: number;
  production: number;
}

export interface MonthRecord extends Ledger {
  year: number;
  month: number;
  cash: number;
  value: number;
  employees: number;
  facilities: number;
  automation: number;
}

export interface ItemDay {
  produced: number;
  consumed: number;
  sold: number;
  bought: number;
}

export interface Notice {
  id: number;
  day: number;
  level: 'info' | 'good' | 'warn' | 'bad';
  icon: string;
  title: string;
  body: string;
  link: Link | null;
  read: boolean;
}

export type Link =
  | { screen: 'facility'; id: number }
  | { screen: 'item'; id: string }
  | { screen: 'market'; id?: string }
  | { screen: 'research'; id?: string }
  | { screen: 'staff' }
  | { screen: 'power' }
  | { screen: 'logistics' }
  | { screen: 'finance' }
  | { screen: 'build'; id?: string }
  | { screen: 'company' }
  | { screen: 'production' }
  | { screen: 'assets' };

export interface HistoryEntry {
  day: number;
  icon: string;
  text: string;
}

export interface Solution {
  kind: string;
  icon: string;
  label: string;
  detail: string;
  /** a command the UI can dispatch directly */
  command?: Command;
  /** or a screen to open */
  link?: Link;
  disabled?: string;
}

export interface Problem {
  key: string;
  level: 'red' | 'yellow';
  icon: string;
  title: string;
  detail: string;
  impact: string[];
  solutions: Solution[];
}

export interface OwnerJob {
  facilityId: number;
  recipe: string;
  /** fraction of a batch */
  amount: number;
  start: number;
  until: number;
}

export interface Settings {
  autoPause: boolean;
  offlineDays: number;
  theme: 'auto' | 'light' | 'dark';
  world3d: boolean;
  compactInventory: boolean;
  automationLevel: AutoMode;
}

export interface GameState {
  version: number;
  seed: number;
  rng: [number, number, number, number];
  nextId: number;
  companyName: string;
  /** ticks since the company was founded */
  tick: number;
  speed: number;
  paused: boolean;
  /** why the game paused itself, if it did */
  pauseReason: string | null;
  cash: number;
  loan: number;
  inventory: Record<string, number>;
  itemToday: Record<string, ItemDay>;
  /** last 30 days per item */
  itemHist: Record<string, { produced: number[]; consumed: number[]; sold: number[]; bought: number[]; stock: number[] }>;
  facilities: FacilityState[];
  employees: Employee[];
  /** bumped whenever staff assignments or skills change (invalidates caches) */
  staffRev: number;
  candidates: Candidate[];
  market: Record<string, MarketItem>;
  contracts: Contract[];
  autoTrade: Record<string, AutoTrade>;
  power: {
    contract: string;
    /** kW wanted by running machines (last tick) */
    demand: number;
    supply: number;
    gridCapacity: number;
    plantCapacity: number;
    plantOutput: number;
    gridOutput: number;
    /** 0..1: share of demand that was served */
    ratio: number;
    /** average yen/kWh paid today */
    avgPrice: number;
    kwhToday: number;
    costToday: number;
  };
  logistics: {
    trucks: number;
    rail: boolean;
    /** tonnes/day wanted (EMA) */
    load: number;
    capacity: number;
    ratio: number;
    movedToday: number;
    /** tonnes production wanted to ship today (before the logistics limit) */
    wantToday: number;
  };
  research: {
    done: string[];
    current: string | null;
    progress: number;
    rpPerDay: number;
    /** progress kept for themes that were switched away from */
    saved: Record<string, number>;
  };
  features: Record<string, boolean>;
  goals: { index: number; done: string[] };
  hq: { level: number; building: { until: number; start: number } | null };
  owner: { job: OwnerJob | null; taps: number };
  totals: {
    produced: Record<string, number>;
    sold: Record<string, number>;
    salesValue: number;
    maxValue: number;
    everHired: number;
  };
  finance: {
    today: Ledger;
    days: DayRecord[];
    months: MonthRecord[];
    monthAcc: Ledger;
  };
  notices: Notice[];
  history: HistoryEntry[];
  /** history milestone keys already written */
  milestones: Record<string, boolean>;
  problems: Problem[];
  /** problem keys that already caused an automatic pause */
  pausedFor: Record<string, boolean>;
  settings: Settings;
}

export type Command =
  | { type: 'gather'; facilityId: number }
  | { type: 'build'; facility: string; recipe?: string }
  | { type: 'upgradeLevel'; facilityId: number }
  | { type: 'buyMachine'; facilityId: number; count?: number }
  | { type: 'automate'; facilityId: number }
  | { type: 'setRecipe'; facilityId: number; recipe: string }
  | { type: 'hire'; candidateId: number }
  | { type: 'bulkHire' }
  | { type: 'fire'; employeeId: number }
  | { type: 'assign'; employeeId: number; facilityId: number | null }
  | { type: 'autoAssign' }
  | { type: 'promote'; employeeId: number; role: RoleId }
  | { type: 'setManager'; facilityId: number; employeeId: number | null }
  | { type: 'sell'; item: string; qty: number }
  | { type: 'buy'; item: string; qty: number }
  | { type: 'contract'; item: string; side: 'buy' | 'sell'; perDay: number; days: number }
  | { type: 'cancelContract'; contractId: number }
  | { type: 'setAutoTrade'; item: string; rule: AutoTrade | null }
  | { type: 'setAutomation'; facilityId: number; settings: AutomationSettings }
  | { type: 'setPowerContract'; contract: string }
  | { type: 'setFuel'; facilityId: number; fuel: string }
  | { type: 'addTrucks'; count: number }
  | { type: 'removeTrucks'; count: number }
  | { type: 'setRail'; on: boolean }
  | { type: 'research'; tech: string }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'upgradeHQ' }
  | { type: 'rename'; facilityId: number; name: string }
  | { type: 'renameCompany'; name: string }
  | { type: 'setSpeed'; speed: number }
  | { type: 'readNotices' }
  | { type: 'setSetting'; key: keyof Settings; value: Settings[keyof Settings] }
  | { type: 'resumeFromAutoPause' };

export interface CommandResult {
  ok: boolean;
  message?: string;
}
