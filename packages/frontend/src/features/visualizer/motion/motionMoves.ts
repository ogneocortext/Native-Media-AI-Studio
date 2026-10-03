/**
 * The motion vocabulary from
 * docs/knowledge/gemini-motion-design-2026-10-02/README.md §5.
 *
 * Ten named, parameterised moves that a frame loop can evaluate deterministically.
 * Every function here is **pure** — it takes the audio state and returns channel
 * values, holding no frame state of its own — because the visualizer's timeline
 * is precomputed and a re-render must reproduce the same frame exactly.
 *
 * State that genuinely needs to persist between frames lives in the classes at
 * the bottom (`ImpulseTrigger`, `PhaseLagChain`) or is passed in explicitly.
 *
 * Spec caveat carried over verbatim: the handoff was written without access to
 * this repo, so the *parameter names* are proposals rather than matches for any
 * existing field. They are self-consistent here and unit-tested, but a caller
 * must still map its own audio data onto them.
 */

import {
  clamp01,
  dampedHarmonic,
  easeInCubic,
  easeInOutSine,
  easeOutExpo,
  easeOutQuad,
  lerp,
  SECTION_EASING,
  getSectionEasing,
  type MotionSection,
} from "./motionEasing";

/** A three-component scale/offset channel triple (X, Y, Z). */
export type Vec3 = [number, number, number];

/** Seconds in one beat at a given tempo. Guards a zero/negative BPM, which
 *  produces Infinity here and then NaN everywhere downstream. */
export function secondsPerBeat(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0.5; // 120 BPM fallback
  return 60 / bpm;
}

/**
 * How far ahead of `now` a lookahead move may look, in beats.
 *
 * The spec leans on zero-latency lookahead ("free, use it everywhere") because
 * the timeline is precomputed. That is true here for the *spectral* timeline
 * (`/api/audio/spectral-timeline`), but the frontend cannot assume a future
 * section boundary or drop marker is present, so every lookahead move degrades
 * to "no anticipation" rather than guessing. Pass `null` when unknown.
 */
export type LookaheadEvent = { timeSec: number } | null;

// ---------------------------------------------------------------------------
// Staging / driver dominance (spec §1)
// ---------------------------------------------------------------------------

export type StagingChannel = "global" | "local" | "shader" | "none";

/**
 * Assign each simultaneous onset a *channel*, so two stems never drive the same
 * global spatial vector at once. This is the "one kinetic thought at a time"
 * rule, and it is the difference between choreography and two things pulsing
 * on the same beat.
 *
 * Ranked by the caller's band energies (loudest first). The strongest onset owns
 * `global`; the next gets `local`, then `shader`. Two onsets with no measurable
 * energy get `none` rather than being promoted on array order.
 */
export function assignStaging(onsets: Array<{ energy: number }>): StagingChannel[] {
  const order = onsets
    .map((o, i) => ({ i, energy: Number.isFinite(o.energy) ? o.energy : 0 }))
    .sort((a, b) => b.energy - a.energy);
  const channels: StagingChannel[] = onsets.map(() => "none");
  const ladder: StagingChannel[] = ["global", "local", "shader"];
  let assigned = 0;
  for (const { i, energy } of order) {
    // A third simultaneous onset already sits at the bottom of the ladder;
    // anything beyond that has no channel and must not drive global motion.
    if (assigned >= ladder.length) break;
    if (energy <= 0) continue;
    channels[i] = ladder[assigned];
    assigned++;
  }
  return channels;
}

// ---------------------------------------------------------------------------
// 1. anticipation-contract
// ---------------------------------------------------------------------------

export interface AnticipationParams {
  durationBeats: number;
  minScale: number;
  orbitDampenFactor: number;
  snapOutDurationMs: number;
}

export const DEFAULT_ANTICIPATION: AnticipationParams = {
  durationBeats: 2.0,
  minScale: 0.85,
  orbitDampenFactor: 0.2,
  snapOutDurationMs: 60,
};

export interface AnticipationResult {
  /** Scale multiplier, 1 at rest, down to `minScale` at the wind-up bottom. */
  scale: number;
  /** Multiplier applied to the orbit speed — the scene decelerates as it winds up. */
  orbitSpeed: number;
  /** True while the snap-out is in progress, so callers can do a 1-frame release. */
  snapped: boolean;
}

