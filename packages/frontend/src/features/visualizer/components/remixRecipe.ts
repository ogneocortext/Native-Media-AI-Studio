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

/** Normalize a name to its lowercase-alphanumeric identity (B6). */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True for test-fixture stem directories that must never be preselected.
 *
 * `demucs_test_input` is a ~10 s fixture that sorts first alphabetically,
 * so a fallback that lands on it makes the panel look broken (the plan
 * B6 cautionary tale).
 */
export function isFixtureSource(track: string): boolean {
  const t = track.toLowerCase();
  return t.startsWith("demucs_test_input") || t.startsWith("test_input") || t.startsWith("fixture");
}

/** Match a visualizer track against a stem source directory (B6).
 *
 *  The visualizer holds library *paths* ("Suno-V6-Mini/SunoV6Mini-Ad-Nauseam.m4a")
 *  while separation writes directories keyed by the bare stem name
 *  ("SunoV6Mini-Ad-Nauseam"). Comparing them directly always failed, so the
 *  panel fell back to the first entry alphabetically — which on this machine is
 *  `demucs_test_input`, a 10-second test fixture. The seed then built a
 *  mashup from scratch audio, which looks like the panel being broken.
 *
 *  Order: exact normalized identity, then a substring either way, then the
 *  first non-fixture entry — never a fixture. Returns undefined only when
 *  every candidate is a fixture, which the caller should treat as "nothing
 *  to preselect" rather than picking one anyway.
 */
export function matchSource(
  currentTrack: string | null | undefined,
  tracks: string[],
): string | undefined {
  if (!currentTrack) return undefined;
  const base = (currentTrack.split(/[\\/]/).pop() ?? currentTrack).replace(/\.[^.]+$/, "");
  const target = normalizeKey(base);
  const nonFixture = tracks.filter((t) => !isFixtureSource(t));
  return (
    nonFixture.find((t) => normalizeKey(t) === target) ??
    nonFixture.find((t) => {
      const n = normalizeKey(t);
      return n.includes(target) || target.includes(n);
    }) ??
    nonFixture[0] ??
    undefined
  );
}

/**
 * The first unused variant of `base` (`base`, `base-2`, `base-3`, …).
 *
 * A5: the build name used to be a fixed default with `overwrite` hardcoded
 * true, so a second build silently replaced the first. The panel now suggests
 * the next free name and treats overwrite as an explicit opt-in; this is the
 * suggestion. `taken` is compared case-insensitively because the backend
 * writes the directory verbatim from whatever the request carried.
 */
export function nextFreeName(base: string, taken: readonly string[]): string {
  const cleaned = (base || "").trim() || "mashup";
  const lowerTaken = new Set(taken.map((t) => t.toLowerCase()));
  if (!lowerTaken.has(cleaned.toLowerCase())) return cleaned;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${cleaned}-${n}`;
    if (!lowerTaken.has(candidate.toLowerCase())) return candidate;
  }
  return `${cleaned}-${Date.now()}`;
}

/** Per-stem chip colours for the timeline (A6). */
export const STEM_TIMELINE_COLORS: Record<EditableLayer["stem"], string> = {
  vocals: "bg-rose-400/70",
  drums: "bg-amber-400/70",
  bass: "bg-emerald-400/70",
  other: "bg-sky-400/70",
};

export interface TimelineSegment {
  slotIndex: number;
  bars: number;
  /** Width as a percentage of the whole arrangement. */
  pct: number;
  crossfadeBars: number;
  /** Crossfade into the previous slot, as a percentage of the arrangement. */
  crossfadePct: number;
  /** Distinct stems this slot plays, in STEM_NAMES order. */
  stems: EditableLayer["stem"][];
}

/**
 * Proportional view of the arrangement (A6).
 *
 * A 4-bar and a 32-bar slot used to look identical in the form, so the shape
 * of the song was unreadable. Widths are shares of total bars — the same
 * relationship the render uses, so what the bar shows is what the mix does.
 * Degenerate input (no bars) yields no segments rather than NaN widths.
 */
/** Canonical stem order for the timeline chips (A6). */
const TIMELINE_STEM_ORDER = ["drums", "bass", "vocals", "other"] as const;

export function timelineSegments(slots: EditableSlot[]): TimelineSegment[] {
  const indexed = slots
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(({ slot }) => slot.layers.length > 0 && slot.bars > 0);
  const totalBars = indexed.reduce((n, { slot }) => n + slot.bars, 0);
  if (totalBars <= 0) return [];
  return indexed.map(({ slot, slotIndex }) => {
    // Canonical order, not insertion order: the chips read the same way
    // whichever order the layers happen to be listed in.
    const present = new Set(slot.layers.map((l) => l.stem));
    const stems = TIMELINE_STEM_ORDER.filter((s) => present.has(s)) as EditableLayer["stem"][];
    return {
      // R2: the true slots-array index, not the filtered position — click
      // and drag handlers operate on the slots array, so a filtered index
      // would audition/reorder the wrong slot once an empty slot exists.
      slotIndex,
      bars: slot.bars,
      pct: (slot.bars / totalBars) * 100,
      crossfadeBars: slot.crossfade_bars,
      crossfadePct: (slot.crossfade_bars / totalBars) * 100,
      stems,
    };
  });
}

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
