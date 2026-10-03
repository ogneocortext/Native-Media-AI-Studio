import { describe, it, expect } from "vitest";
import {
  CANVAS_2D_MODES,
  CANVAS_2D_MODE_LABELS,
  CANVAS_2D_MODE_SHORT_LABELS,
  shortModeLabel,
} from "./visualizerHelpers";
import {
  allowsEffect,
  allowsPhraseFlash,
  assertEffectBudget,
  EFFECT_PRIORITY,
  findWideBudgetModes,
  getModeBudget,
  MAX_EFFECTS,
  MODE_BUDGETS,
  resolveActiveEffects,
  VIGNETTE_ALPHA_CEILING,
  type Canvas2DMode,
} from "./canvas2dModeBudget";

/**
 * Spec: docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md
 * ("The visual problem: no effect hierarchy" + recommended fix #1).
 *
 * The central claim under test is the one the diagnosis doc makes: before this
 * budget, all four global effects drew in every mode, and the fix is a cap of
 * two. If a future mode quietly re-exceeds that, the modes go unreadable again.
 */

const ALL_CONDITIONS = { hasLyrics: true, beatActive: true, phraseActive: true };
const NO_CONDITIONS = { hasLyrics: false, beatActive: false, phraseActive: false };
const MODES = Object.keys(MODE_BUDGETS) as Canvas2DMode[];

/**
 * Cross-module consistency — the bug class that produced the `aurora` outage.
 *
 * Four separate copies of the mode list existed at one point. `aurora` was fully
 * implemented and fully budgeted but missing from the picker's list, so a user
 * could never select it; a Playwright run confirmed the mode renders correctly
 * when set through the test harness, which is exactly how dead UI survives.
 *
 * These tests compare the budget against the canonical list rather than against a
 * hardcoded count, so the next added mode fails here rather than in review.
 */
describe("mode list consistency (the aurora outage)", () => {
  it("budgets exactly the modes the picker offers, no more and no fewer", () => {
    expect([...MODES].sort()).toEqual([...CANVAS_2D_MODES].sort());
  });

  it("has a label for every pickable mode", () => {
    // A mode in CANVAS_2D_MODES with no label renders a blank <option>.
    for (const m of CANVAS_2D_MODES) {
      expect(CANVAS_2D_MODE_LABELS[m]).toBeTruthy();
    }
  });

  it("has no label for a mode that is not pickable", () => {
    expect(Object.keys(CANVAS_2D_MODE_LABELS).sort()).toEqual([...CANVAS_2D_MODES].sort());
  });

  it("keeps aurora reachable — the regression this file exists for", () => {
    // Explicit so the failure names the actual defect rather than a count mismatch.
    expect(CANVAS_2D_MODES).toContain("aurora");
    expect(MODE_BUDGETS).toHaveProperty("aurora");
  });

  it("budgets every pickable mode", () => {
    for (const m of CANVAS_2D_MODES) {
      expect(getModeBudget(m)).toBeDefined();
      expect(getModeBudget(m).rationale.length).toBeGreaterThan(10);
    }
  });

  it("offers a short label for every pickable mode too", () => {
    // The compact "More" picker used to inline its own options. It shipped
    // `value="stereo-split-bands"` — a value that is not a real mode, so
    // selecting it set state to something no branch handles — and omitted
    // `aurora` entirely.
    expect(Object.keys(CANVAS_2D_MODE_SHORT_LABELS).sort()).toEqual([...CANVAS_2D_MODES].sort());
  });

  it("contains no invented mode values", () => {
    // Guards the "stereo-split-bands" class of typo: any option value that is
    // not in CANVAS_2D_MODES is a dead selection.
    const known = new Set<string>(CANVAS_2D_MODES);
    for (const label of [
      ...Object.keys(CANVAS_2D_MODE_LABELS),
      ...Object.keys(CANVAS_2D_MODE_SHORT_LABELS),
    ]) {
      expect(known.has(label)).toBe(true);
    }
    expect(known.has("stereo-split-bands")).toBe(false);
  });

  it("falls back to a real label for an unknown mode", () => {
    expect(shortModeLabel("nope" as never)).toBeTruthy();
  });
});

