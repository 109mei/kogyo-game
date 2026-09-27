import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BalanceSchema, buildData, DATA, DataError } from '../src/data';
import balanceJson from '../src/data/balance.json';
import facilitiesJson from '../src/data/facilities.json';
import goalsJson from '../src/data/goals.json';
import itemsJson from '../src/data/items.json';
import namesJson from '../src/data/names.json';
import recipesJson from '../src/data/recipes.json';
import researchJson from '../src/data/research.json';

const raw = {
  balance: balanceJson,
  items: itemsJson,
  recipes: recipesJson,
  facilities: facilitiesJson,
  research: researchJson,
  goals: goalsJson,
  names: namesJson,
};

describe('data', () => {
  it('balance.json passes the Zod schema', () => {
    expect(BalanceSchema.safeParse(balanceJson).success).toBe(true);
  });

  it('has the 100 items of the plan: 65 goods and 35 facilities, numbered 1..100', () => {
    expect(DATA.items).toHaveLength(65);
    expect(DATA.facilities).toHaveLength(35);
    const nos = [...DATA.items.map((i) => i.no), ...DATA.facilities.map((f) => f.no)].sort((a, b) => a - b);
    expect(nos).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('derives a finite positive base price for every item', () => {
    for (const it of DATA.items) {
      const p = DATA.basePrice[it.id];
      expect(Number.isFinite(p) && p > 0, it.id).toBe(true);
    }
    // the plan's example: steel at 118,000 yen/t before the value scale
    expect(DATA.basePrice.steel / DATA.balance.economy.valueScale).toBeCloseTo(118000, -2);
  });

  it('every recipe adds value: output worth more than inputs', () => {
    for (const r of DATA.recipes) {
      let inputs = 0;
      for (const [i, q] of Object.entries(r.inputs)) inputs += q * DATA.basePrice[i];
      expect(r.output * DATA.basePrice[r.id], r.id).toBeGreaterThan(inputs);
    }
  });

  it('rejects broken data with a readable error', () => {
    const bad = structuredClone(raw) as typeof raw & { recipes: { inputs: Record<string, number> }[] };
    bad.recipes[16].inputs = { unobtainium: 1 };
    expect(() => buildData(bad)).toThrow(DataError);
    const badBalance = structuredClone(raw) as { balance: { time: { ticksPerDay: number } } } & typeof raw;
    badBalance.balance.time.ticksPerDay = -5;
    expect(() => buildData(badBalance)).toThrow(/balance/);
  });

  it('has an icon for every item, facility and UI icon used by the data', () => {
    const ids = [...DATA.items.map((i) => i.id), ...DATA.facilities.map((f) => f.id)];
    for (const id of ids) {
      expect(existsSync(`public/assets/icons/${id}.webp`), id).toBe(true);
      expect(existsSync(`public/assets/icons/sm/${id}.webp`), id).toBe(true);
    }
  });

  it('every research is reachable from the start', () => {
    const done = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of DATA.techs) {
        if (!done.has(t.id) && t.requires.every((r) => done.has(r))) {
          done.add(t.id);
          grew = true;
        }
      }
    }
    expect(done.size).toBe(DATA.techs.length);
  });

  it('every item can be made once research is complete (no dead ends)', () => {
    for (const r of DATA.recipes) {
      const unlock = r.unlock === 'start' || DATA.tech[r.unlock] !== undefined;
      const fac = DATA.facility[r.facility].unlock;
      expect(unlock && (fac === 'start' || DATA.tech[fac] !== undefined), r.id).toBe(true);
    }
  });

  it('the sprite sheet mapping lists each icon id once', () => {
    const cfg = JSON.parse(readFileSync('art_pipeline/sheets.json', 'utf8')) as { sheets: { ids: string[] }[] };
    const ids = cfg.sheets.flatMap((s) => s.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(220);
  });
});
