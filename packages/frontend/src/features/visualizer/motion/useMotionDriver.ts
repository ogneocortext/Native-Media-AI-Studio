/**
 * Per-frame motion driver for the visualizer's motion vocabulary.
 *
 * Wraps the stateless moves in `motionMoves.ts` plus the stateful
 * `ImpulseTrigger`, and resolves one frame's channel values for a viz style.
 *
 * Why this lives outside `Visualizer.tsx`: D14 makes that component the
 * coordinator only. Keeping the motion resolution here means the whole
 * vocabulary stays testable without a browser (`motionMoves.test.ts` runs 129
 * assertions, no renderer, no Playwright).
 *
 * Note on the spec caveat: `docs/knowledge/gemini-motion-design-2026-10-02/`
 * was written without access to this repo, so its parameter names are proposals
 * rather than matches for any existing field. The mapping from this repo's
 * audio onto `MotionInput` is therefore *our* choice and is the thing to
 * re-tune per viz style, not the moves themselves.
 */

import {
  anticipationContract,
  assignStaging,
  DEFAULT_ANTICIPATION,
  DEFAULT_FOCAL_BREATHING,
  DEFAULT_PRE_DROP_FREEZE,
  DEFAULT_SNARE_BACKPEDAL,
  DEFAULT_SUB_BASS_SWELL,
  DEFAULT_WHIP,
  focalBreathing,
  frequencyDispersionWhip,
  ImpulseTrigger,
  orbitalRatchet,
  phaseLagElement,
  preDropFreeze,
  sectionMotionProfile,
  snareBackpedal,
  squashFromImpulse,
  subBassSwell,
  type LookaheadEvent,
  type StagingChannel,
  type Vec3,
} from "./motionMoves";
import type { SectionMotionProfile } from "./motionMoves";

export interface MotionInput {
  /** Heard audio position in seconds (latency-compensated — see audioTiming.ts). */
  nowSec: number;
  /** Frame delta in seconds. */
  dtSec: number;
  bpm: number;
  /** Raw band energies, 0..1, pre-smoothing. */
  bass: number;
  mid: number;
  high: number;
  /** Section label as emitted by the analyzer, e.g. "PRE-CHORUS". */
  section?: string | null;
  /** Next downbeat, if the timeline has one. Enables anticipation. */
  nextBeat?: LookaheadEvent;
  /** Next drop, if known. Enables the pre-drop vacuum. */
  nextDrop?: LookaheadEvent;
  /** Cumulative hi-hat count, for the orbital ratchet. */
  hatCount?: number;
  /** Phrase progress 0..1 over 8-16 bars, for focal breathing. */
  phraseProgress?: number;
}

export interface MotionState {
  /** Volume-preserving squash/stretch — apply to a mesh's scale. */
  scale: Vec3;
  /** Additive camera offset. Apply to a child offset node, never to the rig. */
  cameraOffset: Vec3;
  fov: number;
  /** 0 = dead stop (pre-drop vacuum), 1 = full motion. */
  motionMultiplier: number;
  exposureEV: number;
  /** Impulse amplitude for transient-driven channels, 0..1. */
  impulse: number;
  /** Anticipation wind-up scale, 1 at rest. */
  anticipation: number;
  /** Sub-bass breathing amount, 0..1. */
  swell: number;
  /** Quantised orbit angle in radians. */
  orbitAngle: number;
  /** Which onset owns which channel this frame (driver dominance). */
  staging: StagingChannel[];
  /** The section easing profile in force. */
  profile: SectionMotionProfile;
}

/** Neutral pose. Every channel is a real value, never undefined. */
export const REST_MOTION: MotionState = {
  scale: [1, 1, 1],
  cameraOffset: [0, 0, 0],
  fov: 50,
  motionMultiplier: 1,
  exposureEV: 0,
  impulse: 0,
  anticipation: 1,
  swell: 0,
  orbitAngle: 0,
  staging: [],
  profile: sectionMotionProfile(null),
};

/** Frame-to-frame history the stateless moves cannot derive on their own. */
export interface MotionHistory {
  bassTrigger: ImpulseTrigger;
  midTrigger: ImpulseTrigger;
  highTrigger: ImpulseTrigger;
  /** Recent impulse values, newest first — backs `phase-lag-pendulum`. */
  phaseLag: number[];
  lastNowSec: number;
}

export function createMotionHistory(): MotionHistory {
  return {
    bassTrigger: new ImpulseTrigger(),
    midTrigger: new ImpulseTrigger(),
    highTrigger: new ImpulseTrigger(),
    phaseLag: [],
    lastNowSec: -1,
  };
}

export function resetMotionHistory(history: MotionHistory): void {
  history.bassTrigger.reset();
  history.midTrigger.reset();
  history.highTrigger.reset();
  history.phaseLag.length = 0;
  history.lastNowSec = -1;
}

export interface ResolveMotionOptions {
  /** Damp transients for `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /** Base FOV used as the centre of the focal-breathing range. */
  baseFov?: number;
}

/**
 * Resolve one frame of motion.
 *
 * Pure with respect to `input`; the only mutable state is `history`, which the
 * caller owns. A backwards clock resets that history, so a seek cannot leave a
 * stale envelope latched at full amplitude.
 */