/**
 * Move 1 — anticipation-contract.
 *
 * Sucks geometry inward and decelerates the scene 2 beats before a downbeat,
 * then snaps out on the beat. Needs a real lookahead event (the next downbeat);
 * with none, it is a no-op returning rest pose.
 *
 * `snapOutDurationMs` after the event, the scale is released with easeOutExpo.
 */
export function anticipationContract(
  nowSec: number,
  nextBeat: LookaheadEvent,
  params: AnticipationParams = DEFAULT_ANTICIPATION,
  bpm = 120,
): AnticipationResult {
  const rest: AnticipationResult = {
    scale: 1,
    orbitSpeed: 1,
    snapped: false,
  };
  if (!nextBeat) return rest;

  const lead = secondsPerBeat(bpm) * params.durationBeats;
  const toBeat = nextBeat.timeSec - nowSec;
  const releaseSec = Math.max(0, params.snapOutDurationMs / 1000);

  // The release window sits *after* the beat, so it has to be checked before
  // the "is the beat still ahead" test — otherwise `nextBeat.timeSec > nowSec`
  // rejects every post-beat frame and the snap-out becomes unreachable code.
  if (toBeat <= 0) {
    // Both operands must be in the SAME unit. `releaseSec` is seconds and
    // `toBeat` is seconds, so compare seconds to seconds — an earlier version
    // multiplied the elapsed gap by 1000 here and then compared it against
    // `releaseSec`, which made the whole 60 ms release window unreachable
    // after the first millisecond.
    const elapsedSec = -toBeat;
    if (elapsedSec >= releaseSec) return rest;
    const t = clamp01(elapsedSec / Math.max(1e-6, releaseSec));
    return {
      scale: lerp(params.minScale, 1, easeOutExpo(t)),
      orbitSpeed: lerp(params.orbitDampenFactor, 1, easeOutExpo(t)),
      snapped: t < 1,
    };
  }

  // Beyond the lead window the scene is at rest.
  if (toBeat > lead) return rest;

  // Wind-up: easeInCubic to the minimum as the beat approaches, so the motion
  // is nearly still early and accelerates into the low point.
  const t = clamp01(1 - toBeat / lead);
  const eased = easeInCubic(t);
  return {
    scale: lerp(1, params.minScale, eased),
    orbitSpeed: lerp(1, params.orbitDampenFactor, eased),
    snapped: false,
  };
}
// ---------------------------------------------------------------------------
// 2. squash-impact
// ---------------------------------------------------------------------------

export interface SquashParams {
  /** Y compression at full impact. */
  compressionY: number;
  /** Lateral flare. Defaults to 1/√compressionY so volume is preserved. */
  flareXZ: number;
  springStiffness: number;
  springDamping: number;
}

/** Lateral flare that exactly preserves volume: X·Y·Z = (1/√c)²·c = 1.
 *
 *  Note the spec writes "flareXZ: 1.154 (= 1/0.75, volume-preserving)". The
 *  stated *number* is right (1/√0.75 = 1.1547) but the derivation in the doc is
 *  not: 1/0.75 = 1.333, which gives a volume of 1.333 and is a visible 33%
 *  inflation on every kick. The number wins; this expression makes the
 *  volume-preservation property hold for any `compressionY` rather than only
 *  for the one default. */
export const volumePreservingFlare = (compressionY: number): number =>
  1 / Math.sqrt(compressionY);

/**
 * Defaults from the spec. `flareXZ` is derived from `compressionY` rather than
 * chosen — an isotropic scale is the "amateur tell" this move removes.
 */
export const DEFAULT_SQUASH: SquashParams = {
  compressionY: 0.75,
  flareXZ: 1 / Math.sqrt(0.75),
  springStiffness: 240,
  springDamping: 18,
};

/**
 * Move 2 — squash-impact.
 *
 * Returns a volume-preserving scale triple for a downbeat impact. The caller
 * supplies the settle progress `t` in seconds since the impact; the shape comes
 * from a damped harmonic so it overshoots through inversion and rings down,
 * which is what reads as mass rather than a zoom.
 *
 * The returned triple always satisfies `x·y·z ≈ 1` — that is the whole point,
 * so it is asserted in the unit test rather than trusted.
 */
