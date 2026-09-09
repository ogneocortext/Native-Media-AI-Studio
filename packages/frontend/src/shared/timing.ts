/**
 * Shared timing utilities for HyperFrames and the visualizer.
 *
 * Provides binary-search beat lookup and next-beat countdown over a
 * `beat_times[]` array produced by audio analysis.
 */

export interface TimingHint {
  /** Time in seconds when this hint should trigger. */
  at: number;
  /** What kind of event this is. */
  kind: "beat" | "drop" | "break" | "transition";
  /** Optional section name this hint belongs to. */
  section?: string;
  /** Optional intensity multiplier for reactive animations. */
  intensity?: number;
}

/**
 * Binary search for the nearest beat at or before `elapsedSec`.
 *
 * Returns the beat entry when `elapsedSec` falls within `windowSec` of
 * a stored beat time; otherwise `null`.
 */
export function getBeatNearTimeFromArray(
  beats: number[],
  elapsedSec: number,
  windowSec: number,
): { index: number; time: number } | null {
  if (!beats.length || elapsedSec < 0) return null;

  let lo = 0;
  let hi = beats.length - 1;
  let mid = 0;

  while (lo <= hi) {
    mid = lo + ((hi - lo) >> 1);
    const t = beats[mid];
    if (t < elapsedSec) {
      lo = mid + 1;
    } else if (t > elapsedSec) {
      hi = mid - 1;
    } else {
      break;
    }
  }

  const candidate = beats[mid];
  if (candidate !== undefined && Math.abs(candidate - elapsedSec) <= windowSec) {
    return { index: mid, time: candidate };
  }

  // Check the beat just before elapsedSec if any
  const prev = mid > 0 ? beats[mid - 1] : undefined;
  if (prev !== undefined && Math.abs(prev - elapsedSec) <= windowSec) {
    return { index: mid - 1, time: prev };
  }

  return null;
}

/**
 * Seconds until the next beat onset after `elapsedSec`.
 *
 * Returns `0` when currently inside a beat window, or when no future beat
 * exists.
 */
export function getNextBeatInFromArray(beats: number[], elapsedSec: number): number {
  if (!beats.length || elapsedSec < 0) return 0;

  for (let i = 0; i < beats.length; i++) {
    const t = beats[i];
    if (t > elapsedSec) {
      return t - elapsedSec;
    }
  }

  return 0;
}
