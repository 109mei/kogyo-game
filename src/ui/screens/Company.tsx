import { useState } from 'react';
import { DATA } from '../../data';
import { dateOf, dayIndex } from '../../core/calendar';
import { automationRate, companyValue } from '../../core/finance';
import { managementCapacity, managementLoad, managementFactor } from '../../core/logistics';
import { dispatch, useGame } from '../../store/game';
import { LineChart } from '../charts';
import { Bar, Icon } from '../components';
import { date, days, pct, yen, yenShort } from '../format';

/** how far the company has grown: the job you did yourself, done without you */
const LADDER: { key: string; icon: string; label: string; hint: string }[] = [
  { key: 'self', icon: 'ppl_worker', label: '自分で作業', hint: '原木を集めて売る' },
  { key: 'staff', icon: 'ppl_foreman', label: '従業員', hint: '人を雇って任せる' },
  { key: 'machine', icon: 'auto_machine', label: '機械', hint: '機械で人の何倍も作る' },
  { key: 'auto', icon: 'auto_robot', label: '自動機', hint: '人がいなくても動く' },
  { key: 'rules', icon: 'auto_cycle', label: '運営ルール', hint: '条件で動かす・止める' },
  { key: 'manager', icon: 'ppl_manager', label: '工場長', hint: '工場の判断を任せる' },
];

