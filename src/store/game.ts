/**
 * The bridge between the running game and React. The engine (normally in a
 * worker) sends snapshots about 10 times a second; the store keeps a
 * revision counter, and components read what they need from the latest
 * snapshot through useGame(selector). Only commands change the game.
 */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { Command, CommandResult, GameState } from '../core';
import type { OfflineReport } from '../save/offline';
import { SAVE_KEY, SaveStore, STAMP_KEY } from '../save/SaveStore';
import { startEngine, type Engine, type Started } from './engine';
import type { DevPatch, Init } from './protocol';
import { toast } from './ui';

interface GameStore {
  runner: Engine | null;
  rev: number;
  report: OfflineReport | null;
  bootError: string | null;
  booted: boolean;
  /** a game is being loaded or created */
  starting: boolean;
  /** the game was saved (or deleted) by another tab; this one stepped aside */
  elsewhere: 'saved' | 'deleted' | null;
  boot(): void;
  /** continue here with the latest save, making the other tab step aside */
  takeOver(): void;
  newGame(name: string, seed?: number): Promise<void>;
  /** null when it worked, or what went wrong */
  loadText(text: string): Promise<string | null>;
  dismissReport(): void;
  wipe(): void;
}

const saveStore = new SaveStore();
let unsub: (() => void) | null = null;
let listenersBound = false;
/** resolves once the current start (boot, new game, import) has finished */
let starting: Promise<unknown> = Promise.resolve();

let lastCrashToast = 0;

function crashed(message: string) {
  console.error('simulation error:', message);
  if (Date.now() - lastCrashToast < 30_000) return;
  lastCrashToast = Date.now();
  toast('計算中にエラーが起きました。セーブは残っています', 'bad');
}

function attach(e: Engine) {
  unsub?.();
  unsub = e.subscribe(() => useGameStore.setState((s) => ({ rev: s.rev + 1 })));
  bindPageEvents();
}

function bindPageEvents() {
  if (listenersBound || typeof document === 'undefined') return;
  listenersBound = true;
  document.addEventListener('visibilitychange', () => {
    const cur = useGameStore.getState().runner;
    if (!cur || cur.frozen) return;
    if (document.visibilityState === 'hidden') cur.suspend();
    else
      void cur.resume().then((report) => {
        if (report && report.days >= 1 && useGameStore.getState().runner === cur) useGameStore.setState({ report });
      });
  });
  window.addEventListener('pagehide', () => useGameStore.getState().runner?.flushSave());
  // two tabs of the same game would overwrite each other's progress: the last one to save wins, the other steps aside
  window.addEventListener('storage', (e) => {
    if (e.key !== STAMP_KEY && e.key !== SAVE_KEY && e.key !== null) return;
    const cur = useGameStore.getState().runner;
    if (!cur || cur.frozen) return;
    if (e.key === SAVE_KEY && e.newValue !== null) return; // the stamp that follows says who wrote it
    let owner: string | null = null;
    try {
      owner = e.newValue ? ((JSON.parse(e.newValue) as { owner?: string }).owner ?? null) : null;
    } catch {
      owner = null;
    }
    if (owner === cur.tabId) return;
    cur.freeze();
    useGameStore.setState({ elsewhere: e.newValue ? 'saved' : 'deleted' });
  });
}

function begin(init: Init): Promise<Started> {
  const p = startEngine(init, saveStore, crashed);
  starting = p.catch(() => undefined);
  return p;
}

export const useGameStore = create<GameStore>((set, get) => ({
  runner: null,
  rev: 0,
  report: null,
  bootError: null,
  booted: false,
  starting: false,
  elsewhere: null,
  boot() {
    if (get().booted || get().starting) return;
    const text = saveStore.readText();
    if (!text) {
      set({ booted: true });
      return;
    }
    set({ starting: true });
    begin({ kind: 'load', text }).then(
      ({ engine, report }) => {
        attach(engine);
        set({ runner: engine, report: report && report.days >= 1 ? report : null, bootError: null, booted: true, starting: false });
      },
      (e: unknown) => set({ runner: null, bootError: e instanceof Error ? e.message : String(e), booted: true, starting: false }),
    );
  },
  takeOver() {
    get().runner?.stop();
    unsub?.();
    set({ runner: null, elsewhere: null, booted: false, starting: false, report: null });
    get().boot();
  },
  async newGame(name, seed) {
    if (get().starting) return;
    get().runner?.stop();
    set({ starting: true });
    try {
      const { engine } = await begin({ kind: 'new', name, seed });
      attach(engine);
      set({ runner: engine, report: null, bootError: null, booted: true, elsewhere: null, starting: false });
    } catch (e) {
      set({ starting: false });
      toast(`始められませんでした：${e instanceof Error ? e.message : String(e)}`, 'bad');
    }
  },
  async loadText(text) {
    if (get().starting) return '読み込み中です';
    set({ starting: true });
    try {
      const { engine } = await begin({ kind: 'import', text });
      get().runner?.stop();
      attach(engine);
      set({ runner: engine, report: null, bootError: null, booted: true, elsewhere: null, starting: false });
      return null;
    } catch (e) {
      set({ starting: false });
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

export async function exportSave(): Promise<string> {
  const r = useGameStore.getState().runner;
  return r ? r.exportText() : '';
}

/** bumped when a command has come back, so throttled views refresh at once after a tap */
let commandSeq = 0;

/** run a command; errors and messages become toasts */
export function dispatch(cmd: Command, opts: { quiet?: boolean } = {}): Promise<CommandResult> {
  const r = useGameStore.getState().runner;
  if (!r) return Promise.resolve({ ok: false, message: 'ゲームが始まっていません' });
  return r.dispatch(cmd).then((res) => {
    commandSeq++;
    useGameStore.setState((s) => ({ rev: s.rev + 1 }));
    if (!opts.quiet) {
      if (!res.ok && res.message) toast(res.message, 'bad');
      else if (res.ok && res.message) toast(res.message, 'good');
    }
    return res;
  });
}

export function gameState(): GameState {
  const r = useGameStore.getState().runner;
  if (!r) throw new Error('no game');
  return r.view;
}

function subscribeRev(cb: () => void) {
  return useGameStore.subscribe(cb);
}

/**
 * Re-render at most `hz` times a second with a value derived from the latest
 * snapshot. The selector must not modify the state.
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
  return useMemo(() => selector(runner!.view), [rev, runner, ...deps]);
}

/**
 * A small console hook for testing and debugging. advance(ticks) runs the
 * same engine the clock runs, so it never bends the rules; dev() does, and
 * is only for tests.
 */
if (typeof window !== 'undefined') {
  const current = async () => {
    await starting;
    return useGameStore.getState().runner;
  };
  (window as unknown as { __kogyo: unknown }).__kogyo = {
    state: async () => {
      const r = await current();
      return r ? r.fresh() : null;
    },
    dispatch: async (cmd: Command) => ((await current()) ? dispatch(cmd, { quiet: true }) : { ok: false }),
    advance: async (ticks: number) => {
      const r = await current();
      if (!r) return 0;
      const n = await r.advance(ticks);
      useGameStore.setState((s) => ({ rev: s.rev + 1 }));
      return n;
    },
    dev: async (patch: DevPatch) => (await current())?.dev(patch),
    engine: () => useGameStore.getState().runner?.kind ?? null,
  };
}
