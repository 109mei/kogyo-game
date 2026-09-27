import { DATA } from '../data';

const DAY_MS = 86_400_000;
const start = (() => {
  const [y, m, d] = DATA.balance.time.startDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
})();

export function ticksPerDay(): number {
  return DATA.balance.time.ticksPerDay;
}

export function dayOf(tick: number): number {
  return tick / DATA.balance.time.ticksPerDay;
}

/** whole days since founding */
export function dayIndex(tick: number): number {
  return Math.floor(tick / DATA.balance.time.ticksPerDay);
}

export interface GameDate {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday */
  weekday: number;
  hour: number;
}

export function dateOf(day: number): GameDate {
  const whole = Math.floor(day);
  const d = new Date(start + whole * DAY_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: Math.floor((day - whole) * 24),
  };
}

export function formatDate(day: number, withYear = true): string {
  const d = dateOf(day);
  return withYear ? `${d.year}年${d.month}月${d.day}日` : `${d.month}月${d.day}日`;
}
