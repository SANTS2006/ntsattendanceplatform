import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real API + web app (no mocks).
 * Prerequisites: TEST database (a Neon branch) migrated and seeded with `npm run db:seed --workspace backend`.
 * The API runs in sandbox mode (captured emails, in-memory files) so tests never send real email.
 * Browser: set PW_CHANNEL=msedge|chrome to use an installed browser, or run
 * `npx playwright install chromium` once and leave PW_CHANNEL unset.
 */
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    channel,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
  ],
  webServer: [
    { command: 'npm run dev:sandbox --workspace backend', cwd: '..', url: 'http://localhost:4000/health/live', reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm run dev --workspace frontend', cwd: '..', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 120_000 },
  ],
});
