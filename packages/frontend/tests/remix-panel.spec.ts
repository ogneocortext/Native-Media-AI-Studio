/**
 * Remix / Mashup panel — Windows e2e pass over the Phase 3 controls.
 *
 * Covers the controls the remix-mashup plan's frontend lane added: the A1
 * handoff that opens the panel, A6's timeline view, A7's key advisory, A4's
 * per-layer sliders and audition, and A3's audible preview.
 *
 * Machine-independent by construction: instead of hardcoding a library track,
 * the spec asks the backend which track the panel can actually source from and
 * selects that one, mirroring `matchSource`'s normalization plus the fixture
 * guard. A hardcoded name would pass on one machine and silently select
 * nothing on the next.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  cleanupRoutes,
  expectNoConsoleErrors,
  navigateWithWait,
  setupConsoleErrorCapture,
  BACKEND_OFFLINE_FILTERS,
  getBaseUrl,
} from "./helpers";

/**
 * A track whose analysis is not cached legitimately 404s (the visualizer asks
 * for it on load and falls back to the live-audio path). Those are environment
 * facts, not defects, so they are excluded rather than hidden by dropping the
 * console assertion entirely.
 */
const KNOWN_ENV_FILTERS = [
  "Failed to load resource: the server responded with a status of 404",
  ...BACKEND_OFFLINE_FILTERS,
];

/**
 * Select a library track the remix panel can source, then return its name in
 * the shape the panel reports.
 */
async function selectSourcedTrack(page: Page): Promise<string | null> {
  const trackSelect = page.locator('[data-testid="viz-track-select"]');
  await expect(trackSelect).toBeVisible({ timeout: 15_000 });
  // The store populates the options after mount: a select now reads the
  // placeholder only (measured: 1 option at this instant, 62 once it lands).
  await expect.poll(() => trackSelect.locator("option").count(), { timeout: 20_000 }).toBeGreaterThan(1);

  const target = await page.evaluate(async () => {
    const select = document.querySelector(
      '[data-testid="viz-track-select"]',
    ) as HTMLSelectElement | null;
    const options = Array.from(select?.options ?? [])
      .map((o) => o.value)
      .filter(Boolean);
    if (!options.length) return null;

    // The same normalization `matchSource` uses: basename without extension,
    // case-folded, punctuation stripped. Fixtures are excluded, exactly as the
    // panel's own seeding guard does.
    const fixture = /demucs_test_input|^test[-_]/i;
    const normalize = (s: string) =>
      s
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    try {
      const response = await fetch("/api/audio/remix/sources");
      if (!response.ok) return options[0] ?? null;
      const body = (await response.json()) as { sources?: Array<{ track: string }> };
      const tracks = (body.sources ?? []).map((s) => s.track);
      for (const option of options) {
        const base = option.split("/").pop() ?? option;
        if (fixture.test(base)) continue;
        if (tracks.some((t) => normalize(t) === normalize(option))) return option;
      }
    } catch {
      // Backend unreachable: fall back to the first real option so the test
      // fails on the panel assertion rather than on a null selection.
    }
    return options[0] ?? null;
  });

  if (!target) return null;
  await trackSelect.selectOption(target);
  return target;
}

