/**
 * Deterministic audio frame (plan 2.9 follow-up) — pure-function tests.
 *
 * The properties pinned here are the ones the export's honesty depends on:
 * band means equal the measured band energies, the modelled tier degrades
 * instead of lying, the frame is a pure function of (analysis, timeline, t),
 * and the beat grid matches what the live path reads at the same second.
 */

import { describe, expect, it } from "vitest";
import type { AudioAnalysisData, StemAnalysisData } from "../types";
import type { SpectralFrame } from "../useSpectralTimeline";
import { BAND_EDGES } from "../liveSpectralFrame";
import {
  bandBinRange,
  deterministicAudioFrame,
  downbeatAt,
  drumTypeAt,
  frameReadiness,
  measuredBandsFromFrame,
  onsetAt,
  synthWaveform,
} from "../services/analysisAudioFrame";

const SR = 44100;
const BINS = 1024;
const FFT = 2048;

function analysis(over: Partial<AudioAnalysisData> = {}): AudioAnalysisData {
  return {
    tempo_bpm: 120,
    beat_count: 2,
    beat_times: [1, 2],
    onset_times: [],
    energy_curve: [0.5, 0.5],
    amplitude_envelope: [0.5, 0.5],
    sections: [],
    confidence: 1,
    duration_seconds: 4,
    ...over,
  } as AudioAnalysisData;
}

/** One sampled spectral frame: what `useSpectralTimeline` hands over. */
function spectralFrame(over: Partial<SpectralFrame> = {}): SpectralFrame {
  return { frame: 0, time: 0, sub: 0.8, mid: 0.2, high: 0.05, transient: 1, centroid: 0.1, rms: 0.6, ...over };
}

/** Mean byte inside a band, in the analyser's 0..255 unit. */
function bandMean(freq: Uint8Array, min: number, max: number): number {
  const { first, last } = bandBinRange(min, max, BINS, SR);
  let sum = 0;
  let count = 0;
  for (let i = first; i <= last; i++) {
    sum += freq[i] ?? 0;
    count++;
  }
  return count ? sum / count : 0;
}

describe("measuredBandsFromFrame", () => {
  it("reads the measured bands off a sampled frame, clamped to 0..1", () => {
    const bands = measuredBandsFromFrame(spectralFrame({ sub: 1.4, high: -0.2 }));
    expect(bands?.sub).toBe(1);
    expect(bands?.high).toBe(0);
    expect(bands?.mid).toBeCloseTo(0.2, 5);
  });

  it("returns null without a frame so callers take the modelled tier", () => {
    expect(measuredBandsFromFrame(null)).toBeNull();
    expect(measuredBandsFromFrame(undefined)).toBeNull();
  });
});

describe("onset / downbeat / drum windows", () => {
  it("fires inside the window and not outside it", () => {
    expect(onsetAt([1.0], 1.0)).toBe(true);
    expect(onsetAt([1.0], 1.05)).toBe(true); // +50 ms, inside ±80 ms
    expect(onsetAt([1.0], 1.2)).toBe(false); // +200 ms
    expect(onsetAt([], 1)).toBe(false);
  });

  it("uses the wider 150 ms window for downbeats and drum classes", () => {
    expect(downbeatAt([2], 2.1)).toBe(true);
    expect(downbeatAt([2], 2.3)).toBe(false);
    expect(drumTypeAt([{ time: 2, drumType: "kick" }], 2.1)).toBe("kick");
    expect(drumTypeAt([{ time: 2, drumType: null }], 2.0)).toBeNull();
    expect(drumTypeAt([{ time: 2, drumType: "kick" }], 2.4)).toBeNull();
  });
});

describe("bandBinRange", () => {
  it("keeps abutting bands from sharing a boundary bin", () => {
    const sub = bandBinRange(BAND_EDGES.sub.min, BAND_EDGES.sub.max, BINS, SR);
    const mid = bandBinRange(BAND_EDGES.mid.min, BAND_EDGES.mid.max, BINS, SR);
    const high = bandBinRange(BAND_EDGES.high.min, BAND_EDGES.high.max, BINS, SR);
    expect(mid.first).toBeGreaterThan(sub.last);
    expect(high.first).toBeGreaterThan(mid.last);
    expect(sub.first).toBeGreaterThanOrEqual(1); // never DC
    expect(high.last).toBeLessThan(BINS);
  });
});

