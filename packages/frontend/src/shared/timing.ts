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
 *
 * After the search loop, `lo` is the insertion point (first beat > elapsedSec)
 * and `hi` is `lo - 1` (last beat <= elapsedSec). The nearest beat is always
 * one of those two adjacent entries — never `beats[mid]` alone, because `mid`
 * at loop exit can land on either side and the other adjacent entry would be
 * missed (e.g. beats=[1,4,5], elapsed=3 lands mid==hi==0 and misses beats[1]=4).
 */
export function getBeatNearTimeFromArray(
  beats: number[],
  elapsedSec: number,
  windowSec: number,
): { index: number; time: number } | null {
  if (!beats.length || elapsedSec < 0) return null;

  let lo = 0;
  let hi = beats.length - 1;

  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    const t = beats[mid];
    if (t < elapsedSec) {
      lo = mid + 1;
    } else if (t > elapsedSec) {
      hi = mid - 1;
    } else {
      return { index: mid, time: t };
    }
  }

  // lo is the first beat > elapsedSec, hi is the last beat <= elapsedSec.
  // Check both adjacent entries; pick the closer one within the window.
  let best: { index: number; time: number } | null = null;
  if (hi >= 0 && Math.abs(beats[hi] - elapsedSec) <= windowSec) {
    best = { index: hi, time: beats[hi] };
  }
  if (lo < beats.length && Math.abs(beats[lo] - elapsedSec) <= windowSec) {
    const closer =
      best === null || Math.abs(beats[lo] - elapsedSec) < Math.abs(best.time - elapsedSec)
        ? { index: lo, time: beats[lo] }
        : best;
    best = closer;
  }
  return best;
}

/**
 * Continuous beat phase in [0, 1) for `elapsedSec`: 0 = exactly on the previous
 * beat, approaching 1 as the next beat nears. Derived from analyzed beat_times
 * via binary search (same O(log n) strategy as the beat lookups above).
 *
 * Why phase, not a boolean: motion research (beat-tracking literature models a
 * beat as tempo + phase trajectories; motion practice drives curves from beat
 * markers, not on/off flashes) shows continuous phase produces fluid,
 * anticipatory movement, while boolean onsets can only snap. A 16 ms `beat:
 * true` frame is also invisible to throttled UI consumers. Returns null when
 * no grid exists (caller should fall back to its own onset pulse).
 */
export function getBeatPhase(
  beats: number[],
  elapsedSec: number,
): { phase: number; nextBeatIn: number } | null {
  if (!beats.length || elapsedSec < 0) return null;

  let lo = 0;
  let hi = beats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= elapsedSec) lo = mid + 1;
    else hi = mid - 1;
  }
  const next = beats[lo];
  const prev = lo > 0 ? beats[lo - 1] : undefined;
  const nextBeatIn = next !== undefined ? Math.max(0, next - elapsedSec) : 0;
  if (prev === undefined || next === undefined) {
    return { phase: next === undefined ? 1 : 0, nextBeatIn };
  }
  const span = Math.max(1e-3, next - prev);
  return {
    phase: Math.min(1, Math.max(0, (elapsedSec - prev) / span)),
    nextBeatIn,
  };
}
/**
 * Seconds until the next beat onset after `elapsedSec`.
 *
 * Returns `0` when currently inside a beat window, or when no future beat
 * exists.
 */
export function getNextBeatInFromArray(beats: number[], elapsedSec: number): number {
  if (!beats.length || elapsedSec < 0) return 0;

  let lo = 0;
  let hi = beats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= elapsedSec) lo = mid + 1;
    else hi = mid - 1;
  }
  const next = beats[lo];
  return next !== undefined ? Math.max(0, next - elapsedSec) : 0;
}

/**
 * Linearly interpolate a value from an evenly-spaced curve at `elapsedSec`.
 *
 * Used to map the backend's `energy_curve` (60–100 points over track duration)
 * to per-frame intensity for visualization.
 */
export function getEnergyAtTime(
  energyCurve: number[],
  durationSec: number,
  elapsedSec: number,
): number {
  if (!energyCurve.length || durationSec <= 0 || elapsedSec < 0) return 0;

  const idx = (elapsedSec / durationSec) * (energyCurve.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.min(energyCurve.length - 1, Math.ceil(idx));

  if (lower === upper) return energyCurve[lower] ?? 0;

  const frac = idx - lower;
  const a = energyCurve[lower] ?? 0;
  const b = energyCurve[upper] ?? 0;
  return a + (b - a) * frac;
}
