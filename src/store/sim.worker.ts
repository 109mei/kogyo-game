/// <reference lib="webworker" />
/**
 * The simulation worker: owns the game state and runs the clock off the
 * page's thread, so a big factory at x48 never makes taps and scrolling
 * stutter. The page gets snapshots to draw from and saves to store.
 */
import { createInitialState, type GameState } from '../core';
import { deserialize, importText, serialize } from '../save/SaveStore';
import { applyDev } from './dev';
import type { FromWorker, ToWorker } from './protocol';
import { Runner } from './runner';
import { freshMarks, takeSnapshot } from './snapshot';

declare const self: DedicatedWorkerGlobalScope;

/** the page writes to storage every 10 s; a fresh copy every 2 s is kept in case the page closes */
const BUFFER_SAVE_MS = 2000;

let runner: Runner | null = null;
const marks = freshMarks();

function post(msg: FromWorker) {
  self.postMessage(msg);
}

let lastSnap = 0;

/** a big company's snapshot costs the page more to take in: send it a little less often (commands still go at once) */
function snapEvery(s: GameState): number {
  const n = s.facilities.length;
  return n > 120 ? 250 : n > 50 ? 150 : 100;
}

function snap(force: boolean) {
  if (!runner) return;
  const now = Date.now();
  if (!force && now - lastSnap < snapEvery(runner.state) - 5) return;
  lastSnap = now;
  post({ t: 'snap', snap: takeSnapshot(runner.state, marks, force, now) });
}

const host = {
  save(state: GameState, important: boolean) {
    const at = Date.now();
    post({ t: 'save', text: serialize(state, at), at, important });
  },
  changed(why: 'frame' | 'command') {
    snap(why === 'command');
  },
};

function guard<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    post({ t: 'crash', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
    return undefined;
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.t) {
    case 'init': {
      try {
        let state: GameState;
        let savedAt: number | null = null;
        if (m.init.kind === 'new') state = createInitialState({ companyName: m.init.name, seed: m.init.seed });
        else {
          const loaded = m.init.kind === 'load' ? deserialize(m.init.text) : importText(m.init.text);
          state = loaded.state;
          if (m.init.kind === 'load') savedAt = loaded.savedAt;
        }
        runner = new Runner(state, host, BUFFER_SAVE_MS);
        const report = savedAt !== null ? runner.catchUpFrom(savedAt, m.now) : (runner.save(true), null);
        Object.assign(marks, freshMarks());
        takeSnapshot(runner.state, marks, true, Date.now());
        post({ t: 'ready', state: runner.state, report });
        runner.start();
      } catch (e) {
        post({ t: 'fail', message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    case 'cmd': {
      const res = guard(() => runner!.dispatch(m.cmd)) ?? { ok: false, message: 'エラーが起きました' };
      post({ t: 'reply', id: m.id, value: res });
      return;
    }
    case 'advance': {
      const n = guard(() => runner!.advance(m.ticks)) ?? 0;
      post({ t: 'reply', id: m.id, value: n });
      return;
    }
    case 'full':
      snap(true);
      post({ t: 'reply', id: m.id, value: null });
      return;
    case 'export':
      post({ t: 'reply', id: m.id, value: runner ? serialize(runner.state) : '' });
      return;
    case 'save':
      runner?.save(true);
      return;
    case 'suspend':
      runner?.suspend(m.now);
      return;
    case 'resume': {
      const report = guard(() => runner?.resume(m.now) ?? null) ?? null;
      post({ t: 'reply', id: m.id, value: report });
      return;
    }
    case 'freeze':
      runner?.freeze();
      return;
    case 'dev':
      if (runner) {
        applyDev(runner.state, m.patch);
        snap(true);
      }
      post({ t: 'reply', id: m.id, value: null });
      return;
  }
};

// errors inside the clock's own frames (not tied to a message)
self.addEventListener('error', (e) => post({ t: 'crash', message: e.message }));
