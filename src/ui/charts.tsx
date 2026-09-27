/**
 * Small SVG charts following the data-viz rules: 2px lines, ~10% area wash,
 * hairline solid grid, 4px rounded bar ends on the baseline, crosshair
 * tooltip on lines, per-bar tooltip on columns, text in text tokens.
 */
import { useMemo, useRef, useState } from 'react';

interface LinePoint {
  x: number;
  y: number;
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function Sparkline({ values, width = 64, height = 24, tone }: { values: number[]; width?: number; height?: number; tone?: 'up' | 'down' | 'flat' }) {
  const path = useMemo(() => {
    if (values.length < 2) return '';
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    return values
      .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((v - lo) / span) * (height - 6)).toFixed(1)}`)
      .join('');
  }, [values, width, height]);
  const color = tone === 'down' ? 'var(--bad)' : tone === 'up' ? 'var(--good)' : 'var(--series-1)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** one series over time with a crosshair; y label formatter supplied by the caller */
export function LineChart({
  points,
  height = 160,
  format,
  xLabel,
  zeroBased = false,
  label,
}: {
  points: LinePoint[];
  height?: number;
  format: (v: number) => string;
  xLabel: (x: number) => string;
  zeroBased?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const padL = 44;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const H = height;
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    if (zeroBased) y0 = Math.min(0, y0);
    if (y1 === y0) {
      y1 += Math.abs(y1) * 0.1 || 1;
      y0 -= Math.abs(y0) * 0.1 || 1;
    }
    const pad = (y1 - y0) * 0.08;
    y1 += pad;
    if (!zeroBased) y0 -= pad;
    const sx = (x: number) => padL + ((x - x0) / (x1 - x0 || 1)) * (W - padL - padR);
    const sy = (y: number) => padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    const area = `${d}L${sx(x1).toFixed(1)},${sy(Math.max(y0, Math.min(0, y1))).toFixed(1)}L${sx(x0).toFixed(1)},${sy(Math.max(y0, Math.min(0, y1))).toFixed(1)}Z`;
    const ticks = niceTicks(y0, y1, 3);
    const xt = [x0, x0 + (x1 - x0) / 2, x1];
    return { sx, sy, d, area, ticks, xt };
  }, [points, H, zeroBased]);
  if (!geo) return <div className="empty small">データがたまるとグラフが出ます</div>;
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const dd = Math.abs(geo.sx(p.x) - px);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    setHover(best);
  };
  const hp = hover !== null ? points[hover] : null;
  const last = points[points.length - 1];
  return (
    <figure className="chart" ref={ref} style={{ margin: 0 }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={geo.sy(t)} y2={geo.sy(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 6} y={geo.sy(t) + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)" className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {geo.xt.map((x, i) => (
          <text key={i} x={geo.sx(x)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={10.5} fill="var(--muted)">
            {xLabel(x)}
          </text>
        ))}
        <path d={geo.area} fill="var(--series-1)" opacity={0.1} />
        <path d={geo.d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={geo.sx(last.x)} cy={geo.sy(last.y)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
        {hp && (
          <g>
            <line x1={geo.sx(hp.x)} x2={geo.sx(hp.x)} y1={padT} y2={H - padB} stroke="var(--axis)" strokeWidth={1} />
            <circle cx={geo.sx(hp.x)} cy={geo.sy(hp.y)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(geo.sx(hp.x) / W) * 100}%`, top: `${(geo.sy(hp.y) / H) * 100}%`, marginTop: -8 }}>
          <strong className="num">{format(hp.y)}</strong>
          <span className="muted">{xLabel(hp.x)}</span>
        </div>
      )}
    </figure>
  );
}

/** daily columns around a zero baseline: gains up, losses down */
export function ColumnChart({
  values,
  height = 140,
  format,
  xLabel,
  label,
}: {
  values: { x: number; y: number }[];
  height?: number;
  format: (v: number) => string;
  xLabel: (x: number) => string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const padL = 44;
  const padR = 6;
  const padT = 10;
  const padB = 22;
  const H = height;
  if (values.length < 1) return <div className="empty small">データがたまるとグラフが出ます</div>;
  let lo = Math.min(0, ...values.map((v) => v.y));
  let hi = Math.max(0, ...values.map((v) => v.y));
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08;
  hi += pad;
  if (lo < 0) lo -= pad;
  const sy = (y: number) => padT + (1 - (y - lo) / (hi - lo)) * (H - padT - padB);
  const band = (W - padL - padR) / values.length;
  const bw = Math.max(2, Math.min(24, band - 2));
  const ticks = niceTicks(lo, hi, 3);
  const zero = sy(0);
  const r = Math.min(4, bw / 2);
  return (
    <figure className="chart" style={{ margin: 0 }} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
            <text x={padL - 6} y={sy(t) + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)" className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const x = padL + i * band + (band - bw) / 2;
          const top = sy(Math.max(0, v.y));
          const bot = sy(Math.min(0, v.y));
          const h = Math.max(1, bot - top);
          const up = v.y >= 0;
          // rounded data end, square at the baseline
          const d = up
            ? `M${x},${bot}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${bot}Z`
            : `M${x},${top}V${bot - r}Q${x},${bot} ${x + r},${bot}H${x + bw - r}Q${x + bw},${bot} ${x + bw},${bot - r}V${top}Z`;
          return (
            <g key={v.x} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect x={padL + i * band} y={padT} width={band} height={H - padT - padB} fill="transparent" />
              <path d={h > 1 ? d : `M${x},${zero - 0.5}h${bw}v1h${-bw}Z`} fill={up ? 'var(--series-1)' : 'var(--bad)'} opacity={hover === null || hover === i ? 1 : 0.55} />
            </g>
          );
        })}
        <text x={padL} y={H - 6} fontSize={10.5} fill="var(--muted)">
          {xLabel(values[0].x)}
        </text>
        <text x={W - padR} y={H - 6} fontSize={10.5} fill="var(--muted)" textAnchor="end">
          {xLabel(values[values.length - 1].x)}
        </text>
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${((padL + hover * band + band / 2) / W) * 100}%`, top: `${(sy(Math.max(0, values[hover].y)) / H) * 100}%`, marginTop: -6 }}>
          <strong className="num">{format(values[hover].y)}</strong>
          <span className="muted">{xLabel(values[hover].x)}</span>
        </div>
      )}
    </figure>
  );
}

/** horizontal bars for comparing a handful of magnitudes (one color: magnitude, not identity) */
export function HBars({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="list" style={{ gap: 7 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 92px', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span className="dim">{r.label}</span>
          <div style={{ height: 10, background: 'var(--surface-3)', borderRadius: 5 }}>
            <div style={{ width: `${(Math.abs(r.value) / max) * 100}%`, height: '100%', borderRadius: 5, background: 'var(--series-1)' }} />
          </div>
          <span className="num" style={{ textAlign: 'right' }}>
            {format(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** two-part bar: plant vs grid, with a legend (two series) */
export function SplitBar({ parts, total }: { parts: { label: string; value: number; color: string }[]; total: number }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--surface-3)' }}>
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${total > 0 ? (p.value / total) * 100 : 0}%`, background: p.color }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span className="key" key={p.label}>
            <span className="swatch" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
