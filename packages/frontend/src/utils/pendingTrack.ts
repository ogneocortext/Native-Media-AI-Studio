/**
 * Shared pending-track handoff between Media Library and feature pages.
 *
 * Unlike pendingAudio.ts (which carries a File object for Dashboard→Wizard),
 * this slot carries only a filename string so any page can resume work
 * on an existing output/audio file without re-uploading.
 */

const PENDING_TRACK_KEY = "__pendingTrackFilename";

type WindowWithPendingTrack = Window & { __pendingTrackFilename?: string };

function getWindow(): WindowWithPendingTrack | null {
  if (typeof window === "undefined") return null;
  return window as WindowWithPendingTrack;
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
