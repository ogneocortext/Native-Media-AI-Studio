import { Clock, AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { NotificationItem } from "../../state/notificationStore";

const ICONS: Record<string, typeof Info> = {
  "job.failed": XCircle,
  "job.dead": XCircle,
  "job.completed": CheckCircle2,
  "job.cancelled": AlertTriangle,
  "job.queued": Info,
  "job.started": Info,
  "job.progress": Info,
  "system.": AlertTriangle,
  "health.": Info,
  "queue.": Info,
};

function iconFor(type: string | null) {
  if (!type) return Info;
  for (const [prefix, Icon] of Object.entries(ICONS)) {
    if (type.startsWith(prefix)) return Icon;
  }
  return Info;
}

function priorityClass(priority: NotificationItem["priority"]) {
  return `notification-item--${priority}`;
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function NotificationItem({ item, onRead }: { item: NotificationItem; onRead?: () => void }) {
  const Icon = iconFor(item.type || "");
  const message =
    (item.data?.message as string | undefined) ??
    (item.type ? String(item.type) : "Notification");

  return (
    <div
      className={`notification-item ${priorityClass(item.priority)}`}
      onClick={onRead}
      role="button"
      tabIndex={0}
    >
      <span className="notification-item-icon">
        <Icon size={16} />
      </span>
      <span className="notification-item-body">
        <span className="notification-item-message">{message}</span>
        <span className="notification-item-meta">
          <Clock size={10} />
          {formatTime(item.timestamp)}
        </span>
      </span>
    </div>
  );
}
