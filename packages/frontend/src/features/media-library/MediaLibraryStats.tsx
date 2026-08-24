import type { ComponentType } from "react";

type StatIcon = ComponentType<{ className?: string }>;

interface StatCardProps {
  icon: StatIcon;
  /** Full className for the icon wrapper (kept identical to the inline card). */
  iconWrapperClass: string;
  /** Full className for the icon itself. */
  iconClass: string;
  value: number | string;
  label: string;
}

/** Reusable stat summary card (used by the Media Library stats row). */
export function StatCard({
  icon: Icon,
  iconWrapperClass,
  iconClass,
  value,
  label,
}: StatCardProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={iconWrapperClass}>
          <Icon className={iconClass} />
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{value}</p>
          <p className="text-sm text-muted">{label}</p>
        </div>
      </div>
    </div>
  );
}
