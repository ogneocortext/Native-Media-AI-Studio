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

  test("revises the live arrangement with one sentence (R1)", async ({ page }) => {
    // The model path is slow; the deterministic fallback is fast. Either way
    // the contract is the same: the recipe lands back in the form and the
    // human-readable diff names the change. Budgeted for the COLD model:
    // measured at 167 s for from-prompt with qwen3.5:9b under VRAM
    // contention, so both the test and the fetch must outlast that.
    test.setTimeout(300_000);

    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();
    await expect(page.locator('[data-testid="remix-timeline"]')).toBeVisible({ timeout: 20_000 });

    const gainInputs = page.locator('input[aria-label="Gain dB"]');
    const readGains = () =>
      gainInputs.evaluateAll((els) => els.map((el) => Number((el as HTMLInputElement).value)));
    const before = await readGains();
    await page.getByLabel("Revise arrangement with a sentence").fill("drums up 2 dB");
    await page.getByRole("button", { name: "Revise", exact: true }).click();

    const result = page.locator('[data-testid="remix-revise-result"]');
    await expect(result).toBeVisible({ timeout: 240_000 });
    await expect(result).toContainText("gain");

    // The revised recipe lands back in the form: only drums gains moved, and
    // they moved up. (Exact +2 assumes the deterministic fallback; the model
    // path applies the same delta but is not pinned to its arithmetic.)
    const after = await readGains();
    expect(after).toHaveLength(before.length);
    const stems = await page
      .locator('select[aria-label="Stem"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).value));
    expect(stems).toHaveLength(before.length);
    let drumsMoved = 0;
    after.forEach((v, i) => {
      const delta = v - before[i];
      if (stems[i] === "drums") {
        expect(delta).toBeGreaterThan(0);
        drumsMoved += 1;
      } else {
        expect(Math.abs(delta)).toBeLessThan(1e-6);
      }
    });
    expect(drumsMoved).toBeGreaterThan(0);
  });

  test("auditions one slot alone from the timeline (R2 click)", async ({ page }) => {
    test.setTimeout(180_000);

    const payloads: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/audio/remix/preview-audio")) {
        payloads.push(request.postData() ?? "");
      }
    });

    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();
    const timeline = page.locator('[data-testid="remix-timeline"]');
    await expect(timeline).toBeVisible({ timeout: 20_000 });

    await timeline.getByRole("option").first().click();

    const player = page.locator('[data-testid="remix-listen"] audio');
    await expect(player).toBeVisible({ timeout: 150_000 });
    const src = await player.getAttribute("src");
    expect(src).toContain("/api/audio/remix/preview-file/");
    await expect
      .poll(() => player.evaluate((el) => (el as HTMLAudioElement).error?.code ?? 0))
      .toBe(0);

    // The click scoped the render to one slot: the request carried slot_index.
    expect(payloads.length, "clicking a timeline segment never called the preview endpoint").toBeGreaterThan(0);
    expect(payloads.some((body) => body.includes('"slot_index"'))).toBe(true);
  });

  test("reorders slots from the timeline keyboard path (R2 drag)", async ({ page }) => {
    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();
    const timeline = page.locator('[data-testid="remix-timeline"]');
    await expect(timeline).toBeVisible({ timeout: 20_000 });

    // Build a two-slot arrangement with distinguishable lengths via the
    // presets (Intro → swap), then mark slot 2's length.
    await page.getByRole("button", { name: "Intro → swap" }).click();
    const slot2bars = page.getByLabel("Slot 2 bars");
    await expect(slot2bars).toBeVisible();
    await slot2bars.fill("16");
    await expect(slot2bars).toHaveValue("16");

    // Nudge the second segment left: the form sections follow the same array.
    const segments = timeline.getByRole("option");
    await expect(segments).toHaveCount(2);
    await segments.nth(1).focus();
    await page.keyboard.press("ArrowLeft");

    await expect(page.getByLabel("Slot 1 bars")).toHaveValue("16");
    await expect(page.getByLabel("Slot 2 bars")).toHaveValue("4");
  });

  test("reorders slots by dragging a timeline segment (R2 drag)", async ({ page }) => {
    // The pointer path of the same moveSlot the keyboard test exercises:
    // this proves the HTML5 drag handlers fire and the reorder persists
    // into the recipe the panel would send, not just into the DOM.
    test.setTimeout(180_000);

    const payloads: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/audio/remix/preview-audio")) {
        payloads.push(request.postData() ?? "");
      }
    });

    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();
    const timeline = page.locator('[data-testid="remix-timeline"]');
    await expect(timeline).toBeVisible({ timeout: 20_000 });

    // The intro preset's second slot carries the vocals the first omits,
    // so the layer counts name the order after the drag; its length is
    // marked too, so a no-op drag cannot pass on matching values.
    await page.getByRole("button", { name: "Intro → swap" }).click();
    const slot2bars = page.getByLabel("Slot 2 bars");
    await expect(slot2bars).toBeVisible();
    await slot2bars.fill("16");
    await expect(slot2bars).toHaveValue("16");
    const segments = timeline.getByRole("option");
    await expect(segments).toHaveCount(2);

    await segments.nth(1).dragTo(segments.nth(0));

    // The form sections render from the same slots array: the 16-bar slot
    // travels with the drag to position 1.
    await expect(page.getByLabel("Slot 1 bars")).toHaveValue("16");
    await expect(page.getByLabel("Slot 2 bars")).toHaveValue("4");

    // And the reordered recipe is what a render would receive: the
    // vocals-carrying slot is now first.
    await page.getByRole("button", { name: "Audition", exact: true }).click();
    const player = page.locator('[data-testid="remix-listen"] audio');
    await expect(player).toBeVisible({ timeout: 150_000 });

    const body = payloads.map((p) => JSON.parse(p) as { slots?: Array<{ layers?: unknown[] }> }).at(-1);
    expect(body?.slots, "the audition posted no recipe").toBeTruthy();
    expect(body!.slots!.length).toBe(2);
    expect(
      body!.slots![0].layers!.length,
      "the dragged slot did not reach position 1 in the posted recipe",
    ).toBeGreaterThan(body!.slots![1].layers!.length);
  });

  test("surfaces arrangement-theory masking warnings in the panel", async ({ page }) => {
    // Orion's 9270193: preview_recipe warns when two layers occupy the same
    // frequency slot. The Blend preset puts A/bass + B/bass and A/other +
    // B/other into one slot at equal gain - exactly both rules - so the
    // browser path is verified without hand-assembling the collision, and
    // the assertions do not care which source seeds as A.
    test.setTimeout(180_000);

    await page.goto(getBaseUrl() + "/");
    await page.evaluate(() => sessionStorage.setItem("__pendingRemixOpen", "1"));
    await navigateWithWait(page, "/visualizer");
    const target = await selectSourcedTrack(page);
    expect(target).not.toBeNull();
    const timeline = page.locator('[data-testid="remix-timeline"]');
    await expect(timeline).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Blend A + B" }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();

    // Preview loads and time-stretches every source, so it is the slow path.
    await expect(page.getByText("will mask each other")).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText("midrange masking")).toBeVisible({ timeout: 150_000 });
  });
});