export function squashImpact(
  tSec: number,
  params: SquashParams = DEFAULT_SQUASH,
): Vec3 {
  const compressionY = params.compressionY > 0 ? params.compressionY : 0.75;
  // `flareXZ` is the *peak* flare (at t=0) and is honoured there; at later
  // times the flare is derived from the live scaleY so volume stays conserved.
  const flareXZ = params.flareXZ > 0 ? params.flareXZ : volumePreservingFlare(compressionY);

  if (tSec <= 0) return [flareXZ, compressionY, flareXZ];

  // Decay rate and frequency for a unit-mass damped oscillator x'' + c·x' + k·x = 0:
  //   γ = c/2, ω = √(k − γ²)
  // Note γ is c/2, *not* c/(2·√k): the latter is the dimensionless damping
  // ratio ζ, and using it here gives γ ≈ 0.58 — a "spring" still 60% compressed
  // half a second later and one that never visibly overshoots, which is exactly
  // the mushy triangular hit curve the spec lists as amateur tell #3.
  const gamma = Math.max(0, params.springDamping) / 2;
  const omega = Math.sqrt(Math.max(1e-6, params.springStiffness - gamma * gamma));

  // Full compression at t=0, ringing through rest and settling at neutral.
  // Do NOT clamp `ring`: its excursion below zero IS the overshoot-through-
  // inversion that the spec asks for ("swing through overshoot inversion
  // (0.94, 1.08, 0.94)"). Clamping it to [0,1] turns the spring into a one-way
  // ratchet that can only ever compress, which is tell #3 all over again.
  const ring = dampedHarmonic(tSec, gamma, omega);
  const scaleY = lerp(1, compressionY, ring);
  // Derive the flare from the *actual* Y value at this instant rather than
  // lerping it independently: X·Z is then 1/scaleY by construction, so volume
  // is conserved across the whole settle, not just at t=0. Lerping both axes
  // independently preserves volume at the endpoints only and drifts ~0.7% in
  // between, which is visible as the mesh breathing on the wrong axis.
  const scaleXZ = 1 / Math.sqrt(Math.max(1e-6, scaleY));
  return [scaleXZ, scaleY, scaleXZ];
}

/**
 * Move 2 — squash-impact, driven by an impulse *envelope* rather than by time.
 *
 * `squashImpact` is a pure function of time-since-impact and returns FULL
 * compression at `t = 0`. That is correct for a caller that has just detected a
 * hit, but it is the wrong shape for the frame loop: feeding it
 * `impulse * 0.12` makes t=0 correspond to a *silent* frame, so silence
 * produced the maximum squash ([1.155, 0.75, 1.155]) and a kick produced almost
 * none — precisely inverted.
 *
 * Here `impulse` is the 0..1 attack/decay envelope, so 0 must mean "at rest" and
 * 1 must mean "full impact". Volume is conserved at every value, as with
 * `squashImpact`.
 */
export function squashFromImpulse(
  impulse: number,
  params: SquashParams = DEFAULT_SQUASH,
): Vec3 {
  const amount = clamp01(impulse);
  const compressionY = params.compressionY > 0 ? params.compressionY : 0.75;
  const scaleY = 1 - (1 - compressionY) * amount;
  const scaleXZ = 1 / Math.sqrt(Math.max(1e-6, scaleY));
  return [scaleXZ, scaleY, scaleXZ];
}

// ---------------------------------------------------------------------------
// 3. pre-drop-freeze
// ---------------------------------------------------------------------------

export interface PreDropFreezeParams {
  freezeLeadTimeBeats: number;
  exposureDrop: number;
  particleVelocityClamp: number;
}

export const DEFAULT_PRE_DROP_FREEZE: PreDropFreezeParams = {
  freezeLeadTimeBeats: 1.0,
  exposureDrop: -0.5,
  particleVelocityClamp: 0.0,
};

export interface PreDropFreezeResult {
  /** 0 = dead stop, 1 = full motion. Multiplies every kinematic channel. */
  motionMultiplier: number;
  /** Added to scene exposure in EV. Negative darkens. */
  exposureEV: number;
  /** Clamp applied to particle velocities. */
  particleVelocityClamp: number;
}

/**
 * Move 3 — pre-drop-freeze.
 *
 * Clamps all kinematics to a dead stop 0.5–1 beat before a drop, with a
 * one-frame release. Dead space magnifies the drop; this is the cheapest of the
 * three signature moves and the one that most clearly reads as intentional.
 *
 * With no known drop time this returns full motion rather than freezing forever.
 */
