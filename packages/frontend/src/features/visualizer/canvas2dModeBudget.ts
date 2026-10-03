/**
 * Per-mode effect budget for the Canvas2D visualizer.
 *
 * Spec: `docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md`
 * (the "visual problem: no effect hierarchy" section and recommended fix #1),
 * with the restraint rule from `docs/knowledge/gemini-ae-to-canvas2d-2026-10-02/`.
 *
 * ## Why this exists
 *
 * `Canvas2DVisualizer.tsx` drew *all four* global effects on *every* frame in
 * *every* mode, before the mode's own rendering: trail/ghost fill, phrase flash,
 * beat vignette and drum shockwaves. Add a mode's own glows and you get 5-7
 * simultaneous large-area effects with no staging and no focal point — the
 * "visual noise" failure: everything reacts to everything, so nothing reads.
 *
 * The budget makes the choice **data** rather than code, which is the diagnosis
 * doc's own recommendation ("Recommend data — it makes the budget reviewable in
 * one place") and the only way the guarantee below can be enforced at all.
 *
 * ## The rule
 *
 * At most {@link MAX_EFFECTS} large-area effects may be live at once. The
 * diagnosis doc puts the ceiling at 2; `assertEffectBudget` enforces it, so a
 * future mode that asks for three fails a unit test rather than shipping.
 *
 * This is the structural form of the motion-design doc's "staging / driver
 * dominance": one kinetic thought at a time, enforced in data instead of taste.
 */

import type { Canvas2DMode } from "./visualizerHelpers";

/**
 * The mode list is **not** defined here.
 *
 * It used to be, and that is how `aurora` ended up unreachable: `Canvas2DVisualizer`
 * rendered it and this budget had an entry for it, while the picker list in
 * `visualizerHelpers.ts` never listed it — so the one mode the diagnosis doc
 * singled out as drawing a doubled flash/vignette was never visible to a user.
 * Four divergent copies of the list is how that happened.
 *
 * `CANVAS_2D_MODES` in `visualizerHelpers.ts` is the single source of truth; this
 * module consumes it. A unit test asserts the budget covers every mode in it.
 */
export type { Canvas2DMode };

/** The four effects that were previously unconditional. */
export type LargeAreaEffect = "trails" | "phraseFlash" | "beatVignette" | "shockwaves";

/**
 * Simultaneous large-area effects allowed per mode.
 *
 * 2 is the diagnosis doc's number. It is a *ceiling on what's allowed*, not a
 * target — most modes below use one or none.
 */
export const MAX_EFFECTS = 2;

export interface ModeBudget {
  /** Large-area effects this mode opts into. Must be <= {@link MAX_EFFECTS}. */
  effects: readonly LargeAreaEffect[];
  /**
   * Why this mode gets what it gets. A budget with no rationale is one nobody
   * can review later, which is the whole point of making it data.
   */
  rationale: string;
  /**
   * Trail alpha in 0-255 (the p5.js-style ghost fill). `null` means the mode has
   * no trails. Held here rather than in the draw loop because the old inline
   * version was a 4-level nested ternary with duplicated reduced-motion branches.
   */
  trailAlpha: number | null;
  /** Halved trail alpha under `prefers-reduced-motion`. */
  trailAlphaReduced: number | null;
}

/**
 * Trail defaults for a mode with no trails.
 *
 * Typed as the full pair rather than `Partial<ModeBudget>`: spreading a
 * `Partial` makes the fields optional in the resulting object type, so
 * `Record<Canvas2DMode, ModeBudget>` rejected every entry that used it.
 */
const NO_TRAILS = { trailAlpha: null, trailAlphaReduced: null } as const;

/**
 * Runtime priority for each effect, highest first.
 *
 * The budget caps *simultaneous* effects, but a mode can have several
 * capabilities and still exceed the cap on any given frame — `bars` can have a
 * shockwave, a phrase flash and a vignette live at once. `resolveActiveEffects`
 * uses this order to keep the loudest few and drop the rest, which is the
 * runtime form of "one kinetic thought at a time".
 *
 * Order rationale:
 * - `shockwaves` is a discrete, rhythmic event — it is the moment.
 * - `phraseFlash` is a lyric cue with real semantic weight.
 * - `trails` is a persistent look, not an event.
 * - `beatVignette` is ambient edge darkening, the least specific of the four.
 */
export const EFFECT_PRIORITY: readonly LargeAreaEffect[] = [
  "shockwaves",
  "phraseFlash",
  "trails",
  "beatVignette",
];

/**
 * Beat-vignette alpha ceiling.
 *
 * The old value was 0.45 at full `beatVignette`. The diagnosis doc says "halve
 * the alpha ceiling globally, then re-evaluate" — so 0.225, pending a look at
 * three tracks (dense EDM / sparse verse / acoustic) before it goes further.
 */
export const VIGNETTE_ALPHA_CEILING = 0.225;

