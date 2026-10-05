/**
 * Pure state transitions for the Treblo Tag Picker's selection tray.
 *
 * Lives apart from `TrebloTagPicker.tsx` on purpose: the unit suite runs in a node
 * environment and only collects `.test.ts` files, and its config deliberately
 * excludes React/CSS/asset imports. Importing the component to reach one pure
 * function would pull the whole react chain into a unit test for no reason.
 */

/** Upper bound on the tray. Treblo's own style field is finite; past this the
 *  string stops being pasteable in any useful sense. */
export const MAX_SELECTED_TAGS = 100;

const matches = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Click-to-toggle a tag in the selection.
 *
 * Case-insensitive, because the search endpoint is case-insensitive and a user who
 * types `Phonk` then clicks `phonk` must not end up with the tag twice. The first
 * spelling entered is the one kept, since that is what gets pasted.
 */
export function toggleTag(selection: readonly string[], tag: string): string[] {
  const clean = (tag ?? "").trim();
  if (!clean) return [...selection];
  const existing = selection.findIndex((t) => matches(t, clean));
  if (existing >= 0) return selection.filter((_, i) => i !== existing);
  if (selection.length >= MAX_SELECTED_TAGS) return [...selection];
  return [...selection, clean];
}

/**
 * The paste-ready string: comma-joined, selection order preserved.
 *
 * Order is user intent, not noise — it is what they see and what they paste. Do not
 * sort or alphabetise this.
 */
export function tagStringFor(selection: readonly string[]): string {
  return selection.map((t) => t.trim()).filter(Boolean).join(", ");
}

/**
 * Related tags the user has not already selected.
 *
 * A "related" list is mostly tags already in the tray, so offering them again as
 * one-click additions is pure noise.
 */
export function unfilledRelated(
  selection: readonly string[],
  related: readonly string[],
): string[] {
  return related.filter((t) => !selection.some((s) => matches(s, t)));
}
