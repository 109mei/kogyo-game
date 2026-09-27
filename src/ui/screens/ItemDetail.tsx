import { useState } from 'react';
import { DATA } from '../../data';
import { dayIndex } from '../../core/calendar';
import { unitPrice } from '../../core/market';
import { recipeUnlocked, visibleItems } from '../../core/visibility';
import { useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { LineChart } from '../charts';
import { Icon, Tabs } from '../components';
import { date, num, qty, yen } from '../format';
import { coverage } from '../selectors';

type TabId = 'chain' | 'uses' | 'stock';

export function ItemDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<TabId>('chain');
  const it = DATA.item[id];
  const r = DATA.recipe[id];
  const v = useGame(
    (s) => {
      const vis = visibleItems(s);
      const d = dayIndex(s.tick);
      const h = s.itemHist[id]?.stock ?? [];
      return {
        stock: s.inventory[id] ?? 0,
        price: unitPrice(s, id),
        known: vis.has(id),
        open: recipeUnlocked(s, id),
        inputs: Object.entries(r.inputs).map(([i, q]) => ({ item: i, q, cover: coverage(s, i), known: vis.has(i) })),
        uses: DATA.consumers[id].map((c) => ({ item: c, known: vis.has(c), open: recipeUnlocked(s, c) })),
        fuelFor: id === 'coal' || id === 'natural_gas' || id === 'fuel',
        stockHist: h.map((y, i) => ({ x: d - h.length + i, y })),
        cover: coverage(s, id),
      };
    },
    [id],
    2,
  );
  const push = useUI((s) => s.push);
  const fac = DATA.facility[r.facility];
  return (
    <>
      <div className="card row">
        <Icon id={id} size={96} />
        <div className="grow col" style={{ gap: 2 }}>
          <h1 style={{ fontSize: 20, fontWeight: 750 }}>{it.name}</h1>
          <span className="small dim">
            在庫 <b className="num">{qty(id, v.stock)}</b>
          </span>
          <span className="small dim num">
            市場価格 {yen(v.price)}/{it.unit}
          </span>
          <button className="link" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => push({ screen: 'marketItem', id })}>
            市場で売買 →
          </button>
        </div>
      </div>
      <p className="small dim">{it.desc}</p>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          ['chain', '作り方'],
          ['uses', '使い道'],
          ['stock', '在庫推移'],
        ]}
      />
      {tab === 'chain' && (
        <div className="card">
          <div className="row" style={{ paddingBottom: 8, borderBottom: '1px solid var(--hairline)' }}>
            <Icon id={fac.id} size={40} locked={!v.open} />
            <div className="grow col" style={{ gap: 0 }}>
              <span className="small bold">{fac.name}で作る</span>
              <span className="tiny dim">
                1バッチ {qty(id, r.output)}・{r.time}人日
              </span>
            </div>
          </div>
          {v.inputs.length === 0 && <p className="small dim" style={{ paddingTop: 10 }}>原料なので、自然から採取します。</p>}
          {v.inputs.map((i) => (
            <button key={i.item} className="tree-row" style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--hairline)', textAlign: 'left' }} onClick={() => push({ screen: 'item', id: i.item })}>
              <span className="caret">▼</span>
              <Icon id={i.item} size={30} locked={!i.known} />
              <span>
                {DATA.item[i.item].name}
                <span className="tiny muted"> ×{num(i.q)}{DATA.item[i.item].unit}</span>
              </span>
              <span className={`small bold ${i.cover >= 0.8 ? 'good' : i.cover >= 0.4 ? 'warn' : 'bad'}`}>
                {i.cover >= 0.8 ? '🟢' : i.cover >= 0.4 ? '🟡' : '🔴'} {Math.round(i.cover * 100)}%
              </span>
            </button>
          ))}
          {v.inputs.length > 0 && <p className="tiny muted" style={{ marginTop: 8 }}>％は自社での確保率。タップするとさらに掘り下げます。</p>}
        </div>
      )}
      {tab === 'uses' && (
        <div className="card">
          {v.uses.length === 0 && !v.fuelFor && <p className="small dim">完成品として市場で売ります。</p>}
          {v.fuelFor && <p className="small dim" style={{ paddingBottom: 6 }}>⚡ 発電所の燃料にもなります。</p>}
          {v.uses.map((u) => (
            <button key={u.item} className="tree-row" style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--hairline)', textAlign: 'left' }} onClick={() => push({ screen: 'item', id: u.item })}>
              <span className="caret">▲</span>
              <Icon id={u.item} size={30} locked={!u.known} />
              <span>{u.known ? DATA.item[u.item].name : '？？？'}</span>
              <span className="tiny muted">{u.open ? '作れる' : '🔒'}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'stock' && (
        <div className="card">
          <span className="small bold dim">在庫（30日）</span>
          <div style={{ marginTop: 8 }}>
            <LineChart points={v.stockHist} format={(x) => num(x)} xLabel={(x) => date(x, false)} zeroBased label={`${it.name}の在庫推移`} />
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            自社での確保率 {Math.round(v.cover * 100)}%
          </p>
        </div>
      )}
    </>
  );
}
