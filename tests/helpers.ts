import { expect } from 'vitest';
import { applyCommand, createInitialState, runTicks, type Command, type GameState } from '../src/core';

/** a short opening: tap, sell, hire the first applicants and put them to work */
export function openingState(seed = 7): GameState {
  const s = createInitialState({ seed });
  const forest = s.facilities[0];
  for (let i = 0; i < 3; i++) {
    expect(applyCommand(s, { type: 'gather', facilityId: forest.id }).ok).toBe(true);
    runTicks(s, 40);
  }
  expect(applyCommand(s, { type: 'sell', item: 'log', qty: 3 }).ok).toBe(true);
  for (const c of [...s.candidates]) applyCommand(s, { type: 'hire', candidateId: c.id });
  applyCommand(s, { type: 'autoAssign' });
  return s;
}

/** plays a fixed command script so two runs can be compared */
export function scripted(seed: number, days: number, script: (s: GameState, day: number) => Command[]): GameState {
  const s = createInitialState({ seed });
  for (let d = 0; d < days; d++) {
    for (const c of script(s, d)) applyCommand(s, c);
    runTicks(s, 240, false);
  }
  return s;
}

/** a script that exercises hiring, building, trading and research */
export function busyScript(s: GameState, day: number): Command[] {
  const out: Command[] = [];
  if (day < 3) out.push({ type: 'gather', facilityId: s.facilities[0].id });
  if (day === 3) {
    out.push({ type: 'sell', item: 'log', qty: 1 });
    for (const c of s.candidates) out.push({ type: 'hire', candidateId: c.id });
    out.push({ type: 'autoAssign' });
  }
  if (day === 4) out.push({ type: 'build', facility: 'sawmill' });
  if (day === 5) out.push({ type: 'build', facility: 'research_lab' });
  if (day > 4 && day % 7 === 0) {
    for (const c of s.candidates) out.push({ type: 'hire', candidateId: c.id });
    out.push({ type: 'autoAssign' });
  }
  if (day > 2) {
    for (const item of ['stone', 'water', 'lumber']) if ((s.inventory[item] ?? 0) > 5) out.push({ type: 'sell', item, qty: s.inventory[item] / 2 });
  }
  if (day === 12) out.push({ type: 'research', tech: 'p_tools' });
  return out;
}

export function stable(s: GameState): string {
  return JSON.stringify(s);
}
