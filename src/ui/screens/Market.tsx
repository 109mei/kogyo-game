import { useState } from 'react';
import { DATA } from '../../data';
import type { AutoTrade } from '../../core';
import { dayIndex } from '../../core/calendar';
import { affordable, buyQuote, demandStars, sellQuote, supplyStars, trend, unitPrice } from '../../core/market';
import { hasFeature } from '../../core/util';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { LineChart, Sparkline } from '../charts';
import { Chips, Icon, Stepper, Switch, Tabs } from '../components';
import { date, num, qty, signedPct, stars, yen } from '../format';
import { marketRows } from '../selectors';
import { SurplusCard } from './Assets';

type Cat = 'all' | 'raw' | 'material' | 'part' | 'product';

export function Market() {
  const [cat, setCat] = useState<Cat>('all');
  const [sort, setSort] = useState<'no' | 'up' | 'down'>('no');
  const v = useGame(
    (s) => ({
      rows: marketRows(s),
      open: !!s.features.market,
      orders: !!s.features.orders,
      offers: s.orders.list.filter((o) => o.status === 'offer').length,
      active: s.orders.list.filter((o) => o.status === 'active').length,
    }),
    [],
    2,
  );
  const push = useUI((s) => s.push);
  let rows = v.rows.filter((r) => cat === 'all' || DATA.item[r.item].category === cat);
  if (sort === 'up') rows = [...rows].sort((a, b) => b.change - a.change);
  if (sort === 'down') rows = [...rows].sort((a, b) => a.change - b.change);
  return (
    <>
      <div className="page-title">
        <h1>市場</h1>
        <span className="small muted">{v.rows.length}品目</span>
      </div>
      {!v.open && <div className="banner info">原木を3回集めると市場で売れるようになります。</div>}
      {v.orders && (
        <button className="card tight tap row" style={{ border: 'none', textAlign: 'left' }} onClick={() => push({ screen: 'orders' })} data-testid="open-orders">
          <Icon id="misc_delivery" size={36} />
          <span className="grow bold small">受注（相場より高く売る）</span>
          <span className="small dim">
            {v.offers ? `引き合い${v.offers}・` : ''}受注中{v.active} ›
          </span>
        </button>
      )}
      <SurplusCard />
      <Chips
        value={cat}
        onChange={setCat}
        options={[
          ['all', 'すべて'],
          ['raw', '原料'],
          ['material', '中間素材'],
          ['part', '部品'],
          ['product', '完成品'],
        ]}
      />
      <div className="row small">
        <span className="muted">並び</span>
        <Chips
          value={sort}
          onChange={setSort}
          options={[
            ['no', '番号'],
            ['up', '上昇'],
            ['down', '下落'],
          ]}
        />
      </div>
      <div className="card flush">
        {rows.map((r) => {
          const it = DATA.item[r.item];
          return (
            <button key={r.item} className="mkt" style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--hairline)', textAlign: 'left' }} onClick={() => push({ screen: 'marketItem', id: r.item })} data-testid={`market-${r.item}`}>
              <Icon id={r.item} size={40} />
              <div className="col" style={{ gap: 0, minWidth: 0 }}>
                <span className="bold ellipsis">
                  {it.name} {r.hot && <span className="hot">{r.hot === '供給不足' ? '🔥 供給不足' : '📉 供給過剰'}</span>}
                </span>
                <span className="tiny dim">
                  需要 <span className="warn">{stars(r.demand)}</span> 在庫 {qty(r.item, r.stock)}
                </span>
              </div>
              <div className="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                <span className="num bold small">
                  {yen(r.price)}/{it.unit}
                </span>
                <span className={`num tiny ${r.change > 0.001 ? 'good' : r.change < -0.001 ? 'bad' : 'muted'}`}>{signedPct(r.change)}</span>
              </div>
              <Sparkline values={r.spark} tone={r.change > 0.01 ? 'up' : r.change < -0.01 ? 'down' : 'flat'} />
            </button>
          );
        })}
      </div>
    </>
  );
}

const RANGES: [string, string][] = [
  ['30', '30日'],
  ['90', '90日'],
  ['365', '1年'],
];

