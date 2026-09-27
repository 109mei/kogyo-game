import { memo, useState } from 'react';
import { DATA } from '../../data';
import type { FacilityState } from '../../core';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Bar, Chips, Icon, StagePill } from '../components';
import { perDay, yen } from '../format';
import { facilityStatus, facilityView, type FacilityView } from '../selectors';

type Filter = 'all' | 'extraction' | 'processing' | 'manufacturing' | 'infrastructure';

/** from this many facilities on, the list is grouped by kind (a long flat list is slow and hard to read) */
const GROUP_AT = 25;

interface Group {
  type: string;
  /** who runs the kind: a division head or a subsidiary */
  head: string | null;
  sub: string | null;
  count: number;
  util: number;
  profit: number;
  red: number;
  running: number;
  stopped: number;
  views: FacilityView[] | null;
}

const last = (xs: number[]) => (xs.length ? xs[xs.length - 1] : null);

export function Production() {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const v = useGame(
    (s) => {
      const all = s.facilities.filter((f) => filter === 'all' || DATA.facility[f.type].category === filter);
      const grouped = all.length >= GROUP_AT;
      // a subsidiary is one card whatever the count: the player does not run its facilities one by one
      const inSub = (f: FacilityState) => !!s.divisions[f.type]?.sub;
      const fs = grouped ? all : all.filter((f) => !inSub(f));
      const subs = grouped ? [] : all.filter(inSub);
      let groups: Group[] = [];
      if (grouped || subs.length) {
        const byType = new Map<string, FacilityState[]>();
        for (const f of grouped ? fs : subs) {
          const g = byType.get(f.type);
          if (g) g.push(f);
          else byType.set(f.type, [f]);
        }
        groups = [...byType.entries()]
          .map(([type, members]) => {
            const statuses = members.map((f) => facilityStatus(s, f));
            const red = statuses.filter((x) => x.tone === 'red').length;
            const running = members.filter((f, i) => statuses[i].tone !== 'red' && (last(f.stats.utilHist) ?? f.util) > 0.02).length;
            const d = s.divisions[type];
            const head = d?.headId != null ? s.employees.find((e) => e.id === d.headId) : undefined;
            return {
              type,
              head: d?.headId != null ? (head?.name ?? null) : null,
              sub: d?.sub?.name ?? null,
              count: members.length,
              util: members.reduce((t, f) => t + (last(f.stats.utilHist) ?? f.util), 0) / members.length,
              profit: members.reduce((t, f) => t + (last(f.stats.profitHist) ?? 0), 0),
              red,
              running,
              stopped: members.length - red - running,
              views: open[type] ? members.map((f) => facilityView(s, f)) : null,
            };
          })
          .sort((a, b) => DATA.facility[a.type].no - DATA.facility[b.type].no);
      }
      return {
        grouped,
        list: grouped ? [] : fs.map((f) => facilityView(s, f)),
        divisions: !!s.features.divisions,
        groups,
        canBuild: !!s.features.build,
        total: s.facilities.length,
      };
    },
    [filter, open],
    4,
  );
  const push = useUI((s) => s.push);
  return (
    <>
      <div className="spread">
        <div className="page-title">
          <h1>生産</h1>
          <span className="small muted">{v.total}施設</span>
        </div>
        <button className="btn small" onClick={() => push({ screen: 'build' })} disabled={!v.canBuild} data-testid="open-build">
          ＋ 建設
        </button>
      </div>
      {!v.canBuild && <p className="small muted">「社員を3人にしよう」を達成すると施設を建てられます。</p>}
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          ['all', 'すべて'],
          ['extraction', '採取'],
          ['processing', '加工'],
          ['manufacturing', '製造'],
          ['infrastructure', 'インフラ'],
        ]}
      />
      <div className="list">
        {v.list.length === 0 && v.groups.length === 0 && <div className="card empty">この種類の施設はまだありません</div>}
        {v.list.map((f) => (
          <FacilityCard key={f.id} f={f} />
        ))}
        {v.groups.map((g) => (
          <GroupCard key={g.type} g={g} open={!!open[g.type]} onToggle={() => setOpen({ ...open, [g.type]: !open[g.type] })} divisions={v.divisions} />
        ))}
      </div>
    </>
  );
}

function GroupCard({ g, open, onToggle, divisions }: { g: Group; open: boolean; onToggle: () => void; divisions: boolean }) {
  const def = DATA.facility[g.type];
  const production = def.category !== 'infrastructure';
  const push = useUI((s) => s.push);
  return (
    <>
      <button className="card tap group-card" onClick={onToggle} aria-expanded={open} data-testid={`group-${g.type}`}>
        <div className="fac">
          <Icon id={g.type} size={64} className="fac-img" />
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="fac-name ellipsis grow">
                {g.sub ?? def.name} <span className="muted">×{g.count}</span>
              </span>
              <span className="small dim">{open ? '▲' : '▼'}</span>
            </div>
            {production && (
              <div className="row" style={{ gap: 8 }}>
                <span className="tiny dim" style={{ width: 44 }}>
                  平均
                </span>
                <div className="grow">
                  <Bar value={g.util} tone={g.util > 0.85 ? 'good' : g.util > 0.3 ? 'warn' : 'bad'} label="平均稼働率" />
                </div>
                <span className="tiny num" style={{ width: 34, textAlign: 'right' }}>
                  {Math.round(g.util * 100)}%
                </span>
              </div>
            )}
            <div className="spread small">
              <span className="dim ellipsis">
                {g.red ? `🔴 問題 ${g.red}・` : ''}稼働 {g.running}・停止 {g.stopped}
              </span>
              {production && <span className={`num ${g.profit >= 0 ? 'good' : 'bad'}`}>{yen(g.profit, { sign: true })}/日</span>}
            </div>
          </div>
        </div>
      </button>
      {production && (divisions || g.head || g.sub) && (
        <button className="group-org" onClick={() => push({ screen: 'division', id: g.type })} data-testid={`division-${g.type}`}>
          {g.sub ? `🏢 子会社・社長 ${g.head ?? '—'}` : g.head ? `🗂 部門長 ${g.head}` : '🗂 部門長を任命する'} ›
        </button>
      )}
      {open && g.views && (
        <div className="list group-members">
          {g.views.map((f) => (
            <FacilityCard key={f.id} f={f} />
          ))}
        </div>
      )}
    </>
  );
}

