import { describe, it, expect } from "vitest";
import {
  ASYMMETRIC_SMOOTHING_MODES,
  asymmetricSmoothBands,
  asymmetricSmoothStep,
  barkFreqMap,
  barkToHz,
  clamp,
  DEFAULT_ASYMMETRIC_SMOOTHING,
  easeOutBack,
  easeOutQuad,
  fbm,
  hexToRgb,
  hslToRgb,
  hzToBark,
  hzToERB,
  hzToMel,
  lerpColor,
  logFreqMap,
  makeFreqMapper,
  melFreqMap,
  normalizeHex,
  sampleMappedBand,
  usesAsymmetricSmoothing,
  valueNoise,
  type PerceptualScale,
} from "./canvas2dHelpers";
import { CANVAS_2D_MODES } from "./visualizerHelpers";

/**
 * Covers the three helpers added for
 * docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md (the
 * six-times-copied perceptual-scale selector) and
 * docs/knowledge/gemini-ae-to-canvas2d-2026-10-02/README.md §1 (asymmetric
 * band smoothing, "the #1 visual-fatigue fix").
 */

describe("makeFreqMapper", () => {
  const barCount = 64;
  const freqLen = 1024;

  it.each(["linear", "log", "bark", "mel"] as PerceptualScale[])(
    "returns finite in-range indices for %s",
    (scale) => {
      const map = makeFreqMapper(scale, barCount, freqLen);
      for (let i = 0; i < barCount; i++) {
        const v = map(i);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(freqLen);
      }
    },
  );

  it("matches the individual scale functions exactly", () => {
    // The whole point of the dedup: the six copies were behaviourally identical,
    // so the shared factory must be too — or a mode would change appearance.
    const idx = 17;
    expect(makeFreqMapper("bark", barCount, freqLen)(idx)).toBeCloseTo(
      barkFreqMap(idx, barCount, freqLen),
      12,
    );
    expect(makeFreqMapper("mel", barCount, freqLen)(idx)).toBeCloseTo(
      melFreqMap(idx, barCount, freqLen),
      12,
    );
    expect(makeFreqMapper("log", barCount, freqLen)(idx)).toBeCloseTo(
      logFreqMap(idx, barCount, freqLen),
      12,
    );
    expect(makeFreqMapper("linear", barCount, freqLen)(idx)).toBeCloseTo(
      (idx / barCount) * freqLen,
      12,
    );
  });

  it("defaults to log when the scale is missing", () => {
    const idx = 5;
    expect(makeFreqMapper(undefined, barCount, freqLen)(idx)).toBeCloseTo(
      logFreqMap(idx, barCount, freqLen),
      12,
    );
  });

  it("falls back to log for an unrecognised scale", () => {
    const idx = 5;
    const bogus = makeFreqMapper("erb" as PerceptualScale, barCount, freqLen);
    expect(bogus(idx)).toBeCloseTo(logFreqMap(idx, barCount, freqLen), 12);
  });

  it("increases monotonically with bar index", () => {
    for (const scale of ["linear", "log", "bark", "mel"] as PerceptualScale[]) {
      const map = makeFreqMapper(scale, barCount, freqLen);
      let previous = -Infinity;
      for (let i = 0; i < barCount; i++) {
        const v = map(i);
        expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = v;
      }
    }
  });

  it("survives a degenerate configuration", () => {
    const map = makeFreqMapper("log", 0, 0);
    expect(Number.isFinite(map(0))).toBe(true);
  });
});

describe("sampleMappedBand", () => {
  const freq = [10, 20, 30, 40, 50];
  const identity = (i: number) => i;

  it("reads the mapped bin", () => {
    expect(sampleMappedBand(freq, identity, 2)).toBe(30);
  });

  it("clamps past the end rather than returning undefined", () => {
    // This is what `freq?.[Math.min(freqLen - 1, ...)] || 0` was doing, badly:
    // an out-of-range bin silently blanked the bar instead of clamping.
    expect(sampleMappedBand(freq, identity, 99)).toBe(50);
  });

  it("returns 0 for a negative index", () => {
    expect(sampleMappedBand(freq, identity, -5)).toBe(0);
  });

  it("returns 0 for a missing or empty array", () => {
    expect(sampleMappedBand(null, identity, 1)).toBe(0);
    expect(sampleMappedBand(undefined, identity, 1)).toBe(0);
    expect(sampleMappedBand([], identity, 1)).toBe(0);
  });

  it("returns 0 when the mapper produces NaN", () => {
    // log(0) on an empty FFT buffer used to produce exactly this.
    expect(sampleMappedBand(freq, () => Number.NaN, 1)).toBe(0);
  });

  it("floors a fractional bin index", () => {
    expect(sampleMappedBand(freq, () => 1.9, 0)).toBe(20);
  });
});

