/**
 * Deterministic audio frame for the 2D frame-accurate export (plan 2.9 follow-up).
 *
 * The shader lane's virtual frames freeze every live input and keep the motion
 * (`ShaderVisualizer`), because a shader frame is a function of time plus the
 * analysis timeline. The 2D lane cannot do that: its bars read the live
 * `AnalyserNode` byte spectrum and its waveform reads the time-domain buffer,
 * so a frozen frame would be an empty canvas rather than a recording of the
 * track. This module therefore *derives* those buffers from the analysis
 * timeline instead, and this header records exactly how much of it is measured
 * versus modelled, because the difference is the difference between an export
 * and an approximation.
 *
 * Two tiers, chosen by what the machine actually has:
 *
 * 1. **Measured** — `/api/audio/spectral-timeline/{file}` (`SpectralTimeline`)
 *    carries per-frame sub/mid/high/transient/centroid/rms for the track. Band
 *    energies and RMS come from there, so the envelope that drives the visuals
 *    is the track's own measured envelope. The spectral timeline is fetched by
 *    the shader lane already, so 2D mode reuses the same source rather than a
 *    second fetch.
 * 2. **Modelled** — with no spectral timeline, only `AudioAnalysisData` is
 *    available: `energy_curve`, `spectral_centroid`, `amplitude_envelope`,
 *    `onset_times`, `beat_times`, `downbeat_times`. Band energies are unknown,
 *    so all three bands carry the track energy and the in-band shape comes from
 *    the measured brightness (`spectral_centroid`). The export still animates
 *    with the music; its spectral shape is a tilt, not a measurement.
 *
 * What is never recoverable, in either tier: the true time-domain waveform.
 * `synthWaveform` builds one from the measured zero-crossing rate and envelope,
 * so the `waveform` mode shows a deterministic oscilloscope at the right
 * frequency and level — not the track's actual waveform.
 *
 * Everything here is pure: same inputs, same bytes out. No clock, no analyser,
 * no module state.
 */

import { getBeatPhase, getEnergyAtTime } from "../../../shared/timing";
import type { AudioAnalysisData, AudioData } from "../types";
import type { SpectralFrame } from "../useSpectralTimeline";
import { BAND_EDGES } from "../liveSpectralFrame";

export interface DeterministicFrameInput {
  analysis: AudioAnalysisData | null;
  /**
   * Per-frame measured band energies from the spectral timeline. The caller
   * samples the timeline (the same way the live path does) and hands over one
   * frame; this module stays free of the fetch and its index maths.
   *
   * This is the *primary* source, not a fallback: the timeline is what makes
   * the export faithful, and it exists for tracks whose `AudioAnalysisData`
   * does not (the analysis cache and the timeline are populated separately, so
   * a key mismatch in one leaves the other intact — observed live).
   */
  spectralFrame?: SpectralFrame | null;
  /** Virtual time in seconds — frames are sampled at 1/fps steps. */
  tSec: number;
  /** Bin count of the analyser the live path would have read. */
  binCount: number;
  /** Time-domain buffer length (the analyser's `fftSize`). */
  fftSize: number;
  /** Shared audio graph's sample rate, for Hz-per-bin. */
  sampleRate: number;
}

export interface DeterministicFrame {
  audio: AudioData;
  /** Byte magnitudes in the 0..255 unit `AnalyserNode.getByteFrequencyData` writes. */
  freq: Uint8Array;
  /** Time-domain bytes, 128 = zero crossing, in `getByteTimeDomainData`'s unit. */
  wave: Uint8Array;
  /** True when the band energies came from the measured spectral timeline. */
  measuredBands: boolean;
  /** Which sources a real frame could be built from — see `frameReadiness`. */
  source: FrameSource;
}

export type FrameSource =
  /** Both the timeline and the analysis: bands, envelope, beat grid, waveform. */
  | "measured+analysis"
  /** The timeline only: bands, envelope and transients; beat grid unavailable. */
  | "measured"
  /** Analysis only: modelled bands from the energy curve; no per-frame bands. */
  | "analysis"
  /** Nothing to render from — an export would be blank. */
  | "none";

const BYTE_FULL = 255;
const SILENT: AudioData = {
  bass: 0,
  mid: 0,
  treble: 0,
  overall: 0,
  beat: false,
  peak: 0,
  energy: 0,
  drumType: null,
  nextBeatIn: 0,
};

/** Clamp to [0, 1] and reject NaN — a curve value must never become a NaN byte. */
function unit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Can a faithful frame be built at all, and from what?
 *
 * Callers must check this *before* encoding. A 300-frame MP4 of a black canvas
 * looks exactly like a successful export, which is the worst failure mode this
 * feature can have — plan 2.9 names black frames as unacceptable.
 */
