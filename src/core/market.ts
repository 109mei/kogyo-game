import { DATA } from '../data';
import { dayIndex } from './calendar';
import { normal, random } from './rng';
import type { GameState, MarketItem } from './types';
import { clamp, earn, notify, pay } from './util';

const M = () => DATA.balance.market;

export function initMarket(s: GameState) {
  const hist = Math.min(60, M().historyDays);
  for (const it of DATA.items) {
    const m: MarketItem = { shock: 0, index: 1, flow: 0, todayNet: 0, hist: [] };
    // warm up so the charts have a past
    for (let i = 0; i < hist; i++) {
      m.shock = m.shock * (1 - M().shockReversion) + normal(s) * it.volatility;
      const target = Math.exp(m.shock);
      m.index += (target - m.index) * M().reversion;
      m.hist.push(Math.round(m.index * 10000) / 10000);
    }
    s.market[it.id] = m;
  }
}

export function unitPrice(s: GameState, item: string): number {
  return DATA.basePrice[item] * (s.market[item]?.index ?? 1);
}

function impactFactor(item: string, qty: number, dir: 1 | -1): number {
  const d = DATA.item[item].demand;
  const m = M();
  const f = Math.pow(1 + qty / d, (dir * m.immediateImpact) / m.elasticity);
  return dir > 0 ? Math.min(f, 1 + m.maxImpact) : Math.max(f, 1 - m.maxImpact);
}

export interface Quote {
  qty: number;
  total: number;
  unit: number;
  newIndex: number;
}

export function sellQuote(s: GameState, item: string, qty: number): Quote {
  const m = s.market[item];
  const newIndex = clamp(m.index * impactFactor(item, qty, -1), M().priceFloor, M().priceCeil);
  const avg = (m.index + newIndex) / 2;
  const unit = DATA.basePrice[item] * avg * (1 - M().sellSpread);
  return { qty, total: unit * qty, unit, newIndex };
}

export function buyQuote(s: GameState, item: string, qty: number): Quote {
  const m = s.market[item];
  const newIndex = clamp(m.index * impactFactor(item, qty, 1), M().priceFloor, M().priceCeil);
  const avg = (m.index + newIndex) / 2;
  const unit = DATA.basePrice[item] * avg * (1 + M().buySpread);
  return { qty, total: unit * qty, unit, newIndex };
}

/** sells from inventory; returns yen received */
export function executeSell(s: GameState, item: string, qty: number): number {
  qty = Math.min(qty, s.inventory[item] ?? 0);
  if (!(qty > 1e-9)) return 0;
  const q = sellQuote(s, item, qty);
  s.inventory[item] -= qty;
  if (s.inventory[item] < 1e-9) s.inventory[item] = 0;
  const m = s.market[item];
  m.index = q.newIndex;
  m.todayNet += qty;
  earn(s, 'sales', q.total);
  s.itemToday[item].sold += qty;
  s.totals.sold[item] = (s.totals.sold[item] ?? 0) + qty;
  s.totals.salesValue += q.total;
  return q.total;
}

/** buys into inventory; returns yen paid */
export function executeBuy(s: GameState, item: string, qty: number): number {
  if (!(qty > 1e-9)) return 0;
  const q = buyQuote(s, item, qty);
  const m = s.market[item];
  m.index = q.newIndex;
  m.todayNet -= qty;
  pay(s, 'purchases', q.total);
  s.inventory[item] = (s.inventory[item] ?? 0) + qty;
  s.itemToday[item].bought += qty;
  if (DATA.item[item].transport === 'truck') s.logistics.movedToday += qty * DATA.item[item].weight;
  return q.total;
}

/** the most we can buy with the cash we have (roughly, ignoring impact curvature) */
export function affordable(s: GameState, item: string): number {
  if (s.cash <= 0) return 0;
  const unit = unitPrice(s, item) * (1 + M().buySpread);
  let q = s.cash / unit;
  // shrink until the quote with impact fits
  for (let i = 0; i < 20 && q > 0; i++) {
    const t = buyQuote(s, item, q).total;
    if (t <= s.cash) break;
    q *= (s.cash / t) * 0.999;
  }
  return Math.max(0, q);
}

