/**
 * Customer orders: a fixed quantity at an agreed price, by a deadline. They
 * pay more than the market and do not move its price, but a missed order
 * costs a penalty. Once accepted, deliveries go out by themselves every day
 * from what the company does not need itself (or at once, on request).
 */
import { DATA } from '../data';
import { actualRates, plannedFlows } from './rates';
import { dayIndex } from './calendar';
import { unitPrice } from './market';
import { random, pick } from './rng';
import { ownUse } from './surplus';
import type { GameState, Order } from './types';
import { earn, hasFeature, milestone, newId, notify, pay, qtyText, yenText } from './util';
import { recipeUnlocked } from './visibility';

const O = () => DATA.balance.orders;

const between = (s: GameState, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * random(s);

/** 2 significant figures, whole units */
function niceQty(v: number): number {
  if (v <= 10) return Math.max(1, Math.round(v));
  const k = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / k) * k;
}

function nicePrice(v: number): number {
  const k = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 2);
  return Math.round(v / k) * k;
}

/** a day's output of one new facility of the kind that makes the item (for orders of new products) */
export function referenceRate(item: string): number {
  const r = DATA.recipe[item];
  const def = DATA.facility[r.facility];
  const slots = def.manualWorkers ? def.manualWorkers : def.machinesPerLevel * (def.machine?.rate ?? 1);
  return (slots / r.time) * r.output;
}

function customerName(s: GameState): string {
  return `${pick(s, DATA.names.places)}${pick(s, O().customers)}`;
}

/** items the company made lately, weighted by value, and items it could start making */
function offerFor(s: GameState): Order | null {
  const o = O();
  const today = dayIndex(s.tick);
  const taken = new Set(s.orders.list.map((x) => x.item));
  const made: { item: string; rate: number; w: number }[] = [];
  for (const it of DATA.items) {
    if (it.id === 'water' || taken.has(it.id)) continue;
    const rate = actualRates(s, it.id).produced;
    if (rate > 1e-6) made.push({ item: it.id, rate, w: rate * DATA.basePrice[it.id] });
  }
  const fresh = DATA.items.filter((it) => it.id !== 'water' && !taken.has(it.id) && recipeUnlocked(s, it.id) && !(s.totals.produced[it.id] > 0) && it.category !== 'raw');
  const goFresh = fresh.length > 0 && (made.length === 0 || random(s) < o.freshChance);
  let item: string;
  let qty: number;
  let days: number;
  let premium: number;
  if (goFresh) {
    item = pick(s, fresh).id;
    const rate = referenceRate(item);
    qty = niceQty(rate * between(s, o.freshSizeDays));
    const r = DATA.recipe[item];
    days = Math.ceil(DATA.facility[r.facility].buildDays + (qty / rate) * o.leadMul + 7);
    premium = between(s, o.freshPremium);
  } else {
    if (!made.length) return null;
    let x = random(s) * made.reduce((t, m) => t + m.w, 0);
    let pickM = made[made.length - 1];
    for (const m of made) {
      x -= m.w;
      if (x < 0) {
        pickM = m;
        break;
      }
    }
    item = pickM.item;
    qty = niceQty(pickM.rate * between(s, o.sizeDays));
    days = Math.ceil((qty / pickM.rate) * o.leadMul);
    premium = between(s, o.premium);
  }
  days = Math.min(o.maxDays, Math.max(o.minDays, days));
  const market = unitPrice(s, item);
  return {
    id: newId(s),
    customer: customerName(s),
    item,
    qty,
    delivered: 0,
    price: nicePrice(market * premium),
    marketPrice: market,
    days,
    until: today + o.offerDays,
    status: 'offer',
    fresh: goFresh,
  };
}

function deliver(s: GameState, o: Order, qty: number): number {
  qty = Math.min(qty, o.qty - o.delivered, s.inventory[o.item] ?? 0);
  if (!(qty > 1e-9)) return 0;
  s.inventory[o.item] -= qty;
  if (s.inventory[o.item] < 1e-9) s.inventory[o.item] = 0;
  const yen = qty * o.price;
  earn(s, 'sales', yen);
  s.itemToday[o.item].sold += qty;
  s.totals.sold[o.item] = (s.totals.sold[o.item] ?? 0) + qty;
  s.totals.salesValue += yen;
  o.delivered += qty;
  if (DATA.item[o.item].transport === 'truck') s.logistics.movedToday += qty * DATA.item[o.item].weight;
  return qty;
}