describe("the budget table", () => {
  it("covers every mode the visualizer can render", () => {
    expect(MODES.length).toBe(CANVAS_2D_MODES.length);
    for (const m of MODES) {
      expect(getModeBudget(m)).toBeDefined();
    }
  });

  it("passes its own validator", () => {
    // The single most important assertion: this is the "no more than 2
    // simultaneous large-area effects" guarantee.
    expect(() => assertEffectBudget()).not.toThrow();
  });

  it("rejects a mode that declares trails without a trail alpha", () => {
    const bad = {
      test: {
        effects: ["trails" as const],
        rationale: "x",
        trailAlpha: null,
        trailAlphaReduced: null,
      },
    };
    expect(() => assertEffectBudget(bad)).toThrow(/trailAlpha/);
  });

  it("rejects a mode that sets a trail alpha without declaring trails", () => {
    const bad = {
      test: { effects: [] as const, rationale: "x", trailAlpha: 0x14, trailAlphaReduced: 0x08 },
    };
    expect(() => assertEffectBudget(bad)).toThrow(/trailAlpha/);
  });

  it("rejects a misspelled effect name", () => {
    // "shockwave" instead of "shockwaves" would be a silent no-op that looks
    // like the budget is working, because EFFECT_PRIORITY would just not match.
    const bad = {
      test: {
        effects: ["shockwave" as never],
        rationale: "x",
        trailAlpha: null,
        trailAlphaReduced: null,
      },
    };
    expect(() => assertEffectBudget(bad)).toThrow(/unknown effect/);
  });
});

describe("resolveActiveEffects — the cap", () => {
  it.each(MODES)("%s never activates more than MAX_EFFECTS at once", (mode) => {
    // The worst case is every conditional firing on the same frame.
    const active = resolveActiveEffects(mode, ALL_CONDITIONS);
    expect(active.size).toBeLessThanOrEqual(MAX_EFFECTS);
  });

  it.each(MODES)("%s activates only its steady-state effects on a quiet frame", (mode) => {
    // trails and beatVignette are steady-state, so a quiet frame still has
    // them; the *event* effects (shockwaves, phraseFlash) are what gate out.
    const active = resolveActiveEffects(mode, NO_CONDITIONS);
    expect(active.has("shockwaves")).toBe(false);
    expect(active.has("phraseFlash")).toBe(false);
    expect(active.size).toBeLessThanOrEqual(MAX_EFFECTS);
  });

  it("gives a mode with no steady-state effects nothing on a quiet frame", () => {
    expect(resolveActiveEffects("aurora", NO_CONDITIONS).size).toBe(0);
    expect(resolveActiveEffects("a-new-mode", NO_CONDITIONS).size).toBe(0);
  });

  it("keeps the highest-priority effects when several fire", () => {
    // bars declares shockwaves + phraseFlash + beatVignette; with all three
    // firing, the two loudest survive and the ambient vignette is dropped.
    const active = resolveActiveEffects("bars", ALL_CONDITIONS);
    expect(active.size).toBe(MAX_EFFECTS);
    expect(active.has("shockwaves")).toBe(true);
    expect(active.has("phraseFlash")).toBe(true);
    expect(active.has("beatVignette")).toBe(false);
  });

  it("respects an explicit cap override", () => {
    const active = resolveActiveEffects("bars", ALL_CONDITIONS, 1);
    expect(active.size).toBe(1);
    expect(active.has("shockwaves")).toBe(true);
  });

  it("treats a zero cap as zero effects", () => {
    expect(resolveActiveEffects("bars", ALL_CONDITIONS, 0).size).toBe(0);
  });

  it("orders EFFECT_PRIORITY as documented", () => {
    expect(EFFECT_PRIORITY).toEqual(["shockwaves", "phraseFlash", "trails", "beatVignette"]);
  });
});

