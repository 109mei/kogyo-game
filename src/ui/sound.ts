/**
 * Sound effects, made on the spot with the Web Audio API (no audio files).
 * The choice of sound is kept apart from the playing: soundForCommand and
 * soundsBetween are plain functions of the command or of two game states, so
 * they can be tested without a speaker.
 *
 * Browsers only allow sound after the player has touched the page, so the
 * audio context is made on the first touch. The on/off switch and volume are
 * kept per device (localStorage), not in the save.
 */
import type { Command, GameState } from '../core';
import { ticksPerDay } from '../core/calendar';

export type SoundId =
  | 'tick' // moving between screens
  | 'tap' // the owner's own work, pressed
  | 'work' // the owner's own work, done
  | 'coin' // money in
  | 'build' // building, machines, expansion
  | 'done' // construction finished
  | 'hire'
  | 'ok' // other actions that worked
  | 'error'
  | 'chime' // good news
  | 'research' // research finished
  | 'goal' // goal reached
  | 'alert' // an event asking for a decision
  | 'warn'
  | 'bad';

export interface SoundPrefs {
  on: boolean;
  /** 0..1 */
  volume: number;
}

const PREFS_KEY = 'kogyo-sound';
export const DEFAULT_PREFS: SoundPrefs = { on: true, volume: 0.6 };

export function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      on: typeof p.on === 'boolean' ? p.on : DEFAULT_PREFS.on,
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULT_PREFS.volume,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let prefs: SoundPrefs = typeof window === 'undefined' ? { ...DEFAULT_PREFS } : loadPrefs();
const listeners = new Set<() => void>();

export function soundPrefs(): SoundPrefs {
  return prefs;
}

export function setSoundPrefs(p: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode or storage full: the choice lasts until the page closes
  }
  if (master && ctx) master.gain.setValueAtTime(prefs.volume * MASTER, ctx.currentTime);
  listeners.forEach((f) => f());
}

export function subscribePrefs(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/* ---------- which sound ---------- */

/** the sound for a command's answer; null for quiet commands (settings, speed, ...) */
export function soundForCommand(cmd: Command, ok: boolean): SoundId | null {
  if (!ok) return cmd.type === 'gather' ? null : 'error';
  switch (cmd.type) {
    case 'gather':
      return 'tap';
    case 'sell':
    case 'sellSurplus':
    case 'deliverOrder':
    case 'borrow':
      return 'coin';
    case 'build':
    case 'upgradeLevel':
    case 'buyMachine':
    case 'automate':
    case 'upgradeHQ':
    case 'addTrucks':
    case 'makeSubsidiary':
      return 'build';
    case 'hire':
    case 'bulkHire':
    case 'promote':
    case 'setDivisionHead':
      return 'hire';
    case 'buy':
    case 'research':
    case 'contract':
    case 'acceptOrder':
    case 'chooseEvent':
    case 'repay':
    case 'assign':
    case 'autoAssign':
    case 'setManager':
    case 'setRecipe':
      return 'ok';
    default:
      return null;
  }
}

/** louder news wins when several things happen in one update */
const RANK: Record<SoundId, number> = {
  goal: 10,
  research: 9,
  alert: 8,
  bad: 7,
  done: 6,
  coin: 5,
  warn: 4,
  chime: 3,
  work: 2,
  build: 1,
  hire: 1,
  ok: 1,
  error: 1,
  tap: 0,
  tick: 0,
};

/** the little the sound watcher remembers from one update to the next */
export interface SoundMarks {
  seed: number;
  name: string;
  tick: number;
  lastNotice: number;
  pending: number;
  taps: number;
}

export function soundMarks(s: GameState): SoundMarks {
  return {
    seed: s.seed,
    name: s.companyName,
    tick: s.tick,
    lastNotice: s.notices.reduce((m, n) => Math.max(m, n.id), -1),
    pending: s.events.pending.length,
    taps: s.owner.taps,
  };
}

/**
 * What happened since the last update that deserves a sound. At most one
 * sound (the most important); nothing when it is a different game or when a
 * lot happened at once (catching up after being away).
 * `afterCommand`: the change came from the player's own tap, which already
 * made its sound, so ordinary good news from it stays quiet.
 */
export function soundsBetween(a: SoundMarks, b: GameState, afterCommand = false): SoundId | null {
  if (a.seed !== b.seed || a.name !== b.companyName) return null;
  if (b.tick < a.tick) return null;
  // many days in one go: offline catch-up or a test's fast-forward
  if (b.tick - a.tick > ticksPerDay() * 30) return null;
  const found: SoundId[] = [];
  for (const n of b.notices) {
    if (n.id <= a.lastNotice) continue;
    if (n.icon === 'auto_flag') found.push('goal');
    else if (n.icon === 'ev_tech') found.push('research');
    else if (n.level === 'bad') found.push('bad');
    else if (n.level === 'warn') found.push('warn');
    else if (n.icon === 'misc_delivery') found.push('coin');
    else if (n.icon === 'ui_done' || n.icon === 'headquarters') found.push('done');
    else if (!afterCommand) found.push('chime');
  }
  if (b.events.pending.length > a.pending) found.push('alert');
  if (b.owner.taps > a.taps) found.push('work');
  if (!found.length) return null;
  return found.reduce((x, y) => (RANK[y] > RANK[x] ? y : x));
}

/* ---------- playing ---------- */

const MASTER = 0.5;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const lastPlayed: Partial<Record<SoundId, number>> = {};

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = prefs.volume * MASTER;
  master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const d = noise.getChannelData(0);
  // a fixed pattern is enough for a thud; no need for Math.random
  let x = 12345;
  for (let i = 0; i < d.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (x / 0x3fffffff - 1) * (1 - i / d.length);
  }
  return ctx;
}

