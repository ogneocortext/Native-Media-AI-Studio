import React from "react";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getStatusStyle = (s: string) => {
    switch (s) {
      case "completed":
      case "healthy":
      case "connected":
      case "online":
        return { dot: "status-healthy", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" };
      case "running":
      case "degraded":
      case "warning":
        return { dot: "status-degraded", text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" };
      case "failed":
      case "offline":
      case "error":
      case "cancelled":
        return { dot: "status-offline", text: "text-red-400", bg: "bg-red-500/10 border-red-500/20" };
      case "pending":
      case "queued":
        return { dot: "bg-sky-400", text: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/20" };
      case "processing":
        return { dot: "bg-violet-400", text: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" };
      default:
        return { dot: "bg-gray-400", text: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/20" };
    }
  };

  const style = getStatusStyle(status);

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${style.bg} ${style.text}`}>
      <span className={`status-dot ${style.dot}`} />
      {status.replace("_", " ")}
    </span>
  );
}

interface ProgressBarProps {
  progress: number;
  showPercentage?: boolean;
  size?: "sm" | "md" | "lg";
}

export function ProgressBar({ progress, showPercentage = false, size = "md" }: ProgressBarProps) {
  const heightClass = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";
  return (
    <div className="flex items-center gap-3">
      <div className={`progress-bar ${heightClass} flex-1`}>
        <div className="progress-fill" style={{ width: `${Math.min(progress * 100, 100)}%` }} />
      </div>
      {showPercentage && (
        <span className="text-xs text-muted font-medium min-w-[36px] text-right">
          {Math.round(progress * 100)}%
        </span>
      )}
    </div>
  );
}

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  headerActions?: React.ReactNode;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
  glow?: boolean;
}

export function Card({ title, children, className = "", headerActions, icon, style, glow = false }: CardProps) {
  return (
    <div className={`card ${glow ? "card-glow" : ""} ${className}`} style={style}>
      {title && (
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {icon && <span className="text-primary">{icon}</span>}
            <h3 className="card-title text-base">{title}</h3>
          </div>
          {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
}

export function LoadingSpinner({ size = "md" }: LoadingSpinnerProps) {
  const sizeClasses = { sm: "w-4 h-4", md: "w-8 h-8", lg: "w-12 h-12" };
  return (
    <div className={`${sizeClasses[size]} rounded-full border-2 border-primary/30 border-t-primary animate-spin-slow`} />
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12 animate-fade-in">
      {icon && <div className="mx-auto mb-4 text-muted/40 animate-float">{icon}</div>}
      <p className="text-muted text-base font-medium">{title}</p>
      {description && <p className="text-muted/70 text-sm mt-2 max-w-md mx-auto">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="btn btn-primary btn-sm mt-6"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}