export function dailyMarket(s: GameState, visible: Set<string>) {
  const m0 = M();
  for (const it of DATA.items) {
    const m = s.market[it.id];
    m.flow += (m.todayNet - m.flow) / m0.emaDays;
    m.todayNet = 0;
    m.shock = m.shock * (1 - m0.shockReversion) + normal(s) * it.volatility;
    // rare supply shocks make news
    if (random(s) < 0.0025) {
      const up = random(s) < 0.5;
      const size = 0.15 + random(s) * 0.2;
      m.shock += up ? size : -size;
      if (visible.has(it.id)) {
        notify(
          s,
          'info',
          up ? 'ev_price_surge' : 'ev_recession',
          up ? `🔥 ${it.name} 供給不足` : `📉 ${it.name} 供給過剰`,
          up ? '市場価格が上がりそうです' : '市場価格が下がりそうです',
          { screen: 'market', id: it.id },
        );
      }
    }
    const pressure = clamp(m.flow / it.demand, -0.9, 50);
    const playerEffect = Math.pow(1 + pressure, -1 / m0.elasticity);
    const target = Math.exp(m.shock) * playerEffect;
    m.index = clamp(m.index + (target - m.index) * m0.reversion, m0.priceFloor, m0.priceCeil);
    m.hist.push(Math.round(m.index * 10000) / 10000);
    if (m.hist.length > m0.historyDays) m.hist.splice(0, m.hist.length - m0.historyDays);
  }
}

/** contract deliveries, one hour's worth */
export function hourlyContracts(s: GameState) {
  const d = dayIndex(s.tick);
  const ended: number[] = [];
  for (const c of s.contracts) {
    if (d >= c.endDay) {
      ended.push(c.id);
      continue;
    }
    const q = c.perDay / 24;
    if (c.side === 'buy') {
      pay(s, 'purchases', q * c.price);
      s.inventory[c.item] = (s.inventory[c.item] ?? 0) + q;
      s.itemToday[c.item].bought += q;
      s.market[c.item].todayNet -= q;
      if (DATA.item[c.item].transport === 'truck') s.logistics.movedToday += q * DATA.item[c.item].weight;
      c.done += q;
    } else {
      const have = Math.min(q, s.inventory[c.item] ?? 0);
      if (have > 0) {
        s.inventory[c.item] -= have;
        earn(s, 'sales', have * c.price);
        s.itemToday[c.item].sold += have;
        s.market[c.item].todayNet += have;
        s.totals.sold[c.item] = (s.totals.sold[c.item] ?? 0) + have;
        s.totals.salesValue += have * c.price;
        c.done += have;
      }
    }
  }
  if (ended.length) {
    for (const id of ended) {
      const c = s.contracts.find((x) => x.id === id)!;
      notify(
        s,
        'info',
        'fin_contract',
        `契約完了：${DATA.item[c.item].name}の${c.side === 'buy' ? '購入' : '販売'}`,
        '',
        { screen: 'market', id: c.item },
      );
    }
    s.contracts = s.contracts.filter((c) => !ended.includes(c.id));
  }
}

export function hourlyAutoTrade(s: GameState) {
  for (const [item, rule] of Object.entries(s.autoTrade)) {
    const stock = s.inventory[item] ?? 0;
    const m = s.market[item];
    if (rule.sellAbove !== null && stock > rule.sellAbove && m.index >= rule.minIndex) {
      executeSell(s, item, stock - rule.sellAbove);
    } else if (rule.buyBelow !== null && stock < rule.buyBelow && m.index <= rule.maxIndex) {
      const want = rule.buyBelow - stock;
      const q = Math.min(want, affordable(s, item));
      if (q > 0) executeBuy(s, item, q);
    }
  }
}

/** market trend: price index change vs n days ago */
export function trend(s: GameState, item: string, days = 7): number {
  const h = s.market[item].hist;
  if (h.length < 2) return 0;
  const past = h[Math.max(0, h.length - 1 - days)];
  return s.market[item].index / past - 1;
}

/** 1..5 stars for how strong demand is right now */
export function demandStars(s: GameState, item: string): number {
  const shock = s.market[item].shock;
  return clamp(Math.round(3 + shock / 0.08), 1, 5);
}

/** 1..5 stars for how much is on offer (we add supply when we sell) */
export function supplyStars(s: GameState, item: string): number {
  const m = s.market[item];
  const p = m.flow / DATA.item[item].demand;
  return clamp(Math.round(3 - m.shock / 0.08 + p * 4), 1, 5);
}