describe("frameReadiness", () => {
  it("refuses when neither source exists — a blank export must not look fine", () => {
    const ready = frameReadiness({ analysis: null, spectralFrame: null });
    expect(ready.ok).toBe(false);
    expect(ready.source).toBe("none");
    expect(ready.reason).toMatch(/analysis/i);
  });

  it("accepts a timeline-only track and says what will be missing", () => {
    const ready = frameReadiness({ analysis: null, spectralFrame: spectralFrame() });
    expect(ready.ok).toBe(true);
    expect(ready.source).toBe("measured");
    expect(ready.reason).toMatch(/transients/i);
  });

  it("reports both sources when the analysis is present too", () => {
    const ready = frameReadiness({ analysis: analysis(), spectralFrame: spectralFrame() });
    expect(ready.ok).toBe(true);
    expect(ready.source).toBe("measured+analysis");
  });

  it("accepts an analysis-only track", () => {
    expect(frameReadiness({ analysis: analysis(), spectralFrame: null })).toEqual({
      ok: true,
      source: "analysis",
    });
  });
});

describe("deterministicAudioFrame — timeline only (no analysis)", () => {
  /**
   * This is the case that shipped the black export: the analysis cache and the
   * spectral timeline are populated separately, so a track can have one and not
   * the other. The frame must still be a real recording of the track.
   */
  it("renders the measured bands instead of falling silent", () => {
    const { freq, audio, measuredBands, source } = deterministicAudioFrame({
      analysis: null,
      spectralFrame: spectralFrame({ sub: 0.9, mid: 0.4, high: 0.1, rms: 0.7, transient: 0.8 }),
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });

    expect(source).toBe("measured");
    expect(measuredBands).toBe(true);
    expect(audio.bass).toBeCloseTo(0.9, 5);
    expect(audio.mid).toBeCloseTo(0.4, 5);
    expect(audio.treble).toBeCloseTo(0.1, 5);
    // Not a black canvas: the spectrum and the meters carry the track.
    expect(Math.max(...Array.from(freq))).toBeGreaterThan(100);
    expect(audio.energy).toBeGreaterThan(0);
    expect(audio.peak).toBeGreaterThan(0);
  });

  it("takes `beat` from the timeline's transient channel", () => {
    const hit = deterministicAudioFrame({
      analysis: null,
      spectralFrame: spectralFrame({ transient: 0.9 }),
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });
    const miss = deterministicAudioFrame({
      analysis: null,
      spectralFrame: spectralFrame({ transient: 0.1 }),
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });
    expect(hit.audio.beat).toBe(true);
    expect(miss.audio.beat).toBe(false);
    // No analyzed grid → no phase, and consumers fall back to pulses.
    expect(hit.audio.beatPhase).toBeUndefined();
    expect(hit.audio.nextBeatIn).toBe(0);
  });

  it("still refuses when there is nothing at all", () => {
    const { audio, freq, wave, source } = deterministicAudioFrame({
      analysis: null,
      spectralFrame: null,
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });
    expect(source).toBe("none");
    expect(Math.max(...Array.from(freq))).toBe(0);
    expect(audio.energy).toBe(0);
    // Waveform silence is 128 (its zero-crossing centre), not 0.
    expect(wave.every((b) => b === 128)).toBe(true);
  });
});

describe("deterministicAudioFrame — measured tier", () => {
  it("puts the measured band energies into the spectrum, mean-exact", () => {
    const { freq, audio, measuredBands } = deterministicAudioFrame({
      analysis: analysis(),
      spectralFrame: spectralFrame(),
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });

    expect(measuredBands).toBe(true);
    // 0.8 · 255 = 204 in the sub band, 0.2 · 255 = 51 in mid, 0.05 · 255 ≈ 13.
    expect(bandMean(freq, BAND_EDGES.sub.min, BAND_EDGES.sub.max)).toBeCloseTo(204, -0.5);
    expect(bandMean(freq, BAND_EDGES.mid.min, BAND_EDGES.mid.max)).toBeCloseTo(51, -0.5);
    expect(bandMean(freq, BAND_EDGES.high.min, BAND_EDGES.high.max)).toBeCloseTo(12.75, -0.5);
    expect(audio.bass).toBeCloseTo(0.8, 5);
    expect(audio.mid).toBeCloseTo(0.2, 5);
    expect(audio.treble).toBeCloseTo(0.05, 5);
  });

  it("blends energy 60/40 the way the live path does", () => {
    const { audio } = deterministicAudioFrame({
      analysis: analysis({ energy_curve: [0.25, 0.25] }),
      spectralFrame: spectralFrame(), // rms 0.6
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });
    // 0.6 * 0.6 + 0.25 * 0.4 = 0.46
    expect(audio.energy).toBeCloseTo(0.46, 5);
    expect(audio.analyzedEnergy).toBeCloseTo(0.25, 5);
  });

  it("reads the beat grid at the same second the live path would", () => {
    const { audio } = deterministicAudioFrame({
      analysis: analysis({ beat_times: [0, 1, 2, 3] }),
      spectralFrame: spectralFrame(),
      tSec: 1.5,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });
    // Halfway between beats 1 and 2.
    expect(audio.beatPhase).toBeCloseTo(0.5, 5);
    expect(audio.nextBeatIn).toBeCloseTo(0.5, 5);
  });

  it("is a pure function of its inputs", () => {
    const input = {
      analysis: analysis(),
      spectralFrame: spectralFrame(),
      tSec: 0.75,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    } as const;
    const a = deterministicAudioFrame(input);
    const b = deterministicAudioFrame(input);
    expect(Array.from(a.freq)).toEqual(Array.from(b.freq));
    expect(Array.from(a.wave)).toEqual(Array.from(b.wave));
    expect(a.audio).toEqual(b.audio);
  });
});

