/**
 * The page draws from a copy of the state that the worker keeps up to date
 * with partial snapshots. These tests play a busy game and check that the
 * copy never drifts: after a command or when the day turns it must equal the
 * real state exactly, and the parts sent every frame must always match.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, runTicks, type GameState } from '../src/core';
import { completeResearch } from '../src/core/research';
import { DATA } from '../src/data';
import { freshMarks, mergeSnapshot, takeSnapshot } from '../src/store/snapshot';
import { randomCommand, rng } from '../tools/fuzz-lib';
import { busyScript } from './helpers';

const clone = <T>(x: T): T => structuredClone(x);
const json = (x: unknown) => JSON.stringify(x);

describe('snapshots for the page', () => {
  it('keep the page copy equal to the state after every command and every frame', () => {
    const s = createInitialState({ seed: 5 });
    const marks = freshMarks();
    let now = 0;
    // the page starts from a full copy
    takeSnapshot(s, marks, true, now);
    let view: GameState = clone(s);
    const frame = (force: boolean) => {
      now += 100;
      // structured clone stands in for postMessage
      view = mergeSnapshot(view, clone(takeSnapshot(s, marks, force, now)));
    };
    let checks = 0;
    for (let day = 0; day < 40; day++) {
      for (const c of busyScript(s, day)) {
        applyCommand(s, c);
        frame(true);
        expect(json(view)).toBe(json(s));
        checks++;
      }
      // ten frames of 24 ticks make a day; after every frame the copy is the whole state
      // (the page saves this copy when it closes, so it must never be half old)
      for (let i = 0; i < 10; i++) {
        runTicks(s, 24, false);
        frame(false);
        const a = view as unknown as Record<string, unknown>;
        const b = s as unknown as Record<string, unknown>;
        for (const k of Object.keys(b)) if (json(a[k]) !== json(b[k])) expect.fail(`day ${day} frame ${i}: ${k} is behind`);
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(400);
  });

  it('stay equal in a late game with divisions, orders and events, under random commands', () => {
    const s = createInitialState({ seed: 8 });
    for (const g of DATA.goals) for (const f of g.unlocks) s.features[f] = true;
    for (const tech of DATA.techs) completeResearch(s, tech.id);
    s.cash = 5e10;
    s.events.next = 0;
    const r = rng(77);
    const marks = freshMarks();
    let now = 0;
    takeSnapshot(s, marks, true, now);
    let view: GameState = clone(s);
    for (let step = 0; step < 300; step++) {
      for (let k = 0; k < 3; k++) {
        applyCommand(s, randomCommand(s, r));
        now += 16;
        view = mergeSnapshot(view, clone(takeSnapshot(s, marks, true, now)));
      }
      // frames of any length, never a forced full send
      runTicks(s, Math.floor(r() * 300), false);
      now += 100;
      view = mergeSnapshot(view, clone(takeSnapshot(s, marks, false, now)));
      const a = view as unknown as Record<string, unknown>;
      const b = s as unknown as Record<string, unknown>;
      for (const key of Object.keys(b)) if (json(a[key]) !== json(b[key])) expect.fail(`step ${step}: ${key} is behind`);
    }
    // the late-game parts really were in play
    expect(Object.keys(s.divisions).length + s.orders.done + s.orders.list.length + Object.keys(s.events.last).length).toBeGreaterThan(0);
  });

  it('sends far less than the whole state on an ordinary frame', () => {
    const s = createInitialState({ seed: 6 });
    for (let day = 0; day < 30; day++) {
      for (const c of busyScript(s, day)) applyCommand(s, c);
      runTicks(s, 240, false);
    }
    const marks = freshMarks();
    takeSnapshot(s, marks, true, 0);
    runTicks(s, 2, false);
    const frame = takeSnapshot(s, marks, false, 100);
    expect(frame.full).toBe(false);
    expect(Object.keys(frame.parts)).not.toContain('market');
    expect(Object.keys(frame.parts)).not.toContain('itemHist');
    expect(frame.finance.days).toBeUndefined();
    expect(json(frame).length).toBeLessThan(json(s).length / 2);
  });
});
