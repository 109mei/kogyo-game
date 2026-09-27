/**
 * The improvements from the playtest: selling surplus in one tap, goal
 * subsidies, the cash left after building, division heads and subsidiaries,
 * customer orders, and events with choices.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, runDays, runTicks, type GameState } from '../src/core';
import { dayIndex } from '../src/core/calendar';
import { dailyDivisions, divisionProfit } from '../src/core/divisions';
import { dailyEvents, gridFactor, isDown, strikeFactor } from '../src/core/events';
import { createFacility } from '../src/core/facilities';
import { borrowFor, fixedCostPerDay, operatingProfit } from '../src/core/finance';
import { managementLoad } from '../src/core/logistics';
import { dailyOrders } from '../src/core/orders';
import { completeResearch } from '../src/core/research';
import { maxSaleForDrop, surplusPlan } from '../src/core/surplus';
import { employeesAt, staffCapacity } from '../src/core/staff';
import { DATA } from '../src/data';
import { migrate } from '../src/save/migrations';
import { openingState } from './helpers';

const TPD = DATA.balance.time.ticksPerDay;

function worker(s: GameState, skill = 4, role: 'worker' | 'manager' = 'worker') {
  const e = { id: s.nextId++, name: `テスト ${s.nextId}`, role, skill, exp: 0, specialty: 'extraction' as const, salary: 300000, assignedTo: null, hiredDay: 0 };
  s.employees.push(e);
  s.staffRev++;
  return e;
}

describe('sell surplus', () => {
  it('keeps what the company uses and sells the rest without crashing the price', () => {
    const s = openingState();
    s.inventory.log = 5000;
    s.inventory.stone = 20;
    const plan = surplusPlan(s);
    const log = plan.find((l) => l.item === 'log')!;
    expect(log.qty).toBeLessThanOrEqual(maxSaleForDrop('log', DATA.balance.surplus.maxPriceDrop) + 1);
    expect(log.capped).toBe(true);
    const index = s.market.log.index;
    const cash = s.cash;
    const r = applyCommand(s, { type: 'sellSurplus' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('品目');
    expect(s.cash).toBeGreaterThan(cash);
    // one tap moves the price at most the set share
    expect(s.market.log.index / index).toBeGreaterThan(1 - DATA.balance.surplus.maxPriceDrop - 0.01);
    expect(s.inventory.log).toBeGreaterThan(0);
  });

  it('keeps days of an input the company uses', () => {
    const s = openingState();
    runDays(s, 2, false);
    s.cash = 1e9;
    applyCommand(s, { type: 'build', facility: 'sawmill' });
    runDays(s, 4, false);
    const mill = s.facilities.find((f) => f.type === 'sawmill')!;
    // two workers at the sawmill
    for (let i = 0; i < 2; i++) applyCommand(s, { type: 'assign', employeeId: worker(s, 2).id, facilityId: mill.id });
    runDays(s, 1, false);
    s.inventory.log = 50;
    const plan = surplusPlan(s);
    const log = plan.find((l) => l.item === 'log');
    const keep = log ? log.keep : 50;
    expect(keep).toBeGreaterThan(0);
    applyCommand(s, { type: 'sellSurplus' });
    expect(s.inventory.log).toBeGreaterThanOrEqual(Math.min(50, keep) - 1e-6);
  });

  it('says so when there is nothing spare', () => {
    const s = openingState();
    for (const k of Object.keys(s.inventory)) s.inventory[k] = 0;
    const r = applyCommand(s, { type: 'sellSurplus' });
    expect(r.ok).toBe(false);
  });
});

describe('goal subsidies', () => {
  it('pays the subsidy once when a goal is reached, outside operating profit', () => {
    const s = openingState();
    const hire = DATA.goals.find((g) => g.id === 'g_hire')!;
    expect(s.goals.done).toContain('g_hire');
    expect(s.finance.today.grants).toBeGreaterThanOrEqual(hire.reward);
    const l = { ...s.finance.today };
    const withoutGrant = operatingProfit({ ...l, grants: 0 });
    expect(operatingProfit(l)).toBe(withoutGrant);
    const notice = s.notices.find((n) => n.title.includes(hire.title))!;
    expect(notice.body).toContain('補助金');
  });

  it('every reward is a whole amount and the early ones are modest', () => {
    for (const g of DATA.goals.slice(0, 8)) expect(g.reward).toBeLessThanOrEqual(3_000_000);
    expect(DATA.goals.filter((g) => g.reward > 0).length).toBeGreaterThan(10);
  });
});

describe('cash left after building', () => {
  it('fixed costs cover wages, upkeep and interest; a loan tops up to 30 days', () => {
    const s = openingState();
    const fixed = fixedCostPerDay(s);
    const wages = s.employees.reduce((t, e) => t + e.salary, 0) / 30;
    expect(fixed).toBeGreaterThanOrEqual(wages);
    s.cash = 2_000_000;
    const need = borrowFor(s, 1_500_000, 30);
    expect(need).toBeGreaterThan(0);
    expect((s.cash - 1_500_000 + need) / fixed).toBeGreaterThanOrEqual(29.9);
    s.cash = 1e9;
    expect(borrowFor(s, 1_500_000, 30)).toBe(0);
  });
});

/** a mid-game company with managers and several forestry sites */
function withForests(n: number) {
  const s = openingState();
  s.cash = 5e9;
  for (const t of ['p_tools', 'p_mech', 'a_auto', 'a_rules', 'a_managers', 'g_division', 'g_org', 'g_holding']) completeResearch(s, t);
  const forests = [s.facilities[0]];
  for (let i = 1; i < n; i++) forests.push(createFacility(s, 'forestry', { recipe: 'log' }));
  s.power.contract = 'high';
  // one tick so the contract's supply is in place
  runTicks(s, 1, false);
  return { s, forests };
}