export function preDropFreeze(
  nowSec: number,
  nextDrop: LookaheadEvent,
  params: PreDropFreezeParams = DEFAULT_PRE_DROP_FREEZE,
  bpm = 120,
): PreDropFreezeResult {
  const live: PreDropFreezeResult = {
    motionMultiplier: 1,
    exposureEV: 0,
    particleVelocityClamp: 1,
  };
  if (!nextDrop) return live;

  const lead = secondsPerBeat(bpm) * params.freezeLeadTimeBeats;
  const toDrop = nextDrop.timeSec - nowSec;

  // `toDrop === 0` is the drop itself: the freeze must still be fully clamped
  // *at* that instant, and only release on the next frame. Using `toDrop < 0`
  // here would make the dead stop vanish on exactly the frame that needs it.
  if (toDrop < 0 || toDrop > lead) return live;

  // easeInOutSine ramps the stop in and out rather than slamming it, which
  // would be indistinguishable from a dropped frame.
  const t = clamp01(1 - toDrop / lead);
  const stopped = easeInOutSine(t);
  return {
    motionMultiplier: 1 - stopped,
    exposureEV: params.exposureDrop * stopped,
    particleVelocityClamp: lerp(1, params.particleVelocityClamp, stopped),
  };
}
// ---------------------------------------------------------------------------
// 4. snare-backpedal
// ---------------------------------------------------------------------------

export interface SnareBackpedalParams {
  kickbackDistance: number;
  attackTimeMs: number;
  recoveryTimeMs: number;
  gamma: number;
  omega: number;
}

export const DEFAULT_SNARE_BACKPEDAL: SnareBackpedalParams = {
  kickbackDistance: 1.8,
  attackTimeMs: 0, // instant
  recoveryTimeMs: 220,
  gamma: 14, // ≈4.6 time constants over the 220 ms window
  omega: 26,
};

/**
 * Move 4 — snare-backpedal.
 *
 * Camera recoils along its local view vector on a snare, then a magnetic pull
 * returns it. Returns an offset in world units to apply to the camera **offset
 * node** (the child), never to the rig — see `docs/knowledge/.../README.md` §4,
 * "unanchored drunk camera".
 */
export function snareBackpedal(
  tSec: number,
  params: SnareBackpedalParams = DEFAULT_SNARE_BACKPEDAL,
): number {
  if (tSec <= 0) return 0;
  const recoverySec = Math.max(0.001, params.recoveryTimeMs / 1000);
  // Past the recovery window the offset is exactly 0, not a decaying residue —
  // a camera that never quite stops drifting is the drunk-camera tell.
  if (tSec >= recoverySec) return 0;
  const envelope = 1 - easeOutQuad(clamp01(tSec / recoverySec));
  // Negated: the camera recoils *away* from its rest pose (down its own view
  // vector) and is then pulled back. A positive first excursion would be a
  // lurch toward the subject, which is the opposite of the move.
  return (
    -params.kickbackDistance * dampedHarmonic(tSec, params.gamma, params.omega) * envelope
  );
}

// ---------------------------------------------------------------------------
// 5. orbital-ratchet
// ---------------------------------------------------------------------------

export interface OrbitalRatchetParams {
  stepAngle: number;
  stepDurationMs: number;
  overshootAngle: number;
}

export const DEFAULT_ORBITAL_RATCHET: OrbitalRatchetParams = {
  // The spec writes 0.196 rad (11.25°, 32 steps/rev). 2π/32 = 0.19635, and the
  // rounded 0.196 drifts: 32 steps accumulate to 6.272 rad, which is 0.011 rad
  // short of a full turn — a visible seam that repeats every 32 hats.
  stepAngle: (2 * Math.PI) / 32,
  stepDurationMs: 45,
  overshootAngle: 0.03,
};

/**
 * Move 5 — orbital-ratchet.
 *
 * Quantised orbit stepping on hi-hat 8ths/16ths instead of smooth rotation.
 * `hitCount` is the cumulative number of hats since the start of the sequence,
 * so the result is stateless and replayable.
 */
