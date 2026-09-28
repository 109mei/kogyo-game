/**
 * Which sound goes with what. The playing itself needs a speaker; these
 * check the choice, from real commands and a real game.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, runTicks } from '../src/core';
import { completeResearch } from '../src/core/research';
import { forceEvent } from '../src/core/events';
import { notify } from '../src/core/util';
import { DATA } from '../src/data';
import { soundForCommand, soundMarks, soundsBetween } from '../src/ui/sound';

describe('sound effects', () => {
  it('give actions their own sound and keep settings quiet', () => {
    expect(soundForCommand({ type: 'gather', facilityId: 1 }, true)).toBe('tap');
    expect(soundForCommand({ type: 'sell', item: 'log', qty: 1 }, true)).toBe('coin');
    expect(soundForCommand({ type: 'build', facility: 'sawmill' }, true)).toBe('build');
    expect(soundForCommand({ type: 'hire', candidateId: 1 }, true)).toBe('hire');
    expect(soundForCommand({ type: 'build', facility: 'sawmill' }, false)).toBe('error');
    expect(soundForCommand({ type: 'setSpeed', speed: 2 }, true)).toBeNull();
    expect(soundForCommand({ type: 'readNotices' }, true)).toBeNull();
    // a full work queue is shown by the button; no buzz on every extra tap
    expect(soundForCommand({ type: 'gather', facilityId: 1 }, false)).toBeNull();
  });

  it('hear work finishing and the first goal being reached', () => {
    const s = createInitialState({ seed: 3 });
    const f = s.facilities[0];
    let marks = soundMarks(s);
    applyCommand(s, { type: 'gather', facilityId: f.id });
    const heard: string[] = [];
    for (let i = 0; i < 400 && s.goals.done.length === 0; i++) {
      if (s.owner.job === null && s.owner.queue.length === 0) applyCommand(s, { type: 'gather', facilityId: f.id });
      runTicks(s, 5);
      const id = soundsBetween(marks, s);
      if (id) heard.push(id);
      marks = soundMarks(s);
    }
    expect(heard).toContain('work');
    expect(s.goals.done.length).toBeGreaterThan(0);
    expect(heard).toContain('goal');
  });

  it('pick the most important sound, and stay quiet for another game or a long catch-up', () => {
    const s = createInitialState({ seed: 4 });
    for (const g of DATA.goals) for (const u of g.unlocks) s.features[u] = true;
    const before = soundMarks(s);
    completeResearch(s, DATA.techs[0].id);
    s.owner.taps++;
    expect(soundsBetween(before, s)).toBe('research');

    const b2 = soundMarks(s);
    expect(forceEvent(s, 'blackout') ?? forceEvent(s, 'media')).not.toBeNull();
    expect(soundsBetween(b2, s)).toBe('alert');

    const b3 = soundMarks(s);
    runTicks(s, DATA.balance.time.ticksPerDay * 40, false);
    expect(soundsBetween(b3, s)).toBeNull();

    const other = createInitialState({ seed: 99 });
    expect(soundsBetween(soundMarks(s), other)).toBeNull();
  });

  it('keep news from the player’s own tap quiet, since the tap already made a sound', () => {
    const s = createInitialState({ seed: 5 });
    const before = soundMarks(s);
    // the kind of news a command leaves (hired, automated, promoted ...)
    notify(s, 'good', 'ppl_worker', '採用しました', '');
    expect(soundsBetween(before, s, true)).toBeNull();
    expect(soundsBetween(before, s, false)).toBe('chime');
  });
});
