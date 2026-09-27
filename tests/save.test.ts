import { describe, expect, it } from 'vitest';
import { createInitialState, runDays } from '../src/core';
import { SAVE_VERSION, migrate } from '../src/save/migrations';
import { catchUp } from '../src/save/offline';
import { deserialize, SaveStore, serialize } from '../src/save/SaveStore';
import { busyScript, scripted, stable } from './helpers';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('save', () => {
  it('round-trips a played game without changing it', () => {
    const s = scripted(11, 30, busyScript);
    const back = deserialize(serialize(s, 1234));
    expect(back.savedAt).toBe(1234);
    expect(stable(back.state)).toBe(stable(s));
  });

  it('stores through SaveStore and reads it back', () => {
    const store = new SaveStore(new MemoryStorage());
    expect(store.load()).toBeNull();
    const s = scripted(12, 5, busyScript);
    expect(store.save(s)).toBe(true);
    expect(store.has()).toBe(true);
    expect(stable(store.load()!.state)).toBe(stable(s));
    store.clear();
    expect(store.has()).toBe(false);
  });

  it('exports to text and imports it on another device', () => {
    const store = new SaveStore(new MemoryStorage());
    const s = scripted(13, 8, busyScript);
    const text = store.exportText(s);
    expect(text.startsWith('KOGYO1:')).toBe(true);
    expect(stable(store.importText(text).state)).toBe(stable(s));
    expect(() => store.importText('hello')).toThrow();
  });

  it('upgrades an old save (no version field) and fills in missing parts', () => {
    const s = createInitialState({ seed: 3 });
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { inventory: Record<string, number>; settings?: unknown };
    delete old.version;
    delete old.settings;
    delete old.inventory.small_truck;
    const up = migrate(old);
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.settings.autoPause).toBe(true);
    expect(up.inventory.small_truck).toBe(0);
    runDays(up, 2, false);
  });

  it('refuses a save from a newer version', () => {
    const s = createInitialState({ seed: 3 });
    expect(() => migrate({ ...(s as unknown as Record<string, unknown>), version: SAVE_VERSION + 1 })).toThrow();
  });

  it('catches up the days the app was closed, up to the limit', () => {
    const s = scripted(21, 12, busyScript);
    const day0 = s.tick / 240;
    s.settings.autoPause = false;
    s.settings.offlineDays = 7;
    const report = catchUp(s, 0, 60_000 * 60 * 24)!; // a day away = far more than 7 game days
    expect(report.days).toBeCloseTo(7, 5);
    expect(s.tick / 240 - day0).toBeCloseTo(7, 5);
    // a few seconds away still pass (switching apps must not lose time), but are not worth a report
    const t = s.tick;
    const short = catchUp(s, 0, 6_000)!;
    expect(s.tick - t).toBe(24);
    expect(short.days).toBeLessThan(1);
  });
});
