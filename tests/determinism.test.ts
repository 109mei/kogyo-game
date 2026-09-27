import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, runDays, runTicks } from '../src/core';
import { deserialize, serialize } from '../src/save/SaveStore';
import { busyScript, scripted, stable } from './helpers';

describe('determinism', () => {
  it('the same seed and the same commands give the same world', () => {
    const a = scripted(123, 40, busyScript);
    const b = scripted(123, 40, busyScript);
    expect(stable(a)).toBe(stable(b));
    expect(a.employees.length).toBeGreaterThan(3);
  });

  it('different seeds give different markets and applicants', () => {
    const a = createInitialState({ seed: 1 });
    const b = createInitialState({ seed: 2 });
    expect(a.market.log.hist).not.toEqual(b.market.log.hist);
    expect(a.candidates.map((c) => c.name)).not.toEqual(b.candidates.map((c) => c.name));
  });

  it('catching up N days at once equals playing them tick by tick', () => {
    const a = scripted(9, 20, busyScript);
    const b = structuredClone(a);
    runDays(a, 15, false);
    for (let i = 0; i < 15 * 240; i++) runTicks(b, 1, false);
    expect(stable(a)).toBe(stable(b));
  });

  it('saving and loading mid-day does not change what happens next', () => {
    const a = scripted(31, 25, busyScript);
    runTicks(a, 97, false); // stop in the middle of a day and an hour
    const text = serialize(a, 0);
    const b = deserialize(text).state;
    runDays(a, 12, false);
    runDays(b, 12, false);
    expect(stable(b)).toBe(stable(a));
  });

  it('commands at the same tick give the same result after a reload', () => {
    const a = scripted(5, 10, busyScript);
    const b = deserialize(serialize(a, 0)).state;
    for (const s of [a, b]) {
      applyCommand(s, { type: 'build', facility: 'assembly_plant' });
      runDays(s, 6, false);
    }
    expect(stable(b)).toBe(stable(a));
  });
});
