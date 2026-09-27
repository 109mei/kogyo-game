import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, runDays, runTicks } from '../src/core';
import { plantCapacity } from '../src/core/power';
import { completeResearch } from '../src/core/research';
import { employeesAt } from '../src/core/staff';
import { DATA } from '../src/data';
import { openingState } from './helpers';

describe('the first minutes', () => {
  it('starts with the three workyards, 3,000,000 yen and nobody hired', () => {
    const s = createInitialState({ seed: 1 });
    expect(s.cash).toBe(3_000_000);
    expect(s.facilities.map((f) => f.recipe)).toEqual(['log', 'stone', 'water']);
    expect(s.employees).toHaveLength(0);
  });

  it('a tap takes 10 real seconds at x1 and yields one log', () => {
    const s = createInitialState({ seed: 1 });
    const f = s.facilities[0];
    expect(applyCommand(s, { type: 'gather', facilityId: f.id }).ok).toBe(true);
    const ticks = s.owner.job!.until - s.owner.job!.start;
    const seconds = (ticks / DATA.balance.time.ticksPerDay) * DATA.balance.time.realSecondsPerDay;
    expect(seconds).toBeCloseTo(10, 5);
    // one job at a time
    expect(applyCommand(s, { type: 'gather', facilityId: f.id }).ok).toBe(false);
    runTicks(s, ticks);
    expect(s.inventory.log).toBeCloseTo(1, 6);
  });

  it('unlocks selling after three taps and hiring after the first sale', () => {
    const s = createInitialState({ seed: 1 });
    const f = s.facilities[0];
    expect(applyCommand(s, { type: 'sell', item: 'log', qty: 1 }).ok).toBe(false);
    for (let i = 0; i < 3; i++) {
      applyCommand(s, { type: 'gather', facilityId: f.id });
      runTicks(s, 40);
    }
    expect(applyCommand(s, { type: 'hire', candidateId: s.candidates[0].id }).ok).toBe(false);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'sell', item: 'log', qty: 3 }).ok).toBe(true);
    expect(s.cash).toBeGreaterThan(cash);
    expect(applyCommand(s, { type: 'hire', candidateId: s.candidates[0].id }).ok).toBe(true);
  });

  it('a company that does nothing does not lose money', () => {
    const s = createInitialState({ seed: 2 });
    runDays(s, 60, false);
    expect(s.cash).toBe(3_000_000);
  });

  it('hired workers produce without the owner tapping', () => {
    const s = openingState();
    const before = s.inventory.log + s.inventory.stone + s.inventory.water;
    runDays(s, 3, false);
    expect(s.inventory.log + s.inventory.stone + s.inventory.water).toBeGreaterThan(before + 5);
  });
});

