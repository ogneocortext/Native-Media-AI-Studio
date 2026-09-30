import { useEffect } from "react";
import { useNotificationStore } from "../../state/notificationStore";

export function NotificationsPage() {
  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const loadHistory = useNotificationStore((s) => s.loadHistory);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="notifications-page">
      <div className="notifications-page-header">
        <h1>Notifications</h1>
        <button className="button button-secondary" onClick={markAllRead}>
          Mark all read
        </button>
      </div>
      <div className="notifications-page-list">
        {items.length === 0 && (
          <div className="notifications-page-empty">No notifications yet</div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={`notification-item notification-item--full ${item.priority ? `notification-item--${item.priority}` : ""}`}
          >
            <div className="notification-item-message">
              {(item.data?.message as string | undefined) ??
                (item.type || "Notification")}
            </div>
            {item.timestamp && (
              <div className="notification-item-meta">
                {new Date(item.timestamp).toLocaleString()}
              </div>
            )}
            {item.data && (
              <pre className="notification-item-data">
                {JSON.stringify(item.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