export function resolveMotion(
  input: MotionInput,
  history: MotionHistory = createMotionHistory(),
  options: ResolveMotionOptions = {},
): MotionState {
  const { nowSec, dtSec, bpm } = input;
  const baseFov = options.baseFov ?? DEFAULT_FOCAL_BREATHING.minFOV;

  // A seek (nowSec jumping backwards) invalidates every envelope: without this
  // the scene resumes with a transient stuck at full amplitude until it decays.
  if (history.lastNowSec >= 0 && nowSec < history.lastNowSec - 0.001) {
    resetMotionHistory(history);
  }
  history.lastNowSec = nowSec;

  const profile = sectionMotionProfile(input.section);
  // Transient amplitude, budgeted by section: a verse must not be able to reach
  // a drop's intensity. This is the "one kinetic thought at a time" control.
  const gain = options.reducedMotion ? 0.25 : 1;
  const impulse =
    Math.max(
      history.bassTrigger.update(input.bass, dtSec, nowSec),
      history.midTrigger.update(input.mid, dtSec, nowSec),
      history.highTrigger.update(input.high, dtSec, nowSec),
    ) * profile.transientGain * gain;

  // Driver dominance: the loudest onset owns global motion, so two stems can
  // never drive the same spatial vector at once.
  const staging = assignStaging([
    { energy: input.bass },
    { energy: input.mid },
    { energy: input.high },
  ]);

  const anticipation = anticipationContract(
    nowSec,
    input.nextBeat ?? null,
    DEFAULT_ANTICIPATION,
    bpm,
  );
  const freeze = preDropFreeze(nowSec, input.nextDrop ?? null, DEFAULT_PRE_DROP_FREEZE, bpm);
  // `Infinity` = "no gate": `subBassSwell` expects time *since the swell began*,
  // which is not a quantity the driver has. Passing the absolute audio clock
  // would fade the swell in from zero at the start of every track and then hold
  // it fully open forever after ~0.3 s.
  const swell = subBassSwell(Number.POSITIVE_INFINITY, input.bass, DEFAULT_SUB_BASS_SWELL);
  const breathing = focalBreathing(input.phraseProgress ?? 0, DEFAULT_FOCAL_BREATHING);
  const orbitAngle = orbitalRatchet(nowSec, input.hatCount ?? 0);

  // Camera moves read time-since-impact from the impulse envelope rather than
  // tracking their own timers, which keeps them phase-locked to the same attack
  // as the mesh instead of drifting a few frames behind it.
  const backpedal = snareBackpedal(impulse * 0.05, DEFAULT_SNARE_BACKPEDAL);
  const whip = frequencyDispersionWhip(impulse * 0.1, DEFAULT_WHIP, 0.2, bpm);

  // phase-lag-pendulum history, newest first. Bounded so a long session cannot
  // grow this array without limit.
  history.phaseLag.unshift(impulse);
  if (history.phaseLag.length > 64) history.phaseLag.pop();

  const motionMultiplier = freeze.motionMultiplier;
  // The pre-drop vacuum scales *every* kinematic channel toward rest at once.
  const scale = squashFromImpulse(impulse).map(
    (v) => 1 + (v - 1) * motionMultiplier,
  ) as Vec3;
  // ...including the camera. A frozen scene that keeps drifting is the
  // "unanchored drunk camera" tell the rig split exists to prevent, and a
  // freeze that only touched the mesh would read as a bug, not as intent.
  // `+ 0` normalises -0 so a still camera is exactly the neutral pose.
  const cameraOffset: Vec3 = [
    (whip.yaw * 0.001 + backpedal * 0.01) * motionMultiplier + 0,
    0,
    -backpedal * motionMultiplier + 0,
  ];

  return {
    scale,
    cameraOffset,
    fov:
      (baseFov + breathing.fov - DEFAULT_FOCAL_BREATHING.minFOV + swell.fovDelta) *
      (1 - motionMultiplier * 0.1),
    motionMultiplier,
    exposureEV: freeze.exposureEV,
    impulse,
    anticipation: anticipation.scale,
    swell: swell.displacement,
    orbitAngle,
    staging,
    profile,
  };
}

/** The phase-lag chain's element values for the current frame. */
export function phaseLagChain(history: MotionHistory, chainLength = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < chainLength; i++) {
    out.push(phaseLagElement(history.phaseLag, i));
  }
  return out;
}

/**
 * Build the `MotionInput` for the shader visualizer's frame
 * loop (plan 2.7's mapping, see `motion/README.md`).
 *
 * Extracted as a pure function so the wiring — *which* repo
 * audio feeds *which* channel — is pinned by a unit test
 * rather than only existing inside the rAF closure. The
 * loop calls this, then hands the result to `resolveMotion`.
 *
 * `beatTimes` is the backend's analyzed grid (plan 2.10);
 * the next beat after `nowSec` becomes the lookahead event
 * the anticipation-contract and pre-drop-freeze moves read.
 * An empty grid (unanalyzed track) yields `nextBeat: null`,
 * which those moves treat as "no anticipation" rather than
 * guessing.
 */
export function buildShaderMotionInput(args: {
  nowSec: number;
  dtSec: number;
  bpm: number;
  spectral: { sub: number; mid: number; high: number } | null;
  section: string | null | undefined;
  beatTimes: number[];
}): MotionInput {
  const { nowSec, dtSec, bpm, spectral, section, beatTimes } = args;
  let nextBeat: { timeSec: number } | null = null;
  if (beatTimes.length > 0) {
    for (let i = 0; i < beatTimes.length; i++) {
      if (beatTimes[i] > nowSec) {
        nextBeat = { timeSec: beatTimes[i] };
        break;
      }
    }
  }
  return {
    nowSec,
    dtSec,
    bpm,
    bass: spectral?.sub ?? 0,
    mid: spectral?.mid ?? 0,
    high: spectral?.high ?? 0,
    section: section ?? null,
    nextBeat,
  };
}