test.describe("Remix / Mashup panel", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test("opens from the handoff and resolves its source stems (A1)", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);

    // The handoff flag has to exist *before* the panel mounts, and the panel
    // only mounts once a track is loaded — so seed it on the origin first.
    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));

    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target, "no library track the remix panel can source").not.toBeNull();

    // "N stems ready" appears in both panel states, so it proves the sources
    // landed but not that the handoff expanded the panel. Poll the count
    // (measured: the sources fetch takes a couple of seconds after the panel
    // mounts, so a single read here saw "0 stems ready" on a passing run) and
    // then assert on something only the expanded body renders.
    const ready = page.locator("button").filter({ hasText: /stems ready/ });
    await expect(ready).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () => {
          const text = (await ready.innerText()).trim();
          return Number(text.match(/(\d+)\s+stems/)?.[1] ?? "0");
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // The timeline only renders once the seeded arrangement exists, which only
    // happens in the expanded panel — so this is the handoff assertion.
    await expect(page.locator('[data-testid="remix-timeline"]')).toBeVisible({ timeout: 20_000 });

    expectNoConsoleErrors(errors, KNOWN_ENV_FILTERS);
  });

  test("timeline caption agrees with the seeded tempo, and the advisory names its reliability (A6 + A7)", async ({
    page,
  }) => {
    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();

    await expect(page.locator('[data-testid="remix-timeline"]')).toBeVisible({ timeout: 20_000 });

    // A6: the caption's seconds must be the bars it claims at the tempo it
    // claims. An earlier caption computed bars * bpm / 60 / 4 and reported
    // 4.8 s for an arrangement the audition rendered as 13.3 s — invisible in
    // review, only visible by comparing the two numbers.
    const caption = await page.locator('[data-testid="remix-timeline"] p').innerText();
    const match = caption.match(/(\d+)\s+bars\s+·\s+([\d.]+)s\s+at\s+([\d.]+)\s+BPM/);
    expect(match, `caption did not parse: "${caption}"`).not.toBeNull();
    const bars = Number(match![1]);
    const seconds = Number(match![2]);
    const bpm = Number(match![3]);
    expect(bpm).toBeGreaterThan(0);
    expect(seconds).toBeCloseTo((bars * 4 * 60) / bpm, 0);

    // A7: the advisory must match what the probe actually said — the key it
    // returned and whether that key was trustworthy. Asserting only the text
    // would pass on a track whose probe is confident too.
    const advisory = page.locator('[data-testid="remix-key-advisory"]');
    await expect(advisory).toBeVisible({ timeout: 20_000 });
    const probe = await page.evaluate(async (track) => {
      const response = await fetch(
        `/api/audio/remix/probe/${encodeURIComponent((track ?? "").split("/").pop() ?? "")}`,
      );
      return response.ok ? await response.json() : null;
    }, target);
    const advisoryText = await advisory.innerText();
    if (probe?.key_advisory) expect(advisoryText).toContain(String(probe.key_advisory));
    if (probe && probe.key_confident === false) {
      expect(advisoryText).toContain("unreliable");
      expect(advisoryText).toContain("key shifts stay explicit per layer");
    }
  });

  test("exposes labelled layer controls instead of micro-inputs (A4)", async ({ page }) => {
    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();
    await expect(page.locator('[data-testid="remix-timeline"]')).toBeVisible({ timeout: 20_000 });

    // One row per seeded stem, three labelled sliders each.
    const gain = page.locator('input[aria-label="Gain dB"]');
    const key = page.locator('input[aria-label="Key shift semitones"]');
    const start = page.locator('input[aria-label="Source start bar"]');
    await expect(gain.first()).toBeVisible();
    const layerCount = await gain.count();
    expect(layerCount).toBeGreaterThan(0);
    expect(await key.count()).toBe(layerCount);
    expect(await start.count()).toBe(layerCount);

    // The controls must drive the recipe, not just render: move the first
    // layer's gain and read its value back out of the input.
    await gain.first().fill("-6");
    await expect(gain.first()).toHaveValue("-6");
    await key.first().fill("3");
    await expect(key.first()).toHaveValue("3");

    // A4 also added a per-layer source audition. The button is labelled with
    // the stem and track it plays, so a dead one would be invisible by text.
    const auditionLayer = page.locator('button[aria-label^="Audition "]');
    await expect(auditionLayer.first()).toBeVisible();
  });

  test("auditions the arrangement as a playable excerpt (A3)", async ({ page }) => {
    // Rendering stretches each source stem: measured at ~10 s for a 4-bar
    // one-stem recipe, well past the default 60 s test timeout on a cold cache.
    test.setTimeout(180_000);

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/audio/remix/preview-audio")) requests.push(request.url());
    });

    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();
    await expect(page.locator('[data-testid="remix-timeline"]')).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Audition", exact: true }).click();

    const player = page.locator('[data-testid="remix-listen"] audio');
    await expect(player).toBeVisible({ timeout: 150_000 });
    const src = await player.getAttribute("src");
    expect(src).toContain("/api/audio/remix/preview-file/");

    // The element must be *playable*, not merely present: a 404 on the excerpt
    // URL surfaces as a media error on the element, not as a failed assertion.
    await expect
      .poll(() => player.evaluate((el) => (el as HTMLAudioElement).error?.code ?? 0))
      .toBe(0);

    expect(requests.length, "the audition button never called the preview endpoint").toBeGreaterThan(0);
  });
});
