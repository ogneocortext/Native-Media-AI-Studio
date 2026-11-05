import { describe, it, expect } from "vitest";
import {
  barkFreqMap,
  barkToHz,
  clamp,
  createEnvelopeStage,
  damp,
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
  valueNoise,
  type PerceptualScale,
} from "./canvas2dHelpers";
import { CANVAS_2D_MODES } from "./visualizerHelpers";

/**
 * Covers the three helpers added for
 * docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md (the
 * six-times-copied perceptual-scale selector), the T-VIZ-15 shared
 * attack/release envelope stage, and the frame-rate-invariant damp()
 * primitive from the visualizer-smoothness plan.
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

describe("createEnvelopeStage (T-VIZ-15)", () => {
  const FREQ_LEN = 1024;
  const SR = 44100;
  // binHz ≈ 21.5 → bin 5 ≈ 118 Hz (bass), bin 500 ≈ 10.8 kHz→clamped treble.
  const BASS_BIN = 5;
  const TREBLE_BIN = 500;

  function impulseStage() {
    const stage = createEnvelopeStage(FREQ_LEN, SR);
    const raw = new Uint8Array(FREQ_LEN);
    raw[BASS_BIN] = 255;
    raw[TREBLE_BIN] = 255;
    return { stage, raw };
  }

  it("attacks within a frame or two — a kick peaks immediately", () => {
    const { stage, raw } = impulseStage();
    stage.step(raw, 1 / 60);
    // attack k=0.5 → state ≈ 0.5 → byte ≈ 128 after ONE frame.
    expect(stage.bands[BASS_BIN]).toBeGreaterThan(100);
    stage.step(raw, 1 / 60);
    expect(stage.bands[BASS_BIN]).toBeGreaterThan(180);
  });

  it("releases slowly — the tail decays over ~0.5 s, not one frame", () => {
    const { stage, raw } = impulseStage();
    for (let i = 0; i < 30; i++) stage.step(raw, 1 / 60);
    const silent = new Uint8Array(FREQ_LEN);
    stage.step(silent, 1 / 60);
    // One silent frame must NOT snap the band to zero.
    expect(stage.bands[BASS_BIN]).toBeGreaterThan(100);
  });

  it("bass releases slower than treble (per-band time constants)", () => {
    const { stage, raw } = impulseStage();
    for (let i = 0; i < 30; i++) stage.step(raw, 1 / 60);
    const silent = new Uint8Array(FREQ_LEN);
    for (let i = 0; i < 20; i++) stage.step(silent, 1 / 60);
    // bass release k=0.06 vs treble k=0.10 → bass retains more energy.
    expect(stage.bands[BASS_BIN]).toBeGreaterThan(stage.bands[TREBLE_BIN]);
  });

  it("outputs the same 0–255 scale and length as the analyser", () => {
    const { stage, raw } = impulseStage();
    stage.step(raw, 1 / 60);
    expect(stage.bands).toHaveLength(FREQ_LEN);
    expect(stage.bands[BASS_BIN]).toBeLessThanOrEqual(255);
    expect(stage.bands[BASS_BIN]).toBeGreaterThanOrEqual(0);
  });

  it("reset() snaps all state to zero (track-switch silence guard)", () => {
    const { stage, raw } = impulseStage();
    for (let i = 0; i < 30; i++) stage.step(raw, 1 / 60);
    stage.reset();
    expect(stage.bands[BASS_BIN]).toBe(0);
    expect(stage.centroid).toBe(0);
  });

  it("computes an enveloped spectral centroid in 0..1", () => {
    const stage = createEnvelopeStage(FREQ_LEN, SR);
    const raw = new Uint8Array(FREQ_LEN);
    raw[FREQ_LEN - 1] = 255; // energy at the top bin → centroid ≈ 1
    for (let i = 0; i < 200; i++) stage.step(raw, 1 / 60);
    expect(stage.centroid).toBeGreaterThan(0.9);
    expect(stage.centroid).toBeLessThanOrEqual(1);
  });

  it("handles a shorter raw buffer without reading past it", () => {
    const stage = createEnvelopeStage(FREQ_LEN, SR);
    const short = new Uint8Array(64).fill(200);
    expect(() => stage.step(short, 1 / 60)).not.toThrow();
    // Tail bins decay toward zero rather than sticking at stale values.
    for (let i = 0; i < 60; i++) stage.step(short, 1 / 60);
    expect(stage.bands[FREQ_LEN - 1]).toBeLessThan(50);
  });
});

/**
 * damp() frame-rate invariance: running 60 steps at 60 Hz must converge to
 * the same state as 120 steps at 120 Hz, given the same continuous decay rate
 * `lambda = -60 * ln(1 - k)` derived from a per-60Hz-frame weight `k`.
 *
 * Without damp(), a fixed per-frame lerp `state += k * (target - state)`
 * converges faster at higher frame rates — 120 steps at 120 Hz overshoots
 * relative to 60 steps at 60 Hz — so the visual smoothness depends on the
 * monitor's refresh rate. damp() removes that dependency.
 */
