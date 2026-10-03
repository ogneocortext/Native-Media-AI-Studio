/**
 * Motion easing + spring primitives for audio-reactive visuals.
 *
 * Spec: docs/knowledge/gemini-motion-design-2026-10-02/README.md §1, §2 and the
 * "motion vocabulary" table. Pure maths, no React, no three.js — so it is unit
 * tested in `motionEasing.test.ts` rather than in a browser.
 *
 * Why this exists: before it, every reactive parameter shared one trigger
 * source, one direction and one easing curve, which is why the visuals read as
 * an oscilloscope rather than an organism. Picking a *different* curve per song
 * section is the cheapest half of that fix; the moves in `motionMoves.ts` are
 * the other half.
 */

export type EasingFn = (t: number) => number;

/** Clamp to [0,1]. Easing curves are only defined on that interval; feeding
 *  them an out-of-range t (a frame overshoot past the end of a section) is the
 *  usual source of a visualizer "stuck" at a value that never settles.
 *
 *  NaN maps to 0 so a single poisoned frame cannot stick a channel forever
 *  (NaN fails every subsequent comparison, so settle logic never recovers).
 *  Infinities clamp to the nearer bound instead of taking the NaN path: an
 *  over-driven value should saturate, not snap to silence. */
export function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Easing curves named in the spec's sectional palette.
// ---------------------------------------------------------------------------

// Every curve below clamps its own input. That is deliberate: these are called
// per frame from several call sites, and a single unguarded `t * t` turns one
// NaN frame into a channel that stays NaN forever (NaN fails every subsequent
// comparison, so no settle logic ever recovers it).

export const easeInQuad: EasingFn = (t) => {
  const x = clamp01(t);
  return x * x;
};

export const easeOutQuad: EasingFn = (t) => {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
};

export const easeInOutQuad: EasingFn = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
};

export const easeInExpo: EasingFn = (t) => {
  const x = clamp01(t);
  return x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, 10 * x - 10);
};

export const easeOutExpo: EasingFn = (t) => {
  const x = clamp01(t);
  return x >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.pow(2, -10 * x);
};

/** easeInQuad → easeInExpo chain used for builds ("ratcheting tension"). The
 *  blend is linear in t; the *convexity* of the result is what makes each step
 *  feel shorter than the last, which is the actual ratchet effect. */
export const easeInQuadToExpo: EasingFn = (t) =>
  lerp(easeInQuad(t), easeInExpo(t), clamp01(t));

/** Stepped hold → smooth move. Drives `orbital-ratchet` and the snap-out of
 *  `anticipation-contract`. */
export const easeInOutSine: EasingFn = (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

export const easeInOutCubic: EasingFn = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const easeInCubic: EasingFn = (t) => {
  const x = clamp01(t);
  return x * x * x;
};

/** Ease-in to a minimum (anticipation wind-up), accelerating into the low point. */
export const easeInQuint: EasingFn = (t) => Math.pow(clamp01(t), 5);

const ELASTIC_PERIOD = (2 * Math.PI) / 3;

/** easeOutElastic — "violent displacement, resonant decay". `c5` is the fixed
 *  overshoot amplitude the spec pairs with this period. */
export const easeOutElastic: EasingFn = (t) => {
  const x = clamp01(t);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c5 = (2 * Math.PI) / ELASTIC_PERIOD;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c5) + 1;
};

/** Decaying harmonic `f(t) = e^(-γt)·cos(ωt)` — the spec's chorus/drop and
 *  `snare-backpedal` curve. `gamma` is the decay rate, `omega` the frequency.
 *
 *  NaN-safe: a NaN in, 0 out, so a poisoned channel can recover. */
export function dampedHarmonic(t: number, gamma: number, omega: number): number {
  if (Number.isNaN(t) || Number.isNaN(gamma) || Number.isNaN(omega)) return 0;
  if (t <= 0) return 1;
  return Math.exp(-gamma * t) * Math.cos(omega * t);
}

// ---------------------------------------------------------------------------
// Damped spring
// ---------------------------------------------------------------------------

/**
 * One step of a damped spring, semi-implicit Euler.
 *
 * `dt` is expected in seconds and MUST be small. An explicit integrator with a
 * large `dt` gains energy and the spring oscillates wider every frame instead
 * of settling — so `dampedSpringStep` below sub-steps rather than trusting the
 * caller. Stiffness 240 / damping 18 (the `squash-impact` default) diverges
 * outright at 60 fps on some frame times; sub-stepping makes it stable for any.
 */
export function springStep(
  current: number,
  target: number,
  velocity: number,
  stiffness: number,
  damping: number,
  dt: number,
): [number, number] {
  const springForce = -stiffness * (current - target);
  const nextVelocity = velocity + (springForce - damping * velocity) * dt;
  return [current + nextVelocity * dt, nextVelocity];
}