/** called from the first touch: browsers only start sound inside a user gesture */
export function unlockAudio() {
  if (!prefs.on) return;
  const c = audioContext();
  if (c && c.state === 'suspended') void c.resume();
}

interface Tone {
  f: number;
  /** start, seconds from now */
  t?: number;
  /** length, seconds */
  d: number;
  type?: OscillatorType;
  v?: number;
  /** slide to this frequency */
  to?: number;
}

function tone(c: AudioContext, out: AudioNode, { f, t = 0, d, type = 'sine', v = 1, to }: Tone) {
  const at = c.currentTime + t;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + d);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(v, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + d);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + d + 0.02);
}

function thud(c: AudioContext, out: AudioNode, t: number, v: number, freq: number) {
  if (!noise) return;
  const at = c.currentTime + t;
  const src = c.createBufferSource();
  src.buffer = noise;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(v, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
  src.connect(lp).connect(g).connect(out);
  src.start(at);
  src.stop(at + 0.2);
}

// C major, so everything sits together
const N = { C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C4: 261.6, G4: 392, E4: 329.6, A3: 220 };

const RECIPES: Record<SoundId, (c: AudioContext, o: AudioNode) => void> = {
  tick: (c, o) => tone(c, o, { f: 1800, d: 0.03, type: 'triangle', v: 0.25 }),
  tap: (c, o) => tone(c, o, { f: 520, to: 780, d: 0.07, type: 'triangle', v: 0.5 }),
  work: (c, o) => {
    tone(c, o, { f: N.G5, d: 0.09, type: 'triangle', v: 0.45 });
    tone(c, o, { f: N.C6, t: 0.06, d: 0.14, type: 'triangle', v: 0.45 });
  },
  coin: (c, o) => {
    tone(c, o, { f: 1976, d: 0.07, type: 'square', v: 0.14 });
    tone(c, o, { f: 2637, t: 0.06, d: 0.22, type: 'square', v: 0.14 });
  },
  build: (c, o) => {
    thud(c, o, 0, 0.9, 500);
    tone(c, o, { f: 140, to: 70, d: 0.16, type: 'sine', v: 0.7 });
    tone(c, o, { f: N.E5, t: 0.1, d: 0.12, type: 'triangle', v: 0.3 });
  },
  done: (c, o) => {
    tone(c, o, { f: N.C5, d: 0.12, type: 'triangle', v: 0.4 });
    tone(c, o, { f: N.E5, t: 0.08, d: 0.12, type: 'triangle', v: 0.4 });
    tone(c, o, { f: N.G5, t: 0.16, d: 0.22, type: 'triangle', v: 0.4 });
  },
  hire: (c, o) => {
    tone(c, o, { f: N.E5, d: 0.08, type: 'sine', v: 0.45 });
    tone(c, o, { f: N.A5, t: 0.07, d: 0.16, type: 'sine', v: 0.45 });
  },
  ok: (c, o) => tone(c, o, { f: N.A5, d: 0.08, type: 'sine', v: 0.4 }),
  error: (c, o) => {
    tone(c, o, { f: 196, d: 0.1, type: 'square', v: 0.12 });
    tone(c, o, { f: 165, t: 0.1, d: 0.16, type: 'square', v: 0.12 });
  },
  chime: (c, o) => {
    tone(c, o, { f: N.G5, d: 0.3, type: 'sine', v: 0.35 });
    tone(c, o, { f: N.C6, t: 0.09, d: 0.4, type: 'sine', v: 0.3 });
  },
  research: (c, o) => {
    [N.C5, N.G5, N.C6, N.E6].forEach((f, i) => tone(c, o, { f, t: i * 0.07, d: 0.35, type: 'sine', v: 0.32 }));
  },
  goal: (c, o) => {
    [N.C5, N.E5, N.G5].forEach((f, i) => tone(c, o, { f, t: i * 0.1, d: 0.14, type: 'triangle', v: 0.4 }));
    tone(c, o, { f: N.C6, t: 0.3, d: 0.5, type: 'triangle', v: 0.45 });
    tone(c, o, { f: N.E6, t: 0.3, d: 0.5, type: 'sine', v: 0.2 });
    tone(c, o, { f: N.G6, t: 0.3, d: 0.5, type: 'sine', v: 0.12 });
  },
  alert: (c, o) => {
    tone(c, o, { f: N.A5, d: 0.5, type: 'sine', v: 0.4 });
    tone(c, o, { f: N.E5, t: 0.22, d: 0.6, type: 'sine', v: 0.4 });
  },
  warn: (c, o) => {
    tone(c, o, { f: N.E5, d: 0.14, type: 'triangle', v: 0.35 });
    tone(c, o, { f: N.E5, t: 0.18, d: 0.14, type: 'triangle', v: 0.35 });
  },
  bad: (c, o) => {
    tone(c, o, { f: N.E4, d: 0.22, type: 'sawtooth', v: 0.12 });
    tone(c, o, { f: N.C4, t: 0.18, d: 0.35, type: 'sawtooth', v: 0.12 });
  },
};

/** play a sound now (skipped when sound is off, the page is hidden or the same sound just played) */
export function play(id: SoundId) {
  if (!prefs.on || prefs.volume <= 0) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const c = audioContext();
  if (!c || !master || c.state !== 'running') return;
  const now = performance.now();
  if (now - (lastPlayed[id] ?? -1e9) < 70) return;
  lastPlayed[id] = now;
  try {
    RECIPES[id](c, master);
  } catch (e) {
    // a sound must never break the game
    if (import.meta.env.DEV) console.warn('sound', id, e);
  }
}

/**
 * Page-wide listeners: the first touch starts the audio, and moving between
 * screens (menu, back) gives a light tick. Actions make their own sound when
 * the game answers, so ordinary buttons stay silent here.
 */
export function installSoundListeners() {
  if (typeof document === 'undefined') return;
  const unlock = () => unlockAudio();
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('.nav button, .back-btn, [data-sound="tick"]');
      if (el && !(el as HTMLButtonElement).disabled) play('tick');
    },
    { capture: true },
  );
}
