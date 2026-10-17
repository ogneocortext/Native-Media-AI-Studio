import { useEffect } from "react";
import { BellOff, CheckCheck, Trash2 } from "lucide-react";
import { useNotificationStore } from "../../state/notificationStore";
import type { NotificationItem } from "../../state/notificationStore";

/** Derive a human-readable title. The backend attaches a plain `message`
 * on most events; fall back to event-specific phrasing, then the raw type. */
function notificationTitle(item: NotificationItem): string {
  const data = item.data ?? null;
  const message = data?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  switch (item.type) {
    case "system.health_changed": {
      const status = typeof data?.status === "string" ? data.status : "changed";
      return `System health: ${status}`;
    }
    default:
      break;
  }
  if (!item.type) return "Notification";
  return item.type
    .replace(/^job\./, "Job ")
    .replace(/\.\d+$/, "")
    .replace(/[._]/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Nicely-named details worth surfacing besides the title. */
const DETAIL_KEYS = ["job_id", "id", "level", "response_time_ms", "status", "message"];

function summaryDetails(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  const out: string[] = [];
  for (const key of DETAIL_KEYS) {
    const value = data[key];
    if (key === "message" && typeof value === "string" && value) continue;
    if (value === undefined || value === null || value === "") continue;
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    out.push(`${key}: ${rendered}`);
  }
  return out;
}

function priorityIcon(item: NotificationItem): "urgent" | "high" | "normal" {
  if (item.priority === "urgent") return "urgent";
  if (item.priority === "high") return "high";
  return "normal";
}

export function NotificationsPage() {
  const items = useNotificationStore((s) => s.items);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const loadHistory = useNotificationStore((s) => s.loadHistory);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="notifications-page">
      <div className="notifications-page-header">
        <div>
          <h1>Notifications</h1>
          <p className="text-muted text-sm">
            {items.length === 0
              ? "Job and system events appear here."
              : `${items.length} event${items.length === 1 ? "" : "s"}${unreadCount > 0 ? ` · ${unreadCount} unread` : ""}`}
          </p>
        </div>
        <div className="notifications-page-actions">
          <button
            className="btn btn-secondary"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            title="Mark every notification as read"
          >
            <CheckCheck size={14} />
            Mark all read
          </button>
          <button
            className="btn btn-secondary"
            onClick={clearAll}
            disabled={items.length === 0}
            title="Remove all notifications from this list"
          >
            <Trash2 size={14} />
            Clear all
          </button>
        </div>
      </div>
      <div className="notifications-page-list">
        {items.length === 0 && (
          <div className="notifications-page-empty">
            <BellOff size={32} aria-hidden />
            <p>No notifications yet</p>
            <p className="text-muted text-sm">
              Failed renders and health changes will show up here automatically.
            </p>
          </div>
        )}
        {items.map((item) => {
          const priority = priorityIcon(item);
          const summary = summaryDetails(item.data);
          return (
            <div
              key={item.id}
              className={`notification-item notification-item--full notification-item--${priority}`}
            >
              <div className="notification-item-full-body">
                <div className="notification-item-full-head">
                  <span className="notification-item-type-chip">
                    {item.type ?? "event"}
                  </span>
                  {item.timestamp && (
                    <span className="notification-item-meta">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="notification-item-message">
                  {notificationTitle(item)}
                </div>
                {summary.length > 0 && (
                  <div className="notification-item-summary">{summary.join(" · ")}</div>
                )}
                {item.data && (
                  <details className="notification-item-details">
                    <summary>Raw event data</summary>
                    <pre className="notification-item-data">
                      {JSON.stringify(item.data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
