import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface NotificationItem {
  id: string;
  type: string | null;
  data: Record<string, unknown> | null;
  timestamp: string | null;
  priority: "urgent" | "high" | "medium" | "low";
}

export interface NotificationPreferences {
  progress: boolean;
  completed: boolean;
  failed: boolean;
  cancelled: boolean;
  system: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  push: { enabled: boolean; subscribed: boolean };
}

const STORAGE_KEY = "nma-notification-preferences";

export function getNotificationPreferences(): NotificationPreferences {
  if (typeof window === "undefined") {
    return defaultPreferences();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultPreferences(), ...JSON.parse(raw) };
  } catch {
    // ignore corrupt storage
  }
  return defaultPreferences();
}

export function saveNotificationPreferences(prefs: NotificationPreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function defaultPreferences(): NotificationPreferences {
  return {
    progress: true,
    completed: true,
    failed: true,
    cancelled: true,
    system: true,
    quietHours: { enabled: false, start: "22:00", end: "07:00" },
    push: { enabled: false, subscribed: false },
  };
}

export async function fetchNotifications(limit = 50): Promise<NotificationItem[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(
    `${base}/api/notifications?limit=${encodeURIComponent(String(limit))}`,
    { timeout: 15000 },
  );
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

export async function fetchEventsSince(
  lastId: number,
): Promise<Array<{ id: string; data: Record<string, unknown> | null }>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(
    `${base}/api/events/since?last_id=${encodeURIComponent(String(lastId))}`,
    { timeout: 15000 },
  );
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json();
}

export async function subscribePush(
  subscription: PushSubscriptionJSON,
): Promise<{ status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/notifications/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
    timeout: 15000,
  });
  if (!res.ok) throw new Error("Failed to subscribe push");
  return res.json();
}

export async function unsubscribePush(
  subscription: { endpoint: string },
): Promise<{ status: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/notifications/push/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
    timeout: 15000,
  });
  if (!res.ok) throw new Error("Failed to unsubscribe push");
  return res.json();
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}
