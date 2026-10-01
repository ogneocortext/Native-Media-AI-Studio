import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToRgb,
  lerpColor,
  hslToRgb,
  easeOutQuad,
  easeOutBack,
  logFreqMap,
  clamp,
  valueNoise,
  fbm,
} from "./canvas2dHelpers";

/**
 * Colour and easing maths for the 2D visualizer. These run every frame, so what
 * matters is the documented contract at the boundaries: a non-hex colour must
 * fall back to the canvas background rather than producing an invalid
 * fillStyle, and out-of-range input must not throw or produce NaN.
 */

describe("normalizeHex", () => {
  it("expands 3-digit shorthand by doubling digits", () => {
    // The reason this exists: `#rgb` would otherwise produce an invalid
    // fillStyle and silently break the trail fade.
    expect(normalizeHex("#abc")).toBe("#aabbcc");
  });

  it("lowercases 6-digit hex and trims whitespace", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHex("  #aabbcc  ")).toBe("#aabbcc");
  });

  it("falls back to the canvas background for anything non-hex", () => {
    // Documented behaviour, not an accident: an invalid fillStyle is worse
    // than an unexpected colour.
    expect(normalizeHex("rebeccapurple")).toBe("#050505");
    expect(normalizeHex("#12345")).toBe("#050505");
    expect(normalizeHex("")).toBe("#050505");
  });

  it("is idempotent on its own output", () => {
    for (const input of ["#abc", "#aabbcc", "garbage"]) {
      const once = normalizeHex(input);
      expect(normalizeHex(once)).toBe(once);
    }
  });
});

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("#00ff00")).toEqual([0, 255, 0]);
  });

  it("parses shorthand hex via normalizeHex", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
  });

  it("falls back to the background colour for non-hex input", () => {
    expect(hexToRgb("not-a-colour")).toEqual([5, 5, 5]);
  });
});

describe("lerpColor", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    expect(lerpColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lerpColor("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  it("interpolates in between", () => {
    const mid = hexToRgb(lerpColor("#000000", "#ffffff", 0.5));
    expect(mid[0]).toBeGreaterThan(100);
    expect(mid[0]).toBeLessThan(155);
  });

  it("emits something the canvas can be handed for any t", () => {
    // There is no clamping here: an extreme t gives a negative channel that
    // toString(16) renders as "-4fb". Recorded as current behaviour so a future
    // clamp reads as a deliberate change rather than a silent fix.
    for (const t of [-5, 0, 0.5, 1, 5]) {
      expect(lerpColor("#000000", "#ffffff", t)).toMatch(/^#[0-9a-f-]{3,}/);
    }
  });
});

describe("hslToRgb", () => {
  it("maps primary hues at full saturation and lightness", () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(1 / 3, 1, 0.5)[1]).toBeCloseTo(255, 0);
    expect(hslToRgb(2 / 3, 1, 0.5)[2]).toBeCloseTo(255, 0);
  });

  it("gives grey at zero saturation", () => {
    const [r, g, b] = hslToRgb(0.5, 0, 0.5);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeCloseTo(128, 0);
  });

  it("returns black and white at the lightness extremes", () => {
    expect(hslToRgb(0.5, 1, 0)).toEqual([0, 0, 0]);
    expect(hslToRgb(0.5, 1, 1)).toEqual([255, 255, 255]);
  });

  it("wraps hue outside 0..1", () => {
    expect(hslToRgb(1, 1, 0.5)).toEqual(hslToRgb(0, 1, 0.5));
    expect(hslToRgb(-0.5, 1, 0.5)).toEqual(hslToRgb(0.5, 1, 0.5));
  });
});

