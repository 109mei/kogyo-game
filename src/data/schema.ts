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
    roles: z.object({ worker: RoleSchema, engineer: RoleSchema, researcher: RoleSchema, manager: RoleSchema }),
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
});

export type Item = z.infer<typeof ItemSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type Facility = z.infer<typeof FacilitySchema>;
export type Tech = z.infer<typeof TechSchema>;
export type Effect = Tech['effects'][number];
export type Goal = z.infer<typeof GoalSchema>;
export type GoalCondition = Goal['condition'];
export type Balance = z.infer<typeof BalanceSchema>;
export type PowerContract = Balance['power']['contracts'][number];
export type HQLevel = Balance['hq'][number];
export type RoleId = keyof Balance['staff']['roles'];
