/**
 * EmptySection — consistent empty-state pattern used across the studio.
 *
 * Renders a centered icon above a muted text label. Use this instead of
 * inline <div>+<Icon>+text blocks so every empty state looks identical and
 * a single style change ripples everywhere.
 */
import React from "react";

interface EmptySectionProps {
  icon: React.ReactNode;
  title: string;
  /** Extra text size override; default is text-sm. */
  size?: "sm" | "base";
  /** Icon size; default is 32. */
  iconSize?: number;
}

export function EmptySection({ icon, title, size = "sm", iconSize = 32 }: EmptySectionProps) {
  return (
    <div className={`text-muted text-${size} py-8 text-center flex flex-col items-center`}>
      {icon && (
        <div className="mx-auto mb-2 text-muted/40">
          {React.isValidElement(icon)
            ? React.cloneElement(icon as React.ReactElement<Record<string, unknown>>, { size: iconSize })
            : icon}
        </div>
      )}
      {title}
    </div>
  );
}
