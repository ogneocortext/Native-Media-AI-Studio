/**
 * Component to display tool execution time metrics.
 */

import { Wrench, XCircle } from "lucide-react";
import { Card } from "./common";
import { getMetricsSummary } from "../utils/metrics";

export function ToolExecutionCard() {
  const metrics = getMetricsSummary();

  // Filter for tool metrics only
  const toolMetrics = Object.entries(metrics).filter(([name]) => name.startsWith("tool."));

  if (toolMetrics.length === 0) {
    return (
      <Card title="Tool Execution" icon={<Wrench size={16} className="text-violet-400" />}>
        <div className="text-sm text-muted">No tool executions recorded yet</div>
      </Card>
    );
  }

  // Group by tool name
  const toolStats = new Map<string, { duration: number; count: number; errors: number }>();
  toolMetrics.forEach(([name, stats]) => {
    const [, tool, metric] = name.split(".");
    if (!toolStats.has(tool)) {
      toolStats.set(tool, { duration: 0, count: 0, errors: 0 });
    }
    const entry = toolStats.get(tool)!;
    if (metric === "duration") {
      entry.duration = stats.p95;
    } else if (metric === "count") {
      entry.count = stats.count;
      const errorStats = metrics[`${name.replace(".count", ".duration")}.false`];
      if (errorStats) {
        entry.errors = errorStats.count;
      }
    }
  });

  const sortedTools = Array.from(toolStats.entries()).sort(
    (a, b) => b[1].duration - a[1].duration
  );

  const getLatencyColor = (ms: number) => {
    if (ms < 1000) return "text-emerald-400";
    if (ms < 5000) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <Card title="Tool Execution" icon={<Wrench size={16} className="text-violet-400" />}>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sortedTools.slice(0, 10).map(([tool, stats]) => (
          <div key={tool} className="flex items-center justify-between p-2 bg-white/5 rounded-lg">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-300 truncate" title={tool}>
                {tool}
              </div>
              <div className="text-[10px] text-gray-500">
                {stats.count} executions
              </div>
            </div>
            <div className="flex items-center gap-3">
              {stats.errors > 0 && (
                <div className="flex items-center gap-1 text-red-400">
                  <XCircle size={10} />
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
