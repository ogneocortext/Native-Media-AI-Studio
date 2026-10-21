import { useCallback, useEffect, useState } from "react";

/**
 * First-run detection for the 5-minute path (plan O3).
 *
 * The flag is the only state the path owns: `nma.firstRunDone` in
 * localStorage. Set when the path completes or is dismissed. Nothing else in
 * the app reads it — see `docs/ux/5-minute-path.md`.
 *
 * Storage access is guarded: Safari private mode and some embedded webviews
 * throw on `localStorage`, and a path that cannot remember is still a path.
 */

export const FIRST_RUN_KEY = "nma.firstRunDone";

/** Read the flag. Returns false when storage is unavailable. */
export function hasCompletedFirstRun(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Write the flag. Returns false when storage is unavailable. */
export function markFirstRunDone(): boolean {
  try {
    window.localStorage.setItem(FIRST_RUN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Clear the flag — used by the "show me again" affordance. */
export function clearFirstRunDone(): void {
  try {
    window.localStorage.removeItem(FIRST_RUN_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

export interface FirstRunDetector {
  /**
   * True while the user has not completed (or dismissed) the path.
   * `undefined` until the first effect runs, so callers can avoid a flash of
   * the wrong content on first paint.
   */
  isFirstRun: boolean | undefined;
  /** Mark the path as done (completion or dismissal). */
  complete: () => void;
  /** Re-open the path later — clears the flag. */
  reset: () => void;
}

/**
 * Hook that reports whether this is the user's first session.
 *
 * The initial value is `undefined` rather than `true`/`false` on purpose:
 * reading localStorage during render would make the value differ between
 * the server-rendered and the hydrated tree.
 */
export function useFirstRunDetector(): FirstRunDetector {
  const [isFirstRun, setIsFirstRun] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setIsFirstRun(!hasCompletedFirstRun());
  }, []);

  const complete = useCallback(() => {
    markFirstRunDone();
    setIsFirstRun(false);
  }, []);

  const reset = useCallback(() => {
    clearFirstRunDone();
    setIsFirstRun(true);
  }, []);

  return { isFirstRun, complete, reset };
}