export function orbitalRatchet(
  tSec: number,
  hitCount: number,
  params: OrbitalRatchetParams = DEFAULT_ORBITAL_RATCHET,
): number {
  if (hitCount <= 0) return 0;
  const stepSec = Math.max(1e-4, params.stepDurationMs / 1000);
  const stepIndex = Math.floor(tSec / stepSec);
  // easeOutExpo within each step gives the quick settle the spec asks for; the
  // remainder between steps is the hold that makes it read as a ratchet.
  const t = easeOutExpo(clamp01((tSec - stepIndex * stepSec) / stepSec));
  // `hitCount` hats means `hitCount` steps have been taken — the Nth hat IS
  // step N. An earlier `hitCount - 1` counted only N-1, so the ratchet lagged
  // one step behind the music and 32 hats produced 31 steps (6.087 rad, a
  // quarter-turn short of the intended full revolution).
  return hitCount * params.stepAngle + t * params.overshootAngle;
}

// ---------------------------------------------------------------------------
// 6. sub-bass-swell
// ---------------------------------------------------------------------------

export interface SubBassSwellParams {
  fovDelta: number;
  meshDisplacementAmplitude: number;
  attackTimeMs: number;
  releaseTimeMs: number;
}

export const DEFAULT_SUB_BASS_SWELL: SubBassSwellParams = {
  fovDelta: 8,
  meshDisplacementAmplitude: 0.35,
  attackTimeMs: 300,
  releaseTimeMs: 450,
};

export interface SubBassSwellResult {
  fovDelta: number;
  displacement: number;
}

/**
 * Move 6 — sub-bass-swell.
 *
 * Slow breathing displacement from sustained sub-bass only, with asymmetric
 * attack/release. `subEnergy` must already be band-limited above 60 Hz by the
 * caller; this function deliberately does no filtering of its own so the
 * analysis path stays the single place bands are computed.
 */
export function subBassSwell(
  tSec: number,
  subEnergy: number,
  params: SubBassSwellParams = DEFAULT_SUB_BASS_SWELL,
): SubBassSwellResult {
  const energy = clamp01(subEnergy);
  // Heavily smoothed: a swell is the *sustained* component, not the transient.
  const base = energy * easeInOutSine(clamp01(energy));

  // Asymmetric attack/release. A swell rises slowly and falls a little slower
  // still, which is what reads as breathing rather than as a volume knob.
  //
  // `tSec` is the time since the swell began; it is only meaningful relative to
  // a start, so a caller that has no start time (or a non-finite one) gets the
  // ungated level rather than a channel stuck at the attack floor.
  const elapsedMs = Number.isFinite(tSec) ? tSec * 1000 : Number.POSITIVE_INFINITY;
  const windowMs = elapsedMs < params.attackTimeMs ? params.attackTimeMs : params.releaseTimeMs;
  const envelope =
    Number.isFinite(elapsedMs) && windowMs > 0
      ? clamp01(elapsedMs / windowMs)
      : 1;

  // `|| 0` normalises -0 to 0 so a silent passage returns exactly {0, 0} rather
  // than {-0, -0}, which fails a strict deep-equal against the neutral pose.
  const level = base * easeInOutSine(envelope) || 0;
  return {
    fovDelta: params.fovDelta * level,
    displacement: params.meshDisplacementAmplitude * level,
  };
}

// ---------------------------------------------------------------------------
// 7. frequency-dispersion-whip
// ---------------------------------------------------------------------------

export interface WhipParams {
  whipAngleYaw: number;
  whipRollKick: number;
  durationBeats: number;
}

export const DEFAULT_WHIP: WhipParams = {
  whipAngleYaw: 1.5707, // 90°
  whipRollKick: 0.261, // 15°
  durationBeats: 2.0,
};

export interface WhipResult {
  yaw: number;
  roll: number;
}

/**
 * Move 7 — frequency-dispersion-whip.
 *
 * High-speed camera whip on a fill, accelerating into the downbeat it lands on.
 * `tSec` is the time since the whip started. easeInQuint gives the
 * acceleration the spec describes: a linear ramp reads as a calm pan, and a
 * constant-velocity one as a cut.
 *
 * `durationSec` is what actually bounds the move (the distance to the landing
 * beat); `durationBeats` is only the fallback when no beat is known.
 */
export function frequencyDispersionWhip(
  tSec: number,
  params: WhipParams = DEFAULT_WHIP,
  durationSec?: number,
  bpm = 120,
): WhipResult {
  if (tSec < 0) return { yaw: 0, roll: 0 };
  const span = durationSec ?? secondsPerBeat(bpm) * params.durationBeats;
  const t = clamp01(tSec / Math.max(1e-4, span));
  const eased = Math.pow(t, 5);
  return {
    yaw: params.whipAngleYaw * eased,
    roll: params.whipRollKick * eased,
  };
}

