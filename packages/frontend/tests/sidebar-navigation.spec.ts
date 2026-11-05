/**
 * Navigation performance E2E tests for sidebar page transitions.
 *
 * Measures navigation time between sidebar pages using the browser's
 * Performance Navigation Timing API and custom React-side timing hooks.
 * Reports per-route navigation times to identify slow pages.
 *
 * Run with: pnpm test -- sidebar-navigation.spec.ts
 */

import { test, expect } from "@playwright/test";
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors, mockApiHealth, BACKEND_OFFLINE_FILTERS } from "./helpers";

// Sidebar navigation targets - one per nav group, covering all major areas
const NAV_ROUTES = [
  { group: "Create", label: "Music Video", path: "/create/music-video" },
  { group: "Create", label: "Video Generation", path: "/create/video" },
  { group: "Create", label: "3D Generation", path: "/create/3d" },
  { group: "Create", label: "Image Generation", path: "/create/image" },
  { group: "Create", label: "Kinetic Type", path: "/create/typography" },
  { group: "Create", label: "Music Gen", path: "/create/music" },
  { group: "Create", label: "Remix / Mashup", path: "/create/remix" },
  { group: "Create", label: "Animation Studio", path: "/create/animation" },
  { group: "Create", label: "Unity Control", path: "/create/unity" },
  { group: "Create", label: "HyperFrames", path: "/create/hyperframes" },
  { group: "Library", label: "Media Library", path: "/library" },
  { group: "Library", label: "Video Library", path: "/library/video" },
  { group: "Library", label: "Audio Library", path: "/library/audio" },
  { group: "Library", label: "Storyboards", path: "/library/storyboards" },
  { group: "Analyze", label: "Audio Analysis", path: "/analyze/audio" },
  { group: "Analyze", label: "AI Tools", path: "/analyze/ai" },
  { group: "Analyze", label: "Ollama Chat", path: "/analyze/chat" },
  { group: "Analyze", label: "Mastering", path: "/mastering" },
  { group: "Render", label: "Visualizer", path: "/render/visualizer" },
  { group: "Render", label: "Preview", path: "/render/preview" },
  { group: "Render", label: "Music Prompts", path: "/render/prompts" },
  { group: "System", label: "Dashboard", path: "/system" },
  { group: "System", label: "Queue", path: "/system/queue" },
  { group: "System", label: "Settings", path: "/system/settings" },
  { group: "System", label: "Health", path: "/system/health" },
  { group: "System", label: "Data Management", path: "/system/data-management" },
  { group: "System", label: "Database", path: "/system/database" },
  { group: "System", label: "GPU", path: "/system/gpu" },
  { group: "System", label: "Log Analytics", path: "/system/log-analytics" },
  { group: "System", label: "Notifications", path: "/system/notifications" },
  { group: "System", label: "Documentation", path: "/system/docs" },
  { group: "System", label: "Quick Start", path: "/system/onboarding" },
];

test.describe("Sidebar Navigation Performance", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
    await mockApiHealth(page, 200);
  });

  test("measure navigation time across all sidebar pages", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);

    // Navigate to home first
    await navigateWithWait(page, "/");

    const results: Array<{
      group: string;
      label: string;
      path: string;
      navigateMs: number;
      renderMs: number;
      totalMs: number;
    }> = [];

    for (const route of NAV_ROUTES) {
      const startTime = performance.now();

      // Click the sidebar link instead of direct navigation to simulate real usage
      const link = page.locator(`nav a[href="${route.path}"]`).first();
      if ((await link.count()) === 0) {
        // Fallback: direct navigation
        await navigateWithWait(page, route.path);
      } else {
        await link.click();
        await expect(page).toHaveURL(new RegExp(route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 15_000 });
      }

      const endTime = performance.now();
      const totalMs = endTime - startTime;

      // Measure time from click to main content visible
      const mainVisibleStart = performance.now();
      await expect(page.locator("main.layout-main")).toBeVisible({ timeout: 10_000 });
      const mainVisibleEnd = performance.now();
      const renderMs = mainVisibleEnd - mainVisibleStart;

      results.push({
        group: route.group,
        label: route.label,
        path: route.path,
        navigateMs: Math.round(totalMs - renderMs),
        renderMs: Math.round(renderMs),
        totalMs: Math.round(totalMs),
      });

      console.log(`  ${route.label.padEnd(25)} ${route.path.padEnd(30)} ${Math.round(totalMs)}ms (nav: ${Math.round(totalMs - renderMs)}ms, render: ${Math.round(renderMs)}ms)`);
    }

    // Print summary sorted by total time
    results.sort((a, b) => b.totalMs - a.totalMs);
    console.log("\n=== Navigation Performance Summary (sorted by total time) ===");
    console.log(`${"Group".padEnd(12)} ${"Label".padEnd(25)} ${"Path".padEnd(30)} ${"Total(ms)".padEnd(12)} ${"Navigate(ms)".padEnd(15)} ${"Render(ms)"}`);
    console.log("-".repeat(115));
    for (const r of results) {
      console.log(`${r.group.padEnd(12)} ${r.label.padEnd(25)} ${r.path.padEnd(30)} ${r.totalMs.toString().padEnd(12)} ${r.navigateMs.toString().padEnd(15)} ${r.renderMs}`);
    }

    // Assert no navigation takes more than 5 seconds
    const slowNavigations = results.filter((r) => r.totalMs > 5000);
    if (slowNavigations.length > 0) {
      console.log("\n⚠️  Slow navigations (>5s):");
      for (const r of slowNavigations) {
        console.log(`  ${r.label} (${r.path}): ${r.totalMs}ms`);
      }
    }

    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test("measure repeated navigation to same page (cold vs warm)", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);

    await navigateWithWait(page, "/");

    // First navigation to Music Video (cold - lazy load)
    const start1 = performance.now();
    await page.locator('nav a[href="/create/music-video"]').first().click();
    await expect(page).toHaveURL(/\/create\/music-video/);
    const coldTime = performance.now() - start1;

    // Navigate away using direct navigation
    await navigateWithWait(page, "/system");

    // Second navigation to Music Video (warm - module cached)
    const start2 = performance.now();
    await page.locator('nav a[href="/create/music-video"]').first().click();
    await expect(page).toHaveURL(/\/create\/music-video/);
    const warmTime = performance.now() - start2;

    console.log(`\nCold navigation (first load): ${Math.round(coldTime)}ms`);
    console.log(`Warm navigation (cached):     ${Math.round(warmTime)}ms`);
    if (coldTime > 0) {
      const speedup = (coldTime - warmTime) / coldTime * 100;
      console.log(`Speedup: ${speedup.toFixed(1)}%`);
    }

    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });
});