/** Per-frame conditions the draw loop knows and the budget does not. */
export interface EffectConditions {
  /** An LRC track is loaded — phrase flash is meaningless without one. */
  hasLyrics: boolean;
  /** A beat transient is firing this frame. */
  beatActive: boolean;
  /** A lyric phrase boundary is crossing this frame. */
  phraseActive: boolean;
}

/**
 * Decide which effects actually draw this frame.
 *
 * A mode's declared effects are candidates; this filters them by whether they
 * are firing right now, then keeps at most {@link MAX_EFFECTS} by
 * {@link EFFECT_PRIORITY}. The result is what makes the cap a runtime guarantee
 * rather than a claim about the table.
 */
export function resolveActiveEffects(
  mode: string | null | undefined,
  conditions: EffectConditions,
  maxEffects: number = MAX_EFFECTS,
  budget?: ModeBudget,
): Set<LargeAreaEffect> {
  const declared = (budget ?? getModeBudget(mode)).effects;
  const firing = declared.filter((effect) => {
    switch (effect) {
      case "shockwaves":
        return conditions.beatActive;
      case "phraseFlash":
        // Requires lyrics AND a phrase boundary: the budget records the opt-in,
        // the lyrics gate the meaning.
        return conditions.hasLyrics && conditions.phraseActive;
      case "trails":
        return true;
      case "beatVignette":
        return true;
      default:
        return false;
    }
  });

  const ranked = EFFECT_PRIORITY.filter((effect) => firing.includes(effect));
  return new Set(ranked.slice(0, Math.max(0, maxEffects)));
}

/**
 * The budget, one entry per mode.
 *
 * Assignments follow the diagnosis doc's suggested starting point: trails only
 * on `particles`/`waveform`; shockwaves only on beat-forward modes; phrase flash
 * only where lyrics are the point. `beatVignette` is kept on every mode because
 * the doc asked to halve its alpha "globally, then re-evaluate" — that is a
 * change of strength, not of membership — and its ceiling lives in
 * {@link VIGNETTE_ALPHA_CEILING}.
 *
 * A mode may *declare* more than {@link MAX_EFFECTS}: `bars` legitimately has
 * three capabilities, and which two survive depends on the frame. The cap is
 * applied by {@link resolveActiveEffects}, not by the table.
 */
export const MODE_BUDGETS: Record<Canvas2DMode, ModeBudget> = {
  bars: {
    effects: ["shockwaves", "phraseFlash", "beatVignette"],
    rationale:
      "Beat-forward bar chart; lyrics make phrase flash the point when LRC is loaded. Only two of these three ever draw at once.",
    // No trails: the diagnosis doc's allocation is "keep trails only on
    // `particles` and `waveform`", and a ghost fill across a bar chart turns the
    // crisp bar edges into a smear. The old inline ternary gave `bars` an alpha
    // of 0x14; dropping it is the point of the budget, not an oversight.
    ...NO_TRAILS,
  },
  "mirrored-bars": {
    effects: ["beatVignette"],
    rationale: "Static mirror of `bars`; the symmetry is the read and trails blur it.",
    ...NO_TRAILS,
  },
  "segmented-led-bars": {
    effects: ["beatVignette"],
    rationale: "Discrete LED segments need a clean reset each frame; any smear reads as flicker.",
    ...NO_TRAILS,
  },
  "stereo-split-bars": {
    effects: ["beatVignette"],
    rationale: "Two independent halves; trails would smear one half into the other.",
    ...NO_TRAILS,
  },
  "stacked-frequency-bands": {
    effects: ["beatVignette"],
    rationale: "Bands are already layered; trails collapse the stack into mush.",
    ...NO_TRAILS,
  },
  "dot-peak-matrix": {
    effects: ["beatVignette"],
    rationale: "Peak dots persist by design, which is the trail effect done properly.",
    ...NO_TRAILS,
  },
  waveform: {
    effects: ["trails", "beatVignette"],
    rationale: "Phosphor persistence is the classic waveform look; the vignette is halved and sits under it.",
    trailAlpha: 0x12,
    trailAlphaReduced: 0x08,
  },
  radial: {
    // Deliberately no trails, and shockwaves are the *only* extra. The diagnosis
    // calls `radial` the worst offender: 64 spokes + pulsing glow core + orbital
    // ring + section rotation are already four competing centres of interest. The
    // AE doc's answer is the opposite of adding a ring — make the *baseline
    // radius* the shockwave, so bass modulates geometry that is already there.
    effects: ["shockwaves", "beatVignette"],
    rationale:
      "One extra only: already stacks spokes + core glow + orbital ring. The baseline radius is the shockwave.",
    ...NO_TRAILS,
  },
  spectrogram: {
    effects: ["beatVignette"],
    rationale:
      "The scrolled history *is* the persistence; it opted out of trails before this budget existed.",
    ...NO_TRAILS,
  },
  lissajous: {
    effects: ["beatVignette"],
    rationale: "A single thin figure — trails turn it into a solid blob.",
    ...NO_TRAILS,
  },
  constellation: {
    effects: ["beatVignette"],
    rationale: "Sparse points on black; a ghost fill only lifts the black level.",
    ...NO_TRAILS,
  },
  particles: {
    effects: ["trails", "beatVignette"],
    rationale: "Long particle trails are the whole point of the mode.",
    trailAlpha: 0x0a,
    trailAlphaReduced: 0x03,
  },
  aurora: {
    // The diagnosis flags aurora specifically: it draws its *own* beat-flash
    // rectangle and its *own* top vignette on top of the global stack, so it was
    // effectively getting two of each. Dropping the global flash and vignette
    // leaves its own, which is the point.
    effects: [],
    rationale:
      "Already draws its own beat-flash and vignette; the global stack doubled both.",
    ...NO_TRAILS,
  },
};

