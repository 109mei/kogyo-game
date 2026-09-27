/**
 * Owns the live GameState and the clock. The engine advances in fixed ticks;
 * this file only decides how many ticks real time is worth, saves, and tells
 * the UI store that something changed (about 10 times a second).
 */
import { DATA } from '../data';
import { applyCommand, createInitialState, runTicks, type Command, type CommandResult, type GameState } from '../core';
import { catchUp, type OfflineReport } from '../save/offline';
import { SaveStore } from '../save/SaveStore';

const UI_HZ = 10;
const AUTOSAVE_MS = 10_000;
/** at most this much simulation per frame so a slow phone stays responsive */
const MAX_TICKS_PER_FRAME = 2400;

type Listener = () => void;

export class Runner {
  state: GameState;
  readonly store: SaveStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private lastSave = 0;
  private listeners = new Set<Listener>();
  hiddenAt: number | null = null;

  constructor(state: GameState, store: SaveStore) {
    this.state = state;
    this.store = store;
  }

  static boot(store = new SaveStore()): { runner: Runner | null; report: OfflineReport | null; error: string | null } {
    try {
      const loaded = store.load();
      if (!loaded) return { runner: null, report: null, error: null };
      const runner = new Runner(loaded.state, store);
      const report = catchUp(runner.state, loaded.savedAt);
      runner.save();
      return { runner, report, error: null };
    } catch (e) {
      return { runner: null, report: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  static newGame(companyName: string, store = new SaveStore(), seed?: number): Runner {
    const r = new Runner(createInitialState({ companyName, seed }), store);
    r.save();
    return r;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.lastSave = Date.now();
    this.timer = setInterval(() => this.frame(), 1000 / UI_HZ);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** ticks per real second at the current speed */
  ticksPerSecond(): number {
    const t = DATA.balance.time;
    return (this.state.speed * t.ticksPerDay) / t.realSecondsPerDay;
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    const s = this.state;
    if (!s.paused) {
      this.acc += dt * this.ticksPerSecond();
      const n = Math.min(MAX_TICKS_PER_FRAME, Math.floor(this.acc));
      if (n > 0) {
        this.acc -= n;
        runTicks(s, n, true);
        if (s.paused) this.acc = 0;
      }
    }
    if (Date.now() - this.lastSave > AUTOSAVE_MS) this.save();
    this.notify();
  }

  dispatch(cmd: Command): CommandResult {
    const res = applyCommand(this.state, cmd);
    if (res.ok && cmd.type !== 'readNotices') this.save();
    this.notify();
    return res;
  }

  save() {
    this.lastSave = Date.now();
    this.store.save(this.state);
  }

  /** the tab went to the background: save and remember when */
  suspend() {
    this.save();
    this.hiddenAt = Date.now();
    this.stop();
  }

  /** back to the foreground: run the time we missed (like reopening the app) */
  resume(): OfflineReport | null {
    const since = this.hiddenAt;
    this.hiddenAt = null;
    let report: OfflineReport | null = null;
    if (since !== null) {
      // time in the background runs at the speed the player chose, capped like offline time
      const away = Date.now() - since;
      const scaled = since + away * Math.max(1, this.state.speed);
      report = catchUp(this.state, since, scaled);
    }
    this.start();
    this.notify();
    return report;
  }
}
