import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const pos = z.number().positive();
const nonneg = z.number().nonnegative();
const frac = z.number().min(-1).max(1);

export const ItemSchema = z.object({
  id,
  no: z.number().int().min(1).max(100),
  name: z.string().min(1),
  category: z.enum(['raw', 'material', 'part', 'product']),
  unit: z.string().min(1),
  /** tonnes per unit, used for storage and trucks */
  weight: pos,
  transport: z.enum(['truck', 'pipe']),
  /** market size: units traded per day at the base price */
  demand: pos,
  /** daily standard deviation of the log demand shock */
  volatility: z.number().min(0).max(0.2),
  desc: z.string(),
});

export const RecipeSchema = z.object({
  /** a recipe is named after the single item it makes */
  id,
  facility: id,
  inputs: z.record(id, pos),
  output: pos,
  /** yen of value one batch adds on top of its inputs; defines the base price */
  valueAdded: pos,
  /** worker-days (= machine slots) one batch takes */
  time: pos.default(1),
  powerMul: pos.default(1),
  /** 'start' or a research id */
  unlock: z.string(),
  /** fraction of a batch the owner makes with one tap */
  tap: z.number().min(0).max(1).optional(),
});

const MachineStage = z.object({
  rate: pos,
  cost: pos,
  power: nonneg,
  operators: z.number().int().min(0),
});

const AutoStage = z.object({
  rate: pos,
  /** extra cost per machine to convert it to automatic */
  cost: pos,
  power: nonneg,
});

export const FacilitySchema = z.object({
  id,
  no: z.number().int().min(66).max(100),
  name: z.string().min(1),
  short: z.string().min(1),
  category: z.enum(['extraction', 'processing', 'manufacturing', 'infrastructure']),
  unlock: z.string(),
  buildCost: pos,
  buildDays: pos,
  upkeep: nonneg,
  maxLevel: z.number().int().min(1).max(10),
  /** cost to go from level L to L+1 = buildCost * levelCostMul^(L-1) */
  levelCostMul: pos,
  recipes: z.array(id),
  /** workers per level at the manual stage; absent = no manual stage */
  manualWorkers: z.number().int().min(1).optional(),
  machinesPerLevel: z.number().int().min(0),
  machine: MachineStage.optional(),
  auto: AutoStage.optional(),
  storage: nonneg.optional(),
  logistics: nonneg.optional(),
  logisticsCostCut: frac.optional(),
  researchers: z.number().int().min(1).optional(),
  generator: z
    .object({
      /** kW per generator unit */
      capacity: pos,
      /** tonnes (or units) of fuel per kWh, per fuel item */
      fuels: z.record(id, pos),
      unitCost: pos,
      operators: z.number().int().min(0),
      autoCost: pos,
    })
    .optional(),
  desc: z.string(),
});

const EffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unlock'), target: z.string() }),
  z.object({ type: z.literal('feature'), feature: z.string() }),
  z.object({
    type: z.literal('rate'),
    stage: z.enum(['manual', 'machine', 'auto', 'all']),
    category: z.enum(['extraction', 'processing', 'manufacturing', 'all']).default('all'),
    facility: id.optional(),
    value: frac,
  }),
  z.object({ type: z.literal('power'), value: frac, facility: id.optional() }),
  z.object({ type: z.literal('inputs'), value: frac }),
  z.object({ type: z.literal('logistics'), value: frac }),
  z.object({ type: z.literal('logisticsCost'), value: frac }),
  z.object({ type: z.literal('management'), value: frac }),
  z.object({ type: z.literal('candidates'), value: z.number().int() }),
  z.object({ type: z.literal('skillGrowth'), value: frac }),
  z.object({ type: z.literal('machinesPerLevel'), value: z.number().int() }),
  z.object({ type: z.literal('fuel'), value: frac }),
  z.object({ type: z.literal('managerBonus'), value: frac }),
  z.object({ type: z.literal('loanLimit'), value: z.number() }),
]);

