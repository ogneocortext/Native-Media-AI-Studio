/**
 * Spectral-flux onset detector (T-VIZ-16).
 *
 * Runs on the *unsmoothed* analyser path (`useAudioGraph().transientRef`,
 * `smoothingTimeConstant = 0`): positive-only spectral flux — the sum of
 * per-bin magnitude increases between consecutive frames — with an adaptive
 * threshold (rolling mean + 1.5σ over ~1 s of flux history) so quiet
 * passages don't false-trigger and loud masters don't desensitize it.
 *
 * Output is a decaying envelope, not a boolean: consumers get `envelope`
 * in [0, 1] — 1 on a fresh hit, decaying with ~0.5 s release — plus the
 * raw `flux`/`threshold` for diagnostics and per-band derivatives later.
 *
 * Input domain is normalized magnitude [0, 1] per bin (the caller maps
 * analyser dB floats through min/maxDecibels, or bytes through /255), so
 * the detector is renderer-agnostic and deterministic under virtual frames.
 */

export interface SpectralFluxOnset {
  /** Advance with this frame's normalized magnitude spectrum. */
  step(spectrum: ArrayLike<number>, dt: number): void;
  /** Decaying onset strength, 0..1. Attack is immediate, release ~0.5 s. */
  readonly envelope: number;
  /** Last frame's spectral flux (sum of positive per-bin deltas). */
  readonly flux: number;
  /** Last frame's adaptive threshold the flux was compared against. */
  readonly threshold: number;
  /** Clear all state — call on track switch / silence. */
  reset(): void;
}

/** Flux history window: ~1 s at 60 fps. */
const FLUX_WINDOW = 60;
/** Threshold = rolling mean + this many standard deviations. */
const THRESHOLD_SIGMA = 1.5;
/** Absolute floor so digital silence / dither can't self-trigger. */
const FLUX_FLOOR = 0.02;
/** Envelope release time constant (s) — ~0.5 s audible tail. */
const RELEASE_TAU = 0.15;
/** Cap on a single frame's envelope contribution. */
const ENVELOPE_SATURATION = 0.6;

export function createSpectralFluxOnset(binCount = 1024): SpectralFluxOnset {
  const n = Math.max(1, binCount);
  const prev = new Float64Array(n);
  let havePrev = false;
  const fluxHist = new Float64Array(FLUX_WINDOW);
  let histLen = 0;
  let histIdx = 0;
  let env = 0;
  let lastFlux = 0;
  let lastThreshold = FLUX_FLOOR;

  const detector: SpectralFluxOnset = {
    get envelope() {
      return env;
    },
    get flux() {
      return lastFlux;
    },
    get threshold() {
      return lastThreshold;
    },
    step(spectrum: ArrayLike<number>, dt: number) {
      const len = Math.min(n, spectrum.length);
      if (len === 0) return; // empty frame: keep prev/havePrev untouched
      let flux = 0;
      for (let i = 0; i < len; i++) {
        const v = spectrum[i];
        if (!Number.isFinite(v)) continue;
        if (havePrev) {
          const delta = v - prev[i];
          if (delta > 0) flux += delta;
        }
        prev[i] = v;
      }
      havePrev = true;
      // Normalize by bin count so the threshold is frame-rate and
      // fft-size independent (mean positive rise per bin).
      flux /= len;
      lastFlux = flux;

      // Adaptive threshold over the flux history window.
      let threshold = FLUX_FLOOR;
      if (histLen > 8) {
        let sum = 0;
        for (let i = 0; i < histLen; i++) sum += fluxHist[i];
        const mean = sum / histLen;
        let sq = 0;
        for (let i = 0; i < histLen; i++) {
          const d = fluxHist[i] - mean;
          sq += d * d;
        }
        const std = Math.sqrt(sq / histLen);
        threshold = Math.max(FLUX_FLOOR, mean + THRESHOLD_SIGMA * std);
      }
      lastThreshold = threshold;

      // Push this frame's flux into the rolling window.
      fluxHist[histIdx] = flux;
      histIdx = (histIdx + 1) % FLUX_WINDOW;
      if (histLen < FLUX_WINDOW) histLen++;

      // Onset: flux clears the adaptive threshold. Envelope strength is
      // proportional to how far past threshold the flux went, capped.
      if (flux > threshold) {
        const strength = Math.min(1, (flux - threshold) / ENVELOPE_SATURATION + 0.35);
        if (strength > env) env = strength;
      }

      // Frame-rate-independent release (~0.5 s tail).
      if (dt > 0) env *= Math.exp(-dt / RELEASE_TAU);
      if (env < 0.0005) env = 0;
    },
    reset() {
      prev.fill(0);
      havePrev = false;
      fluxHist.fill(0);
      histLen = 0;
      histIdx = 0;
      env = 0;
      lastFlux = 0;
      lastThreshold = FLUX_FLOOR;
    },
  };
  return detector;
}