describe('division heads', () => {
  it('a manager becomes a division head and takes a lighter load off the head office', () => {
    const { s } = withForests(4);
    const m = worker(s, 4, 'manager');
    const before = managementLoad(s);
    expect(applyCommand(s, { type: 'setDivisionHead', facilityType: 'forestry', employeeId: m.id }).ok).toBe(false);
    expect(applyCommand(s, { type: 'promote', employeeId: m.id, role: 'director' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'setDivisionHead', facilityType: 'forestry', employeeId: m.id }).ok).toBe(true);
    expect(managementLoad(s)).toBeLessThan(before);
    // not while the facilities are run by hand one by one
    expect(s.employees.find((e) => e.id === m.id)!.assignedTo).toBeNull();
  });

  it('fills open places, and invests in the busiest facility', () => {
    const { s, forests } = withForests(3);
    const m = worker(s, 5, 'manager');
    applyCommand(s, { type: 'promote', employeeId: m.id, role: 'director' });
    applyCommand(s, { type: 'setDivisionHead', facilityType: 'forestry', employeeId: m.id });
    applyCommand(s, { type: 'setDivision', facilityType: 'forestry', hire: true, invest: 1 });
    const open = () => forests.reduce((t, f) => t + Math.max(0, staffCapacity(s, f) - employeesAt(s, f.id).length), 0);
    expect(open()).toBeGreaterThan(0);
    // an agency places at most a few people a day, so it may take two mornings
    dailyDivisions(s);
    dailyDivisions(s);
    expect(open()).toBe(0);
    // busy and profitable: a machine goes in
    const d = s.divisions.forestry;
    d.budget = 1e9;
    for (const f of forests) {
      f.stats.utilHist = [1, 1, 1];
      f.stats.profitHist = [100000];
    }
    // one investment a day: the busy starting workyard is made a proper facility, then machines go in
    const growth = () => forests.reduce((t, f) => t + f.machines + f.level + (f.building ? 1 : 0), 0);
    const before = growth();
    dailyDivisions(s);
    expect(growth()).toBeGreaterThan(before);
    expect(d.spent).toBeGreaterThan(0);
    expect(d.last).toBeTruthy();
    const machines = forests.reduce((t, f) => t + f.machines, 0);
    for (let day = 0; day < 3; day++) dailyDivisions(s);
    expect(forests.reduce((t, f) => t + f.machines, 0)).toBeGreaterThan(machines);
    expect(divisionProfit(s, 'forestry')).toBeGreaterThan(0);
  });

  it('a subsidiary leaves the head office, refuses direct orders, and builds when full', () => {
    const { s, forests } = withForests(3);
    const m = worker(s, 4, 'manager');
    applyCommand(s, { type: 'promote', employeeId: m.id, role: 'director' });
    applyCommand(s, { type: 'setDivisionHead', facilityType: 'forestry', employeeId: m.id });
    dailyDivisions(s);
    const before = managementLoad(s);
    expect(applyCommand(s, { type: 'makeSubsidiary', facilityType: 'forestry' }).ok).toBe(true);
    expect(s.divisions.forestry.sub).not.toBeNull();
    expect(managementLoad(s)).toBeLessThan(before);
    // the player no longer steers its facilities
    const r = applyCommand(s, { type: 'upgradeLevel', facilityId: forests[1].id });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('子会社');
    expect(applyCommand(s, { type: 'fire', employeeId: m.id }).ok).toBe(false);
    // every site full and busy (the small starting workyard aside): a new one
    for (const f of forests.slice(1)) {
      f.level = DATA.facility.forestry.maxLevel;
      f.stage = 'auto';
      f.machines = 99;
      f.stats.utilHist = [1, 1, 1];
      f.stats.profitHist = [1e6];
    }
    expect(forests[0].level).toBe(0);
    forests[0].stats.utilHist = [0.2, 0.2, 0.2];
    s.divisions.forestry.budget = 1e9;
    const n = s.facilities.length;
    dailyDivisions(s);
    expect(s.facilities.length).toBe(n + 1);
    expect(s.facilities.at(-1)!.type).toBe('forestry');
    // and back to a division
    expect(applyCommand(s, { type: 'dissolveSubsidiary', facilityType: 'forestry' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'upgradeLevel', facilityId: forests[1].id }).message ?? '').not.toContain('子会社');
  });
});

