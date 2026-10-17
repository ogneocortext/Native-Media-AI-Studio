/**
 * Zustand store for the notification center.
 *
 * Tracks recent SSE-backed notifications, unread counts, preferences,
 * and cross-tab sync state. Persists preferences to localStorage.
 */

import { create } from "zustand";
import { sseService } from "../services/sseService";
import {
  fetchNotifications,
  fetchEventsSince,
  NotificationItem,
  NotificationPreferences,
  getNotificationPreferences,
  saveNotificationPreferences,
} from "../services/api/notifications";

export type { NotificationItem, NotificationPreferences };

const MAX_HISTORY = 100;

// Group rules: events matching the same base key are collapsed into one
// notification. The first matching rule wins; later updates replace the
// earlier item rather than appending a new one.
// Rules receive the event payload too, so a grouping key can keep distinct
// variants alive (e.g. health stays collapsed per level, so a critical
// alert is never silently replaced by a later "healthy" event).
const GROUP_RULES: Array<{
  match: RegExp;
  key: (name: string, data: Record<string, unknown> | null) => string;
}> = [
  {
    match: /^job\.progress\.\d+$/,
    key: (name) => name.replace(/\.\d+$/, ""),
  },
  {
    match: /^job\.(queued|started|completed|failed|dead|cancelled)/,
    key: (name) => name.replace(/\.\d+$/, ""),
  },
  {
    match: /^(system\.)?health_changed$/,
    key: (name, data) =>
      `${name}:${String(data?.level ?? data?.status ?? "unknown")}`,
  },
];

function groupKeyFor(
  name: string,
  data: Record<string, unknown> | null,
): string | null {
  for (const rule of GROUP_RULES) {
    if (rule.match.test(name)) {
      return rule.key(name, data);
    }
  }
  return null;
}

interface NotificationState {
  items: NotificationItem[];
  /** Ids the user has read. Note: countUnread recomputes on every mutation,
   * so "mark all read" survives subsequent SSE items. */
  readIds: string[];
  unreadCount: number;
  preferences: NotificationPreferences;
  isPanelOpen: boolean;

  // Actions
  addItem: (item: NotificationItem) => void;
  addItems: (items: NotificationItem[]) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clearAll: () => void;
  setPreferences: (prefs: NotificationPreferences) => void;
  setPanelOpen: (open: boolean) => void;
  loadHistory: () => Promise<void>;
  syncSinceLastId: () => Promise<void>;
  flushOfflineQueue: () => void;
}

function countUnread(items: NotificationItem[], readIds: string[]): number {
  const read = new Set(readIds);
  return items.reduce(
    (count, item) => count + (item.id && !read.has(item.id) ? 1 : 0),
    0,
  );
}