describe("deterministicAudioFrame — modelled tier", () => {
  it("carries the analyzed energy in all three bands and says it is modelled", () => {
    const { freq, audio, measuredBands } = deterministicAudioFrame({
      analysis: analysis({ energy_curve: [0.4, 0.4], spectral_centroid: [4000, 4000] }),
      spectralFrame: null,
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });
    expect(measuredBands).toBe(false);
    expect(audio.bass).toBeCloseTo(0.4, 5);
    expect(audio.mid).toBeCloseTo(0.4, 5);
    expect(audio.treble).toBeCloseTo(0.4, 5);
    // Still a real spectrum: the tilt must not flatten it to one value.
    const values = new Set(Array.from(freq));
    expect(values.size).toBeGreaterThan(3);
  });

  it("keeps the spectrum silent when the track is silent", () => {
    const { freq, audio } = deterministicAudioFrame({
      analysis: analysis({ energy_curve: [0, 0], amplitude_envelope: [0, 0] }),
      spectralFrame: null,
      tSec: 0,
      binCount: BINS,
      fftSize: FFT,
      sampleRate: SR,
    });
    expect(Math.max(...Array.from(freq))).toBe(0);
    expect(audio.energy).toBe(0);
    expect(audio.overall).toBe(0);
  });
});

describe("synthWaveform", () => {
  it("stays inside the analyser's byte range and moves with the ZCR", () => {
    const low = synthWaveform(analysis({ zero_crossing_rate: [0.01, 0.01] }), 0.5, FFT, SR);
    const high = synthWaveform(analysis({ zero_crossing_rate: [0.2, 0.2] }), 0.5, FFT, SR);
    for (const buffer of [low, high]) {
      expect(buffer).toHaveLength(FFT);
      expect(Math.min(...Array.from(buffer))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...Array.from(buffer))).toBeLessThanOrEqual(255);
    }
    // A higher zero-crossing rate means a higher dominant frequency, so more
    // sign changes across the same window.
    const crossings = (b: Uint8Array) => {
      let n = 0;
      for (let i = 1; i < b.length; i++) {
        if ((b[i - 1]! < 128) !== (b[i]! < 128)) n++;
      }
      return n;
    };
    expect(crossings(high)).toBeGreaterThan(crossings(low));
  });

  it("is flat (128) when the envelope is silent", () => {
    const wave = synthWaveform(
      analysis({ zero_crossing_rate: [0.1, 0.1], amplitude_envelope: [0, 0] }),
      1,
      FFT,
      SR,
    );
    expect(wave.every((b) => b === 128)).toBe(true);
  });
});

describe("stem analysis shape (regression guard for the timeline type)", () => {
  it("accepts the per-stem energy curve the backend sends", () => {
    const stems: StemAnalysisData = {
      vocals: {
        file: "v.wav",
        url: "/v.wav",
        duration: 10,
        sample_rate: 44100,
        rms_mean: 0.1,
        rms_std: 0.02,
        centroid_mean: 1000,
        zcr_mean: 0.05,
        energy_curve: [0.1, 0.2],
        energy_curve_points: 2,
      },
    };
    expect(stems.vocals?.energy_curve).toHaveLength(2);
  });
});
