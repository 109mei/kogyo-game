import { z } from 'zod';
import balanceJson from './balance.json';
import eventsJson from './events.json';
import facilitiesJson from './facilities.json';
import goalsJson from './goals.json';
import itemsJson from './items.json';
import namesJson from './names.json';
import recipesJson from './recipes.json';
import researchJson from './research.json';
import {
  BalanceSchema,
  EventSchema,
  FacilitySchema,
  GoalSchema,
  ItemSchema,
  RecipeSchema,
  TechSchema,
  type Balance,
  type Facility,
  type GameEventDef,
  type Goal,
  type Item,
  type Recipe,
  type Tech,
} from './schema';

export * from './schema';

const NamesSchema = z.object({
  surnames: z.array(z.string()).min(10),
  given: z.array(z.string()).min(10),
  places: z.array(z.string()).min(10),
});

export interface GameData {
  balance: Balance;
  items: Item[];
  recipes: Recipe[];
  facilities: Facility[];
  techs: Tech[];
  goals: Goal[];
  events: GameEventDef[];
  names: z.infer<typeof NamesSchema>;
  item: Record<string, Item>;
  recipe: Record<string, Recipe>;
  facility: Record<string, Facility>;
  tech: Record<string, Tech>;
  event: Record<string, GameEventDef>;
  /** base price in yen per unit, derived from recipes */
  basePrice: Record<string, number>;
  /** recipes that consume each item */
  consumers: Record<string, string[]>;
  /** everything a research unlocks (by the unlock field of each entry) */
  unlockedBy: Record<string, { facilities: string[]; recipes: string[]; contracts: string[] }>;
  /** production facilities in processing order: extraction, processing, manufacturing */
  productionOrder: string[];
  /** facility ids that can produce a recipe's output */
}

export class DataError extends Error {}

function parseList<T>(name: string, schema: z.ZodType<T>, raw: unknown): T[] {
  const res = z.array(schema).safeParse(raw);
  if (!res.success) {
    throw new DataError(`${name}: ${z.prettifyError(res.error)}`);
  }
  return res.data;
}

function indexById<T extends { id: string }>(name: string, list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) {
    if (out[x.id]) throw new DataError(`${name}: duplicate id ${x.id}`);
    out[x.id] = x;
  }
  return out;
}

