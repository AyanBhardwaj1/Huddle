import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests: real box UI and player app pages (built dist served by the engine) against an
 * engine child process with the real replay feed and question engine at 10x. `pnpm e2e`.
 * Only Chromium is used (`pnpm exec playwright install --only-shell chromium`).
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  outputDir: '../test-results',
  use: {
    browserName: 'chromium',
    headless: true,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    // Several phones and the box share one headless browser: keep background pages running at full
    // speed (timers and animation frames), like the foreground page on each real device.
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
});
