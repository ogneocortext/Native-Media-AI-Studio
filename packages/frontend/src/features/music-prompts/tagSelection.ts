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


/**
 * How a tag is attested in Suno community use, as decided by the backend.
 *
 * Tier 3 is deliberately NOT badged. It means "not attested in a corpus covering 13
 * genres", which is not the same as "will not work" - measured, `classical` is
 * tier 1 while `male vocalist` is tier 3, and both are ordinary Suno-safe terms.
 * Badging tier 3 as a warning would tell the user something the data does not say.
 */
export type AttestationTier = 1 | 2 | 3;

export interface Attestation {
  tier: AttestationTier;
  key: string;
  label: string;
}

/** Badge text for a tier, or null when the tag should carry no badge at all. */
export function badgeFor(tier: AttestationTier | undefined): string | null {
  switch (tier) {
    case 1:
      return "verified on Suno";
    case 2:
      return "community-used";
    default:
      // Tier 3 and anything unknown: no badge. Absence of evidence is not evidence.
      return null;
  }
}

/**
 * Production phrases worth surfacing next to a selected tag.
 *
 * Never duplicates what is already in the tray, and never suggests a phrase that is
 * also a Treblo tag (the data is disjoint by construction, but the tray may already
 * hold one typed by hand).
 */
export function productionSuggestions(
  selected: readonly string[],
  phrases: readonly string[],
  limit = 8,
): string[] {
  const has = new Set(selected.map((t) => t.trim().toLowerCase()));
  return phrases.filter((p) => !has.has(p.trim().toLowerCase())).slice(0, limit);
}