/** Trim readIds so it never outgrows the items it refers to. */
function pruneReadIds(readIds: string[], items: NotificationItem[]): string[] {
  const present = new Set(items.map((item) => item.id).filter(Boolean) as string[]);
  return readIds.filter((id) => present.has(id));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  readIds: [],
  unreadCount: 0,
  preferences: getNotificationPreferences(),
  isPanelOpen: false,

  addItem: (item) => {
    set((state) => {
      const gkey = groupKeyFor(item.type || "", item.data);
      let items = state.items;
      if (gkey) {
        // Replace the most recent item of the same group in place (keeping
        // its id, so an already-read notification stays read), drop any
        // older ones of the same group, and keep nothing pre-existing
        // matching the incoming id.
        const replacedIdx = items.findIndex(
          (existing) => groupKeyFor(existing.type || "", existing.data) === gkey,
        );
        if (replacedIdx >= 0) {
          const updated = { ...item, id: items[replacedIdx].id };
          items = [
            updated,
            ...items.filter(
              (existing, index) =>
                index !== replacedIdx &&
                groupKeyFor(existing.type || "", existing.data) !== gkey &&
                existing.id !== item.id,
            ),
          ];
        } else {
          items = [item, ...items.filter((existing) => existing.id !== item.id)];
        }
      } else {
        // Same id arriving again (reconnect replay, history reload) must
        // update the existing row, never append a duplicate key.
        const idx = items.findIndex((existing) => existing.id === item.id);
        if (idx >= 0) {
          const updated = { ...item, id: items[idx].id };
          items = [updated, ...items.filter((_, i) => i !== idx)];
        } else {
          items = [item, ...items];
        }
      }
      items = items.slice(0, MAX_HISTORY);
      const readIds = pruneReadIds(state.readIds, items);
      return { items, readIds, unreadCount: countUnread(items, readIds) };
    });
  },

  addItems: (incoming) => {
    set((state) => {
      const merged = [...incoming, ...state.items];
      // Exact-id dedupe first (history + live SSE races produce copies).
      const seenIds = new Set<string>();
      const byId = merged.filter((item) => {
        if (item.id && seenIds.has(item.id)) return false;
        if (item.id) seenIds.add(item.id);
        return true;
      });
      // Then group-collapse: newest wins, only the first per group survives.
      const seenGroups = new Set<string>();
      const items = byId
        .filter((item) => {
          const gkey = groupKeyFor(item.type || "", item.data);
          if (!gkey) return true;
          if (seenGroups.has(gkey)) return false;
          seenGroups.add(gkey);
          return true;
        })
        .slice(0, MAX_HISTORY);
      const readIds = pruneReadIds(state.readIds, items);
      return { items, readIds, unreadCount: countUnread(items, readIds) };
    });
  },

  markAllRead: () =>
    set((state) => ({
      readIds: state.items.map((item) => item.id).filter(Boolean) as string[],
      unreadCount: 0,
    })),

  markRead: (id) =>
    set((state) => {
      if (!state.items.some((item) => item.id === id)) return state;
      const readIds = [...new Set([...state.readIds, id])];
      return { readIds, unreadCount: countUnread(state.items, readIds) };
    }),

  clearAll: () => set({ items: [], readIds: [], unreadCount: 0 }),

  setPreferences: (prefs) => {
    saveNotificationPreferences(prefs);
    set({ preferences: prefs });
  },

  setPanelOpen: (open) => set({ isPanelOpen: open }),

  loadHistory: async () => {
    try {
      const items = await fetchNotifications();
      get().addItems(items);
      get().markAllRead();
    } catch (error) {
      console.warn("[notifications] loadHistory failed", error);
    }
  },

  syncSinceLastId: async () => {
    try {
      const lastId = get().items[0]?.id;
      if (!lastId) return;
      const numId = Number(lastId);
      if (Number.isNaN(numId)) return;
      const events = await fetchEventsSince(numId);
      const mapped: NotificationItem[] = events
        .filter((ev) => ev.id && ev.data)
        .map((ev) => ({
          id: ev.id,
          type: (ev.data?.type as string | null) ?? null,
          data: (ev.data?.data as Record<string, unknown> | null) ?? ev.data,
          timestamp: (ev.data?.timestamp as string | null) ?? null,
          priority: ((ev.data?.priority as string) ?? "medium") as NotificationItem["priority"],
        }));
      get().addItems(mapped);
    } catch (error) {
      console.warn("[notifications] syncSinceLastId failed", error);
    }
  },

  flushOfflineQueue: () => {
    const queued = sseService.drainOfflineQueue();
    for (const message of queued) {
      handleIncomingSSE(message, useNotificationStore.getState);
    }
  },
}));

let subscriptions: { unsubMessage: () => void; unsubState: () => void } | null = null;

export function connectNotificationSSE(): void {
  if (subscriptions) return;
  const unsubMessage = sseService.subscribe((message) => {
    handleIncomingSSE(message, useNotificationStore.getState);
  });
  const unsubState = sseService.onStateChange((connected) => {
    if (connected) {
      useNotificationStore.getState().flushOfflineQueue();
    }
  });
  subscriptions = { unsubMessage, unsubState };
  sseService.connect();
}

export function disconnectNotificationSSE(): void {
  subscriptions?.unsubMessage();
  subscriptions?.unsubState();
  subscriptions = null;
  sseService.disconnect();
}

function handleIncomingSSE(
  message: Record<string, unknown>,
  get: () => NotificationState,
) {
  const data = message.data as Record<string, unknown> | undefined;
  if (!data) return;

  const type = message.type as string | undefined;
  const eventType = data.type as string | undefined;
  const name = type || eventType;
  if (!name) return;

  const isNotification = isNotificationEvent(name);
  if (!isNotification) return;

  const prefs = get().preferences;
  if (!matchesPreferences(name, prefs)) return;

  const id = String(data.id || message.id || `${Date.now()}-${Math.random()}`);
  const item: NotificationItem = {
    id,
    type: name,
    data,
    timestamp: (data.timestamp as string | null) ?? new Date().toISOString(),
    priority: ((message.priority || data.priority || "medium") as NotificationItem["priority"]),
  };

  get().addItem(item);
}

function isNotificationEvent(name: string): boolean {
  if (name === "connected" || name === "keepalive") return false;
  if (name.startsWith("job.") || name === "job_update") return true;
  if (name.startsWith("system.")) return true;
  if (name.startsWith("health.")) return true;
  if (name.startsWith("queue.")) return true;
  return false;
}

function matchesPreferences(
  name: string,
  prefs: NotificationPreferences,
): boolean {
  if (name.startsWith("job.failed") || name.startsWith("job.dead")) return prefs.failed;
  if (name.startsWith("job.completed")) return prefs.completed;
  if (name.startsWith("job.cancelled")) return prefs.cancelled;
  if (name.startsWith("job.progress")) return prefs.progress;
  if (name.startsWith("system.")) return prefs.system;
  if (name.startsWith("job.queued") || name.startsWith("job.started")) return true;
  return true;
}