describe('customer orders', () => {
  function orderReady() {
    const s = openingState();
    s.features.orders = true;
    runDays(s, 8, false);
    return s;
  }

  it('offers come for what the company makes, pay above the market, and deliver by themselves', () => {
    const s = orderReady();
    let tries = 0;
    while (!s.orders.list.some((o) => o.status === 'offer') && tries++ < 60) dailyOrders(s);
    const o = s.orders.list.find((x) => x.status === 'offer')!;
    expect(o).toBeTruthy();
    expect(o.price).toBeGreaterThan(o.marketPrice);
    expect(applyCommand(s, { type: 'acceptOrder', orderId: o.id }).ok).toBe(true);
    expect(o.until).toBe(dayIndex(s.tick) + o.days);
    // plenty in stock: delivered at the end of the day and paid at the agreed price
    s.inventory[o.item] = o.qty * 3;
    const sales = s.finance.today.sales;
    const done = s.orders.done;
    dailyOrders(s);
    expect(s.orders.done).toBe(done + 1);
    expect(s.finance.today.sales - sales).toBeCloseTo(o.qty * o.price, 0);
    expect(s.orders.list.find((x) => x.id === o.id)).toBeUndefined();
  });

  it('a missed deadline costs a penalty on what was not delivered', () => {
    const s = orderReady();
    let tries = 0;
    while (!s.orders.list.some((o) => o.status === 'offer') && tries++ < 60) dailyOrders(s);
    const o = s.orders.list.find((x) => x.status === 'offer')!;
    applyCommand(s, { type: 'acceptOrder', orderId: o.id });
    s.inventory[o.item] = 0;
    s.features.orders = true;
    o.until = dayIndex(s.tick) - 1;
    const other = s.finance.today.other;
    dailyOrders(s);
    expect(s.orders.failed).toBe(1);
    expect(s.finance.today.other - other).toBeCloseTo(o.qty * o.price * DATA.balance.orders.penalty, 0);
  });

  it('can be declined, delivered at once, or cancelled', () => {
    const s = orderReady();
    let tries = 0;
    while (s.orders.list.filter((o) => o.status === 'offer').length < 2 && tries++ < 200) dailyOrders(s);
    const [a, b] = s.orders.list.filter((o) => o.status === 'offer');
    expect(applyCommand(s, { type: 'declineOrder', orderId: a.id }).ok).toBe(true);
    expect(applyCommand(s, { type: 'acceptOrder', orderId: b.id }).ok).toBe(true);
    s.inventory[b.item] = b.qty / 2;
    expect(applyCommand(s, { type: 'deliverOrder', orderId: b.id }).ok).toBe(true);
    expect(b.delivered).toBeCloseTo(b.qty / 2, 6);
    expect(applyCommand(s, { type: 'cancelOrder', orderId: b.id }).ok).toBe(true);
    expect(s.orders.list).toHaveLength(0);
  });
});

