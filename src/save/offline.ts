import { DATA } from '../data';
import { runDays, type GameState } from '../core';
import { automationRate } from '../core/finance';

export interface OfflineReport {
  /** game days that were simulated */
  days: number;
  /** real seconds the app was closed */
  away: number;
  cashDelta: number;
  produced: { item: string; qty: number }[];
  stoppedBy: string | null;
  automation: number;
}

/**
 * While the app was closed the company kept running at x1, up to the limit
 * set in the settings. A problem that pauses the game stops the catch-up.
 */
export function catchUp(s: GameState, savedAt: number, now = Date.now()): OfflineReport | null {
  const away = Math.max(0, (now - savedAt) / 1000);
  const maxDays = s.settings.offlineDays;
  const days = Math.min(away / DATA.balance.time.realSecondsPerDay, maxDays);
  if (days < 0.25 || s.paused) return null;
  const before = s.cash;
  const made: Record<string, number> = { ...s.totals.produced };
  const ticks = runDays(s, days, true);
  const produced = Object.entries(s.totals.produced)
    .map(([item, qty]) => ({ item, qty: qty - (made[item] ?? 0) }))
    .filter((x) => x.qty > 1e-6)
    .sort((a, b) => b.qty * DATA.basePrice[b.item] - a.qty * DATA.basePrice[a.item])
    .slice(0, 6);
  return {
    days: ticks / DATA.balance.time.ticksPerDay,
    away,
    cashDelta: s.cash - before,
    produced,
    stoppedBy: s.paused ? s.pauseReason : null,
    automation: automationRate(s),
  };
}
