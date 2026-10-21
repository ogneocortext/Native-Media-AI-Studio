/**
 * Onboarding state machine — the pure core of the 5-minute path.
 *
 * Pure functions only: no React, no fetch. The component
 * (`OnboardingFlow.tsx`) owns the effects; this module owns the
 * rules, so the rules are unit-testable without a browser.
 *
 * Implements `docs/plans/creative-onboarding-ux-2026-10.md` (O3) against the
 * flow drafted in `docs/ux/5-minute-path.md`.
 *
 * The path is linear — add → analyze → look → watch → render → done — with
 * exactly one branch allowed by the design: failure, and failure always
 * carries its own fix.
 */

/** The six steps of the path, plus the error branch. */
export type OnboardingStep =
  | "add"
  | "analyzing"
  | "look"
  | "watch"
  | "rendering"
  | "done"
  | "error";

/** A 10-second window of the track chosen for the clip. */
export interface ClipWindow {
  start: number;
  end: number;
}

/** The plain-language reason the suggested look was chosen. */
export interface SuggestionReason {
  /** e.g. "High-energy track, 126 BPM" */
  text: string;
  /** The visualization mode that was suggested. */
  visualization: string;
  /** Q4 confidence, 0..1. Kept for the "full studio", not the path. */
  confidence: number;
}

export interface OnboardingState {
  step: OnboardingStep;
  /** Filename of the chosen track (the library key). */
  filename: string | null;
  /** The suggested look, present once analysis has succeeded. */
  suggestion: SuggestionReason | null;
  /** The window that will be clipped, present once analysis has succeeded. */
  clipWindow: ClipWindow | null;
  /** URL of the rendered clip, present on `done`. */
  outputUrl: string | null;
  /** What went wrong, present on `error`. */
  error: string | null;
  /** The fix the user should take, present on `error`. */
  errorFix: string | null;
}

export const INITIAL_STATE: OnboardingState = {
  step: "add",
  filename: null,
  suggestion: null,
  clipWindow: null,
  outputUrl: null,
  error: null,
  errorFix: null,
};

/** The clip length the path renders. Fixed — the user chooses nothing. */
export const CLIP_SECONDS = 10;

/**
 * Pick the highest-energy 10-second window of the track.
 *
 * Uses the analysis energy curve when available (a fine-grained curve finds a
 * better window than section boundaries), and falls back to the section with
 * the highest mean energy. Deterministic: ties resolve to the earliest start.
 *
 * Returns null when the track is shorter than the clip, or when there is no
 * energy information at all.
 */
export function pickHighestEnergyWindow(
  energyCurve: number[] | undefined,
  sections: { start: number; end: number; energy: number }[] | undefined,
  durationSeconds: number,
  clipSeconds: number = CLIP_SECONDS,
): ClipWindow | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  const windowLength = Math.min(clipSeconds, durationSeconds);

  // Preferred path: slide a window over the energy curve.
  if (energyCurve && energyCurve.length > 1) {
    const samplesPerSecond = energyCurve.length / durationSeconds;
    const windowSamples = Math.max(1, Math.round(windowLength * samplesPerSecond));
    if (windowSamples < energyCurve.length) {
      let bestSum = -Infinity;
      let bestStartSample = 0;
      for (let i = 0; i + windowSamples <= energyCurve.length; i += 1) {
        let sum = 0;
        for (let j = i; j < i + windowSamples; j += 1) sum += energyCurve[j];
        if (sum > bestSum) {
          bestSum = sum;
          bestStartSample = i;
        }
      }
      const start = (bestStartSample / samplesPerSecond);
      return {
        start: round2(start),
        end: round2(Math.min(durationSeconds, start + windowLength)),
      };
    }
  }

  // Fallback: the highest-energy section, clipped to the window length.
  if (sections && sections.length > 0) {
    let best = sections[0];
    for (const s of sections) {
      if (s.energy > best.energy) best = s;
    }
    const start = Math.max(0, Math.min(best.start, durationSeconds - windowLength));
    return { start: round2(start), end: round2(start + windowLength) };
  }

  // Last resort: the opening 10 seconds.
  return { start: 0, end: round2(windowLength) };
}

/**
 * Describe the suggested look in plain language.
 *
 * The path never shows a confidence percentage — the reason is the message.
 * Confidence is carried on the result for the full studio, not rendered here.
 */
export function describeSuggestion(input: {
  visualization?: string | null;
  confidence?: number | null;
  tempoBpm?: number | null;
  energy?: number | null;
}): SuggestionReason | null {
  const visualization = input.visualization;
  if (!visualization) return null;
  const confidence = typeof input.confidence === "number" ? input.confidence : 0;

  const reasons: string[] = [];
  if (typeof input.tempoBpm === "number" && input.tempoBpm > 0) {
    reasons.push(`${Math.round(input.tempoBpm)} BPM`);
  }
  if (typeof input.energy === "number") {
    if (input.energy >= 0.66) reasons.unshift("High-energy track");
    else if (input.energy <= 0.33) reasons.unshift("Low-energy track");
    else reasons.unshift("Mid-energy track");
  }
  if (reasons.length === 0) reasons.push("Matched to your track");

  return {
    text: reasons.join(", "),
    visualization,
    confidence,
  };
}

/** The user chose a track. Analysis starts automatically — no button. */
export function trackSelected(
  state: OnboardingState,
  filename: string,
): OnboardingState {
  return {
    ...state,
    step: "analyzing",
    filename,
    suggestion: null,
    clipWindow: null,
    outputUrl: null,
    error: null,
    errorFix: null,
  };
}

/** Analysis succeeded: move to the look, carrying the suggestion. */
export function analysisSucceeded(
  state: OnboardingState,
  suggestion: SuggestionReason | null,
  clipWindow: ClipWindow | null,
): OnboardingState {
  return {
    ...state,
    step: "look",
    suggestion,
    clipWindow,
    error: null,
    errorFix: null,
  };
}

/** Analysis failed: the error branch, with the fix attached. */
export function analysisFailed(
  state: OnboardingState,
  error: string,
  errorFix = "Choose another track",
): OnboardingState {
  return { ...state, step: "error", error, errorFix };
}

/** The user accepted the suggested look. */
export function lookAccepted(state: OnboardingState): OnboardingState {
  if (state.step !== "look") return state;
  return { ...state, step: "watch" };
}

/** The user asked for the clip. */
export function renderStarted(state: OnboardingState): OnboardingState {
  if (state.step !== "watch" && state.step !== "error") return state;
  return { ...state, step: "rendering", error: null, errorFix: null };
}

/** The clip rendered. */
export function renderSucceeded(
  state: OnboardingState,
  outputUrl: string,
): OnboardingState {
  return { ...state, step: "done", outputUrl, error: null, errorFix: null };
}

/** The render failed: the error branch, with the fix attached. */
export function renderFailed(
  state: OnboardingState,
  error: string,
  errorFix = "Try again",
): OnboardingState {
  return { ...state, step: "error", error, errorFix };
}

/** Retry from the error branch: re-analyze the same track. */
export function retry(state: OnboardingState): OnboardingState {
  if (state.step !== "error") return state;
  if (!state.filename) {
    return { ...INITIAL_STATE };
  }
  return {
    ...state,
    step: "analyzing",
    error: null,
    errorFix: null,
  };
}

/** Start over with a different track. */
export function startOver(_state: OnboardingState): OnboardingState {
  return { ...INITIAL_STATE };
}

/** True when the path is finished (successfully or not). */
export function isComplete(state: OnboardingState): boolean {
  return state.step === "done";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