export const TechSchema = z.object({
  id,
  name: z.string(),
  category: z.enum(['production', 'automation', 'logistics', 'energy', 'materials', 'electronics', 'power', 'management']),
  cost: pos,
  requires: z.array(id),
  effects: z.array(EffectSchema),
  desc: z.string(),
});

const ConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('taps'), count: z.number().int().positive() }),
  z.object({ type: z.literal('sold'), item: id.optional(), amount: pos }),
  z.object({ type: z.literal('employees'), count: z.number().int().positive(), assigned: z.boolean().default(false) }),
  z.object({ type: z.literal('produced'), item: id, amount: pos }),
  z.object({ type: z.literal('facility'), facility: id, count: z.number().int().positive(), level: z.number().int().default(1) }),
  z.object({ type: z.literal('researchers'), count: z.number().int().positive() }),
  z.object({ type: z.literal('tech'), tech: id }),
  z.object({ type: z.literal('stage'), stage: z.enum(['machine', 'auto']), count: z.number().int().positive() }),
  z.object({ type: z.literal('automation'), count: z.number().int().positive() }),
  z.object({ type: z.literal('powerOk') }),
  z.object({ type: z.literal('value'), amount: pos }),
]);

export const GoalSchema = z.object({
  id,
  title: z.string(),
  hint: z.string(),
  condition: ConditionSchema,
  unlocks: z.array(z.string()).default([]),
  /** subsidy (yen) paid when the goal is reached */
  reward: nonneg.default(0),
});

/** how the yen cost of an event choice is worked out when the event comes up */
const EventCostSchema = z.object({
  type: z.enum(['fixed', 'powerDays', 'workerPayrollDays', 'researchPayrollDays', 'buildShare', 'machineShare', 'buyDays']),
  value: nonneg,
  min: nonneg.default(0),
});

const EventEffectSchema = z.discriminatedUnion('type', [
  /** the grid delivers only this share of the contract for a while */
  z.object({ type: z.literal('gridCut'), value: z.number().min(0).max(1), days: pos }),
  /** hand work and machines with operators run at this share for a while (automatic machines keep going) */
  z.object({ type: z.literal('strike'), value: z.number().min(0).max(1), days: pos }),
  /** the facility the event is about stops for a while */
  z.object({ type: z.literal('down'), days: pos }),
  /** workers' and engineers' pay goes up for good */
  z.object({ type: z.literal('raise'), value: nonneg }),
  /** the employee the event is about gets a raise */
  z.object({ type: z.literal('raiseTarget'), value: nonneg }),
  /** the employee the event is about leaves */
  z.object({ type: z.literal('leave') }),
  /** demand for the item the event is about moves (log shock) */
  z.object({ type: z.literal('demand'), value: z.number() }),
  /** extra applicants arrive now */
  z.object({ type: z.literal('applicants'), value: z.number().int().positive() }),
  /** the current research moves on by this many days of the lab's output */
  z.object({ type: z.literal('rp'), days: pos }),
  /** buy this many days of the item's use at today's price */
  z.object({ type: z.literal('stockUp'), days: pos }),
]);

const EventChoiceSchema = z.object({
  id,
  label: z.string(),
  detail: z.string(),
  cost: EventCostSchema.optional(),
  effects: z.array(EventEffectSchema).default([]),
});

export const EventSchema = z.object({
  id,
  icon: z.string(),
  title: z.string(),
  body: z.string(),
  weight: pos,
  /** what the company must have for the event to come up */
  needs: z
    .object({
      feature: z.string().optional(),
      /** a power contract in use */
      grid: z.boolean().optional(),
      /** at least this many workers and engineers at work */
      staff: z.number().int().positive().optional(),
      /** at least this many facilities up and running */
      facilities: z.number().int().positive().optional(),
    })
    .default({}),
  /** what the event is about; the event only comes up when there is one */
  target: z.enum(['none', 'facility', 'machineFacility', 'bestEmployee', 'product', 'input', 'research']).default('none'),
  /** happens as soon as the event comes up, whatever is chosen */
  onArrive: z.array(EventEffectSchema).default([]),
  /** the first choice is taken if nobody decides in time */
  choices: z.array(EventChoiceSchema).min(2).max(3),
});

