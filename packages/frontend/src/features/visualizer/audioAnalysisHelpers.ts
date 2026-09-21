/**
 * Shared audio-analysis helpers for the visualizer.
 *
 * Both the worker thread (`audioAnalysis.worker.ts`) and the main-thread
 * fallback hook (`audioHooks.ts`) use identical frequency-band mapping and
 * peak-hold logic. Centralising them here prevents drift.
 */

/** Hz boundaries for the three analysis bands. */
export const BASS_MAX_HZ = 250;
export const MID_MAX_HZ = 4000;

export interface FrequencyBands {
  bass: number;
  mid: number;
  treble: number;
  overall: number;
}

/**
 * Map a raw FFT magnitude array to normalized bass/mid/treble/overall bands.
 *
 * @param freq - Raw FFT bins (Uint8Array from AnalyserNode.getByteFrequencyData)
 * @param sampleRate - Audio sample rate in Hz
 * @returns Normalized band energies in [0, 1]
 */
export function extractFrequencyBands(freq: Uint8Array, sampleRate: number): FrequencyBands {
  const binSize = sampleRate / (freq.length * 2);
  const bassBins = Math.max(1, Math.floor(BASS_MAX_HZ / binSize));
  const midBins = Math.max(bassBins + 1, Math.floor(MID_MAX_HZ / binSize));

  const rawBass = freq.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
  const rawMid =
    freq.slice(bassBins, midBins).reduce((a, b) => a + b, 0) /
    ((midBins - bassBins) * 255 || 1);
  const rawTreble =
    freq.slice(midBins).reduce((a, b) => a + b, 0) /
    ((freq.length - midBins) * 255 || 1);

  const bass = rawBass;
  const mid = rawMid;
  const treble = rawTreble;
  const overall = bass * 0.4 + mid * 0.35 + treble * 0.25;

  return { bass, mid, treble, overall };
}

/**
 * Peak-hold state container — one instance per analysis pipeline.
 */
export interface PeakHoldState {
  peak: number;
  decayFrames: number;
}

/** Frames the signal must stay below the held peak before decay starts. */
export const PEAK_DECAY_FRAMES = 30;
/** Decay multiplier per frame once the window expires. */
export const PEAK_DECAY_FACTOR = 0.95;

/**
 * Update a peak-hold state with a new energy reading.
 *
 * @param state - Mutable peak-hold state
 * @param currentPeak - Current frame's peak energy (max of bass/mid/treble)
 */
export function updatePeakHold(state: PeakHoldState, currentPeak: number): void {
  if (currentPeak > state.peak) {
    state.peak = currentPeak;
    state.decayFrames = 0;
  } else {
    state.decayFrames++;
    if (state.decayFrames > PEAK_DECAY_FRAMES) {
      state.peak *= PEAK_DECAY_FACTOR;
    }
  }
}

/**
 * Update a pair of separate peak-hold refs (legacy pattern used in audioHooks.ts).
 */
export function updatePeakHoldRefs(
  peakRef: { current: number },
  decayRef: { current: number },
  currentPeak: number,
): void {
  if (currentPeak > peakRef.current) {
    peakRef.current = currentPeak;
    decayRef.current = 0;
  } else {
    decayRef.current++;
    if (decayRef.current > PEAK_DECAY_FRAMES) {
      peakRef.current *= PEAK_DECAY_FACTOR;
    }
  }
}
