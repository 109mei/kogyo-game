/**
 * The bridge between the rule engine and React. The store keeps a revision
 * counter the runner bumps ~10x a second; components read what they need
 * from the live state through useGame(selector). Only commands change the
 * state.
 */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { runTicks, type Command, type CommandResult, type GameState } from '../core';
import type { OfflineReport } from '../save/offline';
import { SAVE_KEY, SaveStore, STAMP_KEY } from '../save/SaveStore';
import { Runner } from './runner';
import { toast } from './ui';

interface GameStore {
  runner: Runner | null;
  rev: number;
  report: OfflineReport | null;
  bootError: string | null;
  booted: boolean;
  /** the game was saved (or deleted) by another tab; this one stepped aside */
  elsewhere: 'saved' | 'deleted' | null;
  boot(): void;
  /** continue here with the latest save, making the other tab step aside */
  takeOver(): void;
  newGame(name: string, seed?: number): void;
  loadText(text: string): string | null;
  dismissReport(): void;
  wipe(): void;
}

const saveStore = new SaveStore();
let unsub: (() => void) | null = null;
let visibilityBound = false;

function attach(r: Runner) {
  unsub?.();
  unsub = r.subscribe(() => useGameStore.setState((s) => ({ rev: s.rev + 1 })));
  r.start();
  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      const cur = useGameStore.getState().runner;
      if (!cur || cur.frozen) return;
      if (document.visibilityState === 'hidden') cur.suspend();
      else {
        const report = cur.resume();
        if (report && report.days >= 1) useGameStore.setState({ report });
      }
    });
    window.addEventListener('pagehide', () => useGameStore.getState().runner?.save());
    // two tabs of the same game would overwrite each other's progress: the last one to save wins, the other steps aside
    window.addEventListener('storage', (e) => {
      if (e.key !== STAMP_KEY && e.key !== SAVE_KEY && e.key !== null) return;
      const cur = useGameStore.getState().runner;
      if (!cur || cur.frozen) return;
      if (e.key === SAVE_KEY && e.newValue !== null) return; // the stamp that follows says who wrote it
      let owner: string | null = null;
      try {
        owner = e.newValue ? (JSON.parse(e.newValue) as { owner?: string }).owner ?? null : null;
      } catch {
        owner = null;
      }
      if (owner === cur.tabId) return;
      cur.freeze();
      useGameStore.setState({ elsewhere: e.newValue ? 'saved' : 'deleted' });
    });
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  runner: null,
  rev: 0,
  report: null,
  bootError: null,
  booted: false,
  elsewhere: null,
  takeOver() {
    get().runner?.stop();
    const { runner, report, error } = Runner.boot(saveStore);
    if (runner) attach(runner);
    set({ runner, report: report && report.days >= 1 ? report : null, bootError: error, elsewhere: null, booted: true });
  },
  boot() {
    if (get().booted) return;
    const { runner, report, error } = Runner.boot(saveStore);
    if (runner) attach(runner);
    set({ runner, report: report && report.days >= 1 ? report : null, bootError: error, booted: true });
  },
  newGame(name, seed) {
    get().runner?.stop();
    const runner = Runner.newGame(name, saveStore, seed);
    attach(runner);
    set({ runner, report: null, bootError: null, booted: true, elsewhere: null });
  },
  loadText(text) {
    try {
      const loaded = saveStore.importText(text);
      get().runner?.stop();
      const runner = new Runner(loaded.state, saveStore);
      runner.save();
      attach(runner);
      set({ runner, report: null, bootError: null, elsewhere: null });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },
  dismissReport() {
    set({ report: null });
  },
  wipe() {
    get().runner?.stop();
    unsub?.();
    saveStore.clear();
    set({ runner: null, report: null, rev: 0, elsewhere: null });
  },
}));

export function exportSave(): string {
  const r = useGameStore.getState().runner;
  return r ? saveStore.exportText(r.state) : '';
}

/** run a command; errors and messages become toasts */
/** bumped before every command so throttled views refresh at once after a tap */
let commandSeq = 0;

export function dispatch(cmd: Command, opts: { quiet?: boolean } = {}): CommandResult {
  const r = useGameStore.getState().runner;
  if (!r) return { ok: false, message: 'ゲームが始まっていません' };
  commandSeq++;
  const res = r.dispatch(cmd);
  if (!opts.quiet) {
    if (!res.ok && res.message) toast(res.message, 'bad');
    else if (res.ok && res.message) toast(res.message, 'good');
  }
  return res;
}

export function gameState(): GameState {
  const r = useGameStore.getState().runner;
  if (!r) throw new Error('no game');
  return r.state;
}

function subscribeRev(cb: () => void) {
  return useGameStore.subscribe(cb);
}

/**
 * Re-render at most `hz` times a second with a value derived from the live
 * state. The selector must not modify the state.
 */
export function useGame<T>(selector: (s: GameState) => T, deps: unknown[] = [], hz = 10): T {
  const lastRev = useRef(-1);
  const lastTime = useRef(0);
  const lastCmd = useRef(-1);
  const shown = useRef(0);
  const rev = useSyncExternalStore(subscribeRev, () => {
    const r = useGameStore.getState().rev;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (r !== lastRev.current && (now - lastTime.current >= 1000 / hz || lastRev.current < 0 || lastCmd.current !== commandSeq)) {
      lastCmd.current = commandSeq;
      lastRev.current = r;
      lastTime.current = now;
      shown.current = r;
    }
    return shown.current;
  });
  const runner = useGameStore((s) => s.runner);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selector(runner!.state), [rev, runner, ...deps]);
}

/**
 * A small console hook for testing and debugging: window.__kogyo.advance(ticks)
 * runs the same engine the clock runs, so it never bends the rules.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __kogyo: unknown }).__kogyo = {
    state: () => useGameStore.getState().runner?.state ?? null,
    dispatch: (cmd: Command) => dispatch(cmd, { quiet: true }),
    advance(ticks: number) {
      const r = useGameStore.getState().runner;
      if (!r) return 0;
      const n = runTicks(r.state, ticks, false);
      r.notify();
      return n;
    },
  };
}
