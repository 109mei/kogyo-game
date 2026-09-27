import { useEffect, useRef, useState } from 'react';
import { DATA, type Tech } from '../../data';
import { labCapacity, researchPerDay, techAvailable } from '../../core/research';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Bar, Chips, Icon } from '../components';
import { days, num } from '../format';

const CAT_LABEL: Record<Tech['category'], string> = {
  production: '生産技術',
  automation: '自動化',
  logistics: '物流',
  energy: '省エネ',
  materials: '材料',
  electronics: '電子',
  power: '電力',
  management: '経営',
};

const CAT_ICON: Record<Tech['category'], string> = {
  production: 'rs_production',
  automation: 'rs_automation',
  logistics: 'rs_logistics',
  energy: 'rs_energy',
  materials: 'rs_materials',
  electronics: 'rs_electronics',
  power: 'nav_power',
  management: 'rs_management',
};

const EFFECT_TEXT: Record<string, (v: number) => string> = {
  rate: (v) => `生産 ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`,
  power: (v) => `消費電力 ${Math.round(v * 100)}%`,
  inputs: (v) => `材料 ${Math.round(v * 100)}%`,
  logistics: (v) => `輸送能力 +${Math.round(v * 100)}%`,
  logisticsCost: (v) => `運賃 ${Math.round(v * 100)}%`,
  management: (v) => `管理能力 +${Math.round(v * 100)}%`,
  candidates: (v) => `応募者 +${v}人/週`,
  skillGrowth: (v) => `熟練 +${Math.round(v * 100)}%`,
  machinesPerLevel: (v) => `機械 +${v}台/Lv`,
  fuel: (v) => `燃料 ${Math.round(v * 100)}%`,
  managerBonus: (v) => `工場長の効果 +${Math.round(v * 100)}%`,
  loanLimit: (v) => `借入枠 ×${v + 1}`,
};

const FEATURE_TEXT: Record<string, string> = {
  machine: '機械化',
  auto: '自動化',
  rules: '運営ルール',
  autotrade: '自動売買',
  advancedRules: '上級ルール',
  managers: '工場長',
  contracts: '長期契約',
  forecast: '価格の見通し',
  bulkHire: '採用キャンペーン',
  rail: '貨物鉄道',
  gasPower: 'ガス・石油火力',
};

type Filter = 'available' | 'all' | Tech['category'];

export function Research({ focus }: { focus?: string }) {
  const [filter, setFilter] = useState<Filter>(focus ? 'all' : 'available');
  const v = useGame(
    (s) => ({
      done: [...s.research.done],
      current: s.research.current,
      progress: s.research.progress,
      saved: { ...s.research.saved },
      rp: researchPerDay(s),
      open: !!s.features.research,
      labs: s.facilities.filter((f) => f.type === 'research_lab').length,
      cap: labCapacity(s),
      researchers: s.employees.filter((e) => e.role === 'researcher' && e.assignedTo !== null).length,
      avail: DATA.techs.filter((t) => techAvailable(s, t.id)).map((t) => t.id),
    }),
    [],
    2,
  );
  const push = useUI((s) => s.push);
  const cur = v.current ? DATA.tech[v.current] : null;
  const list = DATA.techs.filter((t) => {
    if (filter === 'available') return v.avail.includes(t.id);
    if (filter === 'all') return true;
    return t.category === filter;
  });
  return (
    <>
      <div className="page-title">
        <Icon id="nav_research" size={40} />
        <h1>研究</h1>
        <span className="small muted">
          {v.done.length}/{DATA.techs.length}
        </span>
      </div>
      {!v.open && (
        <div className="card col" style={{ gap: 8 }}>
          <p className="small dim">研究所を建てて研究員を配置すると研究が始められます。</p>
          <button className="btn soft block" onClick={() => push({ screen: 'build', id: 'research_lab' })}>
            研究所を建てる
          </button>
        </div>
      )}
      <div className="card">
        {cur ? (
          <>
            <div className="spread">
              <span className="bold">{cur.name}</span>
              <span className="small num dim">
                {num(v.progress, 0)}/{cur.cost} RP
              </span>
            </div>
            <div style={{ margin: '8px 0' }}>
              <Bar value={v.progress / cur.cost} thick label="研究の進み具合" />
            </div>
            <span className="small dim">あと{v.rp > 0 ? days((cur.cost - v.progress) / v.rp) : '—（研究員がいません）'}</span>
          </>
        ) : (
          <span className="small dim">{v.open ? '研究テーマを選んでください' : '研究は止まっています'}</span>
        )}
        <div className="divider" />
        <div className="kv small">
          <span>研究の速さ</span>
          <span>{num(v.rp, 1)} RP/日</span>
          <span>研究員</span>
          <span>
            {v.researchers}/{v.cap}人（研究所{v.labs}）
          </span>
        </div>
      </div>
      <Chips
        value={filter}
        onChange={setFilter}
        options={[['available', '研究できる'], ['all', 'すべて'], ...(Object.keys(CAT_LABEL) as Tech['category'][]).map((c) => [c, CAT_LABEL[c]] as [Filter, string])]}
      />
      <div className="list">
        {list.length === 0 && <div className="card empty">いま研究できるものはありません</div>}
        {list.map((t) => (
          <TechCard key={t.id} t={t} state={v.done.includes(t.id) ? 'done' : v.avail.includes(t.id) ? 'avail' : 'locked'} current={v.current === t.id} canStart={v.open} focus={focus === t.id} saved={v.saved[t.id] ?? 0} />
        ))}
      </div>
    </>
  );
}