const PowerContractSchema = z.object({
  id,
  name: z.string(),
  capacity: nonneg,
  /** yen per kW per month */
  basicFee: nonneg,
  /** yen per kWh */
  energyPrice: nonneg,
  unlock: z.string(),
});

const HQLevelSchema = z.object({
  level: z.number().int().positive(),
  name: z.string(),
  cost: nonneg,
  days: nonneg,
  management: pos,
  candidates: z.number().int().positive(),
  storage: pos,
  logistics: pos,
  upkeep: nonneg,
});

const RoleSchema = z.object({
  name: z.string(),
  salary: pos,
  weight: nonneg,
  unlock: z.string(),
});

export const BalanceSchema = z.object({
  time: z.object({
    realSecondsPerDay: pos,
    ticksPerDay: z.number().int().positive(),
    speeds: z.array(z.number().int().nonnegative()),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    offlineMaxDays: nonneg,
    tapDays: pos,
    /** the owner works this many times as fast as a hired worker */
    tapSpeed: pos,
    /** taps that can wait behind the one in progress */
    tapQueue: z.number().int().nonnegative(),
    hourTicks: z.number().int().positive(),
  }),
  start: z.object({
    cash: pos,
    companyName: z.string(),
    workyards: z.array(z.object({ facility: id, recipe: id, place: z.string() })),
    workyardWorkers: z.number().int().positive(),
  }),
  economy: z.object({
    /** multiplies every recipe's value added (and so every base price) */
    valueScale: pos,
  }),
  staff: z.object({
    roles: z.object({ worker: RoleSchema, engineer: RoleSchema, researcher: RoleSchema, manager: RoleSchema, director: RoleSchema }),
    hireFee: nonneg,
    severanceMonths: nonneg,
    skillMult: z.array(pos).length(5),
    skillSalaryStep: nonneg,
    specialtyBonus: nonneg,
    expDaysPerStar: pos,
    operatorSkillEffect: nonneg,
    managerBonusPerStar: nonneg,
    candidateSkillWeights: z.array(nonneg).length(5),
    candidateLifeDays: pos,
    bulkHire: z.object({ size: z.number().int().positive(), costPerHead: nonneg }),
  }),
  power: z.object({
    contracts: z.array(PowerContractSchema),
    plantUpkeepPerUnit: nonneg,
  }),
  logistics: z.object({
    truckCapacity: pos,
    costPerTon: nonneg,
    truckUpkeep: nonneg,
    railCapacity: pos,
    railCostPerTon: nonneg,
    railMonthlyFee: nonneg,
    /** freight beyond our own capacity goes to outside carriers at this multiple */
    outsourcePremium: pos,
    /** production slowdown per 100% of overload, and its cap */
    delaySlope: nonneg,
    maxDelayPenalty: nonneg,
  }),
  market: z.object({
    buySpread: nonneg,
    sellSpread: nonneg,
    elasticity: pos,
    emaDays: pos,
    immediateImpact: nonneg,
    maxImpact: pos,
    reversion: pos,
    shockReversion: pos,
    priceFloor: pos,
    priceCeil: pos,
    historyDays: z.number().int().positive(),
    contractPremium: z.number(),
    contractDays: z.array(z.number().int().positive()),
  }),
  finance: z.object({
    loanRateYear: nonneg,
    overdraftRateYear: nonneg,
    loanBase: nonneg,
    loanEquityMul: nonneg,
    valueProfitYears: nonneg,
    ledgerDays: z.number().int().positive(),
  }),
  management: z.object({
    perFacility: pos,
    perFacilityWithManager: nonneg,
    employeesPerPoint: pos,
    penaltySlope: nonneg,
    maxPenalty: nonneg,
  }),
  hq: z.array(HQLevelSchema),
  production: z.object({
    overdriveMax: pos,
    overdrivePowerMul: pos,
    recipeSwitchDays: nonneg,
    levelUpkeepMul: pos,
    /** yearly-ish maintenance: share of machine price paid per day */
    machineUpkeepRate: nonneg,
    autoUpkeepRate: nonneg,
    automationWeight: z.object({ manual: nonneg, machine: nonneg, auto: nonneg }),
  }),
  problems: z.object({
    stockRedDays: pos,
    stockYellowDays: pos,
    powerYellow: pos,
    storageYellow: pos,
    logisticsYellow: pos,
    cashRunwayYellowDays: pos,
    lossDays: z.number().int().positive(),
  }),
  research: z.object({
    rpPerResearcher: pos,
  }),
  /** the one-tap "sell what is not needed" */
  surplus: z.object({
    /** days of the company's own use to keep */
    keepDays: nonneg,
    /** sell until the price has dropped this much */
    maxPriceDrop: z.number().min(0.01).max(0.5),
  }),
  orders: z.object({
    /** chance per day of a new offer while there is room */
    offerChance: z.number().min(0).max(1),
    maxOffers: z.number().int().positive(),
    maxActive: z.number().int().positive(),
    /** days an offer stays open */
    offerDays: pos,
    /** price as a multiple of the market price: [min, max] */
    premium: z.tuple([pos, pos]),
    /** share of offers for something the company does not make yet */
    freshChance: z.number().min(0).max(1),
    freshPremium: z.tuple([pos, pos]),
    /** size in days of the company's own output: [min, max] */
    sizeDays: z.tuple([pos, pos]),
    /** size of a new product order in days of one new facility's output */
    freshSizeDays: z.tuple([pos, pos]),
    /** time allowed = size in days of output times this */
    leadMul: pos,
    minDays: pos,
    maxDays: pos,
    /** share of the undelivered value paid when an order is missed or cancelled */
    penalty: z.number().min(0).max(1),
    /** days of the company's own use kept back from automatic deliveries */
    reserveDays: nonneg,
    /** customer name endings */
    customers: z.array(z.string()).min(1),
  }),
  events: z.object({
    startDay: nonneg,
    /** days between events: [min, max] */
    gapDays: z.tuple([pos, pos]),
    /** the same event does not come back within this many days */
    repeatDays: nonneg,
    /** days to decide before the first choice is taken */
    decideDays: pos,
  }),
  divisions: z.object({
    minFacilities: z.number().int().positive(),
    /** management points per facility in a division with a head */
    loadPerFacility: nonneg,
    /** output bonus per star of the head, for every facility of the division */
    headBonusPerStar: nonneg,
    /** hiring through an agency when no applicant fits costs this many times the hiring fee */
    hireFeeMul: pos,
    /** heads do not spend or hire when cash would cover fewer days of fixed costs than this */
    cashReserveDays: nonneg,
    /** average use of a facility above which it counts as busy (worth more machines) */
    busyUtil: z.number().min(0).max(1),
    subsidiaryBase: nonneg,
    subsidiaryPerFacility: nonneg,
  }),
});

export type Item = z.infer<typeof ItemSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type Facility = z.infer<typeof FacilitySchema>;
export type Tech = z.infer<typeof TechSchema>;
export type Effect = Tech['effects'][number];
export type Goal = z.infer<typeof GoalSchema>;
export type GameEventDef = z.infer<typeof EventSchema>;
export type EventChoice = GameEventDef['choices'][number];
export type EventEffect = z.infer<typeof EventEffectSchema>;
export type GoalCondition = Goal['condition'];
export type Balance = z.infer<typeof BalanceSchema>;
export type PowerContract = Balance['power']['contracts'][number];
export type HQLevel = Balance['hq'][number];
export type RoleId = keyof Balance['staff']['roles'];
