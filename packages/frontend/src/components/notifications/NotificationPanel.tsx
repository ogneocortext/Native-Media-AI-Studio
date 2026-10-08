import { X, Settings } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useNotificationStore } from "../../state/notificationStore";
import { NotificationItem } from "./NotificationItem";

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const markRead = useNotificationStore((s) => s.markRead);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleNavigate = (id: string) => {
    markRead(id);
    onClose();
    navigate("/queue");
  };

  return (
    <div className="notification-panel" role="dialog" aria-label="Notifications" ref={panelRef}>
      <div className="notification-panel-header">
        <strong>Notifications</strong>
        <div className="notification-panel-actions">
          <button
            className="notification-panel-settings"
            aria-label="Notification preferences"
            title="Notification preferences"
            onClick={() => {
              onClose();
              navigate("/settings");
            }}
          >
            <Settings size={14} />
          </button>
          <button
            className="notification-panel-close"
            aria-label="Close notifications"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="notification-panel-toolbar">
        <button
          className="notification-panel-mark-all"
          onClick={markAllRead}
          disabled={items.length === 0}
        >
          Mark all read
        </button>
        <span className="notification-panel-count">{items.length} items</span>
      </div>
      <div className="notification-panel-list">
        {items.length === 0 && (
          <div className="notification-panel-empty">No notifications yet</div>
        )}
        {items.map((item) => (
          <NotificationItem
            key={item.id}
            item={item}
            onRead={() => handleNavigate(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
