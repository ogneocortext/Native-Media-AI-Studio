---
name: playwright
description: >
  Run Playwright browser tests against a local dev server. Use whenever the user
  mentions browser testing, Playwright, E2E tests, screenshot tests, UI tests,
  smoke tests, automated browser checks, running the browser test harness,
  recording test scripts, checking console errors in the browser, or wants to
  verify the app works end-to-end in Chromium.
---

# Playwright Browser Testing

Runs Playwright scripts against the locally-running Moto Monitor dev server
(Vite on `:5173`, Express backend on `:3001`).

## Prerequisites

Before running any browser test, verify the servers are up:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/system
```

If either returns non-200 or connection refused, start the servers first:

```bash
# Vite dev server
npx vite --port 5173

# Express backend
node server/index.js
```

## Project Layout

- **`browser-test/run.mjs`** — Custom browser test harness. Walks every tab, clicks interactions, collects console errors / failed requests, and writes a JSON report + screenshots to `browser-test/out/`.
- **`browser-test/out/report.json`** — Structured test results from the last run.
- **`browser-test/out/screenshots/`** — Full-page screenshots per step.
- **`playwright`** is a dev dependency (installed in `node_modules`).
- No `playwright.config.*` exists — the custom harness uses the Playwright API directly.

## Helper Scripts

The skill ships with two helper scripts under `scripts/`:

- **`scripts/check-servers.mjs`** — Verifies both Vite and Express are responding before tests. Exit code 0 = ready.
- **`scripts/summarize-report.mjs`** — Reads `browser-test/out/report.json` and prints a human-readable pass/fail summary.

## Common Tasks

### 1. Run the full browser test harness

```bash
node browser-test/run.mjs
```

This runs the full tab-walk + interaction suite, prints a summary to stdout, and writes results to `browser-test/out/`.

### 2. Run the harness with a custom app URL

```bash
APP_URL=http://localhost:8080/ node browser-test/run.mjs
```

### 3. Check server health before tests

```bash
node ~/.agents/skills/playwright/scripts/check-servers.mjs
```

### 4. Summarize the last test run

```bash
node ~/.agents/skills/playwright/scripts/summarize-report.mjs
```

### 5. Run a one-off Playwright script

For quick ad-hoc checks, write an inline `.mjs` script using the Playwright API:

```js
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/');
// ... your checks ...
await browser.close();
```

Save it (e.g. `browser-test/adhoc.mjs`) and run with `node`. Clean it up afterward.

### 6. Record a new test with Playwright Inspector (codegen)

Generate a script by interacting with the browser — useful for creating new test steps:

```bash
npx playwright codegen http://localhost:5173/
```

This opens a browser and records your actions as Playwright code.

## Key Details

- **Browser**: Chromium only (the harness calls `chromium.launch()`).
- **Viewport**: 1440 × 1000 (configured in `run.mjs`).
- **Wait strategy**: `networkidle` for page loads, then explicit `sleep()` for async renders.
- **Report format**: JSON with `steps[]`, each containing `name`, `ok`, `error`, `problems[]`, and `allEvents[]`.

## Writing New Test Steps

To add a step to the harness, add a new `await step('name', async () => { ... })` call in `browser-test/run.mjs`. The `step` helper automatically captures console errors, page errors, and failed requests during the step. Use `sleep(ms)` for waits (already imported) and Playwright locators for interactions.

Example:

```js
await step('battery-toggle-health', async () => {
  await page.locator('.tab', { hasText: 'Battery' }).first().click();
  await sleep(800);
  const btn = page.locator('button', { hasText: 'Health' });
  if (await btn.count()) await btn.click();
  await sleep(500);
});
```

## Troubleshooting

- **`playwright` not found**: Run `npm install` — it's listed as a dev dependency.
- **Browser not installed**: Run `npx playwright install chromium`.
- **Servers not running**: Check prerequisites above.
- **Timeouts**: The harness uses hardcoded waits. If the app is slow, increase `sleep()` values or adjust `waitForSelector` timeouts.
