import { expect, test, type Page } from '@playwright/test';

/**
 * Plays the opening through the real UI on a 390x844 phone screen. Game time
 * is fast-forwarded with window.__kogyo.advance(), which runs the same engine
 * ticks the clock would run.
 */

declare global {
  interface Window {
    __kogyo: {
      state: () => {
        companyName: string;
        cash: number;
        inventory: Record<string, number>;
        employees: { assignedTo: number | null }[];
        features: Record<string, boolean>;
        owner: { taps: number; job: unknown };
      } | null;
      dispatch: (cmd: unknown) => { ok: boolean };
      advance: (ticks: number) => number;
    };
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function newGame(page: Page, name = 'テスト工業') {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('company-name').fill(name);
  await page.getByTestId('start').click();
  await expect(page.locator('.header .company')).toHaveText(name);
}

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'page must not scroll sideways').toBeLessThanOrEqual(0);
}

const advance = (page: Page, ticks: number) => page.evaluate((n) => window.__kogyo.advance(n), ticks);
const state = (page: Page) => page.evaluate(() => window.__kogyo.state()!);

test('starts a company on a phone screen', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  await expect(page.getByTestId('cash')).toHaveText('300万円');
  await expect(page.getByTestId('goal')).toContainText('原木を3回集めよう');
  for (const tab of ['home', 'production', 'assets', 'market', 'more']) await expect(page.getByTestId(`nav-${tab}`)).toBeVisible();
  await noSideScroll(page);
  expect(errors).toEqual([]);
});

test('the opening: gather by hand, sell, hire and hand the work over', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  await page.getByTestId('nav-production').click();
  const tap = page.locator('[data-testid^=tap-]').first();
  for (let i = 0; i < 3; i++) {
    await tap.click();
    await advance(page, 60);
  }
  let s = await state(page);
  expect(s.owner.taps).toBe(3);
  expect(s.inventory.log).toBeGreaterThanOrEqual(3);
  expect(s.features.market).toBe(true);

  // sell the logs on the market
  await page.getByTestId('nav-market').click();
  await page.getByTestId('market-log').click();
  await page.getByRole('button', { name: 'MAX' }).first().click();
  await page.getByTestId('sell').click();
  s = await state(page);
  expect(s.inventory.log).toBe(0);
  expect(s.cash).toBeGreaterThan(3_000_000);
  expect(s.features.hire).toBe(true);

  // hire the first applicant and let the company place them
  await page.getByTestId('nav-more').click();
  await page.getByTestId('menu-staff').click();
  await page.getByRole('tab', { name: /応募者/ }).click();
  await page.getByTestId('hire').first().click();
  await page.getByRole('tab', { name: /社員/ }).click();
  await page.getByTestId('auto-assign').click();
  s = await state(page);
  expect(s.employees.length).toBe(1);
  expect(s.employees[0].assignedTo).not.toBeNull();

  // with someone on the job, time can be sped up and logs pile up without taps
  await expect(page.getByRole('button', { name: '4倍速' })).toBeEnabled();
  const before = s.inventory.log;
  await advance(page, 240);
  s = await state(page);
  expect(s.inventory.log).toBeGreaterThan(before);
  await noSideScroll(page);
  expect(errors).toEqual([]);
});

test('every screen opens without errors or sideways scrolling', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  for (const tab of ['home', 'production', 'assets', 'market', 'more']) {
    await page.getByTestId(`nav-${tab}`).click();
    await noSideScroll(page);
  }
  for (const screen of ['staff', 'research', 'logistics', 'power', 'finance', 'company', 'world', 'encyclopedia', 'notices', 'settings']) {
    await page.getByTestId('nav-more').click();
    await page.getByTestId(`menu-${screen}`).click();
    await expect(page.locator('.page-title h1')).toBeVisible();
    await noSideScroll(page);
  }
  // a facility, its tabs, and the build list
  await page.getByTestId('nav-production').click();
  await page.locator('[data-testid^=facility-]').first().click();
  for (const t of ['生産', '費用', '人員', '自動化', '概要']) {
    await page.getByRole('tab', { name: t }).click();
    await noSideScroll(page);
  }
  await page.getByRole('button', { name: '戻る' }).click();
  // building unlocks later in the opening; the list is still reachable from the encyclopedia
  await expect(page.getByTestId('open-build')).toBeDisabled();
  await page.getByTestId('nav-more').click();
  await page.getByTestId('menu-encyclopedia').click();
  await page.getByRole('tab', { name: /施設/ }).click();
  await page.locator('.dex button:not([disabled])').first().click();
  await expect(page.locator('[data-testid^=build-]').first()).toBeVisible();
  await noSideScroll(page);
  expect(errors).toEqual([]);
});

test('the company survives a reload', async ({ page }) => {
  await newGame(page, '再読込テスト');
  await page.getByTestId('nav-production').click();
  await page.locator('[data-testid^=tap-]').first().click();
  await advance(page, 60);
  await page.evaluate(() => window.__kogyo.dispatch({ type: 'setSpeed', speed: 0 }));
  const taps = (await state(page)).owner.taps;
  await page.reload();
  await expect(page.locator('.header .company')).toHaveText('再読込テスト');
  const s = await state(page);
  expect(s.owner.taps).toBe(taps);
  expect(s.inventory.log).toBeGreaterThanOrEqual(1);
});

test('a save can be exported and read back', async ({ page }) => {
  await newGame(page, '書き出しテスト');
  await page.getByTestId('nav-more').click();
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('export').click();
  const text = await page.getByLabel('書き出したセーブ').inputValue();
  expect(text.startsWith('KOGYO1:')).toBe(true);
  // delete the company from the settings, then load the export on the first screen
  await page.getByRole('button', { name: '会社を消す' }).click();
  await page.getByRole('button', { name: '消して最初から' }).click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByRole('button', { name: '書き出したセーブを読み込む' }).click();
  await page.getByLabel('セーブ').fill(text);
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.header .company')).toHaveText('書き出しテスト');
});

test('the 3D estate draws and opens a facility on tap', async ({ page }) => {
  const errors = watchErrors(page);
  await newGame(page);
  const world = page.getByTestId('world');
  await expect(world).toBeVisible();
  await expect(world.locator('canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  // tap around the middle of the estate until a building answers
  const box = (await world.locator('canvas').boundingBox())!;
  const back = page.getByRole('button', { name: '戻る' });
  let opened = false;
  for (const [dx, dy] of [[0, 0], [30, 0], [-30, 0], [0, 20], [0, -20], [40, 15], [-40, -15], [40, -15], [-40, 15], [60, 0], [-60, 0]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    if (await back.isVisible()) {
      opened = true;
      break;
    }
  }
  expect(opened, 'tapping a building opens its screen').toBe(true);
  expect(errors).toEqual([]);
});

test('screenshots of the main screens', async ({ page }, info) => {
  await newGame(page);
  await page.evaluate(() => window.__kogyo.dispatch({ type: 'setSpeed', speed: 0 }));
  const shots: [string, () => Promise<void>][] = [
    ['home', async () => page.getByTestId('nav-home').click()],
    ['production', async () => page.getByTestId('nav-production').click()],
    ['assets', async () => page.getByTestId('nav-assets').click()],
    ['market', async () => page.getByTestId('nav-market').click()],
    ['more', async () => page.getByTestId('nav-more').click()],
  ];
  for (const [name, go] of shots) {
    await go();
    await page.waitForTimeout(300);
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  }
});
