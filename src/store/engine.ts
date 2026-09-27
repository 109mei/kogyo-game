/**
 * The page's handle on the running game. The simulation normally runs in a
 * worker (WorkerEngine); where workers cannot start it runs on the page
 * (LocalEngine) with the same interface. Either way the page draws from
 * `view` and changes the game only by sending commands.
 */
import { createInitialState, type Command, type CommandResult, type GameState } from '../core';
import type { OfflineReport } from '../save/offline';
import { deserialize, exportTextOf, importText, SaveStore, serialize } from '../save/SaveStore';
import { applyDev } from './dev';
import type { DevPatch, FromWorker, Init, ToWorker } from './protocol';
import { Runner } from './runner';
import { mergeSnapshot } from './snapshot';

const WRITE_EVERY_MS = 10_000;

export interface Engine {
  /** identifies this tab's saves */
  readonly tabId: string;
  readonly frozen: boolean;
  readonly kind: 'worker' | 'local';
  /** the latest state to draw from (read-only) */
  readonly view: GameState;
  subscribe(fn: () => void): () => void;
  dispatch(cmd: Command): Promise<CommandResult>;
  /** tests and debugging: run ticks now, exactly as the clock would */
  advance(ticks: number): Promise<number>;
  /** the complete, current state (waits for commands already sent) */
  fresh(): Promise<GameState>;
  exportText(): Promise<string>;
  /** write the latest save now (sync; used when the page is going away) */
  flushSave(): void;
  /** the tab went to the background */
  suspend(): void;
  /** back to the foreground: the time away is run and reported */
  resume(): Promise<OfflineReport | null>;
  /** another tab took over: stop and never save again */
  freeze(): void;
  dev(patch: DevPatch): Promise<void>;
  stop(): void;
}

export interface Started {
  engine: Engine;
  report: OfflineReport | null;
}

type Listener = () => void;

const newTabId = () => Math.random().toString(36).slice(2, 10);

// ---- in the page ------------------------------------------------------------------------------

export class LocalEngine implements Engine {
  readonly tabId = newTabId();
  readonly kind = 'local' as const;
  private listeners = new Set<Listener>();
  private runner: Runner;

  private constructor(state: GameState, private store: SaveStore) {
    this.runner = new Runner(state, {
      save: (s) => this.store.save(s, this.tabId),
      changed: () => this.emit(),
    });
  }

  static start(init: Init, store: SaveStore, now = Date.now()): Started {
    let state: GameState;
    let savedAt: number | null = null;
    if (init.kind === 'new') state = createInitialState({ companyName: init.name, seed: init.seed });
    else {
      const loaded = init.kind === 'load' ? deserialize(init.text) : importText(init.text);
      state = loaded.state;
      if (init.kind === 'load') savedAt = loaded.savedAt;
    }
    const e = new LocalEngine(state, store);
    const report = savedAt !== null ? e.runner.catchUpFrom(savedAt, now) : (e.runner.save(true), null);
    e.runner.start();
    return { engine: e, report };
  }

  get view() {
    return this.runner.state;
  }
  get frozen() {
    return this.runner.frozen;
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  dispatch(cmd: Command) {
    if (this.frozen) return Promise.resolve({ ok: false, message: '別のタブで遊んでいます' });
    return Promise.resolve(this.runner.dispatch(cmd));
  }
  advance(ticks: number) {
    return Promise.resolve(this.runner.advance(ticks));
  }
  fresh() {
    return Promise.resolve(this.runner.state);
  }
  exportText() {
    return Promise.resolve(exportTextOf(serialize(this.runner.state)));
  }
  flushSave() {
    this.runner.save(true);
  }
  suspend() {
    this.runner.suspend();
  }
  resume() {
    return Promise.resolve(this.runner.resume());
  }
  freeze() {
    this.runner.freeze();
    this.emit();
  }
  dev(patch: DevPatch) {
    applyDev(this.runner.state, patch);
    this.emit();
    return Promise.resolve();
  }
  stop() {
    this.runner.stop();
  }
}

// ---- in a worker --------------------------------------------------------------------------------

export class WorkerEngine implements Engine {
  readonly tabId = newTabId();
  readonly kind = 'worker' as const;
  frozen = false;
  view!: GameState;
  private listeners = new Set<Listener>();
  private waiting = new Map<number, (v: unknown) => void>();
  private seq = 1;
  private latest: { text: string; at: number } | null = null;
  private written = 0;
  private lastWrite = 0;

  private constructor(
    private w: Worker,
    private store: SaveStore,
    private onCrash: (message: string) => void,
  ) {}

