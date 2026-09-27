import { expect, test, type Page } from '@playwright/test';

/**
 * The improvements from the playtest, played through the real UI on a phone
 * screen: guidance for the first goals, queued taps, selling surplus, the
 * cash left after building, orders, events and division heads.
 * window.__kogyo.dev() sets up a situation directly (tests only).
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function newGame(page: Page) {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('start').click();
  await expect(page.locator('.header .company')).toBeVisible();
  // hold the clock; the tests move time themselves
  await page.evaluate(() => window.__kogyo.dispatch({ type: 'setSpeed', speed: 0 }));
}

const S = <T>(page: Page, fn: () => Promise<T> | T) => page.evaluate(fn);
const advance = (page: Page, ticks: number) => page.evaluate((n) => window.__kogyo.advance(n), ticks);
const dev = (page: Page, patch: unknown) => page.evaluate((p) => window.__kogyo.dev(p as never), patch);
const state = async (page: Page) => (await page.evaluate(() => window.__kogyo.state())) as unknown as Record<string, any>;

/** a small company past the opening: logs sold, three people at work */
async function opening(page: Page) {
  await S(page, async () => {
    const k = window.__kogyo;
    const s = (await k.state())!;
    for (let i = 0; i < 3; i++) {
      await k.dispatch({ type: 'gather', facilityId: s.facilities[0].id });
      await k.advance(30);
    }
    await k.dispatch({ type: 'sell', item: 'log', qty: 3 });
    const now = (await k.state()) as unknown as { candidates: { id: number }[] };
    for (const c of now.candidates) await k.dispatch({ type: 'hire', candidateId: c.id });
    await k.dispatch({ type: 'autoAssign' });
    await k.dispatch({ type: 'setSpeed', speed: 0 });
  });
}

test('the first goal lights the way, and taps can wait their turn', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  // on the home screen the production tab is the next step
  await expect(page.locator('[data-guide]')).toHaveAttribute('data-testid', 'nav-production');
  await page.getByTestId('nav-production').click();
  const tap = page.locator('[data-testid^=tap-]').first();
  await expect(tap).toHaveAttribute('data-guide', '');
  // three taps in a row: one works, two wait
  await tap.click();
  await tap.click();
  await tap.click();
  await expect(tap).toContainText('予約2');
  const s = await state(page);
  expect(s.owner.queue.length).toBe(2);
  // 5 seconds each at x1: 20 ticks per tap
  await advance(page, 61);
  expect((await state(page)).owner.taps).toBe(3);
  // the next goal points at the market
  await page.getByTestId('nav-home').click();
  await expect(page.locator('[data-guide]')).toHaveAttribute('data-testid', 'nav-market');
  expect(errors).toEqual([]);
});

test('surplus stock sells in one tap, keeping what is needed', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  await opening(page);
  await dev(page, { inventory: { log: 400, stone: 300 } });
  await page.getByTestId('nav-assets').click();
  const btn = page.getByTestId('sell-surplus');
  await expect(btn).toContainText('品目を売る');
  const cash = (await state(page)).cash;
  await btn.click();
  await expect(page.locator('.toast.good')).toContainText('品目を');
  const s = await state(page);
  expect(s.cash).toBeGreaterThan(cash);
  expect(s.inventory.log).toBeLessThan(400);
  expect(errors).toEqual([]);
});

test('the build sheet shows the cash left and offers a loan when it is thin', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  await opening(page);
  await dev(page, { features: ['build'], cash: 1_700_000 });
  await page.getByTestId('nav-production').click();
  await page.getByTestId('open-build').click();
  await page.getByTestId('build-sawmill').click();
  const after = page.getByTestId('cash-after');
  await expect(after).toContainText('建設後の資金');
  await expect(after).toContainText('日分');
  const borrow = page.getByTestId('borrow-for-build');
  await expect(borrow).toBeVisible();
  await borrow.click();
  expect((await state(page)).loan).toBeGreaterThan(0);
  await page.getByTestId('build-confirm').click();
  expect((await state(page)).facilities.some((f: { type: string }) => f.type === 'sawmill')).toBe(true);
  expect(errors).toEqual([]);
});

test('a customer order is accepted and delivered from stock', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  await opening(page);
  await dev(page, { features: ['orders'] });
  // offers come every few days for what the company makes
  let offers = 0;
  for (let d = 0; d < 40 && offers === 0; d++) {
    await advance(page, 240);
    offers = ((await state(page)).orders.list as { status: string }[]).filter((o) => o.status === 'offer').length;
  }
  expect(offers).toBeGreaterThan(0);
  await page.getByTestId('nav-home').click();
  await page.getByTestId('orders-card').click();
  await page.getByTestId('accept-order').first().click();
  const s = await state(page);
  const o = (s.orders.list as { status: string; item: string; qty: number }[]).find((x) => x.status === 'active')!;
  expect(o).toBeTruthy();
  await dev(page, { inventory: { [o.item]: o.qty * 3 } });
  await expect(page.getByTestId('order').first()).toBeVisible();
  await page.getByTestId('deliver-now').first().click();
  await expect.poll(async () => (await state(page)).orders.done).toBe(1);
  expect(errors).toEqual([]);
});

test('an event asks for a decision on the home screen', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  await opening(page);
  await dev(page, { features: ['build'], build: [{ type: 'forestry', count: 1, recipe: 'log' }], event: 'typhoon' });
  await page.getByTestId('nav-home').click();
  const card = page.getByTestId('event');
  await expect(card).toContainText('台風');
  await expect(card.getByTestId('choice-rush')).toContainText('円');
  await card.getByTestId('choice-normal').click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('effect')).toContainText('修理中');
  const s = await state(page);
  expect(s.effects.some((x: { kind: string }) => x.kind === 'down')).toBe(true);
  expect(errors).toEqual([]);
});

test('a division head takes over a kind of facility, then it becomes a subsidiary', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  await opening(page);
  await dev(page, {
    cash: 5e9,
    features: ['build'],
    research: ['p_tools', 'p_mech', 'a_auto', 'a_rules', 'a_managers', 'g_org', 'g_division', 'g_holding'],
    build: [{ type: 'forestry', count: 3, recipe: 'log' }],
    employees: [{ role: 'manager', skill: 5 }],
  });
  await page.getByTestId('nav-more').click();
  await page.getByTestId('menu-company').click();
  await page.getByTestId('org-forestry').click();
  await page.getByTestId('promote-appoint').first().click();
  await expect(page.getByTestId('division-head')).toContainText('全施設の生産');
  let s = await state(page);
  expect(s.divisions.forestry.headId).not.toBeNull();
  // a day later the head has filled the open places
  await advance(page, 240);
  s = await state(page);
  expect(s.divisions.forestry.last).toBeTruthy();
  await page.getByTestId('make-subsidiary').click();
  await page.getByRole('button', { name: '子会社にする' }).last().click();
  await expect(page.locator('.page-title h1')).toContainText('株式会社');
  s = await state(page);
  expect(s.divisions.forestry.sub).not.toBeNull();
  // its facilities no longer take direct orders
  const id = (s.facilities as { id: number; type: string }[]).find((f) => f.type === 'forestry' && f.id > 3)!.id;
  const r = await page.evaluate((fid) => window.__kogyo.dispatch({ type: 'upgradeLevel', facilityId: fid }), id);
  expect(r.ok).toBe(false);
  expect(errors).toEqual([]);
});
