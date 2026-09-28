import { expect, test, type Page } from '@playwright/test';

/**
 * Sound effects, with a counting stand-in for the browser's AudioContext
 * (headless browsers have no speaker to listen to). Checks that sounds start
 * only after a touch, follow taps and finished work, and stop when switched off.
 */

async function fakeAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __sounds: number[]; AudioContext: unknown };
    w.__sounds = [];
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const node = () => ({ connect: (n: unknown) => n, gain: param(), frequency: param(), type: '' });
    class FakeContext {
      state = 'suspended';
      sampleRate = 48000;
      currentTime = 0;
      destination = node();
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      createGain() {
        return node();
      }
      createBiquadFilter() {
        return node();
      }
      createOscillator() {
        const o = node() as ReturnType<typeof node> & { start(): void; stop(): void };
        o.start = () => w.__sounds.push(performance.now());
        o.stop = () => {};
        return o;
      }
      createBuffer(_c: number, n: number) {
        return { getChannelData: () => new Float32Array(n) };
      }
      createBufferSource() {
        return { ...node(), buffer: null, start() {}, stop() {} };
      }
    }
    w.AudioContext = FakeContext;
  });
}

const played = (page: Page) => page.evaluate(() => (window as unknown as { __sounds: number[] }).__sounds.length);

test('sounds follow taps and finished work, and the switch in settings turns them off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeAudio(page);
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('start').click();
  await expect(page.locator('.header .company')).toBeVisible();
  await page.evaluate(() => window.__kogyo.dispatch({ type: 'setSpeed', speed: 0 }));

  // moving between screens ticks; the first touch has started the audio
  await page.getByTestId('nav-production').click();
  await expect.poll(() => played(page)).toBeGreaterThan(0);

  // the owner's own work: a sound on the tap, another when it is done
  let n = await played(page);
  await page.locator('[data-testid^=tap-]').first().click();
  await expect.poll(() => played(page)).toBeGreaterThan(n);
  n = await played(page);
  await page.evaluate(() => window.__kogyo.advance(60));
  await expect.poll(() => played(page)).toBeGreaterThan(n);

  // switched off in settings: silence, and it stays off after a reload
  await page.getByTestId('nav-more').click();
  await page.getByTestId('menu-settings').click();
  const sw = page.getByRole('switch', { name: '効果音' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('音量')).toHaveCount(0);
  n = await played(page);
  await page.getByTestId('nav-production').click();
  await page.locator('[data-testid^=tap-]').first().click();
  await page.evaluate(() => window.__kogyo.advance(60));
  await page.waitForTimeout(300);
  expect(await played(page)).toBe(n);

  await page.reload();
  await expect(page.locator('.header .company')).toBeVisible();
  await page.getByTestId('nav-more').click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByRole('switch', { name: '効果音' })).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: 'test-results/sound-settings.png' });
  expect(errors).toEqual([]);
});