export function Company() {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const v = useGame(
    (s) => {
      const hq = DATA.balance.hq[s.hq.level - 1];
      const next = DATA.balance.hq[s.hq.level] ?? null;
      const reached: Record<string, boolean> = {
        self: true,
        staff: s.employees.length > 0,
        machine: s.facilities.some((f) => f.stage !== 'manual' && f.machines > 0),
        auto: s.facilities.some((f) => f.stage === 'auto'),
        rules: s.facilities.some((f) => f.auto.enabled),
        manager: s.facilities.some((f) => f.managerId !== null),
      };
      const d = dayIndex(s.tick);
      return {
        name: s.companyName,
        day: d,
        founded: s.history[0]?.day ?? 0,
        hq,
        next,
        level: s.hq.level,
        building: s.hq.building ? { left: (s.hq.building.until - s.tick) / DATA.balance.time.ticksPerDay, frac: (s.tick - s.hq.building.start) / Math.max(1, s.hq.building.until - s.hq.building.start) } : null,
        load: managementLoad(s),
        cap: managementCapacity(s),
        factor: managementFactor(s),
        employees: s.employees.length,
        facilities: s.facilities.filter((f) => f.level > 0).length,
        auto: automationRate(s),
        value: companyValue(s),
        sales: s.totals.salesValue,
        cash: s.cash,
        reached,
        months: s.finance.months.map((m) => ({ year: m.year, month: m.month, value: m.value })),
        history: [...s.history].reverse().slice(0, 80),
      };
    },
    [],
    2,
  );
  const use = v.cap > 0 ? v.load / v.cap : 0;
  const reachedCount = LADDER.filter((l) => v.reached[l.key]).length;
  const ms = v.months.slice(-24);
  return (
    <>
      <div className="page-title">
        <Icon id="nav_company" size={40} />
        <h1>会社</h1>
      </div>
      <div className="card col" style={{ gap: 8 }}>
        {editing ? (
          <div className="row">
            <input className="input grow" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} aria-label="会社名" autoFocus />
            <button
              className="btn small"
              onClick={() => {
                if (dispatch({ type: 'renameCompany', name }).ok) setEditing(false);
              }}
            >
              保存
            </button>
          </div>
        ) : (
          <div className="spread">
            <span className="bold" style={{ fontSize: 19 }}>
              {v.name}
            </span>
            <button
              className="icon-btn"
              aria-label="会社名を変える"
              onClick={() => {
                setName(v.name);
                setEditing(true);
              }}
            >
              <Icon id="ui_edit" size={22} />
            </button>
          </div>
        )}
        <span className="small dim">
          {date(v.founded)} 創業・{(v.day - v.founded + 1).toLocaleString()}日目（{dateOf(v.day).year - dateOf(v.founded).year + 1}年目）
        </span>
        <div className="kv small">
          <span>企業価値</span>
          <span>{yen(v.value)}</span>
          <span>累計売上</span>
          <span>{yen(v.sales)}</span>
          <span>社員</span>
          <span>{v.employees.toLocaleString()}人</span>
          <span>施設</span>
          <span>{v.facilities}</span>
          <span>自動化率</span>
          <span>{pct(v.auto)}</span>
        </div>
      </div>

      <div className="section-title">
        <span>成長の段階</span>
        <span className="small muted">
          {reachedCount}/{LADDER.length}
        </span>
      </div>
      <div className="card">
        <div className="ladder">
          {LADDER.map((l, i) => {
            const on = v.reached[l.key];
            const current = on && !LADDER.slice(i + 1).some((x) => v.reached[x.key]);
            return (
              <div key={l.key} className={`ladder-step${on ? ' on' : ''}${current ? ' current' : ''}`}>
                <Icon id={l.icon} size={36} locked={!on} />
                <div className="col" style={{ gap: 0 }}>
                  <span className="small bold">{l.label}</span>
                  <span className="tiny dim">{l.hint}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          昨日まで自分でやっていた仕事が、今日は自分なしで回っている。生産の{pct(v.auto)}が人の手を離れています。
        </p>
      </div>

      <div className="section-title">本社</div>
      <div className="card col" style={{ gap: 10 }}>
        <div className="row">
          <Icon id="headquarters" size={64} />
          <div className="grow col" style={{ gap: 0 }}>
            <span className="bold">
              Lv{v.level} {v.hq.name}
            </span>
            <span className="tiny dim">
              応募 {v.hq.candidates}人/週・倉庫 {v.hq.storage.toLocaleString()}t・配送 {v.hq.logistics.toLocaleString()}t/日
            </span>
          </div>
        </div>
        <div>
          <div className="spread small">
            <span>管理の負荷</span>
            <span className="num">
              {v.load.toFixed(1)} / {v.cap.toFixed(0)}
            </span>
          </div>
          <div style={{ marginTop: 4 }}>
            <Bar value={use} tone={use > 1 ? 'bad' : use > 0.85 ? 'warn' : 'good'} label="管理の負荷" />
          </div>
          {v.factor < 1 ? (
            <p className="small bad" style={{ marginTop: 4 }}>
              管理が行き届かず、全施設の生産 −{Math.round((1 - v.factor) * 100)}%
            </p>
          ) : (
            <p className="tiny muted" style={{ marginTop: 4 }}>
              施設1つで1、工場長がいれば0.3、社員{DATA.balance.management.employeesPerPoint}人で1
            </p>
          )}
        </div>
        {v.building ? (
          <div>
            <div className="spread small">
              <span>🏗 {v.next?.name} を建設中</span>
              <span>あと{days(v.building.left)}</span>
            </div>
            <div style={{ marginTop: 4 }}>
              <Bar value={v.building.frac} label="本社の工事" />
            </div>
          </div>
        ) : v.next ? (
          <div className="col" style={{ gap: 6 }}>
            <span className="small">
              次：<b>{v.next.name}</b>（管理 {v.hq.management}→{v.next.management}・応募 {v.hq.candidates}→{v.next.candidates}人/週・倉庫 {v.hq.storage.toLocaleString()}→{v.next.storage.toLocaleString()}t）
            </span>
            <button className="btn block" disabled={v.cash < v.next.cost} onClick={() => dispatch({ type: 'upgradeHQ' })} data-testid="upgrade-hq">
              本社を拡張する（{yen(v.next.cost)}・{v.next.days}日）
            </button>
          </div>
        ) : (
          <span className="small dim">本社は最大です</span>
        )}
      </div>

      {ms.length >= 2 && (
        <div className="card col" style={{ gap: 10 }}>
          <span className="bold">企業価値の推移</span>
          <LineChart points={ms.map((m, i) => ({ x: i, y: m.value }))} format={yenShort} xLabel={(x) => (ms[Math.round(x)] ? `${ms[Math.round(x)].year}/${ms[Math.round(x)].month}` : '')} zeroBased label="企業価値の推移" />
        </div>
      )}

      <div className="section-title">会社の歴史</div>
      <div className="card">
        <div className="timeline">
          {v.history.map((h, i) => {
            const d = dateOf(h.day);
            return (
              <div className="tl-row" key={`${h.day}-${i}`}>
                <span className="tl-year tiny">
                  {d.year}/{d.month}/{d.day}
                </span>
                <Icon id={h.icon} size={26} />
                <span className="small">{h.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
