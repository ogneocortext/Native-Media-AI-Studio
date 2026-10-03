import { describe, it, expect } from "vitest";
import {
  clamp01,
  dampedHarmonic,
  dampedSpringStep,
  DampedSpring,
  easeInCubic,
  easeInExpo,
  easeInOutCubic,
  easeInOutSine,
  easeInQuad,
  easeInQuadToExpo,
  easeOutElastic,
  easeOutExpo,
  easeOutQuad,
  getSectionEasing,
  lerp,
  SECTION_EASING,
  type EasingFn,
} from "./motionEasing";

/**
 * Spec: docs/knowledge/gemini-motion-design-2026-10-02/README.md §1, §2.
 * The defaults asserted here are transcribed from the spec document, so a change
 * to the spec that is not mirrored here shows up as a failing test rather than
 * as silent drift between the doc and the code.
 */

const CURVES: Array<[string, EasingFn]> = [
  ["easeInQuad", easeInQuad],
  ["easeOutQuad", easeOutQuad],
  ["easeInExpo", easeInExpo],
  ["easeOutExpo", easeOutExpo],
  ["easeInOutSine", easeInOutSine],
  ["easeInOutCubic", easeInOutCubic],
  ["easeInCubic", easeInCubic],
  ["easeInQuadToExpo", easeInQuadToExpo],
  ["easeOutElastic", easeOutElastic],
];

