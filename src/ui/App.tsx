import { useEffect, useRef, useState } from 'react';
import { DATA } from '../data';
import { dispatch, useGame, useGameStore } from '../store/game';
import { useUI, type Tab } from '../store/ui';
import { Icon, SheetFrame } from './components';
import { date, yen } from './format';
import { guideKeys, paintGuide } from './guide';
import { profitPerDay } from './selectors';
import { SheetHost } from './sheets';
import { Assets } from './screens/Assets';
import { Build } from './screens/Build';
import { Company } from './screens/Company';
import { Division } from './screens/Division';
import { Encyclopedia } from './screens/Encyclopedia';
import { FacilityDetail } from './screens/FacilityDetail';
import { Finance } from './screens/Finance';
import { Home, SidePanel } from './screens/Home';
import { ItemDetail } from './screens/ItemDetail';
import { Logistics } from './screens/Logistics';
import { Market, MarketItem } from './screens/Market';
import { More } from './screens/More';
import { NewGame } from './screens/NewGame';
import { Notices } from './screens/Notices';
import { Orders } from './screens/Orders';
import { Power } from './screens/Power';
import { Production } from './screens/Production';
import { Research } from './screens/Research';
import { Settings } from './screens/Settings';
import { Staff } from './screens/Staff';
import { World } from './screens/World';

export function App() {
  const booted = useGameStore((s) => s.booted);
  const runner = useGameStore((s) => s.runner);
  const bootError = useGameStore((s) => s.bootError);
  const starting = useGameStore((s) => s.starting);
  useEffect(() => {
    useGameStore.getState().boot();
  }, []);
  if (!booted)
    return starting ? (
      <div className="splash" aria-busy="true">
        <p className="small dim">会社を読み込んでいます…</p>
      </div>
    ) : null;
  if (!runner) return <NewGame error={bootError} />;
  return <Game />;
}