function finish(s: GameState, o: Order) {
  s.orders.list = s.orders.list.filter((x) => x.id !== o.id);
  s.orders.done++;
  const it = DATA.item[o.item];
  const extra = (o.price / Math.max(1e-9, o.marketPrice) - 1) * 100;
  notify(s, 'good', 'misc_delivery', `納品完了：${o.customer}`, `${it.name}${qtyText(o.qty, it.unit)}・${yenText(o.qty * o.price)}（相場より+${Math.round(extra)}%）`, { screen: 'orders' });
  milestone(s, 'firstOrder', 'misc_delivery', `初めての受注を納品（${o.customer}・${it.name}）`);
}

/** the penalty for what was not delivered */
export function penaltyOf(o: Order): number {
  return Math.max(0, o.qty - o.delivered) * o.price * O().penalty;
}

function fail(s: GameState, o: Order, why: string) {
  const fine = penaltyOf(o);
  pay(s, 'other', fine);
  s.orders.list = s.orders.list.filter((x) => x.id !== o.id);
  s.orders.failed++;
  const it = DATA.item[o.item];
  notify(s, 'bad', 'misc_delivery', `${why}：${o.customer}の${it.name}`, `違約金 ${yenText(fine)}（納品 ${qtyText(o.delivered, '')}/${qtyText(o.qty, it.unit)}）`, { screen: 'orders' });
}

/** every hour (before managers and auto-trade sell): what is made goes to the orders first, the soonest due first */
export function hourlyOrders(s: GameState) {
  const active = s.orders.list.filter((x) => x.status === 'active');
  if (!active.length) return;
  const flows = plannedFlows(s);
  for (const x of active.sort((a, b) => a.until - b.until)) {
    const spare = (s.inventory[x.item] ?? 0) - ownUse(s, x.item, flows) * O().reserveDays;
    if (spare > 0) deliver(s, x, spare);
    if (x.delivered >= x.qty - 1e-6) finish(s, x);
  }
}

/** end of day: deadlines, and now and then a new offer */
export function dailyOrders(s: GameState) {
  if (!hasFeature(s, 'orders')) return;
  const o = O();
  const today = dayIndex(s.tick);
  hourlyOrders(s);
  for (const x of [...s.orders.list].sort((a, b) => a.until - b.until)) {
    if (x.status === 'offer') {
      if (today > x.until) s.orders.list = s.orders.list.filter((y) => y.id !== x.id);
      continue;
    }
    if (today > x.until) fail(s, x, '納期に間に合いませんでした');
  }
  const offers = s.orders.list.filter((x) => x.status === 'offer').length;
  if (offers < o.maxOffers && random(s) < o.offerChance) {
    const offer = offerFor(s);
    if (offer) {
      s.orders.list.push(offer);
      const it = DATA.item[offer.item];
      notify(s, 'info', 'misc_delivery', `引き合い：${offer.customer}から${it.name}`, `${qtyText(offer.qty, it.unit)}を${offer.days}日で・${yenText(offer.qty * offer.price)}`, { screen: 'orders' });
    }
  }
}

export function acceptOrder(s: GameState, id: number): string | null {
  const x = s.orders.list.find((o) => o.id === id);
  if (!x || x.status !== 'offer') return 'この引き合いはもうありません';
  if (s.orders.list.filter((o) => o.status === 'active').length >= O().maxActive) return `受けられる注文は同時に${O().maxActive}件までです`;
  x.status = 'active';
  x.until = dayIndex(s.tick) + x.days;
  milestone(s, 'firstAccept', 'misc_delivery', `初めての受注（${x.customer}）`);
  return null;
}

export function declineOrder(s: GameState, id: number): string | null {
  const x = s.orders.list.find((o) => o.id === id);
  if (!x || x.status !== 'offer') return 'この引き合いはもうありません';
  s.orders.list = s.orders.list.filter((o) => o.id !== id);
  return null;
}

/** deliver everything in stock now, own use or not */
export function deliverNow(s: GameState, id: number): { error: string | null; qty: number } {
  const x = s.orders.list.find((o) => o.id === id);
  if (!x || x.status !== 'active') return { error: '注文がありません', qty: 0 };
  const q = deliver(s, x, x.qty - x.delivered);
  if (q <= 0) return { error: `${DATA.item[x.item].name}の在庫がありません`, qty: 0 };
  if (x.delivered >= x.qty - 1e-6) finish(s, x);
  return { error: null, qty: q };
}

export function cancelOrder(s: GameState, id: number): string | null {
  const x = s.orders.list.find((o) => o.id === id);
  if (!x || x.status !== 'active') return '注文がありません';
  fail(s, x, '注文を取り消しました');
  return null;
}

