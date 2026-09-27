import { useState } from 'react';
import { DATA } from '../data';
import type { Solution } from '../core';
import { defOf, facilityById } from '../core/facilities';
import { SPECIALTY_NAME, employeesAt, rolesFor, staffCapacity } from '../core/staff';
import { hasFeature, unlocked } from '../core/util';
import { recipeUnlocked } from '../core/visibility';
import { dispatch, useGame } from '../store/game';
import { openLink, useUI, type Sheet } from '../store/ui';
import { Icon, SheetFrame } from './components';
import { days, stars, yen } from './format';

export function SheetHost() {
  const sheet = useUI((s) => s.sheet);
  const close = useUI((s) => s.closeSheet);
  if (!sheet) return null;
  return (
    <SheetFrame onClose={close} label={sheetLabel(sheet)}>
      <SheetBody sheet={sheet} close={close} />
    </SheetFrame>
  );
}

function sheetLabel(s: Sheet): string {
  switch (s.kind) {
    case 'solutions':
      return `${s.title}への対処`;
    case 'employee':
      return '社員';
    case 'assign':
      return '人を配置';
    case 'build':
      return '建設';
    case 'goal':
      return '次の目標';
    case 'confirm':
      return s.title;
  }
}

function SheetBody({ sheet, close }: { sheet: Sheet; close: () => void }) {
  switch (sheet.kind) {
    case 'solutions':
      return <Solutions sheet={sheet} close={close} />;
    case 'employee':
      return <EmployeeSheet id={sheet.id} close={close} />;
    case 'assign':
      return <AssignSheet facilityId={sheet.facilityId} close={close} />;
    case 'build':
      return <BuildSheet facility={sheet.facility} close={close} />;
    case 'goal':
      return <GoalSheet close={close} />;
    case 'confirm':
      return (
        <div className="col" style={{ gap: 12 }}>
          <h2>{sheet.title}</h2>
          <p className="dim">{sheet.body}</p>
          <div className="row">
            <button className="btn ghost grow" onClick={close}>
              やめる
            </button>
            <button
              className="btn danger grow"
              onClick={() => {
                close();
                sheet.onOk();
              }}
            >
              {sheet.ok}
            </button>
          </div>
        </div>
      );
  }
}