// ---------------------------------------------------------------------------
// 8. phase-lag-pendulum
// ---------------------------------------------------------------------------

export interface PhaseLagParams {
  chainLength: number;
  frameDelayPerElement: number;
  scaleAttenuation: number;
  dampingCoefficient: number;
}

export const DEFAULT_PHASE_LAG: PhaseLagParams = {
  chainLength: 4,
  frameDelayPerElement: 3,
  scaleAttenuation: 0.85,
  dampingCoefficient: 0.12,
};

/**
 * Move 8 — phase-lag-pendulum (stateless form).
 *
 * Element `i` mirrors element 0's value, delayed by `i × frameDelayPerElement`
 * and attenuated. Returns the scalar for one element given the source history —
 * see `PhaseLagChain` for the stateful wrapper that owns that history.
 */
export function phaseLagElement(
  history: number[],
  elementIndex: number,
  params: PhaseLagParams = DEFAULT_PHASE_LAG,
): number {
  if (history.length === 0) return 0;
  const idx = history.length - 1 - elementIndex * params.frameDelayPerElement;
  // A history shorter than the requested delay means the chain has not warmed up
  // yet; hold at zero rather than clamping to the oldest sample, which would
  // make the whole chain jump at once.
  if (idx < 0) return 0;
  const base = history[idx];
  return base * Math.pow(params.scaleAttenuation, elementIndex);
}

/** Stateful cyclic-history wrapper for the phase-lag chain. */
export class PhaseLagChain {
  private history: number[] = [];

  constructor(private params: PhaseLagParams = DEFAULT_PHASE_LAG) {}

  /** Push a source value and read back the full chain, element 0 first. */
  update(source: number): number[] {
    this.history.push(source);
    // Bounded so a long track cannot grow this array without limit.
    const span = this.params.chainLength * this.params.frameDelayPerElement + 2;
    if (this.history.length > span) this.history.shift();
    const out: number[] = [];
    for (let i = 0; i < this.params.chainLength; i++) {
      out.push(phaseLagElement(this.history, i, this.params));
    }
    return out;
  }

  reset(): void {
    this.history = [];
  }
}

// ---------------------------------------------------------------------------
// 9. shutter-stutter
// ---------------------------------------------------------------------------

export interface ShutterStutterParams {
  quantizedFrameRate: number;
  durationMs: number;
}

export const DEFAULT_SHUTTER_STUTTER: ShutterStutterParams = {
  quantizedFrameRate: 12,
  durationMs: 350,
};

/**
 * Move 9 — shutter-stutter — the time quantiser.
 *
 * Sample-and-hold: `T_active(t) = T_source(floor(t/Δt)·Δt)`. Quantises time to
 * 12 FPS while the render itself stays at 60 FPS, which reads as film judder
 * rather than as dropped frames.
 *
 * Returns the *held* timestamp; the caller then looks up that frame's source
 * value (from the spectral timeline, which is already a frame-indexed array).
 * Returns `tSec` unchanged when stuttering is inactive, so a caller can use this
 * unconditionally.
 */
export function shutterHoldTime(
  tSec: number,
  active: boolean,
  params: ShutterStutterParams = DEFAULT_SHUTTER_STUTTER,
): number {
  if (!active || !Number.isFinite(tSec)) return tSec;
  const step = 1 / Math.max(1, params.quantizedFrameRate);
  return Math.floor(tSec / step) * step;
}

/** True while `tSec` is inside a stutter window that started at `startSec`. */
export function isStutterActive(
  tSec: number,
  startSec: number,
  params: ShutterStutterParams = DEFAULT_SHUTTER_STUTTER,
): boolean {
  if (!Number.isFinite(tSec) || !Number.isFinite(startSec)) return false;
  return tSec >= startSec && tSec - startSec < params.durationMs / 1000;
}

// ---------------------------------------------------------------------------
// 10. focal-breathing (dolly zoom / vertigo)
// ---------------------------------------------------------------------------

export interface FocalBreathingParams {
  minFOV: number;
  maxFOV: number;
  fixedSubjectDistance: number;
  transitionTimeBeats: number;
}

export const DEFAULT_FOCAL_BREATHING: FocalBreathingParams = {
  minFOV: 35,
  maxFOV: 85,
  fixedSubjectDistance: 5.0,
  transitionTimeBeats: 16,
};

