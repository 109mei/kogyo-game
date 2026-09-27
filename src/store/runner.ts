/**
 * Owns the live GameState and the clock. The engine advances in fixed ticks;
 * this file only decides how many ticks real time is worth and when a save
 * is due. It runs inside the simulation worker (or on the page where workers
 * are not available); the host decides where saves go and who is told.
 */
import { DATA } from '../data';
import { applyCommand, runTicks, type Command, type CommandResult, type GameState } from '../core';
import { catchUp, type OfflineReport } from '../save/offline';

const FRAME_MS = 100;
/** at most this much simulation per frame so a slow device stays responsive */
const MAX_TICKS_PER_FRAME = 2400;

export interface RunnerHost {
  /** a save is due; important ones (after commands, catch-up, going to the background) should be written at once */
  save(state: GameState, important: boolean): void;
  /** the state moved on: after a frame of ticks, or right after a command */
  changed(why: 'frame' | 'command'): void;
}

export class Runner {
  state: GameState;
  private host: RunnerHost;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private lastSave = 0;
  hiddenAt: number | null = null;
  /** another tab took over this game: this one neither runs nor saves */
  frozen = false;

  constructor(state: GameState, host: RunnerHost, private autosaveMs = 10_000) {
    this.state = state;
    this.host = host;
  }

  /** the time the app was closed runs first (like reopening the app) */
  catchUpFrom(savedAt: number, now = Date.now()): OfflineReport | null {
    const report = catchUp(this.state, savedAt, now);
    this.save(true);
    return report;
  }

  start() {
    if (this.timer || this.frozen) return;
    this.last = performance.now();
    this.lastSave = Date.now();
    this.timer = setInterval(() => this.frame(), FRAME_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
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
    if (Date.now() - this.lastSave > this.autosaveMs) this.save(false);
    this.host.changed('frame');
  }

  dispatch(cmd: Command): CommandResult {
    const res = applyCommand(this.state, cmd);
    if (res.ok && cmd.type !== 'readNotices') this.save(true);
    this.host.changed('command');
    return res;
  }

  /** debugging and tests: run ticks now, exactly as the clock would */
  advance(ticks: number): number {
    const n = runTicks(this.state, ticks, false);
    this.host.changed('command');
    return n;
  }

  save(important: boolean) {
    if (this.frozen) return;
    this.lastSave = Date.now();
    this.host.save(this.state, important);
  }

  /** stop for good: the game is being played in another tab */
  freeze() {
    this.frozen = true;
    this.stop();
  }

  /** the tab went to the background: save and remember when */
  suspend(now = Date.now()) {
    this.save(true);
    this.hiddenAt = now;
    this.stop();
  }

  /** back to the foreground: run the time we missed, at the speed the player chose (capped like offline time) */
  resume(now = Date.now()): OfflineReport | null {
    if (this.frozen) return null;
    const since = this.hiddenAt;
    this.hiddenAt = null;
    let report: OfflineReport | null = null;
    if (since !== null) {
      const away = now - since;
      const scaled = since + away * Math.max(1, this.state.speed);
      report = catchUp(this.state, since, scaled);
      this.save(true);
    }
    this.start();
    this.host.changed('command');
    return report;
  }
}
