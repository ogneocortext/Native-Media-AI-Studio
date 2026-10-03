/**
 * Panel collapse persistence (studio-quality plan 1.2).
 *
 * Pure localStorage encode/decode kept separate from the React hook so the
 * contract ("default collapsed, anything unrecognized resets to the default")
 * is unit-testable in vitest's node environment — which has no localStorage
 * and no React, per packages/frontend/vitest.config.ts.
 *
 * The visualizer's STEM MIXER and MASTER EQ panels used to render expanded on
 * every load, owning ~40% of the viewport while the canvas — the product's
 * point — starved to a sliver at short heights.
 */

const STORAGE_PREFIX = "nma.visualizer.panel.";

/** localStorage key for a collapsible panel id (e.g. "stem-mixer"). */
export function panelStorageKey(panelId: string): string {
  return STORAGE_PREFIX + panelId;
}

/**
 * Decode a stored panel state.
 *
 * Only the exact tokens "open"/"closed" are honoured; a missing or corrupted
 * value falls back to `defaultOpen` (false = collapsed, the plan's default) so
 * a bad write can never pin a panel in the wrong state.
 */
export function parsePanelOpen(raw: string | null, defaultOpen: boolean): boolean {
  if (raw === "open") return true;
  if (raw === "closed") return false;
  return defaultOpen;
}

/** Encode a panel state for localStorage. */
export function serializePanelOpen(open: boolean): string {
  return open ? "open" : "closed";
}
