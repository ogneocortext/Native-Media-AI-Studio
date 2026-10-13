import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors, BACKEND_OFFLINE_FILTERS,
} from './helpers';

/**
 * LRC-Enhanced Visualizer — lyrics loading and section-aware beat building.
 *
 * The previous version of this spec was doubly vacuous and is rewritten from
 * the real harness surface (`window.__VIZ_TEST__.getState()`, Visualizer.tsx):
 *
 *  1. It polled `getState().lyrics`, a field the harness has never exposed
 *     (it exposes `lyricsVisible`, `currentFilename`, `storyboard`), so
 *     `hasLyrics` was always false and the ENTIRE section-aware block below it
 *     never executed — the test passed while asserting only console output.
 *  2. It read `storyboard.currentSection`, which does not exist on Storyboard
 *     ({ track, duration, beats }) or StoryState. Had it ever run, the
 *     `sections.size > 1` assertion could only have collected 'unknown' and
 *     failed.
 *  3. It read the select's option count once, immediately after the select
 *     became visible — but the options are the async-loaded audio library
 *     (measured: 1 option at that instant, 62 a moment later), so the
 *     `selectOption({ index: 1 })` never fired either.
 *
 * What is asserted here, against the real harness and the real library:
 * selecting a track whose .lrc ships beside it parses that LRC
 * (`currentFilename` + `lyricsVisible`) and builds the section-aware
 * storyboard (`storyboard.beats`, one per LRC section run, Roman act titles).
 */

test.describe('LRC-Enhanced Visualizer', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('loads the LRC file and builds a section-aware storyboard', async ({ page }) => {
    test.setTimeout(120000);
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/visualizer');

    const trackSelect = page.locator('[data-testid="viz-track-select"]');
    await expect(trackSelect).toBeVisible({ timeout: 15_000 });
    // The select renders before the shared audio library store resolves.
    await expect
      .poll(() => trackSelect.locator('option').count(), { timeout: 20_000 })
      .toBeGreaterThan(1);

    // The library is real user data and only some tracks ship an .lrc beside
    // them, so discover one the same way the app does (public/ first, then the
    // API) instead of hardcoding a filename that will drift.
    const lrcBackedRef = await page.evaluate(async () => {
      const select = document.querySelector(
        '[data-testid="viz-track-select"]',
      ) as HTMLSelectElement | null;
      if (!select) return null;
      const values = Array.from(select.options)
        .map((o) => o.value)
        .filter(Boolean);
      for (const value of values) {
        const file = value.split('/').pop() ?? value;
        const base = file.replace(/\.(wav|mp3|m4a|flac|ogg)$/i, '');
        const candidates = value.includes('/')
          ? [`${value.replace(/\.[^.]+$/, '.lrc')}`, `${base}.lrc`]
          : [`${base}.lrc`];
        for (const candidate of candidates) {
          try {
            const res = await fetch(
              `/audio/${candidate.split('/').map(encodeURIComponent).join('/')}`,
            );
            // A timestamped body, not just an existing file.
            if (res.ok && /\[\d{1,2}:\d{2}/.test(await res.text())) return value;
          } catch {
            // Try the next candidate.
          }
        }
      }
      return null;
    });
    if (!lrcBackedRef) {
      test.skip(true, 'no library track ships a parseable .lrc beside it');
      return;
    }
    await trackSelect.selectOption(lrcBackedRef);

    const readState = () =>
      page.evaluate(() => {
        const win = window as unknown as {
          __VIZ_TEST__?: {
            getState?: () => {
              currentFilename: string;
              lyricsVisible: boolean;
              storyboard: {
                track: string;
                duration: number;
                beats: Array<{ section: string; actTitle: string; start: number; end: number }>;
              };
            };
          };
        };
        return win.__VIZ_TEST__?.getState?.();
      });

    // `lyricsVisible` is set from the parsed line count (Visualizer.tsx), so
    // it is the real "LRC loaded" signal for the selected track.
    const readReady = () =>
      readState().then((s) =>
        Boolean(s?.currentFilename && s.lyricsVisible && s.storyboard.beats.length > 0),
      );
    try {
      await expect.poll(readReady, { timeout: 45_000, intervals: [500] }).toBe(true);
    } catch (error) {
      const s = await readState();
      throw new Error(
        `LRC never became ready for ref="${lrcBackedRef}": ` +
          `currentFilename=${JSON.stringify(s?.currentFilename)} ` +
          `lyricsVisible=${JSON.stringify(s?.lyricsVisible)} ` +
          `beats=${JSON.stringify(s?.storyboard.beats.length ?? null)}`,
        { cause: error },
      );
    }

    const state = (await readState())!;
    expect(state.storyboard.track).not.toBe('');
    expect(state.storyboard.beats.length, 'storyboard beats from LRC sections').toBeGreaterThan(0);
    expect(state.storyboard.duration).toBeGreaterThan(0);
    // Beat titles are Roman-numeral acts ("I. ESTABLISHING", "II. …"), a cheap
    // structural check that inferMotif ran on the LRC content.
    for (const beat of state.storyboard.beats) {
      expect(beat.actTitle).toMatch(/^[IVX]+\.\s+\S/);
    }
    // Beats are built from ordered section runs.
    const starts = state.storyboard.beats.map((b) => b.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(new Set(state.storyboard.beats.map((b) => b.section)).size).toBeGreaterThan(0);

    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });
});
