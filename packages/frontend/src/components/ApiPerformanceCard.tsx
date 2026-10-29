/**
 * Component to display API performance metrics.
 */

import { Activity, AlertTriangle } from "lucide-react";
import { Card } from "./common";
import { getMetricsSummary } from "../utils/metrics";

export function ApiPerformanceCard() {
  const metrics = getMetricsSummary();

  // Filter for API metrics only
  const apiMetrics = Object.entries(metrics).filter(([name]) => name.startsWith("api."));

  if (apiMetrics.length === 0) {
    return (
      <Card title="API Performance" icon={<Activity size={16} className="text-violet-400" />}>
        <div className="text-sm text-muted">Collecting data...</div>
      </Card>
    );
  }

  // Group by endpoint
  const endpointStats = new Map<string, { duration: number; count: number; errors: number }>();
  apiMetrics.forEach(([name, stats]) => {
    const [, endpoint, metric] = name.split(".");
    if (!endpointStats.has(endpoint)) {
      endpointStats.set(endpoint, { duration: 0, count: 0, errors: 0 });
    }
    const entry = endpointStats.get(endpoint)!;
    if (metric === "duration") {
      entry.duration = stats.p95;
    } else if (metric === "count") {
      entry.count = stats.count;
      // Count errors (tags.success = "false")
      const errorStats = metrics[`${name.replace(".count", ".duration")}.false`];
      if (errorStats) {
        entry.errors = errorStats.count;
      }
    }
  });

  const sortedEndpoints = Array.from(endpointStats.entries()).sort(
    (a, b) => b[1].duration - a[1].duration
  );

  const getLatencyColor = (ms: number) => {
    if (ms < 100) return "text-emerald-400";
    if (ms < 500) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <Card title="API Performance" icon={<Activity size={16} className="text-violet-400" />}>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sortedEndpoints.slice(0, 10).map(([endpoint, stats]) => (
          <div key={endpoint} className="flex items-center justify-between p-2 bg-white/5 rounded-lg">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-300 truncate" title={endpoint}>
                {endpoint}
              </div>
              <div className="text-[10px] text-gray-500">
                {stats.count} requests
              </div>
            </div>
            <div className="flex items-center gap-3">
              {stats.errors > 0 && (
                <div className="flex items-center gap-1 text-red-400">
                  <AlertTriangle size={10} />
                  <span className="text-xs">{stats.errors}</span>
                </div>
              )}
              <div className={`text-sm font-bold tabular-nums ${getLatencyColor(stats.duration)}`}>
                {stats.duration.toFixed(0)} ms
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