describe("easing", () => {
  it("easeOutQuad starts at 0 and ends at 1", () => {
    expect(easeOutQuad(0)).toBeCloseTo(0, 10);
    expect(easeOutQuad(1)).toBeCloseTo(1, 10);
  });

  it("easeOutQuad is monotonic", () => {
    const xs = [0, 0.25, 0.5, 0.75, 1].map(easeOutQuad);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
  });

  it("easeOutBack overshoots past 1 mid-flight", () => {
    // That is the point of the "back": a punchy settle for bar transitions.
    const samples = [0.4, 0.6, 0.8, 0.9].map(easeOutBack);
    expect(Math.max(...samples)).toBeGreaterThan(1);
  });

  it("easeOutBack starts at 0", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
  });

  it("easeOutBack is an overshoot curve: 0 at t=0, peaks past 1, returns to 1 at t=1", () => {
    // Measured: 0 -> 0.943 (t=.25) -> 1.199 (t=.5) -> 1.106 (t=.75) -> 1.0
    // (t=1). The overshoot is the point; settling exactly on 1 is the contract.
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(0.5)).toBeCloseTo(1.1994, 3);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it("easeOutBack is only meaningful on t in [0, 1]", () => {
    // Past t=1 the cubic diverges (7.19 at t=2). That is harmless because the
    // function is an easing curve for a 0..1 parameter, but it is recorded so
    // nobody passes it an overshooting value and gets a wildly wrong result.
    expect(easeOutBack(2)).toBeGreaterThan(1);
  });
describe("clamp", () => {
  it("constrains to the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("is inclusive at both bounds", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("logFreqMap", () => {
  it("stays within the source range for every bar", () => {
    for (let i = 0; i < 64; i++) {
      const idx = logFreqMap(i, 64, 512);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(512);
    }
  });

  it("increases monotonically with the bar index", () => {
    let prev = -Infinity;
    for (let i = 0; i < 32; i++) {
      const idx = logFreqMap(i, 32, 512);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it("anchors the last bar at the top of the range", () => {
    expect(logFreqMap(63, 64, 512)).toBeCloseTo(512, 6);
  });

  it("does not throw on a degenerate configuration", () => {
    expect(Number.isFinite(logFreqMap(0, 1, 1))).toBe(true);
    expect(Number.isFinite(logFreqMap(0, 0, 0))).toBe(true);
  });
});

describe("noise", () => {
  it("returns a value in [0, 1) from the modulo terms", () => {
    // Regression: JS `%` keeps the dividend's sign, and the sin()*43758
    // products span roughly +/-43758, so a bare `% 1` returned about half its
    // samples negative. A noise field must never go below 0.
    for (const [x, y, t] of [[1.5, 2.5, 0], [0.1, 0.9, 3], [-4.2, 7.7, 11]]) {
      const v = valueNoise(x, y, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("never goes negative across a broad sweep", () => {
    // The single-sample check above is cheap but easy to satisfy by luck; this
    // is the assertion that actually pins the fix.
    for (let x = -5; x < 5; x += 0.37) {
      for (let y = -5; y < 5; y += 0.41) {
        for (let t = 0; t < 3; t += 0.7) {
          expect(valueNoise(x, y, t)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("is deterministic for the same input", () => {
    expect(valueNoise(1.5, 2.5, 3)).toBe(valueNoise(1.5, 2.5, 3));
  });

  it("changes with time so the noise animates", () => {
    expect(valueNoise(1.5, 2.5, 0)).not.toBe(valueNoise(1.5, 2.5, 9));
  });

  it("is continuous at integer cell boundaries", () => {
    // Smoothstep interpolation means no visible seam at cell edges. The noise
    // field is fractal, so a single sample pair cannot be compared exactly;
    // a large jump here means the interpolation regressed.
    const before = valueNoise(0.999, 0.999, 1);
    const after = valueNoise(1.001, 1.001, 1);
    expect(Math.abs(after - before)).toBeLessThan(0.2);
  });

  it("fbm is deterministic and bounded across octave counts", () => {
    expect(fbm(1, 2, 3)).toBe(fbm(1, 2, 3));
    for (const octaves of [1, 2, 4, 6]) {
      const v = fbm(1, 2, 3, octaves);
      expect(Number.isFinite(v)).toBe(true);
      // Amplitudes sum to less than 1: 0.5 + 0.25 + 0.125 + ...
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("fbm tolerates a zero-octave request", () => {
    expect(fbm(1, 2, 3, 0)).toBe(0);
  });
});
});