describe("resolveActiveEffects — gating conditions", () => {
  it("does not flash a phrase without lyrics", () => {
    // A phrase flash with no LRC loaded is a flash with no meaning.
    const active = resolveActiveEffects("bars", {
      hasLyrics: false,
      beatActive: false,
      phraseActive: true,
    });
    expect(active.has("phraseFlash")).toBe(false);
  });

  it("does not spawn shockwaves off-beat", () => {
    const active = resolveActiveEffects("bars", {
      hasLyrics: true,
      beatActive: false,
      phraseActive: false,
    });
    expect(active.has("shockwaves")).toBe(false);
  });

  it("keeps trails and vignette when they are the mode's steady state", () => {
    // These two are always-on effects, so they survive a quiet frame.
    for (const mode of ["waveform", "particles"] as Canvas2DMode[]) {
      const active = resolveActiveEffects(mode, NO_CONDITIONS);
      expect(active.has("trails")).toBe(true);
      expect(active.has("beatVignette")).toBe(true);
    }
  });
});

describe("per-mode allocations", () => {
  it("keeps trails only on particles and waveform", () => {
    // Diagnosis doc fix #1: "Keep trails only on `particles` and `waveform`."
    const withTrails = MODES.filter((m) => allowsEffect(m, "trails")).sort();
    expect(withTrails).toEqual(["particles", "waveform"]);
  });

  it("keeps shockwaves only on beat-forward modes", () => {
    // "Keep shockwaves only on beat-forward modes (bars, radial); remove from
    // aurora, spectrogram, lissajous, constellation."
    const withShockwaves = MODES.filter((m) => allowsEffect(m, "shockwaves")).sort();
    expect(withShockwaves).toEqual(["bars", "radial"]);
  });

  it("removes the global flash and vignette from aurora", () => {
    // The diagnosis calls aurora out specifically: it draws its own flash and
    // vignette, so the global stack doubled both.
    expect(allowsEffect("aurora", "phraseFlash")).toBe(false);
    expect(allowsEffect("aurora", "beatVignette")).toBe(false);
    expect(getModeBudget("aurora").effects).toEqual([]);
  });

  it("requires lyrics as well as the opt-in for phrase flash", () => {
    expect(allowsPhraseFlash("bars", true)).toBe(true);
    expect(allowsPhraseFlash("bars", false)).toBe(false);
  });

  it("gives aurora no trails, since it draws its own gradient", () => {
    expect(getModeBudget("aurora").trailAlpha).toBeNull();
  });

  it("gives every budget a rationale", () => {
    // A budget nobody can justify is one nobody can revise later.
    for (const mode of MODES) {
      expect(getModeBudget(mode).rationale.length).toBeGreaterThan(10);
    }
  });
});

describe("unknown modes", () => {
  it("gives an unknown mode no effects", () => {
    // The diagnosis doc forbids adding a 14th mode until the budget exists.
    // The strongest version: an undeclared mode is inert, not given the old stack.
    expect(getModeBudget("a-new-mode").effects).toEqual([]);
    expect(resolveActiveEffects("a-new-mode", ALL_CONDITIONS).size).toBe(0);
  });

  it.each([undefined, null, "", "BARS"])("handles %p without throwing", (mode) => {
    expect(() => getModeBudget(mode)).not.toThrow();
  });

  it("still resolves a correctly-cased known mode", () => {
    expect(getModeBudget("bars")).toBe(MODE_BUDGETS.bars);
  });
});

describe("VIGNETTE_ALPHA_CEILING", () => {
  it("is half the previous 0.45", () => {
    // The diagnosis doc: "Beat vignette: halve the alpha ceiling globally, then
    // re-evaluate."
    expect(VIGNETTE_ALPHA_CEILING).toBeCloseTo(0.225, 6);
  });

  it("keeps peak vignette opacity below the old ceiling", () => {
    expect(VIGNETTE_ALPHA_CEILING).toBeLessThan(0.45);
  });
});

describe("findWideBudgetModes", () => {
  it("reports bars as declaring more than the cap", () => {
    // Diagnostic only — bars legitimately declares 3 and resolves to 2 at runtime.
    // This is the distinction assertEffectBudget's worst-case check relies on.
    expect(findWideBudgetModes()).toContain("bars");
  });
});