/**
 * Fallback for an unknown mode: no effects.
 *
 * A new mode gets nothing for free — the diagnosis doc explicitly forbids
 * adding a 14th mode until the budget exists, and the strongest version of that
 * is to make an undeclared mode inert rather than give it the old stack.
 */
const EMPTY_BUDGET: ModeBudget = {
  effects: [],
  rationale: "Unknown mode — no effects until it declares a budget.",
  ...NO_TRAILS,
};

export function getModeBudget(mode: string | null | undefined): ModeBudget {
  if (!mode) return EMPTY_BUDGET;
  return MODE_BUDGETS[mode as Canvas2DMode] ?? EMPTY_BUDGET;
}

/** True when `mode` opts into `effect`. Unknown modes never do. */
export function allowsEffect(mode: string | null | undefined, effect: LargeAreaEffect): boolean {
  return getModeBudget(mode).effects.includes(effect);
}

/**
 * Phrase flash needs lyrics to mean anything — it is a *lyric* cue. The budget
 * records the opt-in; this adds the second condition so an LRC-less run doesn't
 * fire it on section changes alone.
 */
export function allowsPhraseFlash(mode: string | null | undefined, hasLyrics: boolean): boolean {
  return hasLyrics && allowsEffect(mode, "phraseFlash");
}

/**
 * Every mode's declared effects, capped.
 *
 * Note this validates the *runtime* guarantee — that no frame can activate more
 * than {@link MAX_EFFECTS} — rather than the size of the declaration. A mode may
 * legitimately declare three capabilities (`bars`) because which ones fire is
 * frame-dependent; what must never happen is three firing at once.
 */
export function assertEffectBudget(
  budgets: Record<string, ModeBudget> = MODE_BUDGETS as Record<string, ModeBudget>,
): void {
  const failures: string[] = [];

  for (const [mode, budget] of Object.entries(budgets)) {
    // A mode declaring an effect it has no trail value for would draw with a
    // stale/undefined alpha — catch the mismatch here rather than on screen.
    if (budget.effects.includes("trails") && budget.trailAlpha === null) {
      failures.push(`${mode}: declares "trails" but trailAlpha is null`);
    }
    if (!budget.effects.includes("trails") && budget.trailAlpha !== null) {
      failures.push(`${mode}: sets trailAlpha but does not declare "trails"`);
    }

    // Every declared effect must be a real effect name. A typo ("shockwave",
    // "trail") would otherwise be a silent no-op that looks like the budget is
    // working — and is the one way a bad declaration can slip past the cap,
    // since `EFFECT_PRIORITY` simply would not contain it.
    for (const effect of budget.effects) {
      if (!EFFECT_PRIORITY.includes(effect)) {
        failures.push(`${mode}: unknown effect "${effect}"`);
      }
    }

    // The cap itself: resolving can never return more than MAX_EFFECTS, because
    // `resolveActiveEffects` slices to the cap. Assert it anyway — it is the
    // guarantee the whole module exists to provide, and a future change to the
    // resolver that broke it should fail here rather than on screen.
    for (const beatActive of [false, true]) {
      for (const phraseActive of [false, true]) {
        for (const hasLyrics of [false, true]) {
          const active = resolveActiveEffects(mode, { beatActive, phraseActive, hasLyrics });
          if (active.size > MAX_EFFECTS) {
            failures.push(
              `${mode}: ${active.size} effects active at once (max ${MAX_EFFECTS}): ` +
                `${[...active].join(", ")}`,
            );
          }
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Canvas2D effect budget violated:\n  ${failures.join("\n  ")}\n` +
        `Drop an effect rather than raising MAX_EFFECTS — the ceiling exists ` +
        `because simultaneous large-area effects are what made these modes unreadable.`,
    );
  }
}

/** Modes with more declared effects than the cap. Diagnostic, not a failure. */
export function findWideBudgetModes(
  budgets: Record<string, ModeBudget> = MODE_BUDGETS as Record<string, ModeBudget>,
): string[] {
  return Object.entries(budgets)
    .filter(([, b]) => b.effects.length > MAX_EFFECTS)
    .map(([id]) => id);
}