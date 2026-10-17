/**
 * Canonical stem configuration — the single source of truth for how stems are
 * labelled, coloured, ordered and grouped across the frontend.
 *
 * Previously the frontend had three independent stem lists that disagreed:
 *
 *   - stemMixPresets.STEM_NAMES = ["vocals", "drums", "bass", "other"]
 *   - remixRecipe.TIMELINE_STEM_ORDER = ["drums", "bass", "vocals", "other"]
 *   - StemMixer.STEM_VISUAL_ROLE (vocals-first, no order guarantee)
 *
 * The mixer rendered stems vocals-first while the timeline rendered them
 * drums-first, so the same stem appeared in different places depending on
 * which panel you were in. This module replaces all of them with one list
 * whose order matches the backend (`source_separation.STEM_NAMES =
 * ("vocals", "drums", "bass", "other"`).
 *
 * Each stem carries a colour that the timeline chips and the mixer buttons
 * both use, so a stem's colour means the same thing everywhere.
 */

export type StemKey = "vocals" | "drums" | "bass" | "other";

export interface StemDefinition {
  key: StemKey;
  /** Human-readable label shown in selectors, buttons and headers. */
  label: string;
  /** Tailwind background class used for chips, fader accents and buttons. */
  color: string;
  /** What the stem drives visually (Trend 2 mapping). */
  role: string;
  /** Function group the mixer uses to cluster stems. */
  category: "rhythm" | "lead" | "harmony";
}

/** Canonical order — matches the backend so nothing drifts out of sync. */
export const STEMS: StemDefinition[] = [
  { key: "vocals", label: "Vocals", color: "bg-rose-400/70", role: "lyric kinetic", category: "lead" },
  { key: "drums", label: "Drums", color: "bg-amber-400/70", role: "scale/pulse", category: "rhythm" },
  { key: "bass", label: "Bass", color: "bg-emerald-400/70", role: "camera shake", category: "rhythm" },
  { key: "other", label: "Other", color: "bg-sky-400/70", role: "palette shift", category: "harmony" },
] as const;

/** Stem keys in canonical order. */
export const STEM_KEYS: StemKey[] = STEMS.map((s) => s.key);

/** Lookup a stem's definition by its key. */
export const STEM_BY_KEY: Record<StemKey, StemDefinition> = Object.fromEntries(
  STEMS.map((s) => [s.key, s]),
) as Record<StemKey, StemDefinition>;

/** Category groups, in display order. Each stem appears in exactly one group. */
export const STEM_CATEGORIES = [
  { id: "rhythm", label: "Rhythm", keys: ["drums", "bass"] as StemKey[] },
  { id: "lead", label: "Lead", keys: ["vocals"] as StemKey[] },
  { id: "harmony", label: "Harmony", keys: ["other"] as StemKey[] },
] as const;
