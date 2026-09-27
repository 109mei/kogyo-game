import { DATA } from '../../data';
import { dayIndex } from '../../core/calendar';
import { penaltyOf } from '../../core/orders';
import { ownUse } from '../../core/surplus';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Bar, Icon } from '../components';
import { qty, yen } from '../format';

/** customer orders: offers to answer and orders being delivered */
export function Orders() {
  const v = useGame(
    (s) => {
      const today = dayIndex(s.tick);
      const view = (o: (typeof s.orders.list)[number]) => ({
        ...o,
        left: o.until - today,
        stock: s.inventory[o.item] ?? 0,
        use: ownUse(s, o.item),
        made: s.itemHist[o.item]?.produced.slice(-7).reduce((t, x) => t + x, 0) / Math.max(1, Math.min(7, s.itemHist[o.item]?.produced.length ?? 1)) || 0,
        penalty: penaltyOf(o),
      });
      return {
        on: !!s.features.orders,
        offers: s.orders.list.filter((o) => o.status === 'offer').map(view),
        active: s.orders.list.filter((o) => o.status === 'active').map(view),
        done: s.orders.done,
        failed: s.orders.failed,
        maxActive: DATA.balance.orders.maxActive,
      };
    },
    [],
    3,
  );
  const openSheet = useUI((s) => s.openSheet);
  const push = useUI((s) => s.push);
  return (
    <>
      <div className="page-title">
        <Icon id="misc_delivery" size={40} />
        <h1>受注</h1>
      </div>
      {!v.on && <div className="banner info">「製材所を建てて製材を作ろう」を達成すると、取引先から注文が来るようになります。</div>}
      <p className="small dim">
        取引先が決まった量を決まった値段で買ってくれます。市場の相場より高く、売っても値崩れしません。受けた注文には、自社で使う分を残して1時間ごとに在庫から納品します（工場長や自動売買が市場へ売るより先）。納期に遅れると、残りの{Math.round(DATA.balance.orders.penalty * 100)}%を違約金として払います。
      </p>
      <div className="tiles three">
        <div className="tile">
          <span className="label">受注中</span>
          <span className="value num">
            {v.active.length}/{v.maxActive}
          </span>
        </div>
        <div className="tile">
          <span className="label">納品済み</span>
          <span className="value num good">{v.done}</span>
        </div>
        <div className="tile">
          <span className="label">未達</span>
          <span className={`value num ${v.failed ? 'bad' : ''}`}>{v.failed}</span>
        </div>
      </div>

      <div className="section-title">引き合い</div>
      {v.offers.length === 0 && <div className="card empty small">いまは新しい引き合いはありません。数日おきに届きます。</div>}
      {v.offers.map((o) => {
        const it = DATA.item[o.item];
        const extra = (o.price / Math.max(1e-9, o.marketPrice) - 1) * 100;
        // what the company makes beyond its own use, over the time allowed
        const doable = o.fresh ? null : Math.max(0, o.made - o.use) * o.days;
        return (
          <div key={o.id} className="card col" style={{ gap: 8 }} data-testid="offer">
            <div className="row">
              <Icon id={o.item} size={48} />
              <div className="grow col" style={{ gap: 0 }}>
                <span className="tiny dim">{o.customer}{o.fresh ? '・新しい取引' : ''}</span>
                <span className="bold">
                  {it.name} {qty(o.item, o.qty)}
                </span>
                <span className="small">
                  {o.days}日以内・<b className="num">{yen(o.qty * o.price)}</b>
                </span>
              </div>
              <span className="pill reward">相場+{Math.round(extra)}%</span>
            </div>
            <div className="kv small">
              <span>単価</span>
              <span>
                {yen(o.price)}/{it.unit}（相場 {yen(o.marketPrice)}）
              </span>
              <span>在庫</span>
              <span>{qty(o.item, o.stock)}</span>
              {doable !== null && (
                <>
                  <span>{o.days}日で出せる量</span>
                  <span className={doable + o.stock >= o.qty ? 'good' : 'warn'}>約{qty(o.item, doable)}（自社で使う分を除く）</span>
                </>
              )}
            </div>
            {o.fresh && <p className="tiny warn">まだ作っていない品物です。工場を建てるところから始める注文です。</p>}
            <div className="row">
              <button className="btn ghost grow" onClick={() => dispatch({ type: 'declineOrder', orderId: o.id })}>
                断る
              </button>
              <button className="btn grow" disabled={v.active.length >= v.maxActive} onClick={() => dispatch({ type: 'acceptOrder', orderId: o.id })} data-testid="accept-order">
                受ける
              </button>
            </div>
            <span className="tiny muted">あと{Math.max(0, o.left + 1)}日で締め切り</span>
          </div>
        );
      })}

      <div className="section-title">受注中</div>
      {v.active.length === 0 && <div className="card empty small">受けている注文はありません</div>}
      {v.active.map((o) => {
        const it = DATA.item[o.item];
        const rest = Math.max(0, o.qty - o.delivered);
        const late = o.left < 0;
        return (
          <div key={o.id} className="card col" style={{ gap: 8 }} data-testid="order">
            <div className="row">
              <Icon id={o.item} size={44} />
              <div className="grow col" style={{ gap: 0 }}>
                <span className="tiny dim">{o.customer}</span>
                <span className="bold">
                  {it.name} {qty(o.item, o.delivered)} / {qty(o.item, o.qty)}
                </span>
              </div>
              <span className={`small bold ${o.left <= 3 ? 'bad' : ''}`}>{late ? '今日まで' : `あと${o.left}日`}</span>
            </div>
            <Bar value={o.delivered / o.qty} tone={o.left <= 3 && rest > o.stock ? 'bad' : 'good'} label="納品の進み具合" />
            <div className="kv small">
              <span>残り</span>
              <span>{qty(o.item, rest)}</span>
              <span>在庫</span>
              <span>
                {qty(o.item, o.stock)}（自社で1日 {qty(o.item, o.use)} 使用）
              </span>
              <span>受け取る額</span>
              <span>{yen(o.qty * o.price)}</span>
            </div>
            <div className="row">
              <button className="btn soft grow" disabled={o.stock <= 0} onClick={() => dispatch({ type: 'deliverOrder', orderId: o.id })} data-testid="deliver-now">
                在庫をいま全部納品
              </button>
              <button className="btn ghost small" onClick={() => push({ screen: 'item', id: o.item })}>
                作り方
              </button>
            </div>
            <button
              className="link"
              style={{ color: 'var(--bad-text)', alignSelf: 'flex-start' }}
              onClick={() =>
                openSheet({
                  kind: 'confirm',
                  title: '注文を取り消しますか？',
                  body: `残り${qty(o.item, rest)}の違約金として${yen(o.penalty)}を払います。`,
                  ok: '取り消す',
                  onOk: () => dispatch({ type: 'cancelOrder', orderId: o.id }),
                })
              }
            >
              取り消す（違約金 {yen(o.penalty)}）
            </button>
          </div>
        );
      })}
    </>
  );
}
