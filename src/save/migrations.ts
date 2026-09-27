/**
 * Save migrations. Each entry upgrades a save from version v to v + 1.
 * Never edit an old migration; add a new one and bump SAVE_VERSION.
 */
import { DATA } from '../data';
import { STATE_VERSION, type GameState } from '../core';

export const SAVE_VERSION = STATE_VERSION;

type Raw = Record<string, unknown> & { version?: number };

export const migrations: Record<number, (s: Raw) => Raw> = {
  // 0 -> 1: pre-release saves had no version field; nothing else changed
  0: (s) => ({ ...s, version: 1 }),
};

/** fill in anything added to the data since the save was made (new items, settings) */
export function repair(s: GameState): GameState {
  for (const it of DATA.items) {
    s.inventory[it.id] ??= 0;
    s.itemToday[it.id] ??= { produced: 0, consumed: 0, sold: 0, bought: 0 };
    s.itemHist[it.id] ??= { produced: [], consumed: [], sold: [], bought: [], stock: [] };
    if (!s.market[it.id]) s.market[it.id] = { shock: 0, index: 1, flow: 0, todayNet: 0, hist: [] };
  }
  const defaults: GameState['settings'] = {
    autoPause: true,
    offlineDays: DATA.balance.time.offlineMaxDays,
    theme: 'auto',
    world3d: true,
    compactInventory: false,
    automationLevel: 'easy',
  };
  s.settings = { ...defaults, ...(s.settings ?? {}) };
  s.pausedFor ??= {};
  s.research.saved ??= {};
  s.milestones ??= {};
  return s;
}

export function migrate(data: Raw): GameState {
  let v = typeof data.version === 'number' ? data.version : 0;
  if (v > SAVE_VERSION) throw new Error(`このセーブは新しい版（v${v}）で作られています。ページを更新してください`);
  let cur = data;
  while (v < SAVE_VERSION) {
    const step = migrations[v];
    if (!step) throw new Error(`v${v} のセーブを変換できません`);
    cur = step(cur);
    v += 1;
    cur.version = v;
  }
  return repair(cur as unknown as GameState);
}