const sig3 = (x: number) => Number(x.toPrecision(3));
/** what a card shows, rounded as it is shown: the card only redraws when this changes */
function cardSig(f: FacilityView): string {
  return [
    f.name,
    f.level,
    f.stage,
    f.machines,
    f.recipe,
    Math.round(f.util * 100),
    sig3(f.outPerDay),
    f.profit === null ? '' : sig3(f.profit),
    f.status.text,
    f.managed,
    f.org,
    f.auto,
    f.building ? Math.round(f.building.progress * 100) : '',
    f.tap.can,
    f.tap.why,
    f.tap.progress === null ? '' : Math.round(f.tap.progress * 100),
    f.tap.queued,
    f.tap.busy,
  ].join('|');
}

export const FacilityCard = memo(FacilityCardInner, (a, b) => cardSig(a.f) === cardSig(b.f));

function FacilityCardInner({ f }: { f: FacilityView }) {
  const push = useUI((s) => s.push);
  const def = DATA.facility[f.type];
  const production = def.category !== 'infrastructure';
  return (
    <div className="card tap" onClick={() => push({ screen: 'facility', id: f.id })} data-testid={`facility-${f.id}`}>
      <div className="fac">
        <img className="fac-img" src={`${import.meta.env.BASE_URL}assets/icons/sm/${f.type}.webp`} alt="" loading="lazy" />
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="fac-name ellipsis grow">{f.name}</span>
            {f.level > 0 && <span className="pill">Lv{f.level}</span>}
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {production && <StagePill stage={f.stage} machines={f.machines} />}
            {f.org === 'sub' ? <span className="pill">🏢 子会社</span> : f.org === 'division' ? <span className="pill">🗂 部門</span> : null}
            {f.managed && <span className="pill">👔 工場長</span>}
            {f.auto && <span className="pill">🔁 自動運転</span>}
          </div>
          <div className="fac-lines">
            {production && !f.building && (
              <div className="row" style={{ gap: 8 }}>
                <span className="tiny dim" style={{ width: 44 }}>
                  稼働率
                </span>
                <div className="grow">
                  <Bar value={f.util} tone={f.util > 0.85 ? 'good' : f.util > 0.3 ? 'warn' : 'bad'} label="稼働率" />
                </div>
                <span className="tiny num" style={{ width: 34, textAlign: 'right' }}>
                  {Math.round(f.util * 100)}%
                </span>
              </div>
            )}
            {f.building && <Bar value={f.building.progress} label="工事の進み具合" />}
            {production && f.recipe && (
              <div className="stat-inline">
                <img src={`${import.meta.env.BASE_URL}assets/icons/sm/${f.recipe}.webp`} alt="" />
                <span className="num">{perDay(f.recipe, f.outPerDay)}</span>
                {f.profit !== null && (
                  <span className={`num small ${f.profit >= 0 ? 'good' : 'bad'}`} style={{ marginLeft: 'auto' }}>
                    {yen(f.profit, { sign: true })}/日
                  </span>
                )}
              </div>
            )}
            <span className="small dim">{f.status.text}</span>
          </div>
        </div>
      </div>
      {f.stage === 'manual' && f.recipe && production && !f.building && f.org !== 'sub' && <TapButton f={f} />}
    </div>
  );
}

export function TapButton({ f }: { f: FacilityView }) {
  const here = f.tap.progress !== null;
  const label = f.recipe ? DATA.item[f.recipe] : null;
  const verb = DATA.recipe[f.recipe!].inputs && Object.keys(DATA.recipe[f.recipe!].inputs).length ? '作る' : '採取する';
  const queued = f.tap.queued > 0 ? `・予約${f.tap.queued}` : '';
  return (
    <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
      <button
        className="btn block progress-btn"
        disabled={!f.tap.can}
        onClick={() => dispatch({ type: 'gather', facilityId: f.id })}
        data-testid={`tap-${f.id}`}
        aria-busy={here}
      >
        <span className="fill" style={{ width: `${(f.tap.progress ?? 0) * 100}%` }} />
        {here ? `✋ 作業中… ${Math.round((f.tap.progress ?? 0) * 100)}%${queued}` : `✋ ${label?.name}を${verb}${queued}`}
        <span className="sub">{f.tap.busy ? (f.tap.can ? '押すと予約' : '') : `${Math.round(f.tap.seconds)}秒`}</span>
      </button>
      {!f.tap.can && f.tap.why && <p className="tiny muted center" style={{ marginTop: 4 }}>{f.tap.why}</p>}
    </div>
  );
}
