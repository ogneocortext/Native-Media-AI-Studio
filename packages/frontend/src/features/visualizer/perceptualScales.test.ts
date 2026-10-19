import { describe, it, expect } from "vitest";
import {
  hzToBark,
  barkToHz,
  hzToErb,
  erbToHz,
  hzToMel,
  melToHz,
  generatePerceptualBands,
  mapToPerceptualBands,
  getBandCenterHz,
  dbToLinear,
  linearToDb,
  applyHammingWindow,
} from "./perceptualScales";

/**
 * Perceptual frequency mapping. The failure mode here is silent: a broken
 * inverse or a NaN band center does not throw, it just renders the visualizer's
 * frequency bands at the wrong pitch (or collapses them to zero), which reads
 * as "the viz feels off" rather than as a bug. These pin the exact inverses
 * (mel/erb/bark), the single-band divide-by-zero guard, and the two-pointer band
 * sweep that turns raw bins into band energies.
 */

describe("scale conversions", () => {
  it("mel is an exact inverse of hzToMel", () => {
    for (const hz of [20, 100, 440, 1000, 8000, 22050]) {
      expect(melToHz(hzToMel(hz))).toBeCloseTo(hz, 6);
    }
  });

  it("erb is an exact inverse of hzToErb", () => {
    for (const hz of [20, 100, 440, 1000, 8000, 22050]) {
      expect(erbToHz(hzToErb(hz))).toBeCloseTo(hz, 6);
    }
  });

  it("hzToMel hits the classic 1000 Hz ≈ 1000 mel anchor", () => {
    expect(hzToMel(1000)).toBeCloseTo(1000, 0);
    expect(hzToMel(0)).toBeCloseTo(0, 6);
  });

  it("bark is an exact inverse of hzToBark (bisection, not an approximation)", () => {
    // Traunmuller's closed form used to sit here. It is the inverse of a
    // *different* curve: measured -26% at 20 Hz, +46% at 22.05 kHz, and a 26.5%
    // jump across its own `z < 2` branch seam (161.5 -> 204.2 Hz). The bisection
    // inverse round-trips to double precision, so bark is pinned like mel/erb.
    for (const hz of [20, 100, 440, 1000, 8000, 12000, 22050]) {
      expect(barkToHz(hzToBark(hz))).toBeCloseTo(hz, 6);
    }
    expect(barkToHz(0)).toBe(0);
    expect(hzToBark(0)).toBeCloseTo(0, 6);

    const freqs = [50, 200, 1000, 4000, 12000];
    const barks = freqs.map(hzToBark);
    for (let i = 1; i < barks.length; i++) {
      expect(barks[i]).toBeGreaterThan(barks[i - 1]);
    }
    // Monotonic straight through the old branch seam at bark = 2.
    expect(barkToHz(1.999)).toBeLessThan(barkToHz(2));
    expect(barkToHz(2)).toBeLessThan(barkToHz(2.001));
    // Past hzToBark's asymptote (~25.918 Bark) it saturates, never Infinity/NaN.
    expect(Number.isFinite(barkToHz(26))).toBe(true);
    expect(barkToHz(26)).toBe(barkToHz(40));
  });

  it("dB and linear amplitude are inverses with a clamped floor", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(linearToDb(1)).toBeCloseTo(0, 6);
    expect(dbToLinear(20)).toBeCloseTo(10, 6);
    expect(linearToDb(dbToLinear(-12))).toBeCloseTo(-12, 6);
    // linearToDb(0) is clamped to 1e-10 → -200 dB, never -Infinity.
    expect(linearToDb(0)).toBeCloseTo(-200, 6);
  });
});

describe("generatePerceptualBands", () => {
  it("linear scale spaces bands evenly across the range", () => {
    expect(generatePerceptualBands("linear", 5, 20, 100)).toEqual([20, 40, 60, 80, 100]);
  });

  it("every scale returns numBands finite, strictly increasing values", () => {
    for (const scale of ["bark", "erb", "mel", "log", "linear"] as const) {
      const bands = generatePerceptualBands(scale, 16, 20, 22050);
      expect(bands).toHaveLength(16);
      expect(bands.every((b) => Number.isFinite(b))).toBe(true);
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i]).toBeGreaterThan(bands[i - 1]);
      }
    }
  });

  it("exact-inverse scales span min..max at the endpoints", () => {
    // Every inverse is exact now, so each scale's band[0] is minHz and its last
    // is maxHz. Bark used to be excluded from this loop because its approximate
    // inverse returned 14.85 Hz for 20 and 32.2 kHz (past Nyquist) for 22050.
    for (const scale of ["bark", "erb", "mel", "log", "linear"] as const) {
      const bands = generatePerceptualBands(scale, 16, 20, 22050);
      expect(bands[0], scale).toBeCloseTo(20, 3);
      expect(bands[bands.length - 1], scale).toBeCloseTo(22050, 3);
    }
  });

  it("guards the single-band divide-by-zero (never yields NaN centers)", () => {
    // i/(n-1) would divide by zero for n=1; the guard bumps n to 2 so a caller
    // asking for one band gets two usable centers instead of [NaN].
    for (const requested of [1, 0, Number.NaN]) {
      const bands = generatePerceptualBands("mel", requested);
      expect(bands.length).toBeGreaterThanOrEqual(2);
      expect(bands.every((b) => Number.isFinite(b))).toBe(true);
    }
  });
});