function Solutions({ sheet, close }: { sheet: Extract<Sheet, { kind: 'solutions' }>; close: () => void }) {
  const act = (sol: Solution) => {
    if (sol.command) {
      const r = dispatch(sol.command);
      if (r.ok) close();
    } else if (sol.link) {
      close();
      openLink(sol.link);
    }
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row">
        <Icon id={sheet.icon} size={44} />
        <div className="grow">
          <h2>{sheet.title}</h2>
          <p className="small dim">{sheet.detail}</p>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>
        解決の方法はひとつではありません。状況に合わせて選んでください。
      </p>
      <div>
        {sheet.solutions.map((sol) => (
          <div className="solution" key={sol.kind + sol.label}>
            <Icon id={sol.icon} size={36} />
            <div className="col" style={{ gap: 0 }}>
              <span className="bold">{sol.label}</span>
              <span className="small dim">{sol.disabled ?? sol.detail}</span>
            </div>
            <button className={`btn small${sol.command ? '' : ' soft'}`} disabled={!!sol.disabled} onClick={() => act(sol)}>
              {sol.command ? '実行' : '開く'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeSheet({ id, close }: { id: number; close: () => void }) {
  const v = useGame(
    (s) => {
      const e = s.employees.find((x) => x.id === id);
      if (!e) return null;
      const f = e.assignedTo !== null ? facilityById(s, e.assignedTo) : null;
      return { e: { ...e }, facility: f ? f.name : null, managers: hasFeature(s, 'managers') };
    },
    [id],
    4,
  );
  const openSheet = useUI((s) => s.openSheet);
  if (!v) return <p className="empty">この社員はもういません</p>;
  const e = v.e;
  const role = DATA.balance.staff.roles[e.role];
  const icon = e.role === 'researcher' ? 'ppl_researcher' : e.role === 'manager' ? 'ppl_foreman' : e.role === 'engineer' ? 'ppl_engineer' : 'ppl_worker';
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <Icon id={icon} size={56} />
        <div className="grow">
          <h2>{e.name}</h2>
          <p className="small dim">
            {role.name}・熟練度 <span className="warn">{stars(e.skill)}</span>
          </p>
        </div>
      </div>
      <div className="kv">
        <span>得意</span>
        <span>{SPECIALTY_NAME[e.specialty]} +12%</span>
        <span>給与</span>
        <span>{yen(e.salary)}/月</span>
        <span>現在</span>
        <span>{v.facility ?? '待機中'}</span>
        <span>次の★まで</span>
        <span>{e.skill >= 5 ? '最高' : days(DATA.balance.staff.expDaysPerStar * e.skill - e.exp)}</span>
      </div>
      <div className="col" style={{ gap: 8 }}>
        {e.role !== 'manager' && (
          <button className="btn block" onClick={() => openSheet({ kind: 'assign', facilityId: -e.id })}>
            配置を変える
          </button>
        )}
        {e.role === 'worker' && e.skill >= 3 && (
          <button className="btn soft block" onClick={() => dispatch({ type: 'promote', employeeId: e.id, role: 'engineer' }).ok && close()}>
            技術者に昇進（操作の効率 +10%）
          </button>
        )}
        {(e.role === 'worker' || e.role === 'engineer') && e.skill >= 4 && v.managers && (
          <button className="btn soft block" onClick={() => dispatch({ type: 'promote', employeeId: e.id, role: 'manager' }).ok && close()}>
            工場長に昇進
          </button>
        )}
        {e.assignedTo !== null && (
          <button className="btn ghost block" onClick={() => dispatch({ type: 'assign', employeeId: e.id, facilityId: null }).ok && close()}>
            配置から外す
          </button>
        )}
        <button
          className="btn danger block"
          onClick={() =>
            openSheet({
              kind: 'confirm',
              title: `${e.name}さんを解雇しますか`,
              body: `退職金として${yen(e.salary * DATA.balance.staff.severanceMonths)}を払います。`,
              ok: '解雇する',
              onOk: () => dispatch({ type: 'fire', employeeId: e.id }),
            })
          }
        >
          解雇する
        </button>
      </div>
    </div>
  );
}

/**
 * facilityId > 0: choose people for that facility.
 * facilityId < 0: choose a facility for employee -facilityId.
 */
function AssignSheet({ facilityId, close }: { facilityId: number; close: () => void }) {
  const [onlyIdle, setOnlyIdle] = useState(true);
  const v = useGame(
    (s) => {
      if (facilityId < 0) {
        const e = s.employees.find((x) => x.id === -facilityId);
        if (!e) return null;
        const places = s.facilities
          .filter((f) => rolesFor(f).includes(e.role) && !(f.building && f.building.kind === 'build'))
          .map((f) => ({ id: f.id, type: f.type, name: f.name, have: employeesAt(s, f.id).length, cap: staffCapacity(s, f), here: e.assignedTo === f.id }))
          .filter((p) => p.cap > 0);
        return { mode: 'employee' as const, name: e.name, places };
      }
      const f = facilityById(s, facilityId);
      if (!f) return null;
      const roles = rolesFor(f);
      const people = s.employees
        .filter((e) => roles.includes(e.role) && e.assignedTo !== f.id)
        .map((e) => ({ id: e.id, name: e.name, role: e.role, skill: e.skill, specialty: e.specialty, idle: e.assignedTo === null, where: e.assignedTo !== null ? (facilityById(s, e.assignedTo)?.name ?? '') : '' }))
        .sort((a, b) => Number(b.idle) - Number(a.idle) || Number(b.specialty === defOf(f).category) - Number(a.specialty === defOf(f).category) || b.skill - a.skill);
      return { mode: 'facility' as const, name: f.name, have: employeesAt(s, f.id).length, cap: staffCapacity(s, f), people, category: defOf(f).category };
    },
    [facilityId],
    4,
  );
  if (!v) return <p className="empty">見つかりません</p>;
  if (v.mode === 'employee') {
    return (
      <div className="col" style={{ gap: 8 }}>
        <h2>{v.name}さんの配置先</h2>
        {v.places.length === 0 && <p className="empty">空きのある施設がありません</p>}
        {v.places.map((p) => (
          <button
            key={p.id}
            className="card tight tap row"
            style={{ border: 'none', textAlign: 'left' }}
            disabled={p.here || p.have >= p.cap}
            onClick={() => dispatch({ type: 'assign', employeeId: -facilityId, facilityId: p.id }).ok && close()}
          >
            <Icon id={p.type} size={40} />
            <span className="grow bold">{p.name}</span>
            <span className="small dim num">
              {p.here ? '配置中' : `${p.have}/${p.cap}人`}
            </span>
          </button>
        ))}
      </div>
    );
  }
  const list = onlyIdle ? v.people.filter((p) => p.idle) : v.people;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="spread">
        <h2>{v.name}</h2>
        <span className="small dim num">
          {v.have}/{v.cap}人
        </span>
      </div>
      <div className="row small">
        <button className={`chip${onlyIdle ? ' on' : ''}`} onClick={() => setOnlyIdle(true)}>
          待機中
        </button>
        <button className={`chip${!onlyIdle ? ' on' : ''}`} onClick={() => setOnlyIdle(false)}>
          全員
        </button>
      </div>
      {list.length === 0 && <p className="empty">{onlyIdle ? '待機中の人がいません。人材画面で採用しましょう' : '配置できる人がいません'}</p>}
      {list.slice(0, 60).map((p) => (
        <button
          key={p.id}
          className="card tight tap row"
          style={{ border: 'none', textAlign: 'left' }}
          disabled={v.have >= v.cap}
          onClick={() => dispatch({ type: 'assign', employeeId: p.id, facilityId }).ok && v.have + 1 >= v.cap && close()}
        >
          <Icon id={p.role === 'researcher' ? 'ppl_researcher' : p.role === 'engineer' ? 'ppl_engineer' : 'ppl_worker'} size={36} />
          <div className="grow col" style={{ gap: 0 }}>
            <span className="bold">{p.name}</span>
            <span className="tiny dim">
              <span className="warn">{stars(p.skill)}</span> 得意 {SPECIALTY_NAME[p.specialty]}
              {p.specialty === v.category ? '（一致 +12%）' : ''}
              {!p.idle && ` ・${p.where}`}
            </span>
          </div>
          <span className="btn small soft">配置</span>
        </button>
      ))}
    </div>
  );
}

function BuildSheet({ facility, close }: { facility: string; close: () => void }) {
  const def = DATA.facility[facility];
  const v = useGame((s) => ({
    cash: s.cash,
    recipes: def.recipes.map((r) => ({ id: r, ok: recipeUnlocked(s, r) })),
    unlocked: unlocked(s, def.unlock),
    canBuild: !!s.features.build,
  }));
  const first = v.recipes.find((r) => r.ok)?.id;
  const [recipe, setRecipe] = useState<string | undefined>(first);
  const push = useUI((s) => s.push);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <Icon id={def.id} size={96} />
        <div className="grow">
          <h2>{def.name}</h2>
          <p className="small dim">{def.desc}</p>
        </div>
      </div>
      <div className="kv">
        <span>建設費</span>
        <span className={v.cash < def.buildCost ? 'bad' : ''}>{yen(def.buildCost)}</span>
        <span>工期</span>
        <span>{def.buildDays}日</span>
        <span>維持費</span>
        <span>{yen(def.upkeep)}/日</span>
        {def.manualWorkers && (
          <>
            <span>手作業</span>
            <span>{def.manualWorkers}人/Lv</span>
          </>
        )}
        {def.machine && (
          <>
            <span>機械</span>
            <span>
              {def.machinesPerLevel}台/Lv・{yen(def.machine.cost)}/台
            </span>
          </>
        )}
      </div>
      {v.recipes.length > 1 && (
        <div className="col" style={{ gap: 6 }}>
          <span className="small bold dim">作る物</span>
          <div className="chips">
            {v.recipes.map((r) => (
              <button key={r.id} className={`chip${recipe === r.id ? ' on' : ''}`} disabled={!r.ok} onClick={() => setRecipe(r.id)}>
                {DATA.item[r.id].name}
                {!r.ok && ' 🔒'}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        className="btn block"
        disabled={!v.unlocked || !v.canBuild || v.cash < def.buildCost}
        onClick={() => {
          const r = dispatch({ type: 'build', facility: def.id, recipe });
          if (r.ok) {
            close();
            useUI.getState().setTab('production');
          }
        }}
      >
        {v.cash < def.buildCost ? '資金が足りません' : `${yen(def.buildCost)}で建設する`}
      </button>
      <button className="link" onClick={() => push({ screen: 'item', id: recipe ?? def.recipes[0] ?? 'log' })} disabled={!def.recipes.length}>
        {def.recipes.length ? `${DATA.item[recipe ?? def.recipes[0]].name}の作り方を見る` : ''}
      </button>
    </div>
  );
}

function GoalSheet({ close }: { close: () => void }) {
  const done = useGame((s) => [...s.goals.done], [], 2);
  return (
    <div className="col" style={{ gap: 8 }}>
      <h2>目標</h2>
      <p className="small dim">順番どおりでなくても達成できます。迷ったら上から。</p>
      {DATA.goals.map((g) => {
        const ok = done.includes(g.id);
        return (
          <div key={g.id} className="row" style={{ opacity: ok ? 0.55 : 1 }}>
            <span style={{ width: 22 }}>{ok ? '✅' : '⬜'}</span>
            <div className="grow col" style={{ gap: 0 }}>
              <span className="bold small">{g.title}</span>
              {!ok && <span className="tiny dim">{g.hint}</span>}
            </div>
          </div>
        );
      })}
      <button className="btn ghost block" onClick={close}>
        閉じる
      </button>
    </div>
  );
}