export interface FocalBreathingResult {
  fov: number;
  /** Camera Z translation needed to hold the subject's framing. */
  cameraZ: number;
}

/**
 * Move 10 — focal-breathing.
 *
 * Camera translates on its local Z while FOV counter-compensates: the subject
 * holds its size on screen while the background warps. Driven by slow macro
 * energy over 8–16 bar phrases, so `t` should be phrase progress, not
 * per-frame time.
 */
export function focalBreathing(
  t: number,
  params: FocalBreathingParams = DEFAULT_FOCAL_BREATHING,
): FocalBreathingResult {
  const eased = easeInOutSine(clamp01(t));
  const fov = lerp(params.minFOV, params.maxFOV, eased);
  // Hold subject framing: at a constant subject distance, moving the camera
  // back by the FOV ratio keeps the subject's apparent size constant.
  const cameraZ = params.fixedSubjectDistance * (fov / params.minFOV - 1);
  return { fov, cameraZ };
}
  // ---------------------------------------------------------------------------
// Sectional easing palette applied to a channel (spec §2, implementation step 4)
// ---------------------------------------------------------------------------

export interface SectionMotionProfile {
  ease: (t: number) => number;
  /** Transient amplitude multiplier for this section. */
  transientGain: number;
  /** Human-readable curve name, for telemetry and docs. */
  label: string;
  objective: string;
}

/**
 * Join the sectional easing palette to an actual section label.
 *
 * This is the wiring step the spec asks for — "Sectional easing palette wired to
 * the existing section detection". It reads the label that
 * `sectionHelpers.ts` / `lrcSync` already produce (uppercase, hyphenated, e.g.
 * `"PRE-CHORUS"`, `"FINAL DROP"`) rather than the lowercase `SectionType` keys,
 * because the labels that actually reach the visualizer come from the analyzer.
 *
 * `"FINAL DROP"` and `"BUILD-UP"` are mapped onto drop / pre-chorus: they are
 * the same musical function, and leaving them to the verse fallback is what made
 * the biggest moments on a track feel the quietest.
 */
export function sectionMotionProfile(section: string | null | undefined): SectionMotionProfile {
  const raw = (section ?? "").trim().toUpperCase();
  const alias: Partial<Record<string, MotionSection>> = {
    "BUILD-UP": "pre-chorus",
    BUILDS: "pre-chorus",
    "FINAL DROP": "drop",
    "FINAL CHORUS": "chorus",
    INTRO: "intro",
  };
  const key = alias[raw] ?? (raw.toLowerCase() as MotionSection);
  const entry = getSectionEasing(key);
  return {
    ease: entry.ease,
    transientGain: entry.transientGain,
    label: entry.label,
    objective: entry.objective,
  };
}

/** Every section name `sectionMotionProfile` recognises, for docs and tests. */
export const KNOWN_SECTIONS = Object.keys(SECTION_EASING);

// ---------------------------------------------------------------------------
// Impulse-decay trigger (amateur tell #1) + motion gates
// ---------------------------------------------------------------------------

export interface ImpulseTriggerConfig {
  /** Rise in energy per second required to fire. Suppresses noise. */
  noiseGate: number;
  /**
   * Asymmetric envelope: attack is near-instant, decay is 120-600 ms.
   *
   * `decayMs` is a *hard bound*, not just a rate — the envelope is guaranteed to
   * be exactly 0 one `decayMs` after the attack, so a caller can size buffers
   * and budget motion without worrying about an asymptotic tail.
   */
  attackMs: number;
  decayMs: number;
}

export const DEFAULT_IMPULSE_CONFIG: ImpulseTriggerConfig = {
  noiseGate: 0.35,
  attackMs: 16,
  decayMs: 220,
};

/**
 * First-derivative triggering with a noise gate — the fix for the "jittering
 * oscilloscope" tell.
 *
 * Mapping continuous energy levels straight to a transform makes a mesh twitch
 * every frame. Binding to `max(0, dE/dt)` with a gate means the visual only
 * moves on a *rise*, then rings down through an asymmetric envelope: 0-16 ms
 * attack, 120-600 ms decay. Smooth AFTER the transient step, never before.
 *
 * This holds frame state, so it is a class rather than one of the pure
 * functions above. One instance per driven channel.
 */
