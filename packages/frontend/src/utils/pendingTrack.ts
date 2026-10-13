/**
 * Shared pending-track handoff between Media Library and feature pages.
 *
 * Unlike pendingAudio.ts (which carries a File object for Dashboard→Wizard),
 * this slot carries only a filename string so any page can resume work
 * on an existing output/audio file without re-uploading.
 *
 * It also carries a *remix recipe* handoff (`setPendingRemixRecipe`), which is a
 * different shape of thing: not "load this track" but "reopen this arrangement".
 */
import type { RemixRecipeSpec } from "../services/api/remix";

const PENDING_TRACK_KEY = "__pendingTrackFilename";

type WindowWithPendingTrack = Window & {
  __pendingTrackFilename?: string;
  __pendingRemixRecipe?: RemixRecipeSpec | null;
  __pendingRemixRecipeSource?: string | null;
};

function getWindow(): WindowWithPendingTrack | null {
  if (typeof window === "undefined") return null;
  return window as WindowWithPendingTrack;
}

const KEY = "__pendingRemixRecipe";
const KEY_SOURCE = "__pendingRemixRecipeSource";

/**
 * Hand a rendered mashup's recipe to the Visualizer's Remix Panel.
 *
 * `sourceTrack` records which track the panel is currently showing, so the panel
 * can tell "reopened into the track I was already on" apart from "reopened into
 * something else". Without it the panel re-seeds its source selectors and silently
 * discards the arrangement the user asked to reopen.
 */
export function setPendingRemixRecipe(
  recipe: RemixRecipeSpec,
  sourceTrack?: string | null,
): void {
  const w = getWindow();
  if (w) {
    w.__pendingRemixRecipe = recipe;
    w.__pendingRemixRecipeSource = sourceTrack ?? null;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(recipe));
    if (sourceTrack) sessionStorage.setItem(KEY_SOURCE, sourceTrack);
  } catch {
    /* private mode — ignore */
  }
}

/** Read the pending recipe without clearing it, plus the track it came from. */
export function peekPendingRemixRecipe(): {
  recipe: RemixRecipeSpec | null;
  sourceTrack: string | null;
} {
  try {
    const raw = sessionStorage.getItem(KEY);
    const source = sessionStorage.getItem(KEY_SOURCE);
    if (!raw) return { recipe: null, sourceTrack: null };
    return { recipe: JSON.parse(raw) as RemixRecipeSpec, sourceTrack: source };
  } catch {
    return { recipe: null, sourceTrack: null };
  }
}

/** Take the pending recipe, clearing both slots. */
export function consumePendingRemixRecipe(): {
  recipe: RemixRecipeSpec | null;
  sourceTrack: string | null;
} {
  const w = getWindow();
  const pending: { recipe: RemixRecipeSpec | null; sourceTrack: string | null } =
    w?.__pendingRemixRecipe
      ? { recipe: w.__pendingRemixRecipe, sourceTrack: w.__pendingRemixRecipeSource ?? null }
      : peekPendingRemixRecipe();
  if (w) {
    delete w.__pendingRemixRecipe;
    delete w.__pendingRemixRecipeSource;
  }
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY_SOURCE);
  } catch {
    /* private mode — ignore */
  }
  return pending;
}

export function setPendingTrack(filename: string): void {
  const w = getWindow();
  if (w) w.__pendingTrackFilename = filename;
  try {
    sessionStorage.setItem(PENDING_TRACK_KEY, filename);
  } catch {
    /* private mode — ignore */
  }
}

export function peekPendingTrack(): string | null {
  try {
    return sessionStorage.getItem(PENDING_TRACK_KEY);
  } catch {
    return null;
  }
}

export function consumePendingTrack(): string | null {
  const w = getWindow();
  const filename = w?.__pendingTrackFilename ?? null;
  if (w) delete w.__pendingTrackFilename;
  try {
    sessionStorage.removeItem(PENDING_TRACK_KEY);
  } catch {
    /* ignore */
  }
  return filename;
}

export function clearPendingTrack(): void {
  const w = getWindow();
  if (w) delete w.__pendingTrackFilename;
  try {
    sessionStorage.removeItem(PENDING_TRACK_KEY);
  } catch {
    /* ignore */
  }
}

// ─── pending "open the remix panel" intent ─────────────────────────────────
//
// A1: the Remix Panel renders collapsed (it sits two levels below the
// Visualizer's transport and squeezed the canvas out of the viewport when
// expanded by default), so a handoff that only loads the track still leaves
// the user hunting for the panel. This flag carries the *intent* to expand
// it, in the same window+sessionStorage shape as the other handoffs.

const PENDING_REMIX_OPEN_KEY = "__pendingRemixOpen";

type WindowWithRemixOpen = Window & { __pendingRemixOpen?: boolean };

export function setPendingRemixOpen(): void {
  const w = (typeof window === "undefined" ? null : window) as WindowWithRemixOpen | null;
  if (w) w.__pendingRemixOpen = true;
  try {
    sessionStorage.setItem(PENDING_REMIX_OPEN_KEY, "1");
  } catch {
    /* private mode — ignore */
  }
}

/** Take the intent (clearing both slots), or false when there is none. */
export function consumePendingRemixOpen(): boolean {
  const w = (typeof window === "undefined" ? null : window) as WindowWithRemixOpen | null;
  const pending = Boolean(w?.__pendingRemixOpen) || sessionStorageHas(PENDING_REMIX_OPEN_KEY);
  if (w) delete w.__pendingRemixOpen;
  try {
    sessionStorage.removeItem(PENDING_REMIX_OPEN_KEY);
  } catch {
    /* private mode — ignore */
  }
  return pending;
}

function sessionStorageHas(key: string): boolean {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
