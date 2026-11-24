/**
 * Shared presence roster — the single client-side copy of
 * GET /api/logs/presence.
 *
 * Every presence surface (the app-shell chips in Presence.tsx, the
 * Voice Live header pill, anything added later) reads this store, so all
 * of them always agree: one poller, one cached roster, subscribers
 * notified on each successful fetch. Backend failures keep the last
 * known roster rather than blanking the badges.
 */

import { useSyncExternalStore } from "react";
import {
  getLogPresence,
  type PresencePerson,
  type PresenceRoster,
} from "../../services/api";

const POLL_MS = 15000;
/** "working" = real activity within the last 15 minutes (same window the
 *  backend chip status uses). */
export const PRESENCE_WORKING_WINDOW_SECONDS = 900;

let roster: PresenceRoster | null = null;
let pollTimer: number | null = null;
const listeners = new Set<() => void>();

async function poll(): Promise<void> {
  try {
    const next = await getLogPresence();
    roster = next;
    for (const l of listeners) l();
  } catch {
    /* backend briefly unavailable — keep last known roster */
  }
}

function ensurePolling(): void {
  if (pollTimer != null) return;
  void poll();
  pollTimer = window.setInterval(() => void poll(), POLL_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensurePolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollTimer != null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

function getSnapshot(): PresenceRoster | null {
  return roster;
}

/** Subscribe to the shared presence roster (null until first fetch). */
export function usePresenceRoster(): PresenceRoster | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export type PresenceStatus = "working" | "idle" | "unavailable";

/** Status for one roster person — shared so every surface agrees. */
export function presenceStatusFor(person: PresencePerson | null): PresenceStatus {
  if (!person || person.unavailable) return "unavailable";
  const seconds = person.seconds_since;
  if (seconds != null && seconds >= 0 && seconds <= PRESENCE_WORKING_WINDOW_SECONDS) {
    return "working";
  }
  return "idle";
}