export class ImpulseTrigger {
  private lastEnergy = 0;
  private envelope = 0;
  private lastAttackTime = -Infinity;
  /** The first frame has no previous sample, so its derivative is measured
   *  against a zero baseline and reads as an enormous rise — a spurious full
   *  attack on whatever level the track happens to start at. Until primed we
   *  only record the baseline. */
  private primed = false;

  constructor(private config: ImpulseTriggerConfig = DEFAULT_IMPULSE_CONFIG) {}

  /**
   * Feed the current band energy.
   *
   * @param energy  current energy, 0..1
   * @param dtSec   frame delta in seconds
   * @param nowSec  audio-clock time, used only for attack de-duplication
   * @returns the impulse amplitude, 0..1
   */
  update(energy: number, dtSec: number, nowSec = 0): number {
    const e = clamp01(energy);
    const dt = dtSec > 0 && Number.isFinite(dtSec) ? dtSec : 1 / 60;

    if (!this.primed) {
      this.primed = true;
      this.lastEnergy = e;
      return 0;
    }

    // Derivative: energy gained per second. Only rises trigger.
    const rate = (e - this.lastEnergy) / dt;
    const rise = Math.max(0, rate);

    this.lastEnergy = e;

    if (rise >= this.config.noiseGate) {
      // Scale the rise into 0..1 against a generous reference slope, so a hard
      // transient saturates but a moderate one stays proportional.
      this.envelope = Math.min(1, rise / (this.config.noiseGate * 3));
      this.lastAttackTime = nowSec;
      return this.envelope;
    }

    // No new attack: ring down asymmetrically.
    const elapsedMs = (nowSec - this.lastAttackTime) * 1000;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      this.envelope = Math.max(0, this.envelope - this.config.decayMs * dt * 0.001);
    } else if (elapsedMs < this.config.attackMs) {
      this.envelope = Math.min(1, this.envelope + dt * 0.001);
    } else {
      // Exponential ring-down, tapered linearly to exactly zero at `decayMs`.
      //
      // A pure geometric decay never *arrives*: after 2 s it was still at
      // 7e-5, and the caller has no way to distinguish "at rest" from
      // "immeasurably small but non-zero". The taper is what makes the envelope
      // reach genuine rest on schedule, which is what the spec's "120-600 ms
      // decay" claims and what stops a scene twitching in silence. It also makes
      // the move time-bounded rather than asymptotic, so a caller can rely on
      // `decayMs` as a hard upper bound on how long a transient can hold.
      const progress = clamp01(elapsedMs / Math.max(1, this.config.decayMs));
      const decayFraction = Math.min(1, dt * (1000 / Math.max(1, this.config.decayMs)));
      this.envelope = Math.max(0, this.envelope * (1 - decayFraction)) * (1 - progress);
      if (this.envelope < 1e-6) this.envelope = 0;
    }

    return this.envelope;
  }

  reset(): void {
    this.lastEnergy = 0;
    this.envelope = 0;
    this.lastAttackTime = -Infinity;
    this.primed = false;
  }
}

// ---------------------------------------------------------------------------
// Motion gates (spec §3) — when NOT to react
// ---------------------------------------------------------------------------

export interface MotionGateParams {
  /** Percentile of the song's RMS range below which transients are gated off. */
  percentile: number;
  /** Number of bars in the running RMS window. */
  windowBars: number;
}

export const DEFAULT_MOTION_GATE: MotionGateParams = {
  percentile: 35,
  windowBars: 8,
};

/**
 * Decide whether to gate off transient impulses in a quiet passage.
 *
 * Spec §3: "running 8-bar RMS window; if section RMS < 35th percentile of song
 * range (ambient verses, breakdowns), gate off transient impulses, switch camera
 * to smooth drift". Visual fatigue comes from the same hyperactivity at 0:15 and
 * at the final drop; this is the mechanism for spending rests.
 */
export function shouldGateMotion(
  currentRms: number,
  songRmsSamples: number[],
  params: MotionGateParams = DEFAULT_MOTION_GATE,
): boolean {
  if (songRmsSamples.length < 4) return false; // not enough track context
  const sorted = [...songRmsSamples].sort((a, b) => a - b);
  const p = Math.min(1, Math.max(0, params.percentile / 100));
  const threshold = sorted[Math.floor(p * (sorted.length - 1))];
  return currentRms < threshold;
}

/** True when a passage is even flowing — gates micro-detail during a vacuum. */
export function shouldGateDetail(currentRms: number): boolean {
  return currentRms < 0.06;
}
