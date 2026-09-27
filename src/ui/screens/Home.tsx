import { DATA, type Goal } from '../../data';
import type { GameState, Link } from '../../core';
import { dayIndex } from '../../core/calendar';
import { eventText } from '../../core/events';
import { companyValue } from '../../core/finance';
import { dispatch, useGame } from '../../store/game';
import { openLink, useUI } from '../../store/ui';
import { WorldSlot } from '../world/WorldSlot';
import { Bar, Dot, Icon, Section } from '../components';
import { date, yen } from '../format';
import { kpis, statusTiles } from '../selectors';

const GOAL_LINK: Record<string, Link> = {
  g_gather: { screen: 'production' },
  g_sell: { screen: 'market', id: 'log' },
  g_hire: { screen: 'staff' },
  g_team: { screen: 'staff' },
  g_sawmill: { screen: 'build', id: 'sawmill' },
  g_furniture: { screen: 'build', id: 'assembly_plant' },
  g_lab: { screen: 'build', id: 'research_lab' },
  g_mech: { screen: 'research', id: 'p_mech' },
  g_machine: { screen: 'production' },
  g_power: { screen: 'power' },
  g_steel: { screen: 'research', id: 'm_steel' },
  g_auto: { screen: 'research', id: 'a_auto' },
  g_rules: { screen: 'production' },
  g_motor: { screen: 'research', id: 'el_motor' },
  g_fan: { screen: 'build', id: 'assembly_plant' },
  g_semi: { screen: 'research', id: 'e_semi' },
  g_phone: { screen: 'research', id: 'e_mobile' },
  g_ebike: { screen: 'research', id: 'v_ebike' },
  g_truck: { screen: 'research', id: 'v_truck' },
  g_value: { screen: 'company' },
};

function goalProgress(s: GameState, g: Goal): number | null {
  const c = g.condition;
  switch (c.type) {
    case 'taps':
      return Math.min(1, s.owner.taps / c.count);
    case 'employees':
      return Math.min(1, (c.assigned ? s.employees.filter((e) => e.assignedTo !== null).length : s.employees.length) / c.count);
    case 'produced':
      return Math.min(1, (s.totals.produced[c.item] ?? 0) / c.amount);
    case 'value':
      return Math.min(1, Math.max(0, companyValue(s)) / c.amount);
    case 'researchers':
      return Math.min(1, s.employees.filter((e) => e.role === 'researcher' && e.assignedTo !== null).length / c.count);
    case 'tech':
      return s.research.current === c.tech ? s.research.progress / DATA.tech[c.tech].cost : null;
    default:
      return null;
  }
}

