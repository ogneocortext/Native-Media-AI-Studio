import { useEffect, useRef } from "react";

interface UsePollingOptions {
  /** Polling interval in milliseconds */
  intervalMs?: number;
  /** Whether polling is active */
  enabled?: boolean;
  /** Whether to call immediately on mount */
  immediate?: boolean;
}

/**
 * Shared polling hook with automatic cleanup and visibility-aware pausing.
 * When the tab is hidden, polling pauses and resumes on focus.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  { intervalMs = 5000, enabled = true, immediate = true }: UsePollingOptions = {}
) {
  const callbackRef = useRef(callback);

  // Keep callback ref fresh without restarting interval
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    if (immediate) {
      callbackRef.current();
    }

    const id = setInterval(() => {
      callbackRef.current();
    }, intervalMs);

    return () => {
      clearInterval(id);
    };
  }, [enabled, intervalMs, immediate]);
}
