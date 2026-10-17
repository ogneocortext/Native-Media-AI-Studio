/**
 * A/B comparison for the remix panel: pin two arrangements, flip between them.
 *
 * Lives apart from `RemixPanel.tsx` for the same reason `remixRecipe.ts` does:
 * the unit suite deliberately excludes React/CSS/asset imports, so the logic
 * that is worth testing has to be reachable without mounting the component.
 *
 * The model is deliberately small. A pin is a *snapshot* of the whole form -
 * name, BPM and slots - so flipping between pins is a full context switch:
 * what the form shows is what a preview or build renders. There is no merge,
 * no diff and no "apply pin to current", because the iteration loop's natural
 * use is "try the revision, hear it, go back to what I had", and a snapshot
 * answers that without inventing a merge nobody asked for.
 *
 * The key is deliberately not carried: the panel shows it as an advisory
 * (chroma flatness makes a detected key noise), and the recipe model has no
 * key field, so there is nothing in the form to restore.
 */
import type { EditableSlot } from "../remix/remixRecipe";

/** Everything the form holds that a variant must carry to be restorable. */
export interface AbVariant {
  name: string;
  bpm: number;
  slots: EditableSlot[];
}

/** The two pins. `null` means "nothing pinned there yet". */
export interface AbState {
  a: AbVariant | null;
  b: AbVariant | null;
}

export function abInitial(): AbState {
  return { a: null, b: null };
}

/**
 * Store the current arrangement under `which`, leaving the other pin alone.
 *
 * Re-pinning overwrites, and that is the point: the loop is "pin, iterate,
 * pin the other, flip" - a pin you cannot overwrite would force a third slot
 * nobody asked for. The form itself is untouched: pinning captures what you
 * are looking at, it does not navigate.
 *
 * The copy is structural rather than a reference: a pin is a snapshot, and
 * "the form happens not to mutate in place" is not a guarantee worth
 * resting data the user asked to keep on.
 */
export function abPin(state: AbState, which: "a" | "b", variant: AbVariant): AbState {
  return {
    ...state,
    [which]: {
      ...variant,
      slots: variant.slots.map((slot) => ({
        ...slot,
        layers: slot.layers.map((layer) => ({ ...layer })),
      })),
    },
  };
}

/** True when the form is exactly the pinned variant - ids included. */
export function abMatches(variant: AbVariant | null, current: AbVariant): boolean {
  return variant !== null && JSON.stringify(variant) === JSON.stringify(current);
}

/**
 * Which pinned variant the form currently *is*, if any.
 *
 * Equality, not a "last loaded" flag: a flag would keep claiming the form is
 * variant A after the first edit, which is exactly the lie this panel exists
 * to avoid (the same reason the timeline renders from the slots array).
 */
export function abShowing(state: AbState, current: AbVariant): "a" | "b" | null {
  if (abMatches(state.a, current)) return "a";
  if (abMatches(state.b, current)) return "b";
  return null;
}