/** Sub-stepped wrapper. Splits `dt` into chunks no larger than `maxStep` so a
 *  dropped frame (a seek, a backgrounded tab) cannot make the spring explode. */
export function dampedSpringStep(
  current: number,
  target: number,
  velocity: number,
  stiffness: number,
  damping: number,
  dt: number,
  maxStep = 1 / 120,
): [number, number] {
  if (!(dt > 0) || !Number.isFinite(dt)) return [current, velocity];
  const steps = Math.min(64, Math.max(1, Math.ceil(dt / maxStep)));
  const h = dt / steps;
  let value = current;
  let v = velocity;
  for (let i = 0; i < steps; i++) {
    [value, v] = springStep(value, target, v, stiffness, damping, h);
  }
  return [value, v];
}

/** Stateful spring — one instance per animated channel. */
export class DampedSpring {
  value: number;
  velocity = 0;

  constructor(
    initial = 0,
    private stiffness = 240,
    private damping = 18,
  ) {
    this.value = initial;
  }

  setStiffness(stiffness: number): void {
    this.stiffness = stiffness;
  }

  setDamping(damping: number): void {
    this.damping = damping;
  }

  /** Move toward `target`, returning the new value. */
  step(target: number, dt: number): number {
    [this.value, this.velocity] = dampedSpringStep(
      this.value,
      target,
      this.velocity,
      this.stiffness,
      this.damping,
      dt,
    );
    return this.value;
  }

  /** Kick the velocity without moving the position — used for an impulse that
   *  should read as a hit rather than a teleport. */
  impulse(delta: number): void {
    this.velocity += delta;
  }

  reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
  }
}

// ---------------------------------------------------------------------------
// Sectional easing palette (spec §2)
// ---------------------------------------------------------------------------

export type MotionSection =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "drop"
  | "breakdown";

export interface SectionEasing {
  /** Curve applied to intra-section progress. */
  ease: EasingFn;
  /** Human label for docs/telemetry. */
  label: string;
  /** Objective from the spec table, kept next to the curve so the mapping is
   *  self-documenting rather than needing the doc open. */
  objective: string;
  /** Multiplier on transient amplitude. Verse sits far below drop: this is the
   *  "one kinetic thought at a time" / visual-fatigue control. */
  transientGain: number;
}

/**
 * The spec's palette, keyed by the same section names `sectionStateMachine.ts`
 * already uses, so the two can be joined without a translation table.
 */
export const SECTION_EASING: Record<MotionSection, SectionEasing> = {
  intro: {
    ease: easeInOutSine,
    label: "easeInOutSine",
    objective: "drifting, observational; motion resolves over 2-4 bars",
    transientGain: 0.5,
  },
  verse: {
    ease: easeInOutSine,
    label: "easeInOutSine → easeInOutCubic",
    objective: "drifting, observational; motion resolves over 2-4 bars",
    transientGain: 0.6,
  },
  "pre-chorus": {
    ease: easeInQuadToExpo,
    label: "easeInQuad → easeInExpo",
    objective: "ratcheting tension; decay windows shorten progressively",
    transientGain: 0.85,
  },
  chorus: {
    ease: easeOutElastic,
    label: "instant attack + easeOutElastic",
    objective: "violent displacement, resonant decay",
    transientGain: 1.0,
  },
  drop: {
    ease: easeOutElastic,
    label: "instant attack + damped harmonic",
    objective: "violent displacement, resonant decay",
    transientGain: 1.15,
  },
  bridge: {
    ease: easeOutQuad,
    label: "easeOutQuad rise + linear drift",
    objective: "weightless, decoupled from rhythm",
    transientGain: 0.7,
  },
  outro: {
    ease: easeOutQuad,
    label: "easeOutQuad rise + linear drift",
    objective: "weightless, decoupled from rhythm",
    transientGain: 0.45,
  },
  breakdown: {
    ease: easeInOutSine,
    label: "easeInOutSine",
    objective: "drifting, observational; motion resolves over 2-4 bars",
    transientGain: 0.4,
  },
};

const FALLBACK_SECTION: MotionSection = "verse";

/** Look up the palette entry for a section name, case- and shape-insensitively.
 *  Unknown names fall back to verse rather than throwing: section labels come
 *  from analyzer output, and a new label must not blank the visuals. */
export function getSectionEasing(section: string | null | undefined): SectionEasing {
  if (!section) return SECTION_EASING[FALLBACK_SECTION];
  const key = section.trim().toLowerCase() as MotionSection;
  return SECTION_EASING[key] ?? SECTION_EASING[FALLBACK_SECTION];
}