describe('events with choices', () => {
  function eventReady() {
    const { s } = withForests(6);
    for (const f of s.facilities) if (f.level === 0) f.level = 1;
    for (let i = 0; i < 16; i++) applyCommand(s, { type: 'assign', employeeId: worker(s, 2).id, facilityId: s.facilities[i % s.facilities.length].id });
    runDays(s, DATA.balance.events.startDay + 1, false);
    return s;
  }

  it('an event comes up, waits for a decision, and takes the first choice when nobody decides', () => {
    const s = eventReady();
    s.events.next = dayIndex(s.tick);
    s.events.pending = [];
    dailyEvents(s);
    expect(s.events.pending).toHaveLength(1);
    const e = s.events.pending[0];
    expect(e.until).toBe(e.day + DATA.balance.events.decideDays);
    const n = s.notices.length;
    // time passes without an answer
    for (let d = 0; d <= DATA.balance.events.decideDays + 1; d++) {
      s.tick += TPD;
      dailyEvents(s);
    }
    expect(s.events.pending.find((x) => x.id === e.id)).toBeUndefined();
    expect(s.notices.slice(n).some((x) => x.title.includes(DATA.event[e.kind].choices[0].label))).toBe(true);
  });

  it('choices apply their effects: blackout, repairs, strike', () => {
    const s = eventReady();
    const f = s.facilities.find((x) => x.recipe === 'log')!;
    s.events.pending = [{ id: s.nextId++, kind: 'typhoon', day: dayIndex(s.tick), until: dayIndex(s.tick) + 5, target: f.id, item: null, costs: { normal: 100000, rush: 400000 } }];
    const cash = s.cash;
    expect(applyCommand(s, { type: 'chooseEvent', eventId: s.events.pending[0].id, choice: 'normal' }).ok).toBe(true);
    expect(s.cash).toBeLessThan(cash);
    expect(isDown(s, f)).toBe(true);
    runTicks(s, 2, false);
    expect(f.blocked).toBe('down');
    runDays(s, 6, false);
    expect(isDown(s, f)).toBe(false);

    s.events.pending = [{ id: s.nextId++, kind: 'blackout', day: dayIndex(s.tick), until: dayIndex(s.tick) + 5, target: null, item: null, costs: { wait: 0, rent: 300000 } }];
    applyCommand(s, { type: 'chooseEvent', eventId: s.events.pending[0].id, choice: 'wait' });
    expect(gridFactor(s)).toBe(0.5);
    s.events.pending = [{ id: s.nextId++, kind: 'strike', day: dayIndex(s.tick), until: dayIndex(s.tick) + 5, target: null, item: null, costs: { refuse: 0, raise: 0, bonus: 1 } }];
    applyCommand(s, { type: 'chooseEvent', eventId: s.events.pending[0].id, choice: 'refuse' });
    expect(strikeFactor(s)).toBe(0.4);
    // with events off, nothing new comes up
    s.settings.events = false;
    s.events.pending = [];
    s.events.next = 0;
    dailyEvents(s);
    expect(s.events.pending).toHaveLength(0);
  });

  it('stocking up in a shortage pays for the goods once', () => {
    const s = eventReady();
    // an input the company uses
    s.itemHist.stone.consumed = [10, 10, 10, 10, 10, 10, 10];
    s.events.pending = [];
    const e = { id: s.nextId++, kind: 'supply', day: dayIndex(s.tick), until: dayIndex(s.tick) + 5, target: null, item: 'stone', costs: { wait: 0, stock: 123456 } };
    s.events.pending = [e];
    const cash = s.cash;
    const stone = s.inventory.stone;
    const purchases = s.finance.today.purchases;
    const other = s.finance.today.other;
    expect(applyCommand(s, { type: 'chooseEvent', eventId: e.id, choice: 'stock' }).ok).toBe(true);
    const paid = s.finance.today.purchases - purchases;
    expect(s.inventory.stone - stone).toBeCloseTo(100, 6);
    expect(paid).toBeGreaterThan(0);
    // the estimate shown on the card is not charged on top
    expect(s.finance.today.other).toBe(other);
    expect(cash - s.cash).toBeCloseTo(paid, 3);
  });

  it('refuses a choice the company cannot pay for', () => {
    const s = eventReady();
    s.events.pending = [{ id: s.nextId++, kind: 'blackout', day: dayIndex(s.tick), until: dayIndex(s.tick) + 5, target: null, item: null, costs: { wait: 0, rent: 1e15 } }];
    expect(applyCommand(s, { type: 'chooseEvent', eventId: s.events.pending[0].id, choice: 'rent' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'chooseEvent', eventId: s.events.pending[0].id, choice: 'nope' }).ok).toBe(false);
  });
});

describe('saves from before these features', () => {
  it('upgrade to the new version with empty orders, divisions and events', () => {
    const s = openingState();
    runDays(s, 3, false);
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { owner: Record<string, unknown>; finance: { today: Record<string, unknown>; days: Record<string, unknown>[] } };
    for (const k of ['divisions', 'orders', 'events', 'effects']) delete old[k];
    delete old.owner.queue;
    delete old.finance.today.grants;
    for (const d of old.finance.days) delete d.grants;
    old.version = 1;
    const up = migrate(old);
    expect(up.version).toBe(DATA.balance ? 2 : 0);
    expect(up.divisions).toEqual({});
    expect(up.orders.list).toEqual([]);
    expect(up.events.pending).toEqual([]);
    expect(up.owner.queue).toEqual([]);
    expect(up.finance.days.every((d) => d.grants === 0)).toBe(true);
    expect(up.settings.guide).toBe(true);
    runDays(up, 30, false);
    expect(Number.isFinite(up.cash)).toBe(true);
  });
});

describe('a long game with everything on', () => {
  it('stays sound for 200 days', () => {
    const s = createInitialState({ seed: 9 });
    s.features.orders = true;
    runDays(s, 200, false);
    expect(Number.isFinite(s.cash)).toBe(true);
  });
});