export function frameReadiness(input: {
  analysis: AudioAnalysisData | null;
  spectralFrame?: SpectralFrame | null;
}): { ok: boolean; source: FrameSource; reason?: string } {
  const hasTimeline = Boolean(input.spectralFrame);
  const hasAnalysis = Boolean(input.analysis);
  if (hasTimeline && hasAnalysis) return { ok: true, source: "measured+analysis" };
  if (hasTimeline) {
    return {
      ok: true,
      source: "measured",
      reason:
        "this track has a spectral timeline but no analysis — beat, onset and waveform detail come from the timeline's transients",
    };
  }
  if (hasAnalysis) return { ok: true, source: "analysis" };
  return {
    ok: false,
    source: "none",
    reason:
      "this track has no analyzed timeline — run analysis first (the export is driven by the analyzed timeline, never the wall clock)",
  };
}

/**
 * Read the measured band energies off one sampled spectral frame.
 *
 * Returns null when the frame is absent, so callers take the modelled tier —
 * and callers can tell which tier they got, which the export reports.
 */
export function measuredBandsFromFrame(
  frame: SpectralFrame | null | undefined,
): { sub: number; mid: number; high: number; rms: number; transient: number } | null {
  if (!frame) return null;
  return {
    sub: unit(frame.sub),
    mid: unit(frame.mid),
    high: unit(frame.high),
    rms: unit(frame.rms),
    transient: unit(frame.transient),
  };
}

/** Measured brightness in [0, 1], using the same 8 kHz ceiling as `trackFeatures`. */
function brightnessAt(analysis: AudioAnalysisData, tSec: number): number {
  const curve = analysis.spectral_centroid;
  if (!curve?.length) return 0.5;
  const progress = analysis.duration_seconds > 0 ? tSec / analysis.duration_seconds : 0;
  const index = Math.max(
    0,
    Math.min(curve.length - 1, Math.floor(progress * (curve.length - 1))),
  );
  return Math.min(1, Math.max(0, (curve[index] ?? 0) / 8000));
}

/** Onset window: ±80 ms, decaying — the window `trackFeatures` uses. */
export function onsetAt(onsetTimes: number[] | undefined, tSec: number): boolean {
  if (!onsetTimes?.length || !Number.isFinite(tSec)) return false;
  const centi = Math.round(tSec * 100);
  // Set lookup rather than a scan: `onset_times` holds hundreds of entries and
  // this runs once per exported frame (same approach as `trackFeatures`).
  const keys = new Set<number>();
  for (const time of onsetTimes) keys.add(Math.round(time * 100));
  for (let delta = 0; delta <= 8; delta++) {
    if (keys.has(centi - delta) || keys.has(centi + delta)) return true;
  }
  return false;
}

/** Downbeat window: ±150 ms, matching the live path's detection. */
export function downbeatAt(downbeatTimes: number[] | undefined, tSec: number): boolean {
  if (!downbeatTimes?.length || !Number.isFinite(tSec)) return false;
  const centi = Math.round(tSec * 100);
  const keys = new Set<number>();
  for (const time of downbeatTimes) keys.add(Math.round(time * 100));
  for (let delta = 0; delta <= 15; delta++) {
    if (keys.has(centi - delta) || keys.has(centi + delta)) return true;
  }
  return false;
}

interface TimedDrumBeat {
  time: number;
  drumType: string | null;
}

/** Nearest analyzed beat's drum class, within the same 150 ms window. */
export function drumTypeAt(
  beats: TimedDrumBeat[] | undefined,
  tSec: number,
): AudioData["drumType"] {
  if (!beats?.length || !Number.isFinite(tSec)) return null;
  const centi = Math.round(tSec * 100);
  for (const beat of beats) {
    if (Math.abs(Math.round(beat.time * 100) - centi) <= 15 && beat.drumType) {
      return beat.drumType as AudioData["drumType"];
    }
  }
  return null;
}

/**
 * Half-open bin span for a band, in the analyser's bin geometry.
 *
 * `ceil` on both edges so adjacent bands never share a boundary bin: the live
 * `bandAverage` in `liveSpectralFrame` rounds both edges, which makes BAND_EDGES'
 * abutting bands write the same bin twice. That is invisible when averaging
 * (the shared bin is one of many) but it shifts a band's mean by one bin's worth
 * — which the export's band-exactness depends on.
 */
