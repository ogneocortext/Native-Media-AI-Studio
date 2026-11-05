/**
 * Navigation performance card — displays sidebar navigation timing metrics.
 *
 * Shows per-route navigation times collected via useNavigationMetrics,
 * helping identify slow pages and the benefit of route preloading.
 */

import { useState } from "react";
import { Clock, ChevronUp, ChevronDown } from "lucide-react";
import { Card } from "./common";
import { getNavigationMetricsSummary } from "../utils/metrics";

interface NavPerformanceCardProps {
  initiallyCollapsed?: boolean;
}

export function NavPerformanceCard({ initiallyCollapsed = true }: NavPerformanceCardProps = {}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const summary = getNavigationMetricsSummary();

  if (summary.length === 0) {
    return (
      <Card title="Navigation Performance" icon={<Clock size={16} className="text-violet-400" />}>
        <div className="text-sm text-muted">No navigation data yet. Navigate between pages to collect metrics.</div>
      </Card>
    );
  }

  return (
    <Card title="Navigation Performance" icon={<Clock size={16} className="text-violet-400" />}>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-xs text-muted hover:text-foreground transition-colors"
          aria-label={collapsed ? "Expand navigation metrics" : "Collapse navigation metrics"}
        >
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          <span className="ml-1">{collapsed ? "Show details" : "Hide details"}</span>
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {summary.map((m) => {
            const color = m.avgMs < 200 ? "text-emerald-400" : m.avgMs < 500 ? "text-yellow-400" : "text-red-400";
            const routeLabel = m.route
              .replace(/^nav\./, "")
              .replace(/\._/g, "/")
              .replace(/\.to\./g, " → ");
            return (
              <div key={m.route} className="flex items-center justify-between p-1.5 bg-white/5 rounded">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-300 truncate" title={m.route}>
                    {routeLabel}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {m.count} navigation{m.count > 1 ? "s" : ""}
                  </div>
                </div>
                <div className={`text-sm font-bold tabular-nums ${color}`}>
                  {m.avgMs.toFixed(0)} ms
                </div>
                <div className="text-[10px] text-gray-500">
                  p95: {m.p95Ms.toFixed(0)}ms
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-white/5">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Slowest route:</span>
          <span className="text-sm font-medium text-red-400">
            {summary[0].route.replace(/^nav\./, "").replace(/\._/g, "/")}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
          <span>Fastest route:</span>
          <span className="text-sm font-medium text-emerald-400">
            {summary[summary.length - 1].route.replace(/^nav\./, "").replace(/\._/g, "/")}
          </span>
        </div>
      </div>
    </Card>
  );
}
