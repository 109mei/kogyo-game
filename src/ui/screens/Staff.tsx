import { useState } from 'react';
import { DATA, type RoleId } from '../../data';
import { dateOf, dayIndex } from '../../core/calendar';
import { facilityById } from '../../core/facilities';
import { candidatesPerWeek, employeesAt, rolesFor, SPECIALTY_NAME, staffCapacity } from '../../core/staff';
import type { GameState } from '../../core';
import { hasFeature } from '../../core/util';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Icon, Tabs } from '../components';
import { stars, yen, yenShort } from '../format';

export const ROLE_ICON: Record<RoleId, string> = { worker: 'ppl_worker', engineer: 'ppl_engineer', researcher: 'ppl_researcher', manager: 'ppl_foreman', director: 'ppl_manager' };

/** places a new hire of each role could go to right now (idle people of that role take them first) */
function openings(s: GameState): Record<RoleId, number> {
  const out: Record<RoleId, number> = { worker: 0, engineer: 0, researcher: 0, manager: 0, director: 0 };
  for (const f of s.facilities) {
    if (f.building && f.building.kind === 'build') continue;
    if (s.divisions[f.type]?.sub) continue;
    const room = Math.max(0, staffCapacity(s, f) - employeesAt(s, f.id).length);
    if (!room) continue;
    const roles = rolesFor(f);
    if (roles.includes('researcher')) out.researcher += room;
    else if (roles.includes('worker')) out.worker += room;
  }
  if (s.features.managers) for (const f of s.facilities) if (f.managerId === null && f.recipe && !(f.building && f.building.kind === 'build')) out.manager++;
  for (const e of s.employees) {
    if (e.assignedTo !== null || e.role === 'director') continue;
    if (e.role === 'researcher') out.researcher--;
    else if (e.role === 'manager') out.manager--;
    else out.worker--;
  }
  out.engineer = out.worker;
  return out;
}

