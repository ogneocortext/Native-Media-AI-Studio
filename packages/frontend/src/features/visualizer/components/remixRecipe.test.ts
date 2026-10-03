import { describe, it, expect } from "vitest";
import { recipeToEditableSlots, newEditableLayer } from "./remixRecipe";
import type { RemixRecipeSpec } from "../../../services/api/remix";

/**
 * The reopen path converts a wire recipe into panel state. Two things it must not
 * get wrong:
 *
 *  1. Layers must get DISTINCT `__id`s. They are React keys, and a duplicated id
 *     makes React reuse the wrong DOM node - one layer's gain field silently
 *     editing a different layer.
 *  2. Every arrangement field must survive. `gain_db`, `key_shift_semitones` and
 *     `source_start_bar` are what make a reopened mashup equal the one that was
 *     rendered; dropping one rebuilds a different song.
 */
const RECIPE: RemixRecipeSpec = {
  name: "m",
  target_bpm: 144,
  beats_per_bar: 4,
  slots: [
    {
      bars: 4,
      crossfade_bars: 2,
      layers: [
        { track: "A", stem: "drums", gain_db: 0, key_shift_semitones: 0, source_start_bar: 0 },
        { track: "A", stem: "bass", gain_db: -3, key_shift_semitones: 2, source_start_bar: 4 },
        { track: "B", stem: "vocals", gain_db: 1.5, key_shift_semitones: -1, source_start_bar: 8 },
      ],
    },
    {
      bars: 8,
      crossfade_bars: 0,
      layers: [
        { track: "B", stem: "other", gain_db: 0, key_shift_semitones: 0, source_start_bar: 0 },
        { track: "B", stem: "vocals", gain_db: 0, key_shift_semitones: 0, source_start_bar: 0 },
      ],
    },
  ],
};

describe("recipeToEditableSlots", () => {
  it("preserves slot order, bars and crossfade", () => {
    const slots = recipeToEditableSlots(RECIPE);
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.bars)).toEqual([4, 8]);
    expect(slots.map((s) => s.crossfade_bars)).toEqual([2, 0]);
  });

  it("preserves every layer field exactly", () => {
    const flat = recipeToEditableSlots(RECIPE).flatMap((s) => s.layers);
    expect(flat).toHaveLength(5);
    expect(flat[1]).toMatchObject({
      track: "A",
      stem: "bass",
      gain_db: -3,
      key_shift_semitones: 2,
      source_start_bar: 4,
    });
    expect(flat[2]).toMatchObject({ gain_db: 1.5, key_shift_semitones: -1, source_start_bar: 8 });
  });

  it("gives every layer a distinct id", () => {
    const ids = recipeToEditableSlots(RECIPE).flatMap((s) => s.layers.map((l) => l.__id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not reuse ids across two conversions", () => {
    // The panel allows two opens in one session, and a remount re-runs this.
    const a = recipeToEditableSlots(RECIPE).flatMap((s) => s.layers.map((l) => l.__id));
    const b = recipeToEditableSlots(RECIPE).flatMap((s) => s.layers.map((l) => l.__id));
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it("handles an empty recipe without throwing", () => {
    expect(recipeToEditableSlots({ ...RECIPE, slots: [] })).toEqual([]);
  });
});

describe("newEditableLayer", () => {
  it("starts neutral", () => {
    const layer = newEditableLayer("A", "drums");
    expect(layer).toMatchObject({
      track: "A",
      stem: "drums",
      gain_db: 0,
      key_shift_semitones: 0,
      source_start_bar: 0,
    });
    expect(layer.__id).toBeTruthy();
  });

  it("allocates a fresh id each time", () => {
    expect(newEditableLayer("A", "drums").__id).not.toBe(newEditableLayer("A", "drums").__id);
  });
});
