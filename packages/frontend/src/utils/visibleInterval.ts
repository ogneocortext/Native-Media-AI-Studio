/**
 * setInterval for non-React code (zustand stores, services) that should not
 * fire while the tab is hidden. Skips ticks when `document.hidden`, fires
 * once immediately when the tab becomes visible again, and returns a stop
 * function. React components should prefer the `usePolling` hook, which
 * adds backoff and cross-tab leader election on top of the same idea.
 */
export function startVisibleInterval(fn: () => void, ms: number): () => void {
  const tick = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    fn();
  };
  const id = setInterval(tick, ms);
  const onVisible = () => {
    if (typeof document !== "undefined" && !document.hidden) fn();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    clearInterval(id);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}
