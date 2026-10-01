import { test, expect } from "@playwright/test";
import {
  navigateWithWait,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  expectRedirectedTo,
} from "./helpers";
// Single source of truth for the version, matching Layout.tsx. Hardcoding it
// here made this test fail on every release bump. Read via fs rather than a
// bare JSON import: the Playwright runner is ESM and would require a
// `type: json` import attribute. Same approach as playwright.config.ts.
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const APP_VERSION = (
  JSON.parse(
    fs.readFileSync(
      path.resolve(url.fileURLToPath(import.meta.url), "../../package.json"),
      "utf-8",
    ),
  ) as { version: string }
).version;

test.describe("App Shell", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test("home route loads dashboard", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, "/");
    // Scope to main content to avoid matching the sidebar's h1
    await expect(page.locator("main h1").first()).toContainText("Drop your song");
    expectNoConsoleErrors(errors, ["502", "Bad Gateway", "ECONNREFUSED"]);
  });

  test("sidebar navigation exists with key sections", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, "/");
    const sidebar = page.locator("aside.sidebar-container");
    await expect(sidebar).toBeVisible();
    // Verify all nav sections are present
    const sections = page.locator(".nav-section-title");
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(4);
    expectNoConsoleErrors(errors, ["502", "Bad Gateway", "ECONNREFUSED"]);
  });

  test("footer renders version and copyright", async ({ page }) => {
    await navigateWithWait(page, "/");
    const footer = page.locator("footer.layout-footer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(`V${APP_VERSION}`);
    await expect(footer).toContainText("2026");
  });

  test("unknown route shows NotFound or redirects", async ({ page }) => {
    await navigateWithWait(page, "/this-route-does-not-exist");
    const main = page.locator("main").first();
    await expect(main).toContainText(/404|Not Found|Page not found/);
  });

  test("layout main content area is visible", async ({ page }) => {
    await navigateWithWait(page, "/");
    const main = page.locator("main.layout-main");
    await expect(main).toBeVisible();
  });

  test("redirect routes resolve correctly", async ({ page }) => {
    // Use expectRedirectedTo: client-side <Navigate> fires after domcontentloaded,
    // so a synchronous page.url() check races the redirect and sees the source path.
    await navigateWithWait(page, "/music-video");
    await expectRedirectedTo(page, /\/music-video-wizard/);
  });

  test("sidebar CTA navigates to music video wizard", async ({ page }) => {
    await navigateWithWait(page, "/");
    const cta = page.locator('.sidebar-cta, a[href*="music-video-wizard"]').first();
    if ((await cta.count()) > 0) {
      await cta.click();
      await expect(page).toHaveURL(/\/music-video-wizard/);
    }
  });
});
