/**
 * EmptySection — consistent empty-state pattern used across the studio.
 *
 * Renders a centered icon above muted text (title + optional description),
 * with an optional action button beneath. Use this instead of inline
 * <div>+<Icon>+text blocks so every empty state looks identical and a single
 * style change ripples everywhere.
 */
import React from "react";

interface EmptySectionAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

interface EmptySectionProps {
  icon: React.ReactNode;
  title: string;
  /** Optional subtitle shown beneath the title. */
  description?: string;
  /** Extra text size override; default is text-sm. */
  size?: "sm" | "base";
  /** Icon size; default is 32. */
  iconSize?: number;
  /** Optional primary action rendered as a button beneath the title. */
  action?: EmptySectionAction;
}

export function EmptySection({
  icon,
  title,
  description,
  size = "sm",
  iconSize = 32,
  action,
}: EmptySectionProps) {
  return (
    <div className={`text-muted text-${size} py-8 text-center flex flex-col items-center`}>
      {icon && (
        <div className="mx-auto mb-2 text-muted/40">
          {React.isValidElement(icon)
            ? React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, { size: iconSize })
            : icon}
        </div>
      )}
      <div className="text-base font-medium text-foreground mb-1">{title}</div>
      {description && (
        <p className="text-muted text-xs max-w-xs mx-auto mb-4">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs font-medium hover:bg-accent/20 transition-colors flex items-center gap-1.5 mx-auto shrink-0"
          aria-label={action.label}
        >
          {action.icon && (
            <span className="mr-1">
              {React.isValidElement(action.icon)
                ? React.cloneElement(action.icon as React.ReactElement<Record<string, unknown>>, { size: 14 })
                : action.icon}
            </span>
          )}
          {action.label}
        </button>
      )}
    </div>
  );
}
