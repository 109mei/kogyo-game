import { DATA } from '../../data';
import { costPerTon } from '../../core/logistics';
import { buyQuote } from '../../core/market';
import { hasFeature, unlocked } from '../../core/util';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Bar, Icon, Switch } from '../components';
import { yen } from '../format';

export function Logistics() {
  const v = useGame(
    (s) => {
      const l = s.logistics;
      const own = Math.floor(s.inventory.small_truck ?? 0);
      return {
        l: { ...l },
        own,
        price1: own > 0 ? 0 : buyQuote(s, 'small_truck', 1).total,
        perTon: costPerTon(s),
        centers: s.facilities.filter((f) => f.type === 'logistics_center').map((f) => ({ id: f.id, name: f.name, level: f.level })),
        centerOpen: unlocked(s, 'l_center'),
        rail: hasFeature(s, 'rail'),
        hqCap: DATA.balance.hq[s.hq.level - 1].logistics,
      };
    },
    [],
    3,
  );
  const push = useUI((s) => s.push);
  const b = DATA.balance.logistics;
  const use = v.l.capacity > 0 ? v.l.load / v.l.capacity : 0;
  return (
    <>
      <div className="page-title">
        <Icon id="nav_logistics" size={40} />
        <h1>物流</h1>
      </div>
      <div className="card">
        <div className="spread">
          <span className="bold">{use > 1.001 ? '🔴 追いつかない' : use > 0.9 ? '🟡 逼迫' : '🟢 正常'}</span>
          <span className="num small">
            {Math.round(v.l.load).toLocaleString()} / {Math.round(v.l.capacity).toLocaleString()}t/日
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          <Bar value={use} tone={use > 1.001 ? 'bad' : use > 0.9 ? 'warn' : 'good'} thick label="輸送能力の使用率" />
        </div>
        {use > 1.001 && (
          <p className="small bad" style={{ marginTop: 6 }}>
            超えた {Math.round(v.l.load - v.l.capacity).toLocaleString()}t/日 は外部に頼んでいて運賃が{b.outsourcePremium}倍。配送遅延で生産 −{Math.round((1 - v.l.ratio) * 100)}%。
          </p>
        )}
        <div className="kv small" style={{ marginTop: 10 }}>
          <span>運賃</span>
          <span>{yen(v.perTon)}/t</span>
          <span>本社の配送</span>
          <span>{v.hqCap.toLocaleString()}t/日</span>
          <span>トラック</span>
          <span>
            {v.l.trucks}台 × {b.truckCapacity}t/日
          </span>
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          水・原油・天然ガスはパイプラインで運ぶので対象外。
        </p>
      </div>

      <div className="card col" style={{ gap: 8 }}>
        <div className="row">
          <Icon id="small_truck" size={48} />
          <div className="grow col" style={{ gap: 0 }}>
            <span className="bold">トラックを配車</span>
            <span className="tiny dim">
              1台 +{b.truckCapacity}t/日・維持 {yen(b.truckUpkeep)}/日。{v.own > 0 ? `在庫の小型トラック ${v.own}台を使います` : `市場で購入（約${yen(v.price1)}/台）`}
            </span>
          </div>
        </div>
        <div className="row">
          <button className="btn grow" onClick={() => dispatch({ type: 'addTrucks', count: 1 })} data-testid="add-truck">
            +1台
          </button>
          <button className="btn grow soft" onClick={() => dispatch({ type: 'addTrucks', count: 5 })}>
            +5台
          </button>
          <button className="btn ghost" disabled={v.l.trucks === 0} onClick={() => dispatch({ type: 'removeTrucks', count: 1 })}>
            −1
          </button>
        </div>
      </div>

      <div className="card col" style={{ gap: 8 }}>
        <span className="bold">物流センター</span>
        {v.centers.map((c) => (
          <button key={c.id} className="row" style={{ border: 'none', background: 'none', textAlign: 'left', padding: '4px 0' }} onClick={() => push({ screen: 'facility', id: c.id })}>
            <Icon id="logistics_center" size={36} />
            <span className="grow small">{c.name}</span>
            <span className="pill">Lv{c.level}</span>
          </button>
        ))}
        <button className="btn soft block" disabled={!v.centerOpen} onClick={() => push({ screen: 'build', id: 'logistics_center' })}>
          {v.centerOpen ? `物流センターを建てる（+${(DATA.facility.logistics_center.logistics ?? 0).toLocaleString()}t/日・運賃−20%）` : '🔒 研究「物流センター」'}
        </button>
      </div>

      <div className="card spread">
        <div className="col" style={{ gap: 0 }}>
          <span className="bold">🚂 貨物鉄道</span>
          <span className="tiny dim">
            {v.rail ? `+${b.railCapacity.toLocaleString()}t/日・${b.railCostPerTon}円/t・月${yen(b.railMonthlyFee)}` : '🔒 研究「貨物鉄道」'}
          </span>
        </div>
        <Switch on={v.l.rail} onChange={(on) => dispatch({ type: 'setRail', on })} label="貨物鉄道" />
      </div>
    </>
  );
}
