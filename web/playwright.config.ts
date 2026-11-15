import { defineConfig, devices } from '@playwright/test';

// Runs against the full stack. Default: `docker compose up` on https://localhost.
// The internal CA is not trusted on CI runners, so certificate errors are ignored for tests only.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://localhost',
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 768 },
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
});