export function bandBinRange(
  minHz: number,
  maxHz: number,
  binCount: number,
  sampleRate: number,
): { first: number; last: number } {
  const first = Math.max(1, Math.ceil(minHz / (sampleRate / 2 / Math.max(1, binCount))));
  const last = Math.min(
    binCount - 1,
    Math.ceil(maxHz / (sampleRate / 2 / Math.max(1, binCount))) - 1,
  );
  return { first, last };
}

/** Spectral tilt across a band, in dB per octave, kept modest so bars read as music. */
const IN_BAND_TILT_DB_PER_OCTAVE = 3;

/**
 * Fill `bins` so the mean byte inside each band equals that band's energy.
 *
 * The in-band shape is a fixed −3 dB/oct tilt (normalized per band), which
 * keeps the band mean exact while giving the bars a spectral slope instead of
 * three flat plateaus. Brightness only tilts the *modelled* tier: in the
 * measured tier the timeline's own band energies already carry the shape.
 */
function fillSpectrumBins(  bins: Uint8Array,
  bandEnergy: { sub: number; mid: number; high: number },
  tiltCenter: "low" | "flat",
  binCount: number,
  sampleRate: number,
): void {
  const bands: Array<{ min: number; max: number; energy: number }> = [
    { min: BAND_EDGES.sub.min, max: BAND_EDGES.sub.max, energy: unit(bandEnergy.sub) },
    { min: BAND_EDGES.mid.min, max: BAND_EDGES.mid.max, energy: unit(bandEnergy.mid) },
    { min: BAND_EDGES.high.min, max: BAND_EDGES.high.max, energy: unit(bandEnergy.high) },
  ];
  for (const band of bands) {
    const { first, last } = bandBinRange(band.min, band.max, binCount, sampleRate);
    if (last < first) continue;
    const count = last - first + 1;
    // Weight per bin: tilt toward the band's low end when `tiltCenter` is "low".
    const weights = new Array<number>(count);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const octavesFromLow = Math.log2(1 + i);
      const tilt =
        tiltCenter === "low"
          ? Math.pow(10, (-IN_BAND_TILT_DB_PER_OCTAVE * octavesFromLow) / 20)
          : 1;
      weights[i] = tilt;
      sum += tilt;
    }
    const mean = band.energy * BYTE_FULL;
    for (let i = 0; i < count; i++) {
      const value = mean * (weights[i] / sum) * count;
      bins[first + i] = Math.max(0, Math.min(BYTE_FULL, Math.round(value)));
    }
  }
}

/**
 * Deterministic time-domain buffer: a sine at the frequency the measured ZCR
 * implies (`f ≈ zcr · sampleRate / 2`), with two harmonics and the measured
 * envelope as amplitude. See the header: this is an oscilloscope at the right
 * pitch and level, not the track's waveform.
 */
export function synthWaveform(
  analysis: AudioAnalysisData | null,
  tSec: number,
  fftSize: number,
  sampleRate: number,
): Uint8Array {
  const wave = new Uint8Array(fftSize);
  wave.fill(128);
  if (!analysis || !(fftSize > 0)) return wave;

  const duration = analysis.duration_seconds > 0 ? analysis.duration_seconds : 1;
  const progress = Math.min(1, Math.max(0, tSec / duration));
  const zcrCurve = analysis.zero_crossing_rate;
  const zcrIndex = zcrCurve?.length
    ? Math.max(0, Math.min(zcrCurve.length - 1, Math.floor(progress * (zcrCurve.length - 1))))
    : -1;
  const zcr = zcrIndex >= 0 ? (zcrCurve?.[zcrIndex] ?? 0) : 0;
  const envelope = analysis.amplitude_envelope?.length
    ? getEnergyAtTime(analysis.amplitude_envelope, duration, tSec)
    : 0;
  const amplitude = unit(envelope) * 0.9;
  if (amplitude <= 0) return wave;

  const nyquist = Math.max(1, sampleRate / 2);
  const freq = Math.min(nyquist, Math.max(40, (zcr * sampleRate) / 2));
  for (let i = 0; i < fftSize; i++) {
    const theta = 2 * Math.PI * freq * (tSec + i / Math.max(1, sampleRate));
    // Fundamental + second harmonic + a touch of third: enough structure for an
    // oscilloscope without pretending to be the signal.
    const value =
      Math.sin(theta) * amplitude * 0.78 +
      Math.sin(2 * theta) * amplitude * 0.16 +
      Math.sin(3 * theta) * amplitude * 0.06;
    wave[i] = Math.max(0, Math.min(BYTE_FULL, Math.round(128 + value * 127)));
  }
  return wave;
}