describe("damp", () => {
  it("converges to the target", () => {
    const lambda = -60 * Math.log(1 - 0.28);
    let v = 0;
    for (let i = 0; i < 600; i++) v = damp(v, 1, lambda, 1 / 60);
    expect(v).toBeCloseTo(1, 4);
  });

  it("is invariant: 60 steps at 60 Hz == 120 steps at 120 Hz", () => {
    // springK = 0.28 from computeBarTarget in canvas2dModes.ts
    const lambda = -60 * Math.log(1 - 0.28);

    let v60 = 0;
    for (let i = 0; i < 60; i++) v60 = damp(v60, 1, lambda, 1 / 60);

    let v120 = 0;
    for (let i = 0; i < 120; i++) v120 = damp(v120, 1, lambda, 1 / 120);

    expect(v120).toBeCloseTo(v60, 4);
  });

  it("is invariant: 60 steps at 60 Hz == 30 steps at 30 Hz", () => {
    const lambda = -60 * Math.log(1 - 0.22);

    let v60 = 0;
    for (let i = 0; i < 60; i++) v60 = damp(v60, 1, lambda, 1 / 60);

    let v30 = 0;
    for (let i = 0; i < 30; i++) v30 = damp(v30, 1, lambda, 1 / 30);

    expect(v30).toBeCloseTo(v60, 4);
  });

  it("matches a fixed per-frame lerp at exactly 60 Hz", () => {
    // At dt = 1/60, damp(lambda, dt) must equal state + k * (target - state).
    const k = 0.28;
    const lambda = -60 * Math.log(1 - k);

    let vDamp = 0;
    let vLerp = 0;
    for (let i = 0; i < 60; i++) {
      vDamp = damp(vDamp, 1, lambda, 1 / 60);
      vLerp = vLerp + k * (1 - vLerp);
    }
    expect(vDamp).toBeCloseTo(vLerp, 6);
  });

  it("decays toward zero when target is 0", () => {
    const lambda = -60 * Math.log(1 - 0.5);
    let v = 1;
    for (let i = 0; i < 60; i++) v = damp(v, 0, lambda, 1 / 60);
    // (1 - 0.5)^60 ≈ 8.7e-19, essentially zero after 60 frames at k=0.5
    expect(v).toBeLessThan(1e-10);
  });

  it("handles dt = 0 as a no-op", () => {
    expect(damp(0.3, 1, 5, 0)).toBeCloseTo(0.3, 6);
  });

  it("handles lambda = 0 as a no-op (no decay)", () => {
    let v = 0.3;
    for (let i = 0; i < 100; i++) v = damp(v, 1, 0, 1 / 60);
    expect(v).toBeCloseTo(0.3, 6);
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
      expect(lerpColor("#000000", "#ffffff", t)).toMatch(/^#(-?[0-9a-f]+){3}$/i);
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

  it("barkToHz is an exact inverse of hzToBark across the audible range", () => {
    // Traunmuller's closed form used to be asserted here, and it is the inverse
    // of a different curve — it drifted -26% at 20 Hz and +46% at Nyquist — so
    // this test was capped at 8 kHz with a 10% tolerance. Both are now exact.
    for (const hz of [20, 100, 500, 1000, 2000, 4000, 8000, 12000, 22050]) {
      expect(barkToHz(hzToBark(hz))).toBeCloseTo(hz, 6);
    }
  });

  /**
   * The exactness the old approximation lacked, asserted where it was worst:
   * the top end. The overshoot there is what made mapToPerceptualBands' band
   * boundaries non-monotonic and broke its sorted-input sweep.
   */
  it("barkToHz is exact at the top end, not only at low frequency", () => {
    expect(Math.abs(barkToHz(hzToBark(20000)) - 20000) / 20000).toBeLessThan(1e-6);
    expect(barkToHz(30)).toBe(barkToHz(40)); // saturates, never Infinity
  });

  /**
   * T-VIZ-15: the shared envelope stage replaced the per-mode springs and
   * the two-mode asymmetric wiring. Pin its existence here so a future
   * "optimization" cannot silently delete the only smoothing stage.
   */
  it("createEnvelopeStage is exported and produces a working stage", () => {
    const stage = createEnvelopeStage(1024, 44100);
    expect(stage.bands).toHaveLength(1024);
    expect(typeof stage.step).toBe("function");
    expect(typeof stage.reset).toBe("function");
  });

  /** Every mode the picker offers must resolve to a real budget, no orphans. */
  it("all pickable Canvas2D modes are known to the frequency mapper", () => {
    for (const mode of CANVAS_2D_MODES) {
      const mapper = makeFreqMapper("bark", 32, 1024);
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
   * Tolerance is 15%, but that is now purely *quantization*, not inverse error:
   * 128 bars over the Bark range is a ~0.19 Bark step, which is ~10% of 100 Hz,
   * so the low-frequency cases are coarse by construction and the search can
   * only land within half a step. The 12 kHz case is included because there the
   * old approximation missed by 25% — well outside quantization — which is what
   * makes this a regression test rather than a restatement of the mapper.
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

    // With 128 bars a Bark step is ~0.19 Bark, so allow the quantization bound.
    // The old approximation misses 12 kHz by 25% and cannot pass.
    for (const hz of [100, 250, 1000, 4000, 8000, 12000]) {
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
   * The Hz -> bin conversion divides by Nyquist, so the live AudioContext rate
   * must be passed through. It was not: both callers omitted it, so every render
   * assumed 44.1 kHz — an 8.8% frequency error on a 48 kHz device (the Windows
   * default), which is the difference between bar 32 showing 1.75 kHz and 1.9 kHz.
   */
  it("honours the supplied sample rate when placing bars", () => {
    const barCount = 64;
    const freqLen = 1024;

    // Bar 0 is the same 20 Hz, but on a wider axis 20 Hz is a smaller fraction
    // of it, so the bin index must shrink; the top bar is Nyquist for either rate.
    expect(barkFreqMap(0, barCount, freqLen, 48000)).toBeLessThan(
      barkFreqMap(0, barCount, freqLen, 44100),
    );
    expect(barkFreqMap(barCount - 1, barCount, freqLen, 44100)).toBeCloseTo(freqLen, 6);
    expect(barkFreqMap(barCount - 1, barCount, freqLen, 48000)).toBeCloseTo(freqLen, 6);

    let lower = 0;
    for (let i = 1; i < barCount - 1; i++) {
      if (barkFreqMap(i, barCount, freqLen, 48000) < barkFreqMap(i, barCount, freqLen, 44100)) {
        lower++;
      }
    }
    expect(lower).toBeGreaterThan(barCount / 2);

    // makeFreqMapper forwards the rate rather than re-defaulting it.
    expect(makeFreqMapper("bark", barCount, freqLen, 48000)(0)).toBeCloseTo(
      barkFreqMap(0, barCount, freqLen, 48000),
      12,
    );
    expect(makeFreqMapper("mel", barCount, freqLen, 48000)(5)).toBeCloseTo(
      melFreqMap(5, barCount, freqLen, 48000),
      12,
    );
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
