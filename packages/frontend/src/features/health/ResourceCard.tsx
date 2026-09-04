import React from "react";
import { Card } from "../../components/common";
import { getUsageColor } from "./utils";

export interface ResourceCardProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconColor: string;
  label: string;
  cores?: number;
  usage: number;
  subtext?: string;
}

export function ResourceCard({ icon: Icon, iconColor, label, cores, usage, subtext }: ResourceCardProps) {
  // Static class map to avoid Tailwind purging dynamic classes
  const colorMap: Record<string, { bg: string; text: string }> = {
    blue: { bg: "bg-blue-500/20", text: "text-blue-400" },
    purple: { bg: "bg-purple-500/20", text: "text-purple-400" },
    amber: { bg: "bg-amber-500/20", text: "text-amber-400" },
  };
  const colors = colorMap[iconColor] || colorMap.blue;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center`}>
            <Icon size={18} className={colors.text} />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{label}</h3>
            <p className="text-xs text-muted">{cores ? `${cores} cores` : subtext}</p>
          </div>
        </div>
        <span
          className="text-xs px-2 py-1 rounded-full font-medium"
          style={{
            background: `${getUsageColor(usage)}20`,
            color: getUsageColor(usage),
          }}
        >
          {usage.toFixed(1)}%
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Usage</span>
          <span className="font-bold">{usage.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-background rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${usage}%`, background: getUsageColor(usage) }}
          />
        </div>
      </div>
    </Card>
  );
}
