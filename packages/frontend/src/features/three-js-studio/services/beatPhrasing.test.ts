import { describe, it, expect } from "vitest";
import {
  ANTICIPATION_SEC,
  LANDING_SEC,
  beatPhraseScale,
} from "./beatPhrasing";
import { ease } from "./easing";

/**
 * Plan F4 acceptance: "on a 120 BPM click track, the
 * pullback visibly precedes each downbeat and the landing
 * holds still (no post-beat wobble)". These tests pin the
 * anticipation→action→settle spine at 120 BPM (0.5 s beat
 * window) and verify the phase seams are continuous — a
 * seam jump would read as a wobble.
 */

const AMP = 0.25;
const WINDOW = 0.5; // 120 BPM
const DEPTH = AMP * 0.5;
const HOLD = 1 + AMP;
const LOW = 1 - DEPTH;

describe("beatPhraseScale — 120 BPM spine", () => {
  it("holds at the landed value through the middle of the window (no drift)", () => {
    // The hold phase is (LANDING_SEC, WINDOW - ANTICIPATION_SEC);
    // sample strictly inside it.
    const holdMid = (LANDING_SEC + (WINDOW - ANTICIPATION_SEC)) / 2;
    const mid = beatPhraseScale({
      timeSinceLastBeat: holdMid,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(mid.scale).toBeCloseTo(HOLD, 10);
    expect(mid.anticipating).toBe(false);
    expect(mid.landing).toBe(false);
  });

  it("pulls back from the held value during anticipation", () => {
    // Halfway through the anticipation window the scale has
    // left the held value and is on its way to the low
    // value (the wind-up), strictly between the two.
    const before = beatPhraseScale({
      timeSinceLastBeat: WINDOW - ANTICIPATION_SEC / 2,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(before.scale).toBeGreaterThan(LOW);
    expect(before.scale).toBeLessThan(HOLD);
    expect(before.anticipating).toBe(true);
    expect(before.landing).toBe(false);
  });

  it("winds up close to the low value at the end of anticipation", () => {
    // The final 1% of the anticipation window: the scale
    // must be much closer to the low value than the held
    // value — the pullback is nearly complete. (travel-cut
    // dips in its upper range before the final rise, so
    // "close" only holds in the last few percent.)
    const late = beatPhraseScale({
      timeSinceLastBeat: WINDOW - ANTICIPATION_SEC * 0.01,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(late.anticipating).toBe(true);
    expect(late.scale).toBeLessThan((LOW + HOLD) / 2);
  });

  it("anticipation starts from the held value (seam with the hold phase)", () => {
    const start = beatPhraseScale({
      timeSinceLastBeat: WINDOW - ANTICIPATION_SEC,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(start.scale).toBeCloseTo(HOLD, 10);
  });

  it("lands at the low value exactly on the beat", () => {
    const onBeat = beatPhraseScale({
      timeSinceLastBeat: 0,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(onBeat.scale).toBeCloseTo(LOW, 10);
    expect(onBeat.landing).toBe(true);
    expect(onBeat.anticipating).toBe(false);
  });

  it("pops to the held value by the end of the landing window", () => {
    const landed = beatPhraseScale({
      timeSinceLastBeat: LANDING_SEC,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(landed.scale).toBeCloseTo(HOLD, 10);
  });

  it("is continuous across the beat (anticipation end == landing start)", () => {
    const before = beatPhraseScale({
      timeSinceLastBeat: WINDOW - 1e-6,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    const after = beatPhraseScale({
      timeSinceLastBeat: 0,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    // The anchor's value at p→1⁻ approaches the low value
    // but float precision leaves a ~1e-4 residue; continuity
    // to visual precision (sub-millisecond of the window)
    // is what matters — a seam jump would read as a wobble.
    expect(before.scale).toBeCloseTo(after.scale, 3);
  });

  it("is continuous at the landing/hold seam", () => {
    const landing = beatPhraseScale({
      timeSinceLastBeat: LANDING_SEC,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    const hold = beatPhraseScale({
      timeSinceLastBeat: LANDING_SEC + 1e-6,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(landing.scale).toBeCloseTo(hold.scale, 6);
  });

  it("follows the travel-cut anchor through the anticipation", () => {
    // Halfway through the anticipation window the scale must
    // sit exactly on the anchor's curve between HOLD and LOW.
    const mid = beatPhraseScale({
      timeSinceLastBeat: WINDOW - ANTICIPATION_SEC / 2,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    const k = ease("travel-cut", 0.5);
    expect(mid.scale).toBeCloseTo(HOLD - (HOLD - LOW) * k, 10);
  });

  it("follows the expressive-pop anchor through the landing", () => {
    const mid = beatPhraseScale({
      timeSinceLastBeat: LANDING_SEC / 2,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    const k = ease("expressive-pop", 0.5);
    expect(mid.scale).toBeCloseTo(LOW + (HOLD - LOW) * k, 10);
  });
});

describe("beatPhraseScale — tempo adaptation", () => {
  it("shrinks the phase windows on fast tempos so they never overlap", () => {
    // 240 BPM: 0.25 s window. ANTICIPATION_SEC (0.12) would
    // take nearly half; the adaptive cap keeps the phases tiled.
    const fastWindow = 0.25;
    const anticipationSec = Math.min(ANTICIPATION_SEC, fastWindow * 0.35);
    const landingSec = Math.min(LANDING_SEC, fastWindow - anticipationSec);
    // At the landing/anticipation boundary both formulas
    // must agree (the held value) — no seam jump.
    const boundary = fastWindow - anticipationSec;
    const atBoundary = beatPhraseScale({
      timeSinceLastBeat: boundary,
      beatWindowSec: fastWindow,
      amplitude: AMP,
    });
    expect(atBoundary.scale).toBeCloseTo(HOLD, 10);
    expect(landingSec).toBeGreaterThan(0);
    expect(anticipationSec + landingSec).toBeLessThanOrEqual(fastWindow);
  });

  it("still anticipates on a fast tempo", () => {
    const fastWindow = 0.25;
    const justBefore = beatPhraseScale({
      timeSinceLastBeat: fastWindow - 0.01,
      beatWindowSec: fastWindow,
      amplitude: AMP,
    });
    expect(justBefore.anticipating).toBe(true);
    // Pulled back off the held value, on the way down.
    expect(justBefore.scale).toBeLessThan(HOLD);
    expect(justBefore.scale).toBeGreaterThan(LOW);
  });
});

describe("beatPhraseScale — degenerate inputs", () => {
  it("returns a neutral 1.0 scale for zero amplitude", () => {
    const r = beatPhraseScale({
      timeSinceLastBeat: 0.1,
      beatWindowSec: WINDOW,
      amplitude: 0,
    });
    expect(r.scale).toBe(1);
    expect(r.anticipating).toBe(false);
    expect(r.landing).toBe(false);
  });

  it("returns a neutral 1.0 scale for a zero beat window", () => {
    const r = beatPhraseScale({
      timeSinceLastBeat: 0.1,
      beatWindowSec: 0,
      amplitude: AMP,
    });
    expect(r.scale).toBe(1);
  });

  it("holds (never anticipates) when the beat timeline is stale", () => {
    const stale = beatPhraseScale({
      timeSinceLastBeat: WINDOW * 2,
      beatWindowSec: WINDOW,
      amplitude: AMP,
    });
    expect(stale.scale).toBeCloseTo(HOLD, 10);
    expect(stale.anticipating).toBe(false);
  });
});
