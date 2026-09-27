/**
 * The single place that reads and writes saves. localStorage today; the
 * inside can move to IndexedDB later without touching callers.
 */
import type { GameState } from '../core';
import { migrate, SAVE_VERSION } from './migrations';

export const SAVE_KEY = 'kogyo-game/save';
/** written with every save: when and by which tab (so other open tabs can step aside) */
export const STAMP_KEY = 'kogyo-game/stamp';
const EXPORT_PREFIX = 'KOGYO1:';

export interface SaveEnvelope {
  version: number;
  savedAt: number;
  state: GameState;
}

export interface Loaded {
  state: GameState;
  savedAt: number;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function serialize(state: GameState, savedAt = Date.now()): string {
  const env: SaveEnvelope = { version: SAVE_VERSION, savedAt, state: { ...state, version: SAVE_VERSION } };
  return JSON.stringify(env);
}

export function deserialize(text: string): Loaded {
  const env = JSON.parse(text) as Partial<SaveEnvelope> & Record<string, unknown>;
  if (!env || typeof env !== 'object' || !env.state) throw new Error('セーブデータの形式が違います');
  const raw = { ...(env.state as unknown as Record<string, unknown>), version: env.version ?? (env.state as { version?: number }).version ?? 0 };
  const state = migrate(raw);
  return { state, savedAt: typeof env.savedAt === 'number' ? env.savedAt : Date.now() };
}

/** the text a player copies out of the game */
export function exportTextOf(saveText: string): string {
  return EXPORT_PREFIX + toBase64(saveText);
}

/** a copied save back to a game (throws with a message the player can read) */
export function importText(text: string): Loaded {
  const t = text.trim();
  if (!t.startsWith(EXPORT_PREFIX)) throw new Error('書き出したデータを貼り付けてください');
  let json: string;
  try {
    json = fromBase64(t.slice(EXPORT_PREFIX.length));
  } catch {
    throw new Error('データが途中で切れているか、壊れています');
  }
  return deserialize(json);
}

export class SaveStore {
  constructor(private storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {}

  save(state: GameState, owner = ''): boolean {
    const at = Date.now();
    return this.writeText(serialize(state, at), at, owner);
  }

  /** a save already turned into text (by the simulation worker) */
  writeText(text: string, at: number, owner = ''): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, text);
      this.storage.setItem(STAMP_KEY, JSON.stringify({ at, owner }));
      return true;
    } catch {
      return false;
    }
  }

  readText(): string | null {
    try {
      return this.storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  load(): Loaded | null {
    const text = this.readText();
    if (!text) return null;
    return deserialize(text);
  }

  has(): boolean {
    try {
      return !!this.storage?.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  clear() {
    try {
      this.storage?.removeItem(SAVE_KEY);
      this.storage?.removeItem(STAMP_KEY);
    } catch {
      /* ignore */
    }
  }

  exportText(state: GameState): string {
    return exportTextOf(serialize(state));
  }

  importText(text: string): Loaded {
    return importText(text);
  }
}
