/**
 * Shared pending-audio handoff between Dashboard and MusicVideoWizard.
 *
 * SPA navigation via react-router preserves `window`, so an in-memory slot
 * survives `navigate("/music-video-wizard")`. File objects cannot go through
 * sessionStorage, so only the file *name* is persisted there as a hint.
 */

const PENDING_NAME_KEY = "__pendingAudioName";

type WindowWithPending = Window & { __pendingAudioFile?: File };

function getWindow(): WindowWithPending | null {
  if (typeof window === "undefined") return null;
  return window as WindowWithPending;
}

export function setPendingAudioFile(file: File): void {
  const w = getWindow();
  if (w) w.__pendingAudioFile = file;
  try {
    sessionStorage.setItem(PENDING_NAME_KEY, file.name);
  } catch {
    /* private mode — ignore */
  }
}

/** Peek without consuming (e.g. to show "resume with X" hints). */
export function peekPendingAudioFile(): File | null {
  return getWindow()?.__pendingAudioFile ?? null;
}

export function peekPendingAudioName(): string | null {
  try {
    return sessionStorage.getItem(PENDING_NAME_KEY);
  } catch {
    return null;
  }
}

/** Take the file exactly once — clears both the memory slot and the hint. */
export function consumePendingAudioFile(): File | null {
  const w = getWindow();
  const file = w?.__pendingAudioFile ?? null;
  if (w) delete w.__pendingAudioFile;
  try {
    sessionStorage.removeItem(PENDING_NAME_KEY);
  } catch {
    /* ignore */
  }
  return file ?? null;
}

export function clearPendingAudio(): void {
  const w = getWindow();
  if (w) delete w.__pendingAudioFile;
  try {
    sessionStorage.removeItem(PENDING_NAME_KEY);
  } catch {
    /* ignore */
  }
}
