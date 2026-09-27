import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/kogyo-game/`,
    ...devices['iPhone 13'],
    // iPhone 13 is 390x844; run it in Chromium (the only browser installed in CI)
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    screenshot: 'only-on-failure',
    // WebGL through SwiftShader so the 3D estate renders in headless CI
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/kogyo-game/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
