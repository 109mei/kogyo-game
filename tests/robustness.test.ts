/**
 * Regressions from the playtest and fuzzing (docs/PLAYTEST.md): the engine must refuse bad
 * input without throwing, and random play must never break an invariant.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, runDays } from '../src/core';
import { fuzzRun } from '../tools/fuzz-lib';
import { openingState } from './helpers';

describe('bad input is refused, never thrown', () => {
  it('building with a recipe the facility cannot make', () => {
    const s = openingState(2);
    s.features.build = true;
    expect(() => applyCommand(s, { type: 'build', facility: 'warehouse', recipe: 'x' })).not.toThrow();
    expect(applyCommand(s, { type: 'build', facility: 'sawmill', recipe: 'steel' }).ok).toBe(false);
    expect(s.facilities.some((f) => f.type === 'sawmill' && f.recipe === 'steel')).toBe(false);
  });
});

describe('applicants', () => {
  it('no researcher applies before there is a lab to work in', () => {
    const s = openingState(3);
    runDays(s, 120, false);
    const seen = new Set<string>();
    for (let d = 0; d < 20; d++) {
      runDays(s, 7, false);
      for (const c of s.candidates) seen.add(c.role);
    }
    expect(seen.has('researcher')).toBe(false);
    expect(seen.has('worker')).toBe(true);
  });

  it('a lab (even one being built) brings researchers into the pool', () => {
    const s = openingState(4);
    s.features.build = true;
    s.cash = 1e8;
    expect(applyCommand(s, { type: 'build', facility: 'research_lab' }).ok).toBe(true);
    let researchers = 0;
    for (let w = 0; w < 6; w++) {
      runDays(s, 7, false);
      researchers += s.candidates.filter((c) => c.role === 'researcher').length;
    }
    expect(researchers).toBeGreaterThan(0);
  });
});

describe('random play keeps every invariant', () => {
  it.each([0, 1, 2])('company kind %i (fresh / mid-way / everything researched)', (mode) => {
    for (let run = 0; run < 2; run++) {
      const res = fuzzRun(100 + run * 3 + mode, 90, mode);
      expect(res.failure).toBeNull();
    }
  });
});

it('a fresh game stays a fresh game when nothing is done', () => {
  const s = createInitialState({ seed: 9 });
  runDays(s, 30, false);
  expect(s.cash).toBe(3_000_000);
});
