/**
 * Resource bar component for displaying CPU/GPU/RAM usage.
 * Used in page headers and system monitoring panels.
 */

import React from "react";
import { Cpu, Thermometer, MemoryStick } from "lucide-react";

interface ResourceBarProps {
  label: string;
  value: number;
  unit?: string;
  icon?: "cpu" | "gpu" | "memory" | "thermometer" | "custom";
  customIcon?: React.ReactNode;
  color?: string;
  showBar?: boolean;
  size?: "sm" | "md" | "lg";
  warningThreshold?: number;
  criticalThreshold?: number;
}

function getUsageColor(value: number, warning = 75, critical = 90): string {
  if (value >= critical) return "#ef4444";
  if (value >= warning) return "#f59e0b";
  return "#22c55e";
}

const iconMap = {
  cpu: Cpu,
  gpu: Cpu,
  memory: MemoryStick,
  thermometer: Thermometer,
};

export function ResourceBar({
  label,
  value,
  unit = "%",
  icon = "cpu",
  customIcon,
  color,
  showBar = true,
  size = "md",
  warningThreshold = 75,
  criticalThreshold = 90,
}: ResourceBarProps) {
  const Icon = icon !== "custom" ? iconMap[icon] : null;
  const barColor = color || getUsageColor(value, warningThreshold, criticalThreshold);
  const heightClass = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";

  return (
    <div className={`resource-bar size-${size}`}>
      <div className="resource-bar-header">
        <div className="resource-bar-label">
          {customIcon && <span className="resource-bar-icon">{customIcon}</span>}
          {Icon && <Icon size={size === "sm" ? 12 : 14} className="resource-bar-icon" />}
          <span className="resource-bar-text">{label}</span>
        </div>
        <span className="resource-bar-value" style={{ color: barColor }}>
          {value.toFixed(1)}{unit}
        </span>
      </div>
      {showBar && (
        <div className={`resource-bar-track ${heightClass}`}>
          <div
            className="resource-bar-fill"
            style={{ width: `${Math.min(value, 100)}%`, background: barColor }}
          />
        </div>
      )}
    </div>
  );
}

interface ResourceGroupProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
}

export function ResourceGroup({ children, title, className = "" }: ResourceGroupProps) {
  return (
    <div className={`resource-group ${className}`}>
      {title && <h4 className="resource-group-title">{title}</h4>}
      <div className="resource-group-items">{children}</div>
    </div>
  );
}
