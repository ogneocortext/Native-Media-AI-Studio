import { Bell, BellOff } from "lucide-react";
import { useNotificationStore } from "../../state/notificationStore";
import { NotificationPanel } from "./NotificationPanel";

export function NotificationBell() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const isPanelOpen = useNotificationStore((s) => s.isPanelOpen);
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen);

  return (
    <div className="notification-bell-wrap">
      <button
        className={`notification-bell${isPanelOpen ? " notification-bell--open" : ""}`}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        title={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => setPanelOpen(!isPanelOpen)}
      >
        {unreadCount > 0 ? <Bell size={18} /> : <BellOff size={18} />}
        {unreadCount > 0 && (
          <span className="notification-bell-badge" aria-hidden>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {isPanelOpen && <NotificationPanel onClose={() => setPanelOpen(false)} />}
    </div>
  );
}