describe("easing curves", () => {
  it.each(CURVES)("%s is pinned at both ends", (_name, ease) => {
    expect(ease(0)).toBeCloseTo(0, 6);
    expect(ease(1)).toBeCloseTo(1, 6);
  });

  it.each(CURVES.filter(([name]) => name !== "easeOutElastic"))(
    "%s is monotonically non-decreasing",
    (_name, ease) => {
      // easeOutElastic deliberately overshoots past 1, so it is excluded: a
      // curve that rings above its target is the point, not a defect.
      let previous = -Infinity;
      for (let i = 0; i <= 50; i++) {
        const v = ease(i / 50);
        expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = v;
      }
    },
  );

  it.each(CURVES)("%s survives out-of-range input", (_name, ease) => {
    // A frame that overshoots the end of a section must not produce NaN — that
    // is the "stuck visualizer" failure mode clamp01 exists to prevent.
    for (const t of [-5, -0.001, 1.001, 42, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = ease(t);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it("easeOutElastic actually overshoots", () => {
    // The spec's "resonant decay" claim depends on this; a curve that only
    // approaches 1 from below would make the test above pass for the wrong
    // reason and the chorus/drop sections would lose their punch.
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => easeOutElastic(i / 200)));
    expect(peak).toBeGreaterThan(1.02);
  });

  it("easeInQuadToExpo is convex — the ratchet effect", () => {
    // Spec: builds should ratchet, i.e. each step takes less time than the last.
    // That is a statement about the second derivative, so check curvature
    // directly rather than eyeballing the values.
    const at = (t: number) => easeInQuadToExpo(t);
    const secondDiff = (t: number) => at(t - 0.05) - 2 * at(t) + at(t + 0.05);
    expect(secondDiff(0.5)).toBeGreaterThan(0);
  });
});

describe("clamp01", () => {
  it.each([
    [-1, 0],
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [2, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 0],
  ])("clamps %p to %p", (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });

  it("saturates infinities rather than collapsing them to the NaN path", () => {
    // +Infinity is a channel that ran off the top, not an unknown value: it
    // should saturate at 1. Returning 0 here (the old `!isFinite` behaviour)
    // made an over-driven channel snap to silence instead of pinning high.
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("never returns NaN for any non-NaN input", () => {
    for (const v of [-1e9, -1, 0, 0.5, 1, 1e9]) {
      expect(Number.isNaN(clamp01(v))).toBe(false);
    }
  });
});

describe("dampedHarmonic", () => {
  it("starts at exactly 1", () => {
    expect(dampedHarmonic(0, 14, 26)).toBe(1);
  });

  it("decays: successive cycle peaks get smaller", () => {
    // |cos(ωt)| oscillates, so the *sampled* magnitude is NOT monotonic — a
    // previous version of this test asserted that and failed, correctly. What
    // the spec actually claims is that the oscillation rings down, which is a
    // statement about the peaks of each cycle.
    const peaks: number[] = [];
    const step = 0.0005;
    const period = (2 * Math.PI) / 26;
    for (let t = 0; t < 0.5; t += step) {
      const v = Math.abs(dampedHarmonic(t, 14, 26));
      // A new cycle starts whenever the envelope passes one of its zero
      // crossings; record the running max of each cycle.
      if (Math.floor(t / period) > Math.floor((t - step) / period)) {
        peaks.push(v);
      }
    }
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    }
    expect(peaks.length).toBeGreaterThan(1);
  });

  it("stays inside the exponential envelope", () => {
    const gamma = 14;
    for (let t = 0; t < 0.5; t += 0.005) {
      expect(Math.abs(dampedHarmonic(t, gamma, 26))).toBeLessThanOrEqual(
        Math.exp(-gamma * t) + 1e-12,
      );
    }
  });

  it("never returns NaN", () => {
    expect(Number.isNaN(dampedHarmonic(Number.NaN, 14, 26))).toBe(false);
    expect(dampedHarmonic(Number.NaN, 14, 26)).toBe(0);
  });
});

describe("dampedSpringStep", () => {
  it("settles to the target instead of ringing forever", () => {
    // Spec default stiffness 240 / damping 18, driven from rest toward 1.
    let value = 0;
    let velocity = 0;
    for (let i = 0; i < 600; i++) {
      [value, velocity] = dampedSpringStep(value, 1, velocity, 240, 18, 1 / 60);
    }
    expect(value).toBeCloseTo(1, 3);
    expect(Math.abs(velocity)).toBeLessThan(0.01);
  });

  it("stays stable across a dropped frame (sub-stepping)", () => {
    // A seek or a backgrounded tab produces one enormous dt. Without sub-steps
    // the explicit integrator gains energy and the value diverges to Infinity,
    // which is a permanent visual corruption, not a transient glitch.
    let value = 0;
    let velocity = 0;
    for (let i = 0; i < 20; i++) {
      [value, velocity] = dampedSpringStep(value, 1, velocity, 240, 18, 2.0);
    }
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value)).toBeLessThan(10);
  });

  it("ignores non-positive and non-finite dt", () => {
    expect(dampedSpringStep(0.5, 1, 0.2, 240, 18, 0)).toEqual([0.5, 0.2]);
    expect(dampedSpringStep(0.5, 1, 0.2, 240, 18, Number.NaN)).toEqual([0.5, 0.2]);
  });

  it("DampedSpring.impulse moves via velocity, not position", () => {
    const spring = new DampedSpring(0, 240, 18);
    spring.impulse(5);
    expect(spring.value).toBe(0); // position untouched
    const afterStep = spring.step(0, 1 / 60);
    expect(afterStep).not.toBe(0);
  });
});

describe("sectional easing palette", () => {
  it("uses the curves the spec's table names", () => {
    expect(SECTION_EASING.verse.ease).toBe(easeInOutSine);
    expect(SECTION_EASING["pre-chorus"].ease).toBe(easeInQuadToExpo);
    expect(SECTION_EASING.chorus.ease).toBe(easeOutElastic);
    expect(SECTION_EASING.bridge.ease).toBe(easeOutQuad);
  });

  it("scales transient gain from breakdown up to drop", () => {
    // Spec §3: hold kinetic energy in reserve; the drop must be the loudest.
    const { breakdown, verse, chorus, drop } = SECTION_EASING;
    expect(breakdown.transientGain).toBeLessThan(verse.transientGain);
    expect(verse.transientGain).toBeLessThan(chorus.transientGain);
    expect(chorus.transientGain).toBeLessThan(drop.transientGain);
  });

  it("falls back to verse for unknown or missing sections", () => {
    // Section labels come from analyzer output; an unknown one must not blank
    // the visuals.
    expect(getSectionEasing("SOMETHING-NEW").label).toBe(SECTION_EASING.verse.label);
    expect(getSectionEasing(null).label).toBe(SECTION_EASING.verse.label);
    expect(getSectionEasing(undefined).label).toBe(SECTION_EASING.verse.label);
  });

  it("accepts case and whitespace variants", () => {
    expect(getSectionEasing("  DROP ").label).toBe(SECTION_EASING.drop.label);
    expect(getSectionEasing("Chorus").label).toBe(SECTION_EASING.chorus.label);
  });
});

describe("lerp", () => {
  it("interpolates linearly", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});
