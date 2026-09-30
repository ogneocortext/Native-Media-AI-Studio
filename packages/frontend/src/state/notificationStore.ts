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

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  preferences: NotificationPreferences;
  isPanelOpen: boolean;

  // Actions
  addItem: (item: NotificationItem) => void;
  addItems: (items: NotificationItem[]) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  setPreferences: (prefs: NotificationPreferences) => void;
  setPanelOpen: (open: boolean) => void;
  loadHistory: () => Promise<void>;
  syncSinceLastId: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  preferences: getNotificationPreferences(),
  isPanelOpen: false,

  addItem: (item) => {
    set((state) => {
      const exists = state.items.some((existing) => existing.id === item.id);
      if (exists) return state;
      const items = [item, ...state.items].slice(0, MAX_HISTORY);
      const unreadCount = state.unreadCount + (item.id ? 1 : 0);
      return { items, unreadCount };
    });
  },

  addItems: (items) => {
    set((state) => {
      const existingIds = new Set(state.items.map((i) => i.id));
      const merged = [
        ...items.filter((i) => !existingIds.has(i.id)),
        ...state.items,
      ].slice(0, MAX_HISTORY);
      return { items: merged };
    });
  },

  markAllRead: () => set({ unreadCount: 0 }),

  markRead: (id) =>
    set((state) => {
      const unreadCount = state.items.some((i) => i.id === id)
        ? Math.max(0, state.unreadCount - 1)
        : state.unreadCount;
      return { unreadCount };
    }),

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
}));

let subscriptions: { unsubMessage: () => void; unsubState: () => void } | null = null;

export function connectNotificationSSE(): void {
  if (subscriptions) return;
  const unsubMessage = sseService.subscribe((message) => {
    handleIncomingSSE(message, useNotificationStore.getState);
  });
  const unsubState = sseService.onStateChange(() => {
    // Connection state changes don't mutate notification state directly,
    // but listeners can subscribe via the store.
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
