import { DATA } from '../data';
import { dateOf } from '../core/calendar';

/** 3億2,840万円 style: the two largest Japanese units, 4 significant-ish digits */
export function yen(v: number, opts: { sign?: boolean; unit?: boolean } = {}): string {
  const unit = opts.unit === false ? '' : '円';
  const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
  const a = Math.abs(v);
  if (a >= 1e12) {
    const cho = Math.floor(a / 1e12);
    const oku = Math.floor((a % 1e12) / 1e8);
    return `${sign}${cho.toLocaleString()}兆${oku ? `${oku.toLocaleString()}億` : ''}${unit}`;
  }
  if (a >= 1e8) {
    const oku = Math.floor(a / 1e8);
    const man = Math.floor((a % 1e8) / 1e4);
    return `${sign}${oku.toLocaleString()}億${man ? `${man.toLocaleString()}万` : ''}${unit}`;
  }
  if (a >= 1e4) {
    const man = a / 1e4;
    return `${sign}${man >= 100 ? Math.round(man).toLocaleString() : man.toFixed(man >= 10 ? 0 : 1).replace(/\.0$/, '')}万${unit}`;
  }
  return `${sign}${Math.round(a).toLocaleString()}${unit}`;
}

/** short form for tight places: 3.28億 */
export function yenShort(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(a >= 1e13 ? 0 : 1)}兆`;
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(a >= 1e9 ? 0 : 1)}億`;
  if (a >= 1e4) return `${sign}${a >= 1e5 ? Math.round(a / 1e4).toLocaleString() : (a / 1e4).toFixed(1)}万`;
  return `${sign}${Math.round(a).toLocaleString()}`;
}

export function num(v: number, digits?: number): string {
  const a = Math.abs(v);
  const d = digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 1 : a === 0 ? 0 : 2);
  const s = v.toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: d });
  if (/^-0(\.0*)?$/.test(s)) return '0';
  return s.replace('-', '−');
}

export function qty(item: string, v: number, opts: { sign?: boolean } = {}): string {
  const u = DATA.item[item]?.unit ?? '';
  const n = num(v);
  const sign = opts.sign && v > 0 && n !== '0' ? '+' : '';
  return `${sign}${n}${u}`;
}

export function perDay(item: string, v: number, opts: { sign?: boolean } = {}): string {
  return `${qty(item, v, opts)}/日`;
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function signedPct(v: number, digits = 1): string {
  const s = (v * 100).toFixed(digits);
  return v > 0 ? `▲ ${s}%` : v < 0 ? `▼ ${s.replace('-', '')}%` : `${s}%`;
}

export function kw(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(v >= 1e5 ? 0 : 1)}MW`;
  return `${Math.round(v).toLocaleString()}kW`;
}

export function date(day: number, withYear = true): string {
  const d = dateOf(day);
  return withYear ? `${d.year}年${d.month}月${d.day}日` : `${d.month}月${d.day}日`;
}

export function monthLabel(day: number): string {
  const d = dateOf(day);
  return `${d.year}年${d.month}月`;
}

export function days(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v < 1) return `${Math.max(0, Math.round(v * 24))}時間`;
  if (v < 10) return `${v.toFixed(1)}日`;
  return `${Math.round(v).toLocaleString()}日`;
}

export function stars(n: number): string {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(k) + '☆'.repeat(5 - k);
}