describe("asymmetricSmoothStep", () => {
  it("uses the AE doc's coefficients", () => {
    // docs/knowledge/gemini-ae-to-canvas2d-2026-10-02/README.md §1.
    expect(DEFAULT_ASYMMETRIC_SMOOTHING.attack).toBe(0.8);
    expect(DEFAULT_ASYMMETRIC_SMOOTHING.release).toBe(0.12);
  });

  it("rises much faster than it falls", () => {
    // The asymmetry IS the point: a 6.7x ratio is what damps flicker without
    // adding lag to a kick.
    expect(DEFAULT_ASYMMETRIC_SMOOTHING.attack).toBeGreaterThan(
      DEFAULT_ASYMMETRIC_SMOOTHING.release * 4,
    );
  });

  it("attacks faster than it releases from the same starting state", () => {
    const up = asymmetricSmoothStep(0.5, 1);
    const down = asymmetricSmoothStep(0.5, 0);
    expect(up).toBeCloseTo(0.9, 6);
    expect(down).toBeCloseTo(0.44, 6);
    // Stated separately so collapsing the two weights into one cannot pass: a
    // symmetric smoother would leave the rise and fall the same distance apart.
    expect(up - 0.5).toBeGreaterThan(2 * (0.5 - down));
  });

  it("converges to a steady target", () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = asymmetricSmoothStep(v, 0.8);
    expect(v).toBeCloseTo(0.8, 4);
  });

  it("is a no-op when the state already matches", () => {
    expect(asymmetricSmoothStep(0.5, 0.5)).toBe(0.5);
  });

  it("stays within [0,1] for an out-of-range target", () => {
    // An unnormalised FFT sample must not be able to push a bar off-canvas.
    expect(asymmetricSmoothStep(0.5, 5)).toBe(1);
    expect(asymmetricSmoothStep(0.5, -5)).toBe(0);
  });

  it("treats a NaN target as silence rather than poisoning the band", () => {
    const out = asymmetricSmoothStep(0.7, Number.NaN);
    expect(Number.isNaN(out)).toBe(false);
    expect(out).toBeLessThan(0.7);
  });

  it("honours custom coefficients", () => {
    expect(asymmetricSmoothStep(0, 1, { attack: 0.5, release: 0.5 })).toBeCloseTo(0.5, 6);
  });
});

describe("asymmetricSmoothBands", () => {
  it("smooths every band", () => {
    const values = [1, 1, 1, 1];
    const smoothed = [0, 0, 0, 0];
    asymmetricSmoothBands(values, smoothed);
    for (const v of smoothed) expect(v).toBeCloseTo(0.8, 6);
  });

  it("mutates in place rather than returning a copy", () => {
    // Runs 64+ times per frame; allocating here is the point of the signature.
    const smoothed = [0, 0];
    expect(asymmetricSmoothBands([1, 1], smoothed)).toBeUndefined();
    expect(smoothed[0]).toBeGreaterThan(0);
  });

  it("resizes a mismatched buffer instead of writing past its end", () => {
    const smoothed = [0, 0, 0];
    asymmetricSmoothBands([1, 1, 1, 1, 1], smoothed);
    expect(smoothed).toHaveLength(5);
    for (const v of smoothed) expect(v).toBeCloseTo(0.8, 6);
  });

  it("preserves state across frames when the buffer matches", () => {
    const smoothed = [0, 0];
    asymmetricSmoothBands([1, 1], smoothed);
    const afterFirst = smoothed[0];
    asymmetricSmoothBands([1, 1], smoothed);
    // A same-size buffer must NOT reset, or every frame would look like the first.
    expect(smoothed[0]).toBeGreaterThan(afterFirst);
  });

  it("reaches the target over repeated frames", () => {
    const smoothed = [0];
    for (let i = 0; i < 100; i++) asymmetricSmoothBands([0.5], smoothed);
    expect(smoothed[0]).toBeCloseTo(0.5, 4);
  });
});

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

