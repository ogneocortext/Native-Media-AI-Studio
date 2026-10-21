/**
 * onboarding-flow.spec.ts — the 5-minute path, end to end.
 *
 * Plan O3 acceptance (creative-onboarding-ux-2026-10.md):
 *   - First-time users see the onboarding flow automatically
 *   - Flow completes on a typical track
 *   - Exported MP4 is valid (ffprobe check)
 *   - Success state celebrates the output
 *   - Subsequent visits go to the normal dashboard (onboarding skipped)
 *   - The flow is drivable end-to-end
 *
 * The path itself is described in `docs/ux/5-minute-path.md`.
 */

import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const TEST_AUDIO = "test-10s.wav";
/**
 * Paths resolve from this file's location, not the process cwd — Playwright
 * runs from `packages/frontend`, but the fixtures and the rendered output
 * live at the repo root.
 */
const TEST_DIR = path.dirname(import.meta.filename);
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
const TEST_AUDIO_PATH = path.join(TEST_DIR, TEST_AUDIO);
const OUTPUT_DIR = path.join(REPO_ROOT, "output", "video");

/** Run ffprobe to get duration in seconds, or null. */
function ffprobeDuration(file: string): number | null {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "${file}"`,
      { encoding: "utf-8", timeout: 10000 },
    );
    const m = out.match(/duration=([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  } catch {
    return null;
  }
}

/** Clear the first-run flag so each test starts as a new user. */
async function clearFirstRun(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("nma.firstRunDone");
      window.sessionStorage.removeItem("nma.quickStartBannerDismissed");
    } catch {
      /* storage unavailable */
    }
  });
}

test.describe("Onboarding — the 5-minute path", () => {
  test.beforeEach(async ({ page }) => {
    await clearFirstRun(page);
  });

  test("the path is reachable and states the whole bargain in one line", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-flow")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Drop a track, get a video/i }),
    ).toBeVisible();
    // The exit is always visible, never guilt-tripped.
    await expect(page.getByTestId("onboarding-exit")).toBeVisible();
  });

  test("exiting the path lands on the normal studio", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByTestId("onboarding-exit").click();
    await expect(page).toHaveURL(/\/$/);
    // The Dashboard, not the path.
    await expect(page.getByTestId("onboarding-flow")).toHaveCount(0);
  });

  test("a first-time user with an empty library is sent to the path", async ({
    page,
  }) => {
    // Empty the library so the gate applies.
    await page.route("**/api/audio/files", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByTestId("onboarding-flow")).toBeVisible();
  });

  test("a returning user goes to the normal dashboard, not the path", async ({
    page,
  }) => {
    // The flag is set — the user has already been through the path.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("nma.firstRunDone", "1");
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/onboarding/);
    await expect(page.getByTestId("onboarding-flow")).toHaveCount(0);
  });

  test("a failure carries its own fix and one button", async ({ page }) => {
    test.setTimeout(120_000);
    // A file the backend cannot analyse fails the analysis step.
    await page.goto("/onboarding");
    await page.getByTestId("onboarding-file-input").setInputFiles({
      name: "not-audio.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this is not audio"),
    });

    // The error branch is the only branch the path allows, and it must
    // carry the fix with it.
    const failure = page.getByTestId("onboarding-error");
    await expect(failure).toBeVisible({ timeout: 60000 });
    await expect(failure).toContainText(/couldn't be (read|uploaded)/i);
    // One button to fix it, and one to pick a different track.
    await expect(page.getByTestId("onboarding-retry")).toBeVisible();
    await expect(page.getByTestId("onboarding-choose-another")).toBeVisible();
  });

  test("the full path runs: add → analyze → look → watch → render → success", async ({
    page,
  }) => {
    test.setTimeout(420_000);

    await page.goto("/onboarding");

    // Step 1 — add a track.
    await page.getByTestId("onboarding-file-input").setInputFiles(TEST_AUDIO_PATH);
    await expect(page.getByTestId("onboarding-analyzing")).toBeVisible({
      timeout: 15000,
    });

    // Step 2/3 — analysis is automatic; the look is pre-accepted.
    await expect(page.getByTestId("onboarding-look")).toBeVisible({
      timeout: 120000,
    });
    // The reason is plain language, never a percentage.
    await expect(page.getByTestId("onboarding-look")).not.toContainText("%");

    // Step 4 — one click accepts the look.
    await page.getByTestId("onboarding-looks-good").click();
    await expect(page.getByTestId("onboarding-watch")).toBeVisible();
    // The render decision is one button, and the spec is stated before pressing.
    await expect(page.getByTestId("onboarding-export")).toBeVisible();
    await expect(page.getByTestId("onboarding-export")).toContainText(
      /Make my clip/i,
    );

    // Step 5 — render.
    await page.getByTestId("onboarding-export").click();

    // Step 6 — success. The path renders locally (the `visualization`
    // method), so a failure here is a real failure, not a degradation to
    // tolerate: the acceptance criterion is a valid exported MP4.
    const success = page.getByTestId("onboarding-success");
    await expect(success).toBeVisible({ timeout: 300000 });

    // The clip plays in place — the output is the celebration.
    const video = page.getByTestId("onboarding-success-video");
    await expect(video).toBeVisible();
    const src = await video.getAttribute("src");
    expect(src).toBeTruthy();

    // The exported MP4 is valid: ffprobe reports a duration.
    const local = path.join(OUTPUT_DIR, path.basename(src ?? ""));
    expect(
      fs.existsSync(local),
      `expected the rendered clip at ${local}`,
    ).toBe(true);
    const dur = ffprobeDuration(local);
    expect(dur, "ffprobe could not read the rendered clip").not.toBeNull();
    expect(dur!).toBeGreaterThan(0);
    // The clip is 10s (tolerance for the render's frame quantization).
    expect(dur!).toBeLessThan(12);
  });
});
