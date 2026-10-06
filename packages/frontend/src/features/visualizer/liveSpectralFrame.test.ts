import { describe, it, expect } from "vitest";
import { synthesizeLiveFrame, BAND_EDGES } from "./liveSpectralFrame";

/**
 * The live-frame synthesizer is the 2.11 fallback: it must keep
 * every reactivity uniform moving on an unanalyzed track. These
 * tests pin the band math against a synthetic analyser so a
 * regression (wrong band edges, a transient that fires on flat
 * input, a centroid that leaves [0,1]) fails here rather than
 * as a frozen visual in the browser.
 */

/** Minimal AnalyserNode stand-in: only what `synthesizeLiveFrame` reads. */
function mockAnalyser(
  bins: Uint8Array,
  opts: { sampleRate?: number; fftSize?: number } = {},
) {
  const sampleRate = opts.sampleRate ?? 44100;
  const fftSize = opts.fftSize ?? 2048;
  return {
    fftSize,
    frequencyBinCount: bins.length,
    context: { sampleRate },
    getByteFrequencyData: (out: Uint8Array) => {
      out.set(bins.subarray(0, out.length));
    },
  } as unknown as AnalyserNode;
}

/** A spectrum with energy only in `bin` (0..255). */
function singleBinSpectrum(bin: number, value = 255, binCount = 1024) {
  const bins = new Uint8Array(binCount);
  bins[bin] = value;
  return bins;
}

describe("synthesizeLiveFrame", () => {
  it("returns null without an analyser", () => {
    expect(synthesizeLiveFrame(null, 0)).toBeNull();
  });

  it("splits sub/mid/high by frequency, not bin index", () => {
    // 44.1 kHz / 2048 ≈ 21.53 Hz per bin.
    // 100 Hz → bin ~4.6 (sub), 1000 Hz → bin ~46 (mid), 5000 Hz → bin ~232 (high).
    const binWidth = 44100 / 2048;
    const subBin = Math.round(100 / binWidth);
    const midBin = Math.round(1000 / binWidth);
    const highBin = Math.round(5000 / binWidth);

    // A single hot bin is a narrow spike, so the band *average*
    // is low — what matters is that the energy lands in the right
    // band and nowhere else. Assert relative dominance.
    const subOnly = mockAnalyser(singleBinSpectrum(subBin));
    const subFrame = synthesizeLiveFrame(subOnly, 0)!;
    expect(subFrame.sub).toBeGreaterThan(0);
    expect(subFrame.sub).toBeGreaterThan(subFrame.mid);
    expect(subFrame.sub).toBeGreaterThan(subFrame.high);
    expect(subFrame.mid).toBe(0);
    expect(subFrame.high).toBe(0);

    const midOnly = mockAnalyser(singleBinSpectrum(midBin));
    const midFrame = synthesizeLiveFrame(midOnly, 0)!;
    expect(midFrame.mid).toBeGreaterThan(0);
    expect(midFrame.mid).toBeGreaterThan(midFrame.sub);
    expect(midFrame.mid).toBeGreaterThan(midFrame.high);
    expect(midFrame.sub).toBe(0);
    expect(midFrame.high).toBe(0);

    const highOnly = mockAnalyser(singleBinSpectrum(highBin));
    const highFrame = synthesizeLiveFrame(highOnly, 0)!;
    expect(highFrame.high).toBeGreaterThan(0);
    expect(highFrame.high).toBeGreaterThan(highFrame.sub);
    expect(highFrame.high).toBeGreaterThan(highFrame.mid);
    expect(highFrame.sub).toBe(0);
    expect(highFrame.mid).toBe(0);
  });

  it("recomputes band edges from the analyser's own sample rate", () => {
    // The same 1000 Hz tone must land in `mid` at both 44.1 and 48 kHz.
    // A hard-coded bin index would put it in `high` at 48 kHz.
    const binWidth48 = 48000 / 2048;
    const midBin48 = Math.round(1000 / binWidth48);
    const frame = synthesizeLiveFrame(
      mockAnalyser(singleBinSpectrum(midBin48), { sampleRate: 48000 }),
      0,
    )!;
    expect(frame.mid).toBeGreaterThan(0);
    expect(frame.mid).toBeGreaterThan(frame.high);
    expect(frame.mid).toBeGreaterThan(frame.sub);
    expect(frame.high).toBe(0);
  });

  it("reports a transient only on an RMS rise", () => {
    const quiet = new Uint8Array(1024).fill(10);
    const loud = new Uint8Array(1024).fill(200);

    // Flat input: no transient, whatever the level.
    const flat = synthesizeLiveFrame(mockAnalyser(loud), 200 / 255)!;
    expect(flat.transient).toBe(0);

    // Rise: transient proportional to the jump, clamped to 1.
    const rising = synthesizeLiveFrame(mockAnalyser(loud), 10 / 255)!;
    expect(rising.transient).toBeGreaterThan(0.5);
    expect(rising.transient).toBeLessThanOrEqual(1);

    // Fall: never a transient.
    const falling = synthesizeLiveFrame(mockAnalyser(quiet), 200 / 255)!;
    expect(falling.transient).toBe(0);
  });

  it("keeps the centroid inside [0, 1]", () => {
    const bins = new Uint8Array(1024);
    bins[1023] = 255; // all energy at Nyquist
    const frame = synthesizeLiveFrame(mockAnalyser(bins), 0)!;
    expect(frame.centroid).toBeGreaterThan(0.9);
    expect(frame.centroid).toBeLessThanOrEqual(1);

    const silent = synthesizeLiveFrame(mockAnalyser(new Uint8Array(1024)), 0)!;
    expect(silent.centroid).toBe(0);
  });

  it("normalizes RMS to [0, 1]", () => {
    const full = new Uint8Array(1024).fill(255);
    const frame = synthesizeLiveFrame(mockAnalyser(full), 0)!;
    expect(frame.rms).toBeCloseTo(1, 6);
  });

  it("exposes the documented band edges", () => {
    // The edges are part of the module's contract with the backend's
    // sub/mid/high split; pin them so a silent edit is caught.
    expect(BAND_EDGES.sub).toEqual({ min: 20, max: 250 });
    expect(BAND_EDGES.mid).toEqual({ min: 250, max: 2000 });
    expect(BAND_EDGES.high).toEqual({ min: 2000, max: 8000 });
  });
});
