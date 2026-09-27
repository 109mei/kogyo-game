import { useGame } from '../../store/game';
import { useUI, type Route } from '../../store/ui';

const ITEMS: { route: Route; label: string; icon: string; sub?: (v: Summary) => string }[] = [
  { route: { screen: 'staff' }, label: '人材', icon: 'nav_staff', sub: (v) => `${v.employees}人・応募${v.candidates}` },
  { route: { screen: 'research' }, label: '研究', icon: 'nav_research', sub: (v) => (v.research ? '研究中' : v.canResearch ? '未設定' : '研究所なし') },
  { route: { screen: 'logistics' }, label: '物流', icon: 'nav_logistics', sub: (v) => `${v.logistics}%` },
  { route: { screen: 'power' }, label: '電力', icon: 'nav_power', sub: (v) => v.power },
  { route: { screen: 'finance' }, label: '財務', icon: 'nav_finance' },
  { route: { screen: 'company' }, label: '会社', icon: 'nav_company' },
  { route: { screen: 'world' }, label: '世界', icon: 'ui_world' },
  { route: { screen: 'encyclopedia' }, label: '図鑑', icon: 'ui_book' },
  { route: { screen: 'notices' }, label: '通知', icon: 'ui_bell', sub: (v) => (v.unread ? `未読${v.unread}` : '') },
  { route: { screen: 'settings' }, label: '設定', icon: 'ui_settings' },
];

interface Summary {
  employees: number;
  candidates: number;
  research: boolean;
  canResearch: boolean;
  logistics: number;
  power: string;
  unread: number;
}

export function More() {
  const v = useGame(
    (s): Summary => ({
      employees: s.employees.length,
      candidates: s.candidates.length,
      research: !!s.research.current,
      canResearch: s.facilities.some((f) => f.type === 'research_lab'),
      logistics: s.logistics.capacity > 0 ? Math.round((s.logistics.load / s.logistics.capacity) * 100) : 0,
      power: s.power.supply > 0 ? `${Math.round((s.power.demand / s.power.supply) * 100)}%` : '契約なし',
      unread: s.notices.filter((n) => !n.read && n.level !== 'info').length,
    }),
    [],
    2,
  );
  const push = useUI((s) => s.push);
  return (
    <>
      <div className="page-title">
        <h1>その他</h1>
      </div>
      <div className="menu">
        {ITEMS.map((i) => (
          <button key={i.label} onClick={() => push(i.route)} data-testid={`menu-${i.route.screen}`}>
            <img src={`${import.meta.env.BASE_URL}assets/icons/sm/${i.icon}.webp`} alt="" className="icon" />
            {i.label}
            {i.sub && <span className="sub">{i.sub(v)}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
