import { useState } from 'react';
import { DATA } from '../../data';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Bar, Chips, StagePill } from '../components';
import { perDay, yen } from '../format';
import { facilityView, type FacilityView } from '../selectors';

type Filter = 'all' | 'extraction' | 'processing' | 'manufacturing' | 'infrastructure';

export function Production() {
  const [filter, setFilter] = useState<Filter>('all');
  const v = useGame(
    (s) => ({
      list: s.facilities.filter((f) => filter === 'all' || DATA.facility[f.type].category === filter).map((f) => facilityView(s, f)),
      canBuild: !!s.features.build,
      total: s.facilities.length,
    }),
    [filter],
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
        {v.list.length === 0 && <div className="card empty">この種類の施設はまだありません</div>}
        {v.list.map((f) => (
          <FacilityCard key={f.id} f={f} />
        ))}
      </div>
    </>
  );
}

export function FacilityCard({ f }: { f: FacilityView }) {
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
      {f.stage === 'manual' && f.recipe && production && !f.building && <TapButton f={f} />}
    </div>
  );
}

export function TapButton({ f }: { f: FacilityView }) {
  const busy = f.tap.progress !== null;
  const label = f.recipe ? DATA.item[f.recipe] : null;
  const verb = DATA.recipe[f.recipe!].inputs && Object.keys(DATA.recipe[f.recipe!].inputs).length ? '作る' : '採取する';
  return (
    <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
      <button
        className="btn block progress-btn"
        disabled={!busy && !f.tap.can}
        onClick={() => dispatch({ type: 'gather', facilityId: f.id })}
        data-testid={`tap-${f.id}`}
        aria-busy={busy}
      >
        <span className="fill" style={{ width: `${(f.tap.progress ?? 0) * 100}%` }} />
        {busy ? `✋ 作業中… ${Math.round((f.tap.progress ?? 0) * 100)}%` : `✋ ${label?.name}を${verb}`}
        {!busy && <span className="sub">{Math.round(f.tap.seconds)}秒</span>}
      </button>
      {!busy && !f.tap.can && f.tap.why && f.tap.why !== 'いま別の作業をしています' && <p className="tiny muted center" style={{ marginTop: 4 }}>{f.tap.why}</p>}
    </div>
  );
}