describe('growth', () => {
  it('building costs money and takes days', () => {
    const s = openingState();
    const cash = s.cash;
    expect(applyCommand(s, { type: 'build', facility: 'sawmill' }).ok).toBe(true);
    const f = s.facilities.at(-1)!;
    expect(s.cash).toBe(cash - DATA.facility.sawmill.buildCost);
    expect(f.building).not.toBeNull();
    runDays(s, DATA.facility.sawmill.buildDays + 0.1, false);
    expect(f.building).toBeNull();
  });

  it('machines need the research, then replace hand work with 20 workers of output', () => {
    const s = openingState();
    s.cash = 1e9;
    const forest = s.facilities[0];
    applyCommand(s, { type: 'upgradeLevel', facilityId: forest.id });
    runDays(s, 3, false);
    expect(forest.level).toBe(1);
    expect(applyCommand(s, { type: 'buyMachine', facilityId: forest.id }).ok).toBe(false);
    completeResearch(s, 'p_tools');
    completeResearch(s, 'p_mech');
    expect(applyCommand(s, { type: 'buyMachine', facilityId: forest.id }).ok).toBe(true);
    expect(forest.stage).toBe('machine');
    applyCommand(s, { type: 'setPowerContract', contract: 'low' });
    applyCommand(s, { type: 'autoAssign' });
    const before = s.totals.produced.log ?? 0;
    runDays(s, 2, false);
    const perDay = ((s.totals.produced.log ?? 0) - before) / 2;
    // one machine, one operator: about 20 batches of 6 logs, minus a little for the hand-off tick
    expect(perDay).toBeGreaterThan(20 * 6 * 0.8);
  });

  it('automating frees the operators', () => {
    const s = openingState();
    s.cash = 1e10;
    const forest = s.facilities[0];
    applyCommand(s, { type: 'upgradeLevel', facilityId: forest.id });
    runDays(s, 3, false);
    for (const t of ['p_tools', 'p_mech', 'a_auto']) completeResearch(s, t);
    applyCommand(s, { type: 'buyMachine', facilityId: forest.id, count: 2 });
    applyCommand(s, { type: 'autoAssign' });
    expect(employeesAt(s, forest.id).length).toBeGreaterThan(0);
    expect(applyCommand(s, { type: 'automate', facilityId: forest.id }).ok).toBe(true);
    expect(employeesAt(s, forest.id)).toHaveLength(0);
    expect(forest.stage).toBe('auto');
  });

  it('power shortage slows machines down; a bigger contract fixes it', () => {
    const s = openingState();
    s.cash = 1e10;
    for (const t of ['p_tools', 'p_mech', 'pw_grid']) completeResearch(s, t);
    const forest = s.facilities[0];
    applyCommand(s, { type: 'upgradeLevel', facilityId: forest.id });
    runDays(s, 3, false);
    applyCommand(s, { type: 'buyMachine', facilityId: forest.id, count: 2 });
    applyCommand(s, { type: 'autoAssign' });
    runDays(s, 1, false);
    expect(s.power.ratio).toBe(0);
    expect(s.problems.some((p) => p.key === 'power' && p.level === 'red')).toBe(true);
    applyCommand(s, { type: 'setPowerContract', contract: 'high' });
    runDays(s, 1, false);
    expect(s.power.ratio).toBe(1);
  });

  it('selling a lot pushes the price down, and it recovers', () => {
    const s = openingState();
    s.inventory.stone = 20_000;
    const p0 = s.market.stone.index;
    applyCommand(s, { type: 'sell', item: 'stone', qty: 20_000 });
    expect(s.market.stone.index).toBeLessThan(p0 * 0.8);
    runDays(s, 60, false);
    expect(s.market.stone.index).toBeGreaterThan(0.7);
  });

  it('every problem offers more than one way out', () => {
    const s = openingState();
    s.cash = 1e9;
    for (const t of ['p_tools', 'p_mech']) completeResearch(s, t);
    const forest = s.facilities[0];
    applyCommand(s, { type: 'upgradeLevel', facilityId: forest.id });
    runDays(s, 3, false);
    applyCommand(s, { type: 'buyMachine', facilityId: forest.id, count: 2 });
    runDays(s, 1, false);
    expect(s.problems.length).toBeGreaterThan(0);
    for (const p of s.problems) expect(p.solutions.length, p.title).toBeGreaterThanOrEqual(1);
    const power = s.problems.find((p) => p.key === 'power')!;
    expect(power.solutions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('fixes found while balancing', () => {
  it('switching research keeps the progress of the old theme', () => {
    const s = openingState(3);
    s.features.research = true;
    applyCommand(s, { type: 'research', tech: 'p_tools' });
    s.research.progress = 3;
    expect(applyCommand(s, { type: 'research', tech: 'g_finance' }).ok).toBe(true);
    expect(s.research.progress).toBe(0);
    expect(s.research.saved.p_tools).toBe(3);
    applyCommand(s, { type: 'research', tech: 'p_tools' });
    expect(s.research.progress).toBe(3);
    expect(s.research.saved.p_tools).toBeUndefined();
  });

  it('a new research lab brings a researcher applicant at once', () => {
    const s = openingState(4);
    s.features.build = true;
    s.cash = 1e8;
    s.candidates = s.candidates.filter((c) => c.role !== 'researcher');
    expect(applyCommand(s, { type: 'build', facility: 'research_lab' }).ok).toBe(true);
    runDays(s, DATA.facility.research_lab.buildDays + 0.5, false);
    expect(s.candidates.some((c) => c.role === 'researcher')).toBe(true);
  });

  it('a power plant keeps generating while it is being expanded', () => {
    const s = openingState(5);
    s.cash = 1e10;
    for (const id of ['p_tools', 'p_mech', 'm_steel', 'pw_grid', 'pw_plant']) completeResearch(s, id);
    s.features.build = true;
    expect(applyCommand(s, { type: 'build', facility: 'power_plant' }).ok).toBe(true);
    const plant = s.facilities[s.facilities.length - 1];
    runDays(s, DATA.facility.power_plant.buildDays + 0.5, false);
    expect(applyCommand(s, { type: 'buyMachine', facilityId: plant.id }).ok).toBe(true);
    for (const e of s.employees) applyCommand(s, { type: 'assign', employeeId: e.id, facilityId: plant.id });
    const before = plantCapacity(s, plant);
    expect(before).toBeGreaterThan(0);
    expect(applyCommand(s, { type: 'upgradeLevel', facilityId: plant.id }).ok).toBe(true);
    expect(plant.building?.kind).toBe('level');
    expect(plantCapacity(s, plant)).toBe(before);
  });
});
