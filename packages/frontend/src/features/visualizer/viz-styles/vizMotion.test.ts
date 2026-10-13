import { describe, expect, it } from "vitest";
import { gammaDrive } from "./vizMotion";

/**
 * gammaDrive — the perceptual brightness curve for the Three.js styles
 * (plan 2.6). Endpoints, the quiet-passage lift, the loud-half
 * compression, and the guard rails. The exponent is pinned to 2.2, the
 * same default `AudioReactivityProcessor` uses for its shader uniforms,
 * so the two render paths stay on one curve.
 */
describe("gammaDrive — 2.2 curve endpoints", () => {
  it("maps 0 to 0 and 1 to 1", () => {
    expect(gammaDrive(0)).toBe(0);
    expect(gammaDrive(1)).toBe(1);
  });

  it("lifts the midpoint to ~0.730, not a linear 0.5", () => {
    expect(gammaDrive(0.5)).toBeCloseTo(0.5 ** (1 / 2.2), 6);
    expect(gammaDrive(0.5)).toBeCloseTo(0.7297, 4);
  });

  it("lifts quiet passages relatively more than loud ones", () => {
    // The point of the curve: a quiet verse moves the lightness channel
    // visibly (2.1x its linear value at 0.25) while a chorus is
    // compressed instead of clipping (1.17x at 0.75).
    expect(gammaDrive(0.25)).toBeCloseTo(0.5325, 4);
    expect(gammaDrive(0.75)).toBeCloseTo(0.8774, 4);
    expect(gammaDrive(0.25) / 0.25).toBeGreaterThan(gammaDrive(0.75) / 0.75);
  });

  it("is monotonic across the whole domain", () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const next = gammaDrive(v);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });
});

describe("gammaDrive — guard rails", () => {
  it("returns 0 for NaN so a poisoned channel stops driving", () => {
    expect(gammaDrive(NaN)).toBe(0);
  });

  it("returns 0 for a non-finite infinity", () => {
    expect(gammaDrive(Infinity)).toBe(0);
    expect(gammaDrive(-Infinity)).toBe(0);
  });

  it("clamps out-of-range finite input to [0, 1]", () => {
    expect(gammaDrive(-0.5)).toBe(0);
    expect(gammaDrive(1.5)).toBe(1);
    expect(gammaDrive(42)).toBe(1);
  });

  it("is the identity map at gamma 1.0", () => {
    expect(gammaDrive(0.3, 1)).toBeCloseTo(0.3, 12);
    expect(gammaDrive(0.9, 1)).toBeCloseTo(0.9, 12);
  });

  it("honours a custom exponent", () => {
    // gamma 4 darkens the mid relative to 2.2: 0.5^(1/4) = 0.8409.
    expect(gammaDrive(0.5, 4)).toBeCloseTo(0.8409, 4);
  });
});