/** events waiting for a decision, and the temporary conditions they left */
function Events() {
  const v = useGame(
    (s) => {
      const today = dayIndex(s.tick);
      return {
        cash: s.cash,
        events: s.events.pending.map((e) => {
          const def = DATA.event[e.kind];
          return {
            id: e.id,
            icon: def.icon,
            title: eventText(s, e, def.title),
            body: eventText(s, e, def.body),
            left: e.until - today,
            choices: def.choices.map((c, i) => ({
              id: c.id,
              label: c.label,
              detail: eventText(s, e, c.detail, c.id),
              cost: e.costs[c.id] ?? 0,
              first: i === 0,
            })),
          };
        }),
        effects: s.effects.filter((x) => x.until > s.tick).map((x) => ({ label: x.label, left: (x.until - s.tick) / DATA.balance.time.ticksPerDay })),
      };
    },
    [],
    4,
  );
  if (!v.events.length && !v.effects.length) return null;
  return (
    <>
      {v.effects.map((x) => (
        <div key={x.label} className="banner warn small" data-testid="effect">
          <span className="grow">{x.label}</span>
          <span className="num tiny">あと{x.left < 1 ? `${Math.max(1, Math.round(x.left * 24))}時間` : `${Math.ceil(x.left)}日`}</span>
        </div>
      ))}
      {v.events.map((e) => (
        <div key={e.id} className="card event-card" role="group" aria-label={e.title} data-testid="event">
          <div className="row">
            <Icon id={e.icon} size={48} />
            <div className="grow col" style={{ gap: 2 }}>
              <span className="tiny bold warn">出来事・{e.left > 0 ? `あと${e.left}日で決める` : '今日中に決める'}</span>
              <span className="bold">{e.title}</span>
            </div>
          </div>
          <p className="small dim" style={{ marginTop: 6 }}>
            {e.body}
          </p>
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            {e.choices.map((c) => (
              <button
                key={c.id}
                className={`btn block choice${c.first ? ' soft' : ''}`}
                disabled={c.cost > v.cash}
                onClick={() => dispatch({ type: 'chooseEvent', eventId: e.id, choice: c.id })}
                data-testid={`choice-${c.id}`}
              >
                <span className="col" style={{ gap: 1, alignItems: 'flex-start', textAlign: 'left' }}>
                  <span>{c.label}</span>
                  <span className="tiny" style={{ opacity: 0.85, fontWeight: 500 }}>
                    {c.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            決めないと「{e.choices[0].label}」になります。
          </p>
        </div>
      ))}
    </>
  );
}

/** offers waiting for an answer and orders in progress */
function OrdersCard() {
  const v = useGame(
    (s) => {
      const today = dayIndex(s.tick);
      const active = s.orders.list.filter((o) => o.status === 'active');
      return {
        on: !!s.features.orders,
        offers: s.orders.list.filter((o) => o.status === 'offer').length,
        active: active.length,
        soonest: active.length ? Math.min(...active.map((o) => o.until - today)) : null,
        progress: active.length ? active.reduce((t, o) => t + o.delivered / o.qty, 0) / active.length : 0,
      };
    },
    [],
    2,
  );
  const push = useUI((s) => s.push);
  if (!v.on || (!v.offers && !v.active)) return null;
  return (
    <button className="card tap row" style={{ border: 'none', textAlign: 'left' }} onClick={() => push({ screen: 'orders' })} data-testid="orders-card">
      <Icon id="misc_delivery" size={44} />
      <div className="grow col" style={{ gap: 2 }}>
        <span className="bold">
          {v.offers > 0 && `新しい引き合い ${v.offers}件`}
          {v.offers > 0 && v.active > 0 && '・'}
          {v.active > 0 && `受注中 ${v.active}件`}
        </span>
        {v.active > 0 ? (
          <>
            <Bar value={v.progress} label="納品の進み具合" />
            <span className="tiny dim">いちばん近い納期まで {v.soonest}日</span>
          </>
        ) : (
          <span className="tiny dim">相場より高く買ってくれます。受けるか決めてください</span>
        )}
      </div>
      <span className="small dim">›</span>
    </button>
  );
}

export function Home() {
  const v = useGame((s) => ({
    paused: s.paused,
    pauseReason: s.pauseReason,
    goal: DATA.goals.find((g) => !s.goals.done.includes(g.id)) ?? null,
    progress: (() => {
      const g = DATA.goals.find((x) => !s.goals.done.includes(x.id));
      return g ? goalProgress(s, g) : null;
    })(),
    tiles: statusTiles(s),
    problems: s.problems,
    k: kpis(s),
    notices: s.notices.slice(-3).reverse(),
    day: s.tick / DATA.balance.time.ticksPerDay,
  }));
  const push = useUI((s) => s.push);
  const openSheet = useUI((s) => s.openSheet);
  return (
    <>
      {v.paused && v.pauseReason && (
        <div className="banner bad" role="alert">
          <span className="grow">🛑 「{v.pauseReason}」のため時間を止めました</span>
          <button className="btn small danger" onClick={() => dispatch({ type: 'resumeFromAutoPause' })}>
            再開
          </button>
        </div>
      )}

      <Events />

      {v.goal && (
        <button className="card goal tap" style={{ border: 'none', textAlign: 'left' }} onClick={() => openLink(GOAL_LINK[v.goal!.id])} data-testid="goal">
          <Icon id="auto_target" size={44} />
          <div className="col" style={{ gap: 3 }}>
            <span className="tiny bold spread" style={{ color: 'var(--accent-text)' }}>
              <span>次の目標</span>
              {v.goal.reward > 0 && <span className="pill reward">達成で補助金 {yen(v.goal.reward)}</span>}
            </span>
            <span className="bold">{v.goal.title}</span>
            <span className="small dim">{v.goal.hint}</span>
            {v.progress !== null && <Bar value={v.progress} label="目標の進み具合" />}
          </div>
        </button>
      )}

      <OrdersCard />

      <WorldSlot />

      <Section title="会社状況">
        <div className="tiles">
          {v.tiles.map((t) => (
            <button key={t.key} className="tile" onClick={() => (t.link === 'production' ? useUI.getState().setTab('production') : t.link === 'assets' ? useUI.getState().setTab('assets') : push({ screen: t.link }))}>
              <span className="label">
                <Dot tone={t.tone} />
                {t.label}
              </span>
              <span className="value num">{t.value}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={v.problems.length ? `要対応（${v.problems.length}）` : '要対応'}>
        {v.problems.length === 0 && <div className="card empty">いまのところ問題はありません 👍</div>}
        {v.problems.slice(0, 6).map((p) => (
          <div key={p.key} className={`card alert-${p.level}`} data-testid="problem">
            <div className="problem-head">
              <Icon id={p.icon} size={44} />
              <div className="col" style={{ gap: 0 }}>
                <span className="problem-title">
                  {p.level === 'red' ? '🔴' : '🟡'} {p.title}
                </span>
                <span className="small dim">{p.detail}</span>
              </div>
              <button className="btn small" onClick={() => openSheet({ kind: 'solutions', title: p.title, detail: p.detail, icon: p.icon, solutions: p.solutions })}>
                対処する
              </button>
            </div>
            {p.impact.length > 0 && (
              <div className="impacts">
                {p.impact.map((i) => (
                  <span key={i}>{i}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {v.problems.length > 6 && <p className="small muted center">ほか{v.problems.length - 6}件</p>}
      </Section>

      <Section title="会社の規模">
        <div className="tiles">
          <div className="tile">
            <span className="label">企業価値</span>
            <span className="value num">{yen(v.k.value)}</span>
          </div>
          <div className="tile">
            <span className="label">自動化率</span>
            <span className="value num">{Math.round(v.k.automation * 100)}%</span>
            <Bar value={v.k.automation} tone="good" />
          </div>
          <button className="tile" onClick={() => push({ screen: 'staff' })}>
            <span className="label">社員</span>
            <span className="value num">{v.k.employees.toLocaleString()}人</span>
          </button>
          <button className="tile" onClick={() => useUI.getState().setTab('production')}>
            <span className="label">施設</span>
            <span className="value num">{v.k.facilities.toLocaleString()}</span>
          </button>
        </div>
      </Section>

      <Section
        title="最近の出来事"
        action={
          <button className="link" onClick={() => push({ screen: 'notices' })}>
            すべて
          </button>
        }
      >
        <div className="card tight">
          {v.notices.length === 0 && <p className="empty small">まだ何も起きていません</p>}
          {v.notices.map((n) => (
            <button key={n.id} className="row" style={{ width: '100%', border: 'none', background: 'none', padding: '6px 0', textAlign: 'left' }} onClick={() => openLink(n.link)}>
              <Icon id={n.icon} size={30} />
              <div className="grow col" style={{ gap: 0 }}>
                <span className="small bold">{n.title}</span>
                <span className="tiny muted">{date(n.day, false)}</span>
              </div>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

/** right-hand column on wide screens: problems and notices at a glance */
export function SidePanel() {
  const v = useGame((s) => ({ problems: s.problems, notices: s.notices.slice(-12).reverse() }), [], 4);
  const openSheet = useUI((s) => s.openSheet);
  return (
    <>
      <div className="section-title">要対応</div>
      {v.problems.length === 0 && <div className="card empty small">問題はありません</div>}
      {v.problems.slice(0, 8).map((p) => (
        <button key={p.key} className={`card tight tap alert-${p.level} row`} style={{ border: 'none', textAlign: 'left' }} onClick={() => openSheet({ kind: 'solutions', title: p.title, detail: p.detail, icon: p.icon, solutions: p.solutions })}>
          <Icon id={p.icon} size={30} />
          <div className="grow col" style={{ gap: 0 }}>
            <span className="small bold">{p.title}</span>
            <span className="tiny dim">{p.detail}</span>
          </div>
        </button>
      ))}
      <div className="section-title">通知</div>
      <div className="card tight">
        {v.notices.map((n) => (
          <button key={n.id} className="row" style={{ width: '100%', border: 'none', background: 'none', padding: '5px 0', textAlign: 'left' }} onClick={() => openLink(n.link)}>
            <Icon id={n.icon} size={26} />
            <span className="grow small">{n.title}</span>
          </button>
        ))}
      </div>
    </>
  );
}