export function MarketItem({ id }: { id: string }) {
  const it = DATA.item[id];
  const [range, setRange] = useState('90');
  const [sellQty, setSellQty] = useState(0);
  const [buyQty, setBuyQty] = useState(0);
  const v = useGame(
    (s) => {
      const m = s.market[id];
      const d = dayIndex(s.tick);
      const n = Number(range);
      const hist = m.hist.slice(-n);
      return {
        price: unitPrice(s, id),
        change: trend(s, id, 7),
        change30: trend(s, id, 30),
        demand: demandStars(s, id),
        supply: supplyStars(s, id),
        stock: s.inventory[id] ?? 0,
        cash: s.cash,
        points: hist.map((y, i) => ({ x: d - hist.length + i, y: y * DATA.basePrice[id] })),
        index: m.index,
        shock: m.shock,
        open: !!s.features.market,
        forecast: hasFeature(s, 'forecast'),
        auto: hasFeature(s, 'autotrade'),
        contractsOn: hasFeature(s, 'contracts'),
        rule: s.autoTrade[id] ? { ...s.autoTrade[id] } : null,
        contracts: s.contracts.filter((c) => c.item === id).map((c) => ({ ...c })),
        day: d,
        maxBuy: affordable(s, id),
        sellQuote: sellQty > 0 ? sellQuote(s, id, Math.min(sellQty, s.inventory[id] ?? 0)) : null,
        buyQuote: buyQty > 0 ? buyQuote(s, id, buyQty) : null,
      };
    },
    [id, range, sellQty, buyQty],
    4,
  );
  const stepFor = (n: number) => (n >= 10000 ? 1000 : n >= 1000 ? 100 : n >= 100 ? 10 : 1);
  const sellStep = stepFor(v.stock);
  const buyStep = stepFor(v.maxBuy);
  const plus = (n: number) => `+${n.toLocaleString()}`;
  return (
    <>
      <div className="card">
        <div className="row">
          <Icon id={id} size={64} />
          <div className="grow col" style={{ gap: 0 }}>
            <span className="bold" style={{ fontSize: 18 }}>
              {it.name}
            </span>
            <span className="num" style={{ fontSize: 22, fontWeight: 750 }}>
              {yen(v.price)}
              <span className="small dim">/{it.unit}</span>
            </span>
            <span className={`small num ${v.change > 0 ? 'good' : v.change < 0 ? 'bad' : 'muted'}`}>
              7日 {signedPct(v.change)}・30日 {signedPct(v.change30)}
            </span>
          </div>
        </div>
        <div className="kv small" style={{ marginTop: 10 }}>
          <span>需要</span>
          <span className="warn">{stars(v.demand)}</span>
          <span>供給</span>
          <span className="warn">{stars(v.supply)}</span>
          <span>市場規模</span>
          <span>{qty(id, it.demand)}/日</span>
          <span>基準価格との比</span>
          <span>{Math.round(v.index * 100)}%</span>
          {v.forecast && (
            <>
              <span>見通し</span>
              <span className={Math.exp(v.shock) > v.index ? 'good' : 'bad'}>{Math.exp(v.shock) > v.index * 1.01 ? '↗ 上がりそう' : Math.exp(v.shock) < v.index * 0.99 ? '↘ 下がりそう' : '→ 横ばい'}</span>
            </>
          )}
        </div>
        {v.index > 1.25 && <p className="small bad" style={{ marginTop: 8 }}>🔥 供給不足：高く売れるチャンスです</p>}
      </div>

      <div className="card">
        <div className="spread">
          <span className="small bold dim">価格の推移</span>
          <Tabs value={range} onChange={setRange} options={RANGES} />
        </div>
        <div style={{ marginTop: 8 }}>
          <LineChart points={v.points} format={(x) => yen(x, { unit: false })} xLabel={(x) => date(x, false)} label={`${it.name}の価格推移`} />
        </div>
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <div className="spread">
          <span className="bold">売る</span>
          <span className="small dim">在庫 {qty(id, v.stock)}</span>
        </div>
        <Stepper value={sellQty} onChange={setSellQty} step={sellStep} max={v.stock} quick={[{ label: plus(sellStep), add: sellStep }, { label: plus(sellStep * 10), add: sellStep * 10 }, { label: '半分', set: Math.floor(v.stock / 2) }, { label: 'MAX', set: v.stock, testid: 'sell-max' }]} />
        {v.sellQuote && (
          <p className="small dim">
            受け取り <b className="num">{yen(v.sellQuote.total)}</b>（平均 {yen(v.sellQuote.unit)}/{it.unit}、手数料込み）
          </p>
        )}
        <button
          className="btn block"
          disabled={!v.open || sellQty <= 0 || v.stock <= 0}
          onClick={() => {
            void dispatch({ type: 'sell', item: id, qty: Math.min(sellQty, v.stock) }).then((r) => r.ok && setSellQty(0));
          }}
          data-testid="sell"
        >
          売る
        </button>
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <div className="spread">
          <span className="bold">買う</span>
          <span className="small dim">最大 {qty(id, v.maxBuy)}</span>
        </div>
        <Stepper value={buyQty} onChange={setBuyQty} step={buyStep} max={Math.floor(v.maxBuy * 100) / 100} quick={[{ label: plus(buyStep), add: buyStep }, { label: plus(buyStep * 10), add: buyStep * 10 }, { label: plus(buyStep * 100), add: buyStep * 100 }, { label: 'MAX', set: Math.floor(v.maxBuy * 100) / 100 }]} />
        {v.buyQuote && (
          <p className="small dim">
            支払い <b className="num">{yen(v.buyQuote.total)}</b>（平均 {yen(v.buyQuote.unit)}/{it.unit}）
          </p>
        )}
        <button
          className="btn soft block"
          disabled={!v.open || buyQty <= 0 || (v.buyQuote?.total ?? 0) > v.cash}
          onClick={() => {
            void dispatch({ type: 'buy', item: id, qty: buyQty }).then((r) => r.ok && setBuyQty(0));
          }}
        >
          買う
        </button>
      </div>

      {v.auto && <AutoTradeCard id={id} rule={v.rule} />}
      {v.contractsOn && <ContractsCard id={id} contracts={v.contracts} day={v.day} price={v.price} />}
    </>
  );
}