function useTheme() {
  const theme = useGame((s) => s.settings.theme, [], 2);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);
}

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** light up the next control to press while the first goals are open */
function useGuide() {
  const keys = useGame((s) => guideKeys(s), [], 2);
  const tab = useUI((s) => s.tab);
  const stack = useUI((s) => s.stack);
  const sheet = useUI((s) => s.sheet);
  const ref = useRef(keys);
  ref.current = keys;
  const active = stack.length === 0 ? tab : null;
  const sig = keys.join(',');
  useEffect(() => {
    if (!sig) {
      paintGuide([], null);
      return;
    }
    const paint = () => paintGuide(ref.current, active);
    // after React has drawn the screen, and again now and then as rows appear
    const raf = requestAnimationFrame(paint);
    const id = setInterval(paint, 700);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [sig, active, stack.length, sheet]);
}

function Game() {
  useTheme();
  useGuide();
  const wide = useWide();
  const tab = useUI((s) => s.tab);
  const stack = useUI((s) => s.stack);
  const top = stack[stack.length - 1];
  return (
    <div className={`app${wide ? ' wide' : ''}`}>
      {wide && <Nav />}
      <div className="shell">
        <Header canBack={stack.length > 0} />
        <main className="main" key={`${tab}:${stack.length}:${top ? JSON.stringify(top) : ''}`}>
          {top ? <RouteView /> : <TabView tab={tab} />}
        </main>
      </div>
      {wide ? (
        <aside className="side">
          <SidePanel />
        </aside>
      ) : (
        <Nav />
      )}
      <SheetHost />
      <OfflineReport />
      <Elsewhere />
      <Toasts />
    </div>
  );
}

function TabView({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'home':
      return <Home />;
    case 'production':
      return <Production />;
    case 'assets':
      return <Assets />;
    case 'market':
      return <Market />;
    case 'more':
      return <More />;
  }
}


function RouteView() {
  const stack = useUI((s) => s.stack);
  const r = stack[stack.length - 1];
  switch (r.screen) {
    case 'facility':
      return <FacilityDetail id={r.id} />;
    case 'build':
      return <Build focus={r.id} />;
    case 'item':
      return <ItemDetail id={r.id} />;
    case 'marketItem':
      return <MarketItem id={r.id} />;
    case 'staff':
      return <Staff />;
    case 'research':
      return <Research focus={r.id} />;
    case 'power':
      return <Power />;
    case 'logistics':
      return <Logistics />;
    case 'finance':
      return <Finance />;
    case 'company':
      return <Company />;
    case 'encyclopedia':
      return <Encyclopedia />;
    case 'settings':
      return <Settings />;
    case 'notices':
      return <Notices />;
    case 'world':
      return <World />;
    case 'orders':
      return <Orders />;
    case 'division':
      return <Division type={r.id} />;
  }
}

function Header({ canBack }: { canBack: boolean }) {
  const h = useGame((s) => ({
    company: s.companyName,
    day: s.tick / DATA.balance.time.ticksPerDay,
    cash: s.cash,
    profit: profitPerDay(s),
    speed: s.speed,
    paused: s.paused,
    canSpeed: !!s.features.speed,
    unread: s.notices.filter((n) => !n.read && n.level !== 'info').length,
  }));
  const goBack = useUI((s) => s.goBack);
  const push = useUI((s) => s.push);
  return (
    <header className="header">
      <div className="header-top">
        {canBack && (
          <button className="back-btn" aria-label="戻る" onClick={goBack}>
            ‹
          </button>
        )}
        <span className="company ellipsis grow">{h.company}</span>
        <span className="header-date num">{date(h.day)}</span>
        <button className="icon-btn" aria-label={`通知 ${h.unread}件`} onClick={() => push({ screen: 'notices' })}>
          <Icon id="ui_bell" size={26} alt="" />
          {h.unread > 0 && <span className="badge">{h.unread > 99 ? '99+' : h.unread}</span>}
        </button>
      </div>
      <div className="header-bottom">
        <div className="col" style={{ gap: 0 }}>
          <span className={`cash num${yen(h.cash).length > 12 ? ' longer' : yen(h.cash).length > 8 ? ' long' : ''}`} data-testid="cash">
            {yen(h.cash)}
          </span>
          <span className={`profit num ${h.profit >= 0 ? 'good' : 'bad'}`}>
            {h.profit >= 0 ? '📈' : '📉'} {yen(h.profit, { sign: true })}/日
          </span>
        </div>
        <SpeedControl speed={h.speed} paused={h.paused} canSpeed={h.canSpeed} />
      </div>
    </header>
  );
}

function SpeedControl({ speed, paused, canSpeed }: { speed: number; paused: boolean; canSpeed: boolean }) {
  const speeds = DATA.balance.time.speeds.filter((x) => x > 0);
  return (
    <div className="speed" role="group" aria-label="時間の速さ">
      <button
        className={`pause${paused ? ' on' : ''}`}
        aria-label={paused ? '再開' : '一時停止'}
        onClick={() => dispatch(paused ? { type: 'resumeFromAutoPause' } : { type: 'setSpeed', speed: 0 })}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          {paused ? <path d="M3.5 1.8v10.4a.8.8 0 0 0 1.2.7l8-5.2a.8.8 0 0 0 0-1.4l-8-5.2a.8.8 0 0 0-1.2.7z" fill="currentColor" /> : <path d="M3 1.5h2.6v11H3zM8.4 1.5H11v11H8.4z" fill="currentColor" />}
        </svg>
      </button>
      {speeds.map((x) => (
        <button key={x} className={!paused && speed === x ? 'on' : ''} disabled={x > 1 && !canSpeed} onClick={() => dispatch({ type: 'setSpeed', speed: x })} aria-label={`${x}倍速`}>
          ×{x}
        </button>
      ))}
    </div>
  );
}

const NAV: { tab: Tab; label: string; icon: string | null }[] = [
  { tab: 'home', label: 'ホーム', icon: 'nav_home' },
  { tab: 'production', label: '生産', icon: 'nav_production' },
  { tab: 'assets', label: '資産', icon: 'nav_assets' },
  { tab: 'market', label: '市場', icon: 'nav_market' },
  { tab: 'more', label: 'その他', icon: null },
];

function Nav() {
  const tab = useUI((s) => s.tab);
  const stack = useUI((s) => s.stack);
  const setTab = useUI((s) => s.setTab);
  const flags = useGame((s) => ({ red: s.problems.some((p) => p.level === 'red'), market: !!s.features.market }), [], 2);
  return (
    <nav className="nav" aria-label="メインメニュー">
      <div className="nav-inner">
        {NAV.map((n) => (
          <button
            key={n.tab}
            className={tab === n.tab && stack.length === 0 ? 'on' : ''}
            onClick={() => setTab(n.tab)}
            aria-current={tab === n.tab ? 'page' : undefined}
            data-testid={`nav-${n.tab}`}
          >
            {n.icon ? <img src={`${import.meta.env.BASE_URL}assets/icons/sm/${n.icon}.webp`} alt="" /> : <MoreGlyph />}
            <span>{n.label}</span>
            {n.tab === 'home' && flags.red && <span className="dot" aria-label="要対応" />}
          </button>
        ))}
      </div>
    </nav>
  );
}

function MoreGlyph() {
  return (
    <span className="more-glyph" aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function OfflineReport() {
  const report = useGameStore((s) => s.report);
  const dismiss = useGameStore((s) => s.dismissReport);
  if (!report) return null;
  return (
    <SheetFrame onClose={dismiss} label="留守中の報告">
      <div className="col" style={{ gap: 12 }}>
        <div className="row">
          <Icon id="auto_robot" size={52} />
          <div>
            <h2>おかえりなさい</h2>
            <p className="dim small">留守中の{Math.floor(report.days)}日間も、会社は動いていました。</p>
          </div>
        </div>
        <div className="kv">
          <span>資金の増減</span>
          <span className={report.cashDelta >= 0 ? 'good bold' : 'bad bold'}>{yen(report.cashDelta, { sign: true })}</span>
          <span>自動化率</span>
          <span>{Math.round(report.automation * 100)}%</span>
        </div>
        {report.produced.length > 0 && (
          <div className="list" style={{ gap: 4 }}>
            <span className="small dim bold">主な生産</span>
            {report.produced.map((p) => (
              <div key={p.item} className="row small">
                <Icon id={p.item} size={24} />
                <span className="grow">{DATA.item[p.item].name}</span>
                <span className="num">
                  +{Math.round(p.qty).toLocaleString()}
                  {DATA.item[p.item].unit}
                </span>
              </div>
            ))}
          </div>
        )}
        {report.stoppedBy && <div className="banner bad">🛑 「{report.stoppedBy}」が起きたので時間を止めました</div>}
        <button className="btn block" onClick={dismiss}>
          続ける
        </button>
      </div>
    </SheetFrame>
  );
}


/** the same game was opened (or deleted) in another tab: this one has stopped so neither overwrites the other */
function Elsewhere() {
  const why = useGameStore((s) => s.elsewhere);
  if (!why) return null;
  return (
    <div className="scrim" style={{ alignItems: 'center' }}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-label="別のタブで開かれています" style={{ margin: 16, borderRadius: 'var(--radius)' }}>
        <div className="col" style={{ gap: 12 }}>
          <h2>{why === 'saved' ? '別のタブで遊んでいます' : '別のタブで会社が消されました'}</h2>
          <p className="small dim">
            {why === 'saved'
              ? 'このゲームが別のタブ（またはウィンドウ）で進んでいます。セーブを上書きしないよう、ここでは時間を止めました。'
              : '別のタブで会社を消したため、ここでは止めました。'}
          </p>
          <button className="btn block" onClick={() => useGameStore.getState().takeOver()} data-testid="take-over">
            {why === 'saved' ? 'こちらで続ける' : '最初の画面へ'}
          </button>
          <p className="tiny muted">「こちらで続ける」を押すと、最新のセーブを読み込み、もう一方のタブが止まります。</p>
        </div>
      </div>
    </div>
  );
}