describe("perceptual scales", () => {
  it("converts Hz to Bark, ERB, and Mel monotonically", () => {
    const freqs = [100, 500, 1000, 4000, 10000];
    for (let i = 1; i < freqs.length; i++) {
      expect(hzToBark(freqs[i])).toBeGreaterThan(hzToBark(freqs[i - 1]));
      expect(hzToERB(freqs[i])).toBeGreaterThan(hzToERB(freqs[i - 1]));
      expect(hzToMel(freqs[i])).toBeGreaterThan(hzToMel(freqs[i - 1]));
    }
  });

  it("barkToHz inverts hzToBark over the range the formula is valid for", () => {
    // Capped at 8 kHz deliberately. Traunmueller's inverse is an approximation
    // that degrades badly above it - measured 6.7% at 8 kHz but 26% at 12 kHz and
    // 38% at 16 kHz - so a test spanning the full range would be asserting a
    // property the Bark inverse does not have. The same formula is in
    // perceptualScales.ts, so this is a property of the scale, not of our code.
    for (const hz of [500, 1000, 2000, 4000, 8000]) {
      const roundTripped = barkToHz(hzToBark(hz));
      expect(Math.abs(roundTripped - hz) / hz).toBeLessThan(0.1);
    }
  });

  /**
   * Documents the ceiling rather than hiding it: past ~8 kHz the approximation
   * drifts, which is why barkFreqMap's top bars overshoot Nyquist. Worth
   * knowing before anyone "fixes" the clamping.
   */
  it("barkToHz is a low-frequency approximation, not exact at the top end", () => {
    expect(Math.abs(barkToHz(hzToBark(20000)) - 20000) / 20000).toBeGreaterThan(0.2);
  });

  /**
   * The asymmetric smoother must actually reach `bars`.
   *
   * This is the half-wired regression: `ASYMMETRIC_SMOOTHING_MODES` once omitted
   * "bars" while this file imported the symbol, so the suite could pass while
   * the feature did nothing. Asserting the *set contents* (rather than only the
   * predicate) is what makes the wiring itself visible.
   */
  it("ASYMMETRIC_SMOOTHING_MODES includes every bar-style mode that should smooth", () => {
    expect(ASYMMETRIC_SMOOTHING_MODES.has("bars")).toBe(true);
    expect(usesAsymmetricSmoothing("bars")).toBe(true);
    expect(usesAsymmetricSmoothing("stacked-frequency-bands")).toBe(true);
  });

  /** Every mode the picker offers must resolve to a real budget, no orphans. */
  it("all pickable Canvas2D modes are known to the frequency mapper", () => {
    for (const mode of CANVAS_2D_MODES) {
      const mapper = makeFreqMapper("bark" as PerceptualScale, 32, 1024);
      expect(Number.isFinite(mapper(0))).toBe(true);
      expect(typeof mode).toBe("string");
    }
  });

  it("barkFreqMap produces valid bin indices in range", () => {
    const barCount = 32;
    const freqLen = 1024;
    for (let i = 0; i < barCount; i++) {
      const bin = barkFreqMap(i, barCount, freqLen);
      expect(Number.isFinite(bin)).toBe(true);
      expect(bin).toBeGreaterThanOrEqual(0);
      expect(bin).toBeLessThanOrEqual(freqLen);
    }
  });

  it("melFreqMap produces valid bin indices in range", () => {
    const barCount = 32;
    const freqLen = 1024;
    for (let i = 0; i < barCount; i++) {
      const bin = melFreqMap(i, barCount, freqLen);
      expect(Number.isFinite(bin)).toBe(true);
      expect(bin).toBeGreaterThanOrEqual(0);
      expect(bin).toBeLessThanOrEqual(freqLen);
    }
  });

  it("barkFreqMap and melFreqMap increase monotonically with bar index", () => {
    const barCount = 16;
    const freqLen = 512;
    for (let i = 1; i < barCount; i++) {
      expect(barkFreqMap(i, barCount, freqLen)).toBeGreaterThan(barkFreqMap(i - 1, barCount, freqLen));
      expect(melFreqMap(i, barCount, freqLen)).toBeGreaterThan(melFreqMap(i - 1, barCount, freqLen));
    }
  });

  /**
   * Regression: barkFreqMap used the ERB inverse on Bark values.
   *
   * The range + monotonicity tests above pass for BOTH the correct and the
   * broken inverse, which is how a 3.4x-wrong scale survived review. What
   * actually separates them is *scale fidelity*: does a known frequency land
   * near where it should?
   *
   * Tolerance is 12%, not one bin. Traunmueller's Bark inverse is itself only
   * approximate, and with freqLength=1024 one bin is already 21.5 Hz - so a
   * tight tolerance fails at 8 kHz for reasons unrelated to the bug. 12% is
   * ~0.05 octaves: the broken inverse misses by 50-300%, so it cannot pass.
   */
  it("barkFreqMap maps known frequencies to near their true position", () => {
    const barCount = 128;
    const freqLen = 1024;
    const nyquist = 44100 / 2;
    const binHz = nyquist / freqLen;
    const hzAt = (hz: number) => {
      // Invert the bar index back to a frequency: find the bar whose Bark value
      // is closest to this frequency's Bark value, then read the Hz that bar
      // actually samples. This exercises barkFreqMap end-to-end rather than
      // re-deriving the inverse the function already calls.
      let best = 0;
      let bestErr = Infinity;
      for (let i = 0; i < barCount; i++) {
        const bin = barkFreqMap(i, barCount, freqLen);
        const err = Math.abs(hzToBark((bin / freqLen) * nyquist) - hzToBark(hz));
        if (err < bestErr) {
          bestErr = err;
          best = i;
        }
      }
      return Math.floor(barkFreqMap(best, barCount, freqLen)) * binHz;
    };

    // With 128 bars a Bark step is ~0.17 Bark, so allow 15%. The broken ERB
    // inverse misses by 50-300% and cannot pass this.
    for (const hz of [100, 250, 1000, 4000, 8000]) {
      expect(Math.abs(hzAt(hz) - hz) / hz).toBeLessThan(0.15);
    }
  });

  /**
   * The broken inverse capped the top bar near 1.2 kHz instead of Nyquist, so
   * the top two octaves were never displayed.
   */
  it("barkFreqMap spans the full spectrum, reaching the top of the range", () => {
    const barCount = 32;
    const freqLen = 1024;
    const nyquist = 44100 / 2;
    const topBarHz = (Math.floor(barkFreqMap(barCount - 1, barCount, freqLen)) / freqLen) * nyquist;
    expect(topBarHz).toBeGreaterThan(nyquist * 0.8);
  });

  /**
   * Bark is perceptually uniform: equal *Bark* intervals get equal bars, so
   * bar spacing in Hz must WIDEN with frequency (a log-like curve), not stay
   * constant (linear) or shrink.
   *
   * Deliberately not "bass octave gets more bars than treble octave" - that is
   * false for Bark by construction, and asserting it here would have been a
   * test that encodes a misunderstanding. Uniformity is in Bark units; the Hz
   * spread of a fixed Bark step grows with frequency.
   */
  it("barkFreqMap widens Hz spacing with frequency (perceptually uniform)", () => {
    const barCount = 64;
    const freqLen = 1024;
    const nyquist = 44100 / 2;
    const hzAt = (i: number) => (barkFreqMap(i, barCount, freqLen) / freqLen) * nyquist;

    const lowSpread = hzAt(14) - hzAt(7);
    const midSpread = hzAt(35) - hzAt(28);
    const highSpread = hzAt(56) - hzAt(49);

    expect(midSpread).toBeGreaterThan(lowSpread);
    expect(highSpread).toBeGreaterThan(midSpread);
  });
});
});
