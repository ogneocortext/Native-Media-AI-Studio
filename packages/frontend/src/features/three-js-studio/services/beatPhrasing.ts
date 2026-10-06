/**
 * Beat-phrased animation (three-js-studio plan F4).
 *
 * The old beat response was a decaying spike:
 * `beatPunchAmp * (1 - timeSinceLastBeat / beatWindowSec)` —
 * a punch that only existed *after* the beat and drifted
 * back to zero. Music performance is the opposite shape:
 * anticipation → action → settle. This module turns the
 * beat grid into that spine:
 *
 *   hold ──anticipation──> pullback ──beat──> pop ──> hold
 *   (1 + A)   travel-cut     (1 − D)  expressive-pop  (1 + A)
 *
 * - **Anticipation** — the last ~120 ms before the beat, the
 *   scale pulls back from the held value to a low value on the
 *   `travel-cut` anchor (fast-slow-fast, the research doc's
 *   interrupted-move curve: the wind-up never settles).
 * - **Landing** — the first ~250 ms after the beat, the scale
 *   pops from the low value back to the held value on the
 *   `expressive-pop` anchor (fast out, soft settle).
 * - **Hold** — the landed value persists with **no drift**
 *   until the next anticipation window. This is the "hold,
 *   no post-beat wobble" the plan's acceptance asks for.
 *
 * The cycle is continuous at every seam: anticipation starts
 * at the held value (travel-cut(0) = 0), ends at the low value
 * (travel-cut(1) = 1), and the landing starts at that same low
 * value (expressive-pop(0) = 0) and ends at the held value
 * (expressive-pop(1) = 1).
 *
 * Both phase windows adapt to the tempo: on fast tempos (beat
 * window under ~0.35 s) they shrink proportionally so the three
 * phases always tile the beat window exactly and never overlap.
 *
 * Pure and allocation-light: one result object per call, no
 * heap churn in the easing path itself.
 */

import { ease } from "./easing";

/** Anticipation window before a beat (sec) at moderate tempos. */
export const ANTICIPATION_SEC = 0.12;

/** Landing window after a beat (sec) at moderate tempos — the
 *  expressive-pop duration. */
export const LANDING_SEC = 0.25;

/** Anticipation depth as a fraction of the punch amplitude: the
 *  pullback dips to `1 − amplitude * DEPTH_RATIO`. */
const ANTICIPATION_DEPTH_RATIO = 0.5;

/** Largest share of a beat window the anticipation may occupy
 *  (keeps the phases tiled on fast tempos). */
const MAX_ANTICIPATION_SHARE = 0.35;

export interface BeatPhraseInput {
  /** Seconds since the last beat (from the beat timeline). */
  timeSinceLastBeat: number;
  /** Seconds per beat (60 / bpm). */
  beatWindowSec: number;
  /** Template's beatPunch amplitude (0..0.5). */
  amplitude: number;
}

export interface BeatPhraseResult {
  /** Scale multiplier for the beat cycle. */
  scale: number;
  /** True while the anticipation pullback is in flight. */
  anticipating: boolean;
  /** True while the post-beat pop is landing. */
  landing: boolean;
}

/**
 * The beat-cycle scale multiplier. Returns a neutral `1` when
 * there is no amplitude or no beat window (the caller's
 * non-phrased paths then apply unchanged).
 */
export function beatPhraseScale(input: BeatPhraseInput): BeatPhraseResult {
  const { timeSinceLastBeat, beatWindowSec, amplitude } = input;
  if (!(beatWindowSec > 0) || !(amplitude > 0)) {
    return { scale: 1, anticipating: false, landing: false };
  }
  // Adaptive phase windows: the anticipation never takes more
  // than MAX_ANTICIPATION_SHARE of the window, and the landing
  // never spills into it — the three phases tile the beat
  // window exactly at any tempo.
  const anticipationSec = Math.min(
    ANTICIPATION_SEC,
    beatWindowSec * MAX_ANTICIPATION_SHARE,
  );
  const landingSec = Math.min(
    LANDING_SEC,
    beatWindowSec - anticipationSec,
  );
  const holdValue = 1 + amplitude;
  const lowValue = 1 - amplitude * ANTICIPATION_DEPTH_RATIO;
  const timeToNextBeat = beatWindowSec - timeSinceLastBeat;
  // Anticipation: the final `anticipationSec` before the beat.
  if (timeToNextBeat > 0 && timeToNextBeat <= anticipationSec) {
    const p = 1 - timeToNextBeat / anticipationSec;
    const k = ease("travel-cut", p);
    return {
      scale: holdValue - (holdValue - lowValue) * k,
      anticipating: true,
      landing: false,
    };
  }
  // Landing: the first `landingSec` after the beat.
  if (timeSinceLastBeat <= landingSec) {
    const q = timeSinceLastBeat / landingSec;
    const k = ease("expressive-pop", q);
    return {
      scale: lowValue + (holdValue - lowValue) * k,
      anticipating: false,
      landing: true,
    };
  }
  // Hold: the landed value, no drift.
  return { scale: holdValue, anticipating: false, landing: false };
}