describe("mapToPerceptualBands", () => {
  // sampleRate 8000 -> Nyquist 4000, 8 bins -> binSize 500 Hz (bins at
  // 0, 500, 1000 ... 3500 Hz). Precomputed centers [100,900,2000,3600] give
  // boundaries [20,500,1450,2800,4000] -> bins land 1/2/3/2 per band.
  const bins = 8;
  const centers = [100, 900, 2000, 3600];

  it("uses precomputed band centers and averages energy per band", () => {
    const loud = new Uint8Array(bins).fill(255);
    expect(mapToPerceptualBands(loud, 8000, "mel", 4, centers)).toEqual([1, 1, 1, 1]);
    // Output length follows the supplied centers, not numBands.
    expect(mapToPerceptualBands(loud, 8000, "mel", 99, centers)).toHaveLength(centers.length);
  });

  it("returns zeroed bands for silent input and never exceeds unity", () => {
    const silent = new Uint8Array(bins);
    expect(mapToPerceptualBands(silent, 8000, "mel", 4, centers)).toEqual([0, 0, 0, 0]);

    const noisy = new Uint8Array(bins).fill(200);
    const energies = mapToPerceptualBands(noisy, 8000, "mel", 4, centers);
    for (const e of energies) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });

  it("generates centers itself when none are supplied", () => {
    const data = new Uint8Array(64).fill(128);
    expect(mapToPerceptualBands(data, 44100, "mel", 12)).toHaveLength(12);
  });

  it("derives monotonic band boundaries for every scale (sweep precondition)", () => {
    // The two-pointer sweep below only advances bandIdx while boundaries are
    // sorted, so a non-monotonic list silently misassigns bins at the top of the
    // spectrum. The bark scale did exactly that until barkToHz became an exact
    // inverse: its last boundary (23375 Hz) exceeded the 22050 Hz value appended
    // after it, because the band centers overshot Nyquist by 46%.
    for (const scale of ["bark", "erb", "mel", "log", "linear"] as const) {
      const bands = 16;
      const sampleRate = 48000;
      const maxHz = sampleRate / 2;
      const centers = generatePerceptualBands(scale, bands, 20, maxHz);

      const boundaries = [20];
      for (let i = 0; i < centers.length - 1; i++) {
        boundaries.push((centers[i] + centers[i + 1]) / 2);
      }
      boundaries.push(maxHz);

      for (let i = 1; i < boundaries.length; i++) {
        expect(boundaries[i], `${scale} boundary ${i}`).toBeGreaterThan(boundaries[i - 1]);
      }
    }
  });

  it("getBandCenterHz returns the band's center and 0 when out of range", () => {
    expect(getBandCenterHz(0, 5, "linear", 20, 100)).toBeCloseTo(20, 6);
    expect(getBandCenterHz(4, 5, "linear", 20, 100)).toBeCloseTo(100, 6);
    expect(getBandCenterHz(99, 5, "linear", 20, 100)).toBe(0);
  });
});

describe("applyHammingWindow", () => {
  it("shapes a flat full-scale signal by the Hamming curve", () => {
    const N = 5;
    const full = new Uint8Array(N).fill(255);
    const windowed = applyHammingWindow(full);
    expect(windowed).toBeInstanceOf(Float32Array);
    expect(windowed).toHaveLength(N);
    // Hamming endpoints are 0.54-0.46 = 0.08; the midpoint is 0.54+0.46 = 1.0.
    expect(windowed[0]).toBeCloseTo(0.08, 6);
    expect(windowed[(N - 1) / 2]).toBeCloseTo(1.0, 6);
    expect(windowed[N - 1]).toBeCloseTo(0.08, 6);
  });

  it("normalizes byte input by 255 before windowing", () => {
    // A 128 sample is 128/255 of full scale, windowed by 0.08 at the endpoint.
    const quiet = new Uint8Array([128, 128, 128, 128, 128]);
    const windowed = applyHammingWindow(quiet);
    expect(windowed[0]).toBeCloseTo((128 / 255) * 0.08, 6);
  });

  it("windows Float32 input as amplitude, without the byte /255 shrink", () => {
    // Regression: the /255 normalization was applied to every input, so a
    // time-domain Float32Array came back at ~0.4% of its value — muted.
    const full = new Float32Array(5).fill(1);
    const windowed = applyHammingWindow(full);
    expect(windowed[0]).toBeCloseTo(0.08, 6);
    expect(windowed[2]).toBeCloseTo(1.0, 6);
    expect(applyHammingWindow(new Float32Array(5).fill(0.5))[2]).toBeCloseTo(0.5, 6);
  });

  it("handles a single sample without dividing by zero", () => {
    // (N - 1) is 0 for N = 1, so the window factor was 0/0 = NaN.
    const one = applyHammingWindow(new Uint8Array([255]));
    expect(Number.isNaN(one[0])).toBe(false);
    expect(one[0]).toBeCloseTo(1, 6);
  });
});
