import { useEffect, useState, type ReactNode } from 'react';
import { DATA } from '../data';
import type { Stage } from '../core';
import { num } from './format';

const BASE = import.meta.env.BASE_URL;

export function iconUrl(id: string, size: number): string {
  return `${BASE}assets/icons/${size <= 72 ? 'sm/' : ''}${id}.webp`;
}

export function Icon({ id, size = 40, locked, alt, className }: { id: string; size?: number; locked?: boolean; alt?: string; className?: string }) {
  return (
    <img
      className={`icon${locked ? ' locked' : ''}${className ? ` ${className}` : ''}`}
      src={iconUrl(id, size)}
      width={size}
      height={size}
      alt={alt ?? DATA.item[id]?.name ?? DATA.facility[id]?.name ?? ''}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

export function Bar({ value, tone, thick, label }: { value: number; tone?: 'good' | 'warn' | 'bad'; thick?: boolean; label?: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`bar${tone ? ` ${tone}` : ''}${thick ? ' thick' : ''}`} role="meter" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${w}%` }} />
    </div>
  );
}

export function Dot({ tone }: { tone: 'green' | 'yellow' | 'red' | 'gray' }) {
  return <span className={`sdot ${tone}`} aria-hidden />;
}

export const STAGE_LABEL: Record<Stage, string> = { manual: '手作業', machine: '機械', auto: '自動' };

export function StagePill({ stage, machines }: { stage: Stage; machines: number }) {
  return (
    <span className={`pill ${stage}`}>
      {stage === 'manual' ? '✋ 手作業' : stage === 'machine' ? `⚙ 機械×${machines}` : `🤖 自動×${machines}`}
    </span>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map(([v, label]) => (
        <button key={v} className={`chip${v === value ? ' on' : ''}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Radio({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`radio${on ? ' on' : ''}`} role="radio" aria-checked={on} onClick={onClick}>
      <span className="mark" />
      <span className="grow">{children}</span>
    </button>
  );
}

/** [-] value [+] with quick steps; digits only, never below min */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  quick,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  quick?: { label: string; add?: number; set?: number }[];
  unit?: string;
}) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const clampV = (v: number) => Math.max(min, max !== undefined ? Math.min(max, v) : v);
  return (
    <div>
      <div className="stepper">
        <button aria-label="減らす" onClick={() => onChange(clampV(value - step))}>
          −
        </button>
        <input
          inputMode="decimal"
          value={text}
          aria-label="数量"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = Number(text.replace(/[^0-9.]/g, ''));
            if (Number.isFinite(v)) onChange(clampV(v));
            else setText(fmt(value));
          }}
        />
        <button aria-label="増やす" onClick={() => onChange(clampV(value + step))}>
          ＋
        </button>
      </div>
      {unit && <div className="tiny muted center" style={{ marginTop: 2 }}>{unit}</div>}
      {quick && (
        <div className="quick">
          {quick.map((q) => (
            <button key={q.label} onClick={() => onChange(clampV(q.set !== undefined ? q.set : value + (q.add ?? 0)))}>
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(v: number): string {
  return num(v, v >= 100 ? 0 : 2);
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="list">
      <div className="section-title">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SheetFrame({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}
