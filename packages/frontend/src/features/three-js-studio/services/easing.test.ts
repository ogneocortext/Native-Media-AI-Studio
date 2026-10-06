import { describe, it, expect } from "vitest";
import {
  ANCHOR_NAMES,
  chain,
  ease,
  easeBezier,
  type EasingAnchor,
} from "./easing";

/**
 * Plan F3 acceptance: "unit tests pin each anchor's output at
 * t=0/0.5/1". The midpoint values are verified against an
 * *independent* oracle — dense sampling of the parametric curve
 * with linear interpolation — rather than against the Newton
 * solver's own output, so a bug in the solver cannot hide
 * behind a matching expectation.
 */

/** Independent oracle: densely sample the parametric cubic
 *  bezier and interpolate y at `targetX`. O(N) but only runs
 *  in tests. */
function oracleY(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  targetX: number,
): number {
  const N = 20000;
  let prevX = 0;
  let prevY = 0;
  for (let i = 1; i <= N; i++) {
    const u = i / N;
    // B(u) = 3(1-u)²u·P1 + 3(1-u)u²·P2 + u³·P3, with
    // P0 = (0, 0) and P3 = (1, 1).
    const b = 3 * (1 - u) * (1 - u) * u;
    const c = 3 * (1 - u) * u * u;
    const d = u * u * u;
    const x = b * x1 + c * x2 + d;
    const y = b * y1 + c * y2 + d;
    if (x >= targetX) {
      const f = (targetX - prevX) / (x - prevX || 1e-12);
      return prevY + f * (y - prevY);
    }
    prevX = x;
    prevY = y;
  }
  return 1;
}

const ANCHOR_POINTS: Record<EasingAnchor, [number, number, number, number]> = {
  "entrance-sharp": [0.2, 0.75, 0.34, 0.94],
  "settle-soft": [0.0, 0.65, 0.51, 0.99],
  "expressive-pop": [0.94, 0.75, 0.34, 0.94],
  "travel-balanced": [1.0, 0.49, 0.0, 0.55],
  "exit-accelerate": [1.0, 0.02, 0.54, 0.42],
  "travel-cut": [0.15, 0.85, 0.95, 0.05],
};

describe("ease — anchors", () => {
  it("exposes exactly the six documented anchors", () => {
    expect(ANCHOR_NAMES).toEqual([
      "entrance-sharp",
      "settle-soft",
      "expressive-pop",
      "travel-balanced",
      "exit-accelerate",
      "travel-cut",
    ]);
  });

  for (const name of ANCHOR_NAMES) {
    it(`${name}: endpoints are 0 and 1`, () => {
      expect(ease(name, 0)).toBe(0);
      expect(ease(name, 1)).toBe(1);
    });

    it(`${name}: midpoint matches the independent oracle`, () => {
      const [x1, y1, x2, y2] = ANCHOR_POINTS[name];
      const expected = oracleY(x1, y1, x2, y2, 0.5);
      const actual = ease(name, 0.5);
      expect(actual).toBeCloseTo(expected, 3);
    });

    it(`${name}: is monotonic and stays in [0, 1]`, () => {
      let prev = 0;
      for (let i = 1; i <= 200; i++) {
        const v = ease(name, i / 200);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    });

    it(`${name}: clamps and survives poisoned input`, () => {
      expect(ease(name, -0.5)).toBe(0);
      expect(ease(name, 1.5)).toBe(1);
      expect(ease(name, Number.NaN)).toBe(0);
    });
  }

  it("travel-balanced is an S-curve through the centre", () => {
    // The S-curve anchor: x1=1, x2=0 makes B_x(u) = 3u(1-u)² + u³,
    // which passes through (0.5, 0.5) at u=0.5, so y(0.5) is the
    // weighted centre of the two control y's plus the cubic term.
    const v = ease("travel-balanced", 0.5);
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.6);
  });

  it("travel-cut never settles (still moving at t=1)", () => {
    // "Fast-slow-fast, never settles": the curve's slope at the end
    // is non-zero — the derivative of B_y at u=1 is 3(y2... ) —
    // for travel-cut y2=0.05, so the end slope is 3·(1−0.05)−... ;
    // assert the last decile still gains height.
    const y09 = ease("travel-cut", 0.9);
    const y1 = ease("travel-cut", 1.0);
    expect(y1 - y09).toBeGreaterThan(0.01);
  });
});

describe("easeBezier — arbitrary curves", () => {
  it("is the identity for a linear curve", () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(easeBezier(0, 0, 1, 1, t)).toBeCloseTo(t, 6);
    }
  });

  it("matches the oracle at the midpoint for a custom curve", () => {
    const expected = oracleY(0.3, 0.8, 0.6, 0.2, 0.5);
    expect(easeBezier(0.3, 0.8, 0.6, 0.2, 0.5)).toBeCloseTo(expected, 3);
  });

  it("clamps out-of-range control x into the monotonic range", () => {
    // x1=2 would make x(u) non-monotonic; the clamp keeps the
    // solve well-defined and the result in [0, 1].
    const v = easeBezier(2, 0.5, -1, 0.5, 0.5);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("chain — composite anchors", () => {
  it("runs the first anchor over the first half", () => {
    // At t = split/2, chain(a, b, split, t) = ease(a, 0.5) * split.
    const split = 0.4;
    const v = chain("entrance-sharp", "exit-accelerate", split, split / 2);
    expect(v).toBeCloseTo(ease("entrance-sharp", 0.5) * split, 6);
  });

  it("reaches 1 at t=1 and is continuous at the split", () => {
    const split = 0.3;
    expect(chain("settle-soft", "expressive-pop", split, 1)).toBeCloseTo(1, 6);
    const before = chain("settle-soft", "expressive-pop", split, split);
    const after = chain("settle-soft", "expressive-pop", split, split + 1e-6);
    expect(Math.abs(after - before)).toBeLessThan(1e-4);
  });
});