export function Staff() {
  const [tab, setTab] = useState<'people' | 'candidates'>('people');
  const v = useGame(
    (s) => {
      const d = dayIndex(s.tick);
      const groups = new Map<string, { name: string; people: { id: number; name: string; role: RoleId; skill: number; specialty: string; salary: number }[] }>();
      const idle: { id: number; name: string; role: RoleId; skill: number; specialty: string; salary: number }[] = [];
      const heads: { id: number; name: string; role: RoleId; skill: number; specialty: string; salary: number; leads: string }[] = [];
      const leads = new Map(Object.values(s.divisions).filter((d) => d.headId !== null).map((d) => [d.headId!, d.sub ? `${d.sub.name}の社長` : `${DATA.facility[d.type].short}部門`]));
      for (const e of s.employees) {
        const row = { id: e.id, name: e.name, role: e.role, skill: e.skill, specialty: e.specialty, salary: e.salary };
        if (e.role === 'director') heads.push({ ...row, leads: leads.get(e.id) ?? 'まだ部門を任せていません' });
        else if (e.assignedTo === null) idle.push(row);
        else {
          const f = facilityById(s, e.assignedTo);
          const key = String(e.assignedTo);
          if (!groups.has(key)) groups.set(key, { name: f?.name ?? '?', people: [] });
          groups.get(key)!.people.push(row);
        }
      }
      const byRole: Record<string, number> = {};
      for (const e of s.employees) byRole[e.role] = (byRole[e.role] ?? 0) + 1;
      return {
        total: s.employees.length,
        payroll: s.employees.reduce((t, e) => t + e.salary, 0),
        byRole,
        idle,
        heads,
        groups: [...groups.values()],
        candidates: s.candidates.map((c) => ({ ...c, left: c.expires - d })),
        canHire: !!s.features.hire,
        bulk: hasFeature(s, 'bulkHire'),
        perWeek: candidatesPerWeek(s),
        nextMonday: (1 - dateOf(d).weekday + 7) % 7 || 7,
        open: openings(s),
        cash: s.cash,
      };
    },
    [],
    3,
  );
  const openSheet = useUI((s) => s.openSheet);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const big = v.total > 40;
  return (
    <>
      <div className="page-title">
        <Icon id="nav_staff" size={40} />
        <h1>人材</h1>
      </div>
      <div className="tiles three">
        <div className="tile">
          <span className="label">社員</span>
          <span className="value num">{v.total.toLocaleString()}人</span>
        </div>
        <div className="tile">
          <span className="label">人件費</span>
          <span className="value num">{yenShort(v.payroll)}円</span>
          <span className="tiny muted">/月</span>
        </div>
        <div className="tile">
          <span className="label">待機</span>
          <span className={`value num ${v.idle.length ? 'warn' : ''}`}>{v.idle.length}人</span>
        </div>
      </div>
      <div className="row wrap small dim">
        {(Object.keys(DATA.balance.staff.roles) as RoleId[]).map((r) =>
          v.byRole[r] ? (
            <span key={r} className="pill">
              {DATA.balance.staff.roles[r].name} {v.byRole[r]}
            </span>
          ) : null,
        )}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          ['people', `社員 ${v.total}`],
          ['candidates', `応募者 ${v.candidates.length}`],
        ]}
      />
      {tab === 'people' && (
        <>
          <div className="row">
            <button className="btn grow" disabled={!v.idle.length} onClick={() => dispatch({ type: 'autoAssign' })} data-testid="auto-assign">
              自動で配置（待機{v.idle.length}人）
            </button>
          </div>
          {v.total === 0 && <div className="card empty">まだ社員がいません。応募者タブから採用しましょう。</div>}
          {v.heads.length > 0 && (
            <div className="card">
              <span className="small bold">部門長</span>
              {v.heads.map((p) => (
                <PersonRow key={p.id} p={p} note={p.leads} onClick={() => openSheet({ kind: 'employee', id: p.id })} />
              ))}
            </div>
          )}
          {v.idle.length > 0 && (
            <div className="card">
              <span className="small bold warn">待機中</span>
              {v.idle.map((p) => (
                <PersonRow key={p.id} p={p} onClick={() => openSheet({ kind: 'employee', id: p.id })} />
              ))}
            </div>
          )}
          {v.groups.map((g) => {
            const isOpen = open[g.name] ?? !big;
            return (
              <div className="card" key={g.name}>
                <button className="spread" style={{ width: '100%', border: 'none', background: 'none', padding: 0 }} onClick={() => setOpen({ ...open, [g.name]: !isOpen })} aria-expanded={isOpen}>
                  <span className="bold small">{g.name}</span>
                  <span className="small dim">
                    {g.people.length}人 {isOpen ? '▲' : '▼'}
                  </span>
                </button>
                {isOpen && g.people.map((p) => <PersonRow key={p.id} p={p} onClick={() => openSheet({ kind: 'employee', id: p.id })} />)}
              </div>
            );
          })}
        </>
      )}
      {tab === 'candidates' && (
        <>
          <p className="small dim">
            毎週月曜に{v.perWeek}人ほど応募が来ます（あと{v.nextMonday}日）。採用費 {yen(DATA.balance.staff.hireFee)}。
          </p>
          {!v.canHire && <div className="banner info">原木を市場で売ると採用できるようになります。</div>}
          {v.bulk && (
            <button className="btn soft block" onClick={() => dispatch({ type: 'bulkHire' })}>
              📣 採用キャンペーン：作業員{DATA.balance.staff.bulkHire.size}人（{yen(DATA.balance.staff.bulkHire.size * DATA.balance.staff.bulkHire.costPerHead)}）
            </button>
          )}
          <div className="row wrap small">
            <span className="dim">いまの空き：</span>
            <span className={`pill ${v.open.worker > 0 ? '' : 'muted'}`}>作業員 {Math.max(0, v.open.worker)}</span>
            <span className={`pill ${v.open.researcher > 0 ? '' : 'muted'}`}>研究員 {Math.max(0, v.open.researcher)}</span>
            {v.open.manager > 0 && <span className="pill">工場長 {v.open.manager}</span>}
          </div>
          {v.candidates.length === 0 && <div className="card empty">いまは応募者がいません</div>}
          {v.candidates.map((c) => (
            <div className="card" key={c.id} data-testid="candidate">
              <div className="row">
                <Icon id={ROLE_ICON[c.role]} size={48} />
                <div className="grow col" style={{ gap: 0 }}>
                  <span className="bold">{c.name}</span>
                  <span className="small dim">
                    {DATA.balance.staff.roles[c.role].name}・<span className="warn">{stars(c.skill)}</span>
                  </span>
                  <span className="tiny dim">
                    得意 {SPECIALTY_NAME[c.specialty]}・{yen(c.salary)}/月・あと{Math.max(0, c.left)}日
                  </span>
                  {v.open[c.role] <= 0 && (
                    <span className="tiny warn" data-testid="no-opening">
                      ⚠ {c.role === 'researcher' ? '研究所に空きがありません' : c.role === 'manager' ? '任せる施設がありません' : '空いている持ち場がありません'}。雇うと待機になり、給料だけかかります
                    </span>
                  )}
                </div>
                <button className={`btn small${v.open[c.role] <= 0 ? ' soft' : ''}`} disabled={!v.canHire || v.cash < DATA.balance.staff.hireFee} onClick={() => dispatch({ type: 'hire', candidateId: c.id })} data-testid={c.role === 'researcher' ? 'hire-researcher' : 'hire'}>
                  採用
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function PersonRow({ p, onClick, note }: { p: { id: number; name: string; role: RoleId; skill: number; specialty: string; salary: number }; onClick: () => void; note?: string }) {
  return (
    <button className="row" style={{ width: '100%', border: 'none', background: 'none', padding: '7px 0', textAlign: 'left' }} onClick={onClick}>
      <Icon id={ROLE_ICON[p.role]} size={34} />
      <div className="grow col" style={{ gap: 0 }}>
        <span className="small bold">{p.name}</span>
        <span className="tiny dim">
          {DATA.balance.staff.roles[p.role].name}・<span className="warn">{stars(p.skill)}</span>・{note ?? `得意 ${SPECIALTY_NAME[p.specialty as keyof typeof SPECIALTY_NAME]}`}
        </span>
      </div>
      <span className="tiny muted num">{yen(p.salary)}</span>
    </button>
  );
}