export function buildData(raw: {
  balance: unknown;
  items: unknown;
  recipes: unknown;
  facilities: unknown;
  research: unknown;
  goals: unknown;
  events?: unknown;
  names: unknown;
}): GameData {
  const b = BalanceSchema.safeParse(raw.balance);
  if (!b.success) throw new DataError(`balance: ${z.prettifyError(b.error)}`);
  const balance = b.data;
  const items = parseList('items', ItemSchema, raw.items);
  const recipes = parseList('recipes', RecipeSchema, raw.recipes).map((r) => ({
    ...r,
    valueAdded: r.valueAdded * balance.economy.valueScale,
  }));
  const facilities = parseList('facilities', FacilitySchema, raw.facilities);
  const techs = parseList('research', TechSchema, raw.research);
  const goals = parseList('goals', GoalSchema, raw.goals);
  const events = parseList('events', EventSchema, raw.events ?? []);
  const n = NamesSchema.safeParse(raw.names);
  if (!n.success) throw new DataError(`names: ${z.prettifyError(n.error)}`);

  const item = indexById('items', items);
  const recipe = indexById('recipes', recipes);
  const facility = indexById('facilities', facilities);
  const tech = indexById('research', techs);
  indexById('goals', goals);
  const event = indexById('events', events);

  const unlockOk = (u: string) => u === 'start' || tech[u] !== undefined;
  const errors: string[] = [];

  // cross references
  for (const r of recipes) {
    if (!item[r.id]) errors.push(`recipe ${r.id}: no item with that id`);
    const f = facility[r.facility];
    if (!f) errors.push(`recipe ${r.id}: unknown facility ${r.facility}`);
    else if (!f.recipes.includes(r.id)) errors.push(`recipe ${r.id}: facility ${f.id} does not list it`);
    for (const inp of Object.keys(r.inputs)) if (!item[inp]) errors.push(`recipe ${r.id}: unknown input ${inp}`);
    if (!unlockOk(r.unlock)) errors.push(`recipe ${r.id}: unknown unlock ${r.unlock}`);
  }
  for (const it of items) if (!recipe[it.id]) errors.push(`item ${it.id}: has no recipe`);
  for (const f of facilities) {
    for (const rid of f.recipes) if (!recipe[rid]) errors.push(`facility ${f.id}: unknown recipe ${rid}`);
    if (!unlockOk(f.unlock)) errors.push(`facility ${f.id}: unknown unlock ${f.unlock}`);
    if (f.category !== 'infrastructure') {
      if (!f.machine) errors.push(`facility ${f.id}: production facility needs a machine stage`);
      if (!f.auto) errors.push(`facility ${f.id}: production facility needs an auto stage`);
    }
    if (f.generator) for (const fuel of Object.keys(f.generator.fuels)) if (!item[fuel]) errors.push(`facility ${f.id}: unknown fuel ${fuel}`);
  }
  for (const t of techs) {
    for (const req of t.requires) if (!tech[req]) errors.push(`research ${t.id}: unknown requirement ${req}`);
  }
  for (const c of balance.power.contracts) if (!unlockOk(c.unlock)) errors.push(`contract ${c.id}: unknown unlock ${c.unlock}`);
  for (const w of balance.start.workyards) {
    if (!facility[w.facility]) errors.push(`workyard: unknown facility ${w.facility}`);
    if (!recipe[w.recipe]) errors.push(`workyard: unknown recipe ${w.recipe}`);
  }
  for (const e of events) {
    // placeholders must have something to fill them
    const text = [e.title, e.body, ...e.choices.flatMap((c) => [c.label, c.detail])].join(' ');
    const need: Record<string, string[]> = { facility: ['facility', 'machineFacility'], item: ['product', 'input'], employee: ['bestEmployee'], stars: ['bestEmployee'], tech: ['research'] };
    for (const [ph, targets] of Object.entries(need)) if (text.includes(`{${ph}}`) && !targets.includes(e.target)) errors.push(`event ${e.id}: {${ph}} needs target ${targets.join('/')}`);
    for (const c of e.choices) if (c.detail.includes('{cost}') && !c.cost) errors.push(`event ${e.id}/${c.id}: {cost} without a cost`);
    if (e.needs.feature && !e.needs.feature.match(/^[a-zA-Z]+$/)) errors.push(`event ${e.id}: bad feature ${e.needs.feature}`);
  }
  for (const g of goals) {
    const c = g.condition;
    if ('item' in c && c.item && !item[c.item]) errors.push(`goal ${g.id}: unknown item ${c.item}`);
    if (c.type === 'tech' && !tech[c.tech]) errors.push(`goal ${g.id}: unknown tech ${c.tech}`);
    if (c.type === 'facility' && !facility[c.facility]) errors.push(`goal ${g.id}: unknown facility ${c.facility}`);
  }
  // research graph must be acyclic
  const techState: Record<string, 0 | 1 | 2> = {};
  const visitTech = (id: string, path: string[]) => {
    if (techState[id] === 2) return;
    if (techState[id] === 1) {
      errors.push(`research cycle: ${[...path, id].join(' -> ')}`);
      return;
    }
    techState[id] = 1;
    for (const r of tech[id]?.requires ?? []) visitTech(r, [...path, id]);
    techState[id] = 2;
  };
  for (const t of techs) visitTech(t.id, []);
  if (errors.length) throw new DataError(errors.join('\n'));

  // base prices, bottom-up
  const basePrice: Record<string, number> = {};
  const visiting = new Set<string>();
  const priceOf = (id: string): number => {
    if (basePrice[id] !== undefined) return basePrice[id];
    if (visiting.has(id)) throw new DataError(`recipe cycle through ${id}`);
    visiting.add(id);
    const r = recipe[id];
    let cost = r.valueAdded;
    for (const [inp, qty] of Object.entries(r.inputs)) cost += qty * priceOf(inp);
    visiting.delete(id);
    basePrice[id] = cost / r.output;
    return basePrice[id];
  };
  for (const it of items) priceOf(it.id);

  const consumers: Record<string, string[]> = {};
  for (const it of items) consumers[it.id] = [];
  for (const r of recipes) for (const inp of Object.keys(r.inputs)) consumers[inp].push(r.id);

  const unlockedBy: GameData['unlockedBy'] = {};
  const bucket = (u: string) => (unlockedBy[u] ??= { facilities: [], recipes: [], contracts: [] });
  for (const f of facilities) bucket(f.unlock).facilities.push(f.id);
  for (const r of recipes) bucket(r.unlock).recipes.push(r.id);
  for (const c of balance.power.contracts) bucket(c.unlock).contracts.push(c.id);

  const catRank = { extraction: 0, processing: 1, manufacturing: 2, infrastructure: 3 } as const;
  const productionOrder = facilities
    .filter((f) => f.category !== 'infrastructure')
    .sort((a, b) => catRank[a.category] - catRank[b.category] || a.no - b.no)
    .map((f) => f.id);

  return {
    balance,
    items,
    recipes,
    facilities,
    techs,
    goals,
    names: n.data,
    item,
    recipe,
    facility,
    tech,
    event,
    events,
    basePrice,
    consumers,
    unlockedBy,
    productionOrder,
  };
}

export const DATA: GameData = buildData({
  balance: balanceJson,
  items: itemsJson,
  recipes: recipesJson,
  facilities: facilitiesJson,
  research: researchJson,
  goals: goalsJson,
  events: eventsJson,
  names: namesJson,
});
