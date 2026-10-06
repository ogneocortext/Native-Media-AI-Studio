/**
 * Live FFT → SpectralFrame synthesis (plan 2.11).
 *
 * `useSpectralTimeline` returns `null` for any track without a backend
 * analysis, and `ShaderVisualizer` used to skip
 * `AudioReactivityProcessor.update()` entirely in that case — so the
 * gamma-mapped reactivity uniforms (bass/mid/high/transient/energy/
 * centroid/beatPhase/downbeat) froze at stale values while the base
 * uniforms (from live `AudioData`) kept moving. Half the uniform set
 * frozen, half live.
 *
 * This module synthesizes a `SpectralFrame` per frame from the shared
 * graph's live `AnalyserNode` (see `useAudioGraph().analyserRef`), so
 * the processor keeps running on unanalyzed tracks. It is a module,
 * not inline in `ShaderVisualizer.tsx`, per D14: the frame loop stays
 * a coordinator and the DSP stays testable without a browser.
 *
 * The analyser is configured by `useAudioGraph` with `fftSize = 2048`
 * (1024 bins) and light `smoothingTimeConstant`. Bin width is
 * `sampleRate / fftSize` (~21.5 Hz at 44.1 kHz), so the band edges
 * below are computed from the analyser's own `sampleRate` rather than
 * hard-coded bin indices — a 48 kHz graph must not read 44.1 kHz
 * band edges.
 */

import type { SpectralFrame } from "./useSpectralTimeline";

/** Frequency band edges in Hz (ERB-adjacent, matches the backend's
 *  sub/mid/high split closely enough for a live fallback). */
export const BAND_EDGES = {
  sub: { min: 20, max: 250 },
  mid: { min: 250, max: 2000 },
  high: { min: 2000, max: 8000 },
} as const;

/**
 * Average the byte-spectrum values in `[minHz, maxHz)`, normalized to
 * 0..1. `getByteFrequencyData` returns 0..255 unsigned bytes, so the
 * mean is divided by 255. Out-of-range edges clamp to the bin array.
 */
function bandAverage(
  bins: Uint8Array,
  binWidthHz: number,
  minHz: number,
  maxHz: number,
): number {
  if (bins.length === 0 || binWidthHz <= 0) return 0;
  const first = Math.max(1, Math.floor(minHz / binWidthHz));
  const last = Math.min(bins.length - 1, Math.ceil(maxHz / binWidthHz));
  if (last <= first) return 0;
  let sum = 0;
  for (let i = first; i < last; i++) sum += bins[i];
  return sum / (last - first) / 255;
}

/**
 * Build one live frame from the analyser.
 *
 * `prevRms` is the previous frame's RMS (the caller owns it in a ref);
 * the transient channel is the frame-to-frame RMS rise, clamped — the
 * same "only rises trigger" rule `ImpulseTrigger` enforces, so a flat
 * or falling level never reports a transient.
 *
 * Returns `null` when there is no analyser or no audio flowing (all
 * bins zero), so callers can distinguish "silence" from "no device".
 */
export function synthesizeLiveFrame(
  analyser: AnalyserNode | null,
  prevRms: number,
): SpectralFrame | null {
  if (!analyser) return null;
  const binCount = analyser.frequencyBinCount;
  if (binCount === 0) return null;
  const bins = new Uint8Array(binCount);
  analyser.getByteFrequencyData(bins);

  const sampleRate = analyser.context.sampleRate || 44100;
  const binWidthHz = sampleRate / analyser.fftSize;

  const sub = bandAverage(bins, binWidthHz, BAND_EDGES.sub.min, BAND_EDGES.sub.max);
  const mid = bandAverage(bins, binWidthHz, BAND_EDGES.mid.min, BAND_EDGES.mid.max);
  const high = bandAverage(bins, binWidthHz, BAND_EDGES.high.min, BAND_EDGES.high.max);

  // RMS over the audible range (skip DC bin 0).
  let sum = 0;
  for (let i = 1; i < binCount; i++) sum += bins[i];
  const rms = sum / (binCount - 1) / 255;

  // Spectral centroid, normalized to [0, 1] over the audible range.
  let weighted = 0;
  let weight = 0;
  for (let i = 1; i < binCount; i++) {
    weighted += bins[i] * i;
    weight += bins[i];
  }
  const centroid =
    weight > 0
      ? weighted / weight / binCount
      : 0;

  // Transient: positive frame-to-frame RMS change, scaled so a hard
  // onset (~0.3 RMS jump) saturates near 1.
  const rise = Math.max(0, rms - prevRms);
  const transient = Math.min(1, rise / 0.3);

  return {
    frame: 0,
    time: 0,
    sub,
    mid,
    high,
    transient,
    centroid,
    rms,
  };
}
