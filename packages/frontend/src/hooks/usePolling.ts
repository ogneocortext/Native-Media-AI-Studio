import { useEffect, useRef } from "react";

interface UsePollingOptions {
  /** Polling interval in milliseconds */
  intervalMs?: number;
  /** Whether polling is active */
  enabled?: boolean;
  /** Whether to call immediately on mount */
  immediate?: boolean;
  /** Pause while tab hidden / offline (default true) */
  pauseWhenHidden?: boolean;
  /**
   * Elect a single leader tab per channel via BroadcastChannel +
   * localStorage heartbeat. Followers skip polling and rely on the
   * leader's side effects (store/SSE). Omit to poll in every tab.
   */
  leaderChannel?: string;
  /** Exponential backoff on callback rejection: { maxMs, factor } */
  backoff?: { maxMs?: number; factor?: number };
}

const HEARTBEAT_MS = 2000;
const TAKEOVER_MS = 4500;

function tryAcquireLeader(key: string, id: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.setItem(key, JSON.stringify({ id, ts: Date.now() }));
      return true;
    }
    const parsed = JSON.parse(raw) as { id?: string; ts?: number };
    if (parsed.id === id) return true;
    if (typeof parsed.ts === "number" && Date.now() - parsed.ts < TAKEOVER_MS) return false;
    localStorage.setItem(key, JSON.stringify({ id, ts: Date.now() }));
    return true;
  } catch {
    return true; // private mode — every tab polls, same as before
  }
}

/**
 * Shared polling hook with visibility/online-aware pausing, optional
 * cross-tab leader election, and error backoff.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  {
    intervalMs = 5000,
    enabled = true,
    immediate = true,
    pauseWhenHidden = true,
    leaderChannel,
    backoff,
  }: UsePollingOptions = {}
) {
  const callbackRef = useRef(callback);
  const tabId = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let failures = 0;
    let isLeader = !leaderChannel;
    const leaderKey = leaderChannel ? `poll-leader:${leaderChannel}` : "";
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let bc: BroadcastChannel | null = null;

    const isHidden = () =>
      pauseWhenHidden &&
      (typeof document !== "undefined" && document.hidden);

    const isOffline = () =>
      pauseWhenHidden &&
      typeof navigator !== "undefined" &&
      navigator.onLine === false;

    const checkLeader = () => {
      if (!leaderChannel) return true;
      const won = tryAcquireLeader(leaderKey, tabId.current);
      isLeader = won;
      return won;
    };

    const tick = async () => {
      if (stopped) return;
      if (!checkLeader()) {
        schedule(intervalMs);
        return;
      }
      if (isHidden() || isOffline()) {
        schedule(intervalMs);
        return;
      }
      try {
        await callbackRef.current();
        failures = 0;
        schedule(intervalMs);
      } catch (err) {
        failures += 1;
        const factor = backoff?.factor ?? 2;
        const maxMs = backoff?.maxMs ?? 60000;
        const delay = Math.min(maxMs, intervalMs * Math.pow(factor, failures));
        // Surface once; callers keep their own error state
        console.warn(`[usePolling] tick failed (${failures}x), retry in ${delay}ms`, err);
        schedule(delay);
      }
    };

    const schedule = (ms: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };

    checkLeader();

    if (leaderChannel && typeof BroadcastChannel !== "undefined") {
      try {
        bc = new BroadcastChannel(leaderChannel);
        bc.onmessage = (ev) => {
          if (ev.data?.type === "leader-heartbeat" && ev.data?.id !== tabId.current) {
            // Another leader is alive — back off unless its heartbeat goes stale
            if (isLeader) isLeader = false;
          }
        };
      } catch {
        bc = null;
      }
      heartbeat = setInterval(() => {
        if (isLeader) {
          try {
            localStorage.setItem(leaderKey, JSON.stringify({ id: tabId.current, ts: Date.now() }));
          } catch { /* ignore */ }
          bc?.postMessage({ type: "leader-heartbeat", id: tabId.current });
        } else {
          checkLeader();
        }
      }, HEARTBEAT_MS);
    }

    const onVisibility = () => {
      if (!document.hidden && immediate) {
        // Resume promptly instead of waiting out the full interval
        if (timer) clearTimeout(timer);
        schedule(250);
      }
    };
    const onOnline = () => {
      if (timer) clearTimeout(timer);
      schedule(250);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    if (immediate) {
      // Defer one microtask so mount completes before first fetch
      schedule(0);
    } else {
      schedule(intervalMs);
    }

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      bc?.close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, intervalMs, immediate, pauseWhenHidden, leaderChannel, backoff?.maxMs, backoff?.factor]);
}
