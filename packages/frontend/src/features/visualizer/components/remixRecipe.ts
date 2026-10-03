/**
 * Conversions between a wire-format remix recipe and the panel's editable state.
 *
 * Lives apart from `RemixPanel.tsx` on purpose: the unit suite runs in a node
 * environment and only collects `.test.ts` files, and its config deliberately
 * excludes React/CSS/asset imports. Importing the component to reach one pure
 * function would pull the whole react + lucide chain into a unit test for no
 * reason, so the logic is here and the component consumes it.
 */
import type { RemixRecipeSpec, RemixSlotSpec } from "../../../services/api/remix";

/** A layer with the UI-only identity field attached. */
export type EditableLayer = RemixSlotSpec["layers"][number] & { __id: string };
/** A slot whose layers carry their keys. */
export type EditableSlot = Omit<RemixSlotSpec, "layers"> & { layers: EditableLayer[] };

/**
 * Monotonic layer-id source. Module-level so ids stay unique across two opens in
 * one session, which the panel permits.
 */
let layerSeq = 0;

export function nextLayerId(): string {
  return `L${layerSeq++}`;
}

export function newEditableLayer(track: string, stem: EditableLayer["stem"]): EditableLayer {
  return {
    __id: nextLayerId(),
    track,
    stem,
    gain_db: 0,
    key_shift_semitones: 0,
    source_start_bar: 0,
  };
}

/**
 * Rebuild editable slot state from a recipe that arrived over the wire.
 *
 * Layers must each get a *distinct* `__id`: they are React keys, and a duplicated
 * id makes React reuse the wrong DOM node, which surfaces as one layer's controls
 * editing a different layer's values. Every other field is copied verbatim -
 * `gain_db`, `key_shift_semitones` and `source_start_bar` are what make a reopened
 * mashup equal the one that was rendered.
 */
export function recipeToEditableSlots(recipe: RemixRecipeSpec): EditableSlot[] {
  return recipe.slots.map((slot: RemixSlotSpec) => ({
    bars: slot.bars,
    crossfade_bars: slot.crossfade_bars,
    layers: slot.layers.map((layer) => ({ ...layer, __id: nextLayerId() })),
  }));
}