function TechCard({ t, state, current, canStart, focus, saved }: { t: Tech; state: 'done' | 'avail' | 'locked'; current: boolean; canStart: boolean; focus: boolean; saved: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'center' });
  }, [focus]);
  const u = DATA.unlockedBy[t.id];
  const unlockIcons = [...(u?.facilities ?? []), ...(u?.recipes ?? []).filter((r) => !(u?.facilities ?? []).includes(DATA.recipe[r].facility))];
  const effects = t.effects
    .map((e) => (e.type === 'feature' ? `解放：${FEATURE_TEXT[e.feature] ?? e.feature}` : e.type === 'unlock' ? '' : 'value' in e ? EFFECT_TEXT[e.type]?.(e.value) : ''))
    .filter(Boolean);
  const contracts = (u?.contracts ?? []).map((c) => DATA.balance.power.contracts.find((x) => x.id === c)?.name + '契約');
  return (
    <div ref={ref} className={`card tech ${state}`} style={focus ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined} data-testid={`tech-${t.id}`}>
      <Icon id={CAT_ICON[t.category]} size={44} locked={state === 'locked'} />
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="tech-name">
          {state === 'done' ? '✅ ' : state === 'locked' ? '🔒 ' : ''}
          {t.name}
        </span>
        <span className="tiny dim">{t.desc}</span>
        {(effects.length > 0 || contracts.length > 0) && <span className="tiny" style={{ color: 'var(--accent-text)' }}>{[...effects, ...contracts].join('・')}</span>}
        {unlockIcons.length > 0 && (
          <div className="unlock-icons">
            {unlockIcons.slice(0, 10).map((x) => (
              <Icon key={x} id={x} size={24} locked={state === 'locked'} />
            ))}
          </div>
        )}
        {state === 'locked' && <span className="tiny muted">前提：{t.requires.map((r) => DATA.tech[r].name).join('、')}</span>}
        {saved > 0 && !current && (
          <span className="tiny dim">
            途中 {Math.floor(saved).toLocaleString()}/{t.cost.toLocaleString()} RP（続きから再開）
          </span>
        )}
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
        <span className="tiny num muted">{t.cost.toLocaleString()} RP</span>
        {state === 'avail' && (
          <button className={`btn small${current ? ' soft' : ''}`} disabled={!canStart || current} onClick={() => dispatch({ type: 'research', tech: t.id })}>
            {current ? '研究中' : '研究する'}
          </button>
        )}
      </div>
    </div>
  );
}

