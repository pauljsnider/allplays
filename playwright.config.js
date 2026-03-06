const { defineConfig, devices } = require('@playwright/test');
const { resolveShard, resolveSuiteSelection } = require('./config/playwright-suite-strategy.cjs');
const { buildReporters, resolveGrepInvert } = require('./config/playwright-reliability.cjs');

const suiteSelection = resolveSuiteSelection(process.env);
const shard = resolveShard(process.env);

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: buildReporters(process.env),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'python3 -m http.server 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  grep: suiteSelection.grep,
  grepInvert: resolveGrepInvert(process.env),
  shard,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