  static start(init: Init, store: SaveStore, onCrash: (message: string) => void, now = Date.now()): Promise<Started> {
    return new Promise((resolve, reject) => {
      let w: Worker;
      try {
        w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      } catch (e) {
        reject(e);
        return;
      }
      const engine = new WorkerEngine(w, store, onCrash);
      let ready = false;
      w.onmessage = (ev: MessageEvent<FromWorker>) => {
        const m = ev.data;
        if (!ready) {
          if (m.t === 'ready') {
            ready = true;
            engine.view = m.state;
            resolve({ engine, report: m.report });
          } else if (m.t === 'fail') {
            w.terminate();
            reject(new LoadError(m.message));
          } else if (m.t === 'save') engine.onSave(m.text, m.at, m.important);
          return;
        }
        engine.receive(m);
      };
      w.onerror = (ev) => {
        if (!ready) {
          ev.preventDefault?.();
          w.terminate();
          reject(new Error(ev.message || 'worker failed to start'));
        }
      };
      engine.post({ t: 'init', init, now });
    });
  }

  private post(m: ToWorker) {
    this.w.postMessage(m);
  }

  private ask<T>(make: (id: number) => ToWorker): Promise<T> {
    const id = this.seq++;
    return new Promise<T>((resolve) => {
      this.waiting.set(id, resolve as (v: unknown) => void);
      this.post(make(id));
    });
  }

  private receive(m: FromWorker) {
    switch (m.t) {
      case 'snap':
        this.view = mergeSnapshot(this.view, m.snap);
        this.emit();
        return;
      case 'reply': {
        const fn = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        fn?.(m.value);
        return;
      }
      case 'save':
        this.onSave(m.text, m.at, m.important);
        return;
      case 'crash':
        this.onCrash(m.message);
        return;
      default:
        return;
    }
  }

  private onSave(text: string, at: number, important: boolean) {
    if (this.frozen) return;
    this.latest = { text, at };
    if (important || Date.now() - this.lastWrite >= WRITE_EVERY_MS) this.write();
  }

  private write() {
    if (this.frozen || !this.latest || this.latest.at <= this.written) return;
    this.store.writeText(this.latest.text, this.latest.at, this.tabId);
    this.written = this.latest.at;
    this.lastWrite = Date.now();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  dispatch(cmd: Command) {
    if (this.frozen) return Promise.resolve<CommandResult>({ ok: false, message: '別のタブで遊んでいます' });
    return this.ask<CommandResult>((id) => ({ t: 'cmd', id, cmd }));
  }
  advance(ticks: number) {
    return this.ask<number>((id) => ({ t: 'advance', id, ticks }));
  }
  async fresh() {
    await this.ask<null>((id) => ({ t: 'full', id }));
    return this.view;
  }
  async exportText() {
    return exportTextOf(await this.ask<string>((id) => ({ t: 'export', id })));
  }
  /**
   * The page is going away and cannot wait for the worker: save the page's own
   * copy, which is the whole state as of the last snapshot (a fraction of a
   * second old; tests/snapshot.test.ts checks it never lags behind).
   */
  flushSave() {
    if (this.frozen || !this.view) return;
    const at = Date.now();
    if (this.store.save(this.view, this.tabId)) {
      this.written = at;
      this.lastWrite = at;
    }
  }
  suspend() {
    this.post({ t: 'suspend', now: Date.now() });
  }
  resume() {
    if (this.frozen) return Promise.resolve(null);
    return this.ask<OfflineReport | null>((id) => ({ t: 'resume', id, now: Date.now() }));
  }
  freeze() {
    this.frozen = true;
    this.post({ t: 'freeze' });
    this.emit();
  }
  async dev(patch: DevPatch) {
    await this.ask<null>((id) => ({ t: 'dev', id, patch }));
  }
  stop() {
    this.w.terminate();
    // nothing more will answer: settle anything still waiting
    for (const fn of this.waiting.values()) fn({ ok: false, message: '停止しました' });
    this.waiting.clear();
  }
}

/** a save that could not be read (as opposed to a worker that could not start) */
export class LoadError extends Error {}

/**
 * Start the game in a worker, or on the page if a worker cannot start. A save
 * that cannot be read is an error either way (it is not the worker's fault).
 */
export async function startEngine(init: Init, store: SaveStore, onCrash: (message: string) => void): Promise<Started> {
  const now = Date.now();
  if (typeof Worker !== 'undefined' && !forceLocal()) {
    try {
      return await WorkerEngine.start(init, store, onCrash, now);
    } catch (e) {
      if (e instanceof LoadError) throw e;
      console.warn('simulation worker unavailable, running on the page:', e);
    }
  }
  return LocalEngine.start(init, store, now);
}

/** ?local in the address runs the simulation on the page (for comparing and debugging) */
function forceLocal(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');
  } catch {
    return false;
  }
}