function AutoTradeCard({ id, rule }: { id: string; rule: AutoTrade | null }) {
  const it = DATA.item[id];
  const [r, setR] = useState<AutoTrade>(rule ?? { sellAbove: null, buyBelow: null, minIndex: 0.7, maxIndex: 1.3 });
  return (
    <div className="card col" style={{ gap: 10 }}>
      <span className="bold">🔁 自動売買</span>
      <div className="spread">
        <span className="small">在庫がこれを超えたら超過分を売る</span>
        <Switch on={r.sellAbove !== null} onChange={(on) => setR({ ...r, sellAbove: on ? 100 : null })} label="自動で売る" />
      </div>
      {r.sellAbove !== null && <Stepper value={r.sellAbove} onChange={(x) => setR({ ...r, sellAbove: x })} step={10} unit={it.unit} quick={[{ label: '+100', add: 100 }, { label: '+1,000', add: 1000 }, { label: '+10,000', add: 10000 }, { label: '0', set: 0 }]} />}
      <div className="spread">
        <span className="small">在庫がこれより少なければ買い足す</span>
        <Switch on={r.buyBelow !== null} onChange={(on) => setR({ ...r, buyBelow: on ? 100 : null })} label="自動で買う" />
      </div>
      {r.buyBelow !== null && <Stepper value={r.buyBelow} onChange={(x) => setR({ ...r, buyBelow: x })} step={10} unit={it.unit} quick={[{ label: '+100', add: 100 }, { label: '+1,000', add: 1000 }, { label: '+10,000', add: 10000 }, { label: '0', set: 0 }]} />}
      <p className="tiny muted">基準価格の{Math.round(r.minIndex * 100)}%未満では売らず、{Math.round(r.maxIndex * 100)}%を超えると買いません。</p>
      <button className="btn block" onClick={() => dispatch({ type: 'setAutoTrade', item: id, rule: r.sellAbove === null && r.buyBelow === null ? null : r })}>
        保存
      </button>
    </div>
  );
}

function ContractsCard({ id, contracts, day, price }: { id: string; contracts: { id: number; side: 'buy' | 'sell'; perDay: number; price: number; endDay: number }[]; day: number; price: number }) {
  const it = DATA.item[id];
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [perDay, setPerDay] = useState(10);
  const [days, setDays] = useState(30);
  const prem = DATA.balance.market.contractPremium;
  return (
    <div className="card col" style={{ gap: 10 }}>
      <span className="bold">📄 長期契約</span>
      {contracts.map((c) => (
        <div key={c.id} className="spread small">
          <span>
            {c.side === 'buy' ? '購入' : '販売'} {qty(id, c.perDay)}/日 @{yen(c.price)}
          </span>
          <span className="dim">あと{c.endDay - day}日</span>
          <button className="link" style={{ color: 'var(--bad-text)' }} onClick={() => dispatch({ type: 'cancelContract', contractId: c.id })}>
            解約
          </button>
        </div>
      ))}
      <Tabs
        value={side}
        onChange={setSide}
        options={[
          ['buy', '買う契約'],
          ['sell', '売る契約'],
        ]}
      />
      <Stepper value={perDay} onChange={setPerDay} step={1} unit={`${it.unit}/日`} quick={[{ label: '+10', add: 10 }, { label: '+100', add: 100 }, { label: '+1,000', add: 1000 }, { label: '1', set: 1 }]} />
      <Tabs
        value={String(days)}
        onChange={(x) => setDays(Number(x))}
        options={DATA.balance.market.contractDays.map((d) => [String(d), `${d}日`] as [string, string])}
      />
      <p className="small dim">
        固定価格 {yen(price * (side === 'buy' ? 1 + prem : 1 - prem))}/{it.unit}・合計 {yen(price * perDay * days)} 前後。価格の上下に左右されません。
      </p>
      <button className="btn soft block" onClick={() => dispatch({ type: 'contract', item: id, side, perDay, days })}>
        契約する
      </button>
      <p className="tiny muted">途中解約は1週間分の2割の違約金がかかります。</p>
    </div>
  );
}

export { num };
