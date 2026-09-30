import { defineConfig, devices } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

// Load frontend port from config/ports.json (single source of truth)
function getFrontendPort(): string {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(url.fileURLToPath(import.meta.url), '../../config/ports.json'), 'utf-8'),
    );
    return String(raw.frontend_port ?? 5173);
  } catch {
    return '5173';
  }
}

const FRONTEND_PORT = getFrontendPort();
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/browser/**',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: BASE_URL,
    // These are `PlaywrightTestOptions` (i.e. `use`) fields — at the top level of
    // `defineConfig` they are not part of the `Config` type and are ignored.
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
