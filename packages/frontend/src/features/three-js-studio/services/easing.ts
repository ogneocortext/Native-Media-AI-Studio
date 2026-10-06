/**
 * Render-loop easing utilities (three-js-studio plan F3).
 *
 * The six cubic-bezier "anchors" from
 * docs/knowledge-library/three-js-render-motion-2026.md §3 —
 * the shared motion-craft vocabulary for the studio. Before
 * this module the anchors existed only as guidance text in
 * `sceneGuidelines.ts`; the render loop accumulated raw
 * `sin()`/linear deltas. These are the runtime curves.
 *
 * Every function is pure and allocation-free: `ease(anchor, t)`
 * returns a number and touches no heap, so the per-frame path
 * (F1 camera blends, F4 beat phrasing) never allocates.
 *
 * The solver: Newton-Raphson on the curve's x-coordinate with
 * a bisection fallback. All six anchors have both control
 * points inside [0, 1], which makes x(u) monotonic — so the
 * solve is guaranteed to converge and the result is a true
 * function of t (no double-valued curves).
 */

/** Clamp to [0, 1]; NaN maps to 0 so one poisoned frame
 *  cannot stick a channel (same rule as the visualizer's
 *  motionEasing.clamp01). */
function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export type EasingAnchor =
  | "entrance-sharp"
  | "settle-soft"
  | "expressive-pop"
  | "travel-balanced"
  | "exit-accelerate"
  | "travel-cut";

/** The anchors, as cubic-bezier control points (x1, y1, x2, y2)
 *  with endpoints pinned at (0, 0) and (1, 1). Values are
 *  verbatim from the research doc — derive, don't invent. */
const ANCHORS: Record<EasingAnchor, [number, number, number, number]> = {
  /** Fast in, soft land — drop hits, title cards. */
  "entrance-sharp": [0.2, 0.75, 0.34, 0.94],
  /** Deep ease-out, no bounce — verse settles, logo lockups. */
  "settle-soft": [0.0, 0.65, 0.51, 0.99],
  /** Fast-out + soft settle, overshoot opt-in — chorus flourishes. */
  "expressive-pop": [0.94, 0.75, 0.34, 0.94],
  /** S-curve ease-in-out — camera moves, object travel. */
  "travel-balanced": [1.0, 0.49, 0.0, 0.55],
  /** Slow start, fast end — cut companions, exits. */
  "exit-accelerate": [1.0, 0.02, 0.54, 0.42],
  /** Fast-slow-fast, never settles — interrupted moves, whips. */
  "travel-cut": [0.15, 0.85, 0.95, 0.05],
};

/** Every anchor name, for docs/tests. */
export const ANCHOR_NAMES = Object.keys(ANCHORS) as EasingAnchor[];

/** B_x(u) in Horner form: 3x1·u + (3x2−6x1)u² + (3x1−3x2+1)u³. */
function sampleX(u: number, x1: number, x2: number): number {
  return u * (3 * x1 + u * ((3 * x2 - 6 * x1) + u * (3 * x1 - 3 * x2 + 1)));
}

/** d/du B_x(u). */
function sampleXDerivative(u: number, x1: number, x2: number): number {
  return 3 * x1 + u * ((6 * x2 - 12 * x1) + u * (9 * x1 - 9 * x2 + 3));
}

/** B_y(u) in Horner form. */
function sampleY(u: number, y1: number, y2: number): number {
  return u * (3 * y1 + u * ((3 * y2 - 6 * y1) + u * (3 * y1 - 3 * y2 + 1)));
}

/**
 * Solve B_x(u) = x for u by Newton-Raphson (seeded at u = x,
 * clamped to [0, 1] each step so a bad seed cannot diverge),
 * falling back to bisection when the derivative vanishes.
 * Returns B_y(u). Both control points must be inside [0, 1]
 * on x for the solve to be monotonic (all six anchors are).
 */
function solveBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
): number {
  let u = x;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const err = sampleX(u, x1, x2) - x;
    if (Math.abs(err) < 1e-7) break;
    const slope = sampleXDerivative(u, x1, x2);
    let next: number;
    if (Math.abs(slope) < 1e-7) {
      next = (lo + hi) / 2; // bisection fallback
    } else {
      next = u - err / slope;
      if (next < lo || next > hi) next = (lo + hi) / 2;
    }
    // Tighten the bracket from the current sample so the
    // bisection fallback always converges.
    if (sampleX(u, x1, x2) < x) lo = u;
    else hi = u;
    u = next;
  }
  return sampleY(u, y1, y2);
}

/**
 * Evaluate a named anchor at progress `t` (0..1).
 */
export function ease(anchor: EasingAnchor, t: number): number {
  const [x1, y1, x2, y2] = ANCHORS[anchor];
  const x = clamp01(t);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return solveBezier(x1, y1, x2, y2, x);
}

/**
 * Evaluate an arbitrary cubic-bezier at `t`. Same solver as
 * `ease`; for curves that are not one of the six named
 * anchors. Control points are clamped into [0, 1] on x so
 * the solve stays monotonic.
 */
export function easeBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
): number {
  const cx1 = clamp01(x1);
  const cx2 = clamp01(x2);
  const x = clamp01(t);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return solveBezier(cx1, y1, cx2, y2, x);
}

/**
 * Chain two anchors: `a` runs over the first `split` of the
 * progress, `b` over the remainder. Used for moves that are
 * "anticipation then action" (F4) without allocating a
 * composite curve.
 */
export function chain(
  a: EasingAnchor,
  b: EasingAnchor,
  split: number,
  t: number,
): number {
  const s = clamp01(split);
  const x = clamp01(t);
  if (x <= s) return ease(a, s > 0 ? x / s : 0) * s;
  return s + ease(b, (x - s) / (1 - s)) * (1 - s);
}