/**
 * Build the frame a virtual 2D render should draw at `tSec`.
 *
 * The returned `AudioData` mirrors the live path's semantics field for field
 * (`audioHooks.ts`): bands from the spectrum, energy blended 60% measured-RMS
 * / 40% analyzed curve, `beat` from onsets, `beatPhase` from the analyzed grid,
 * `isDownbeat` from the backend's downbeat times, `analyzedEnergy` interpolated
 * from the energy curve. Live-only fields (`perceptualBands`) are absent: the
 * 2D draw loop does not read them.
 *
 * The spectral timeline is the primary source and `AudioAnalysisData` the
 * enrichment: a frame is built from the timeline alone when there is no
 * analysis (measured bands, RMS, transients as beats) rather than falling back
 * to silence — a timeline-only frame is a real recording of the track's
 * envelope, and a silent one is a black export. `frameReadiness` reports which
 * of the two sources a frame used.
 */
export function deterministicAudioFrame(input: DeterministicFrameInput): DeterministicFrame {
  const { analysis, spectralFrame, tSec, binCount, fftSize, sampleRate } = input;
  const readiness = frameReadiness(input);
  if (readiness.source === "none" || !Number.isFinite(tSec) || tSec < 0 || binCount <= 0) {
    // Silence in the analyser's units: frequency bytes 0, time-domain bytes
    // 128 (its zero-crossing centre), not 0 — a zeroed wave buffer reads as
    // full-scale negative. Callers are expected to have screened this out via
    // `frameReadiness`; reaching it is a bug, not a rendering choice.
    return {
      audio: { ...SILENT },
      freq: new Uint8Array(Math.max(0, binCount)),
      wave: synthWaveform(null, tSec, fftSize, sampleRate),
      measuredBands: false,
      source: "none",
    };
  }

  const measured = measuredBandsFromFrame(spectralFrame);
  const duration = analysis && analysis.duration_seconds > 0 ? analysis.duration_seconds : 1;
  const t = analysis ? Math.min(tSec, duration) : tSec;
  const analyzedEnergy = analysis
    ? getEnergyAtTime(analysis.energy_curve, duration, t)
    : 0;

  const bandEnergy = measured
    ? { sub: measured.sub, mid: measured.mid, high: measured.high }
    : { sub: analyzedEnergy, mid: analyzedEnergy, high: analyzedEnergy };
  const rms = measured ? measured.rms : analyzedEnergy;

  // Same 60/40 blend the live path uses, so an exported frame's intensity
  // matches what the user saw: 60% keeps transients, 40% anchors to structure.
  // Without an energy curve the measured RMS stands alone.
  const energy = analyzedEnergy > 0 ? rms * 0.6 + analyzedEnergy * 0.4 : rms;
  const phase = analysis ? getBeatPhase(analysis.beat_times ?? [], t) : null;
  const envelope = analysis?.amplitude_envelope?.length
    ? getEnergyAtTime(analysis.amplitude_envelope, duration, t)
    : rms;

  // Modelled tier only: the measured timeline's band energies already carry
  // the shape, so a tilt would only distort them. Without one, brightness is
  // the only spectral measurement available — a bright track gets a near-flat
  // spectrum, a dark one leans low, which is where the energy actually is.
  const tiltCenter = measured || !analysis ? "flat" : brightnessAt(analysis, t) > 0.5 ? "flat" : "low";

  const bins = new Uint8Array(binCount);
  fillSpectrumBins(bins, bandEnergy, tiltCenter, binCount, sampleRate);

  const audio: AudioData = {
    bass: unit(bandEnergy.sub),
    mid: unit(bandEnergy.mid),
    treble: unit(bandEnergy.high),
    overall: (unit(bandEnergy.sub) + unit(bandEnergy.mid) + unit(bandEnergy.high)) / 3,
    // Onsets when the analysis has them, otherwise the timeline's own
    // transient channel — the same "only a rise triggers" idea.
    beat: analysis ? onsetAt(analysis.onset_times, t) : (measured?.transient ?? 0) > 0.5,
    peak: unit(envelope),
    energy: unit(energy),
    drumType: analysis ? drumTypeAt(analysis.timing_contract?.beats, t) : null,
    nextBeatIn: phase?.nextBeatIn ?? 0,
    beatPhase: phase?.phase,
    isDownbeat: analysis ? downbeatAt(analysis.downbeat_times, t) : false,
    analyzedEnergy: unit(analyzedEnergy),
  };

  return {
    audio,
    freq: bins,
    wave: synthWaveform(analysis, t, fftSize, sampleRate),
    measuredBands: Boolean(measured),
    source: readiness.source,
  };
}
