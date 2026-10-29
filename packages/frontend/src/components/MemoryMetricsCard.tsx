/**
 * Component to display frontend memory usage metrics.
 */

import { Cpu } from "lucide-react";
import { Card } from "./common";
import { useMemoryMetrics } from "../hooks/useMemoryMetrics";

export function MemoryMetricsCard({ pollInterval = 2000 }: { pollInterval?: number }) {
  const metrics = useMemoryMetrics(pollInterval);

  if (!metrics.available) {
    return (
      <Card title="Frontend Memory" icon={<Cpu size={16} className="text-violet-400" />}>
        <div className="text-sm text-muted">Memory API not available in this browser</div>
      </Card>
    );
  }

  const getUsageColor = (percent: number) => {
    if (percent < 60) return "text-emerald-400";
    if (percent < 80) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <Card title="Frontend Memory" icon={<Cpu size={16} className="text-violet-400" />}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Usage</span>
          <span className={`text-sm font-bold tabular-nums ${getUsageColor(metrics.usagePercent)}`}>
            {metrics.usagePercent.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Used</span>
          <span className="text-sm tabular-nums text-gray-300">
            {metrics.usedMB.toFixed(1)} MB
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Total Allocated</span>
          <span className="text-sm tabular-nums text-gray-300">
            {metrics.totalMB.toFixed(1)} MB
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Limit</span>
          <span className="text-sm tabular-nums text-gray-300">
            {metrics.limitMB.toFixed(0)} MB
          </span>
        </div>
        <div className="mt-2">
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                metrics.usagePercent < 60
                  ? "bg-emerald-500"
                  : metrics.usagePercent < 80
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
              style={{ width: `${metrics.usagePercent}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
