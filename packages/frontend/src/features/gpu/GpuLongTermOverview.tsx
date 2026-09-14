// ---------------------------------------------------------------------------
// GpuLongTermOverview.tsx — collapsible long-term overview with brush + categories
// ---------------------------------------------------------------------------
import React, { useMemo } from "react";
import { Card } from "../../components/common";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ResponsiveContainer,
} from "recharts";
import { formatMB } from "./gpuHelpers";

interface CategoryRow {
  name: string;
  vram: number;
  trend: "up" | "down" | "flat";
  delta: number;
}

interface LongTermOverviewProps {
  history: { time: number; label: string; temp?: number; vram?: number; util?: number }[];
  categoryTrends: CategoryRow[];
  showOverview: boolean;
  onToggleOverview: () => void;
  trendIcon: (t: string) => React.ReactNode;
}

export function GpuLongTermOverview({
  history,
  categoryTrends,
  showOverview,
  onToggleOverview,
  trendIcon,
}: LongTermOverviewProps) {
  const durationMin = useMemo(
    () => ((history[history.length - 1]?.time ?? 0) - (history[0]?.time ?? 0)) / 60000,
    [history]
  );

  return (
    <Card
      title="Long-term overview (all stored)"
      className="!p-4"
      headerActions={
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted tabular-nums">
            {history.length} points • ~{durationMin.toFixed(0)} min
          </span>
          <button
            onClick={onToggleOverview}
            aria-expanded={showOverview}
            className="text-[11px] px-2 py-1 rounded-md bg-white/5 border border-white/10 text-muted hover:text-white"
          >
            {showOverview ? "Hide" : "Show"}
          </button>
        </div>
      }
    >
      {showOverview ? (
        <>
          <div className="h-36" role="img" aria-label="Long-term overview of all stored GPU history, drag brush to zoom">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" minTickGap={60} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#6b7280" }} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,15,20,0.95)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Line type="monotone" dataKey="vram" stroke="#a855f7" strokeWidth={1.5} dot={false} name="VRAM %" />
                <Line type="monotone" dataKey="util" stroke="#22c55e" strokeWidth={1.5} dot={false} name="GPU %" />
                <Line type="monotone" dataKey="temp" stroke="#ef4444" strokeWidth={1} dot={false} name="Temp °C" />
                <Brush
                  dataKey="label"
                  height={16}
                  stroke="#6366f1"
                  fill="rgba(255,255,255,0.02)"
                  tickFormatter={() => ""}
                  aria-label="Brush to zoom long-term overview"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Category breakdown with trends */}
          {categoryTrends.length > 0 && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <p className="text-[11px] text-muted mb-2 font-medium uppercase tracking-wider">VRAM by category</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {categoryTrends.map((cat) => {
                  const total = categoryTrends.reduce((a, c) => a + c.vram, 0);
                  const share = total > 0 ? (cat.vram / total) * 100 : 0;
                  const absDelta = Math.abs(cat.delta);
                  const deltaStr = absDelta >= 1024 ? `${(absDelta / 1024).toFixed(1)}G` : `${Math.round(absDelta)}M`;
                  const deltaSign = cat.delta > 0 ? "+" : cat.delta < 0 ? "−" : "";
                  const trendColor =
                    cat.trend === "up" ? "text-red-400" : cat.trend === "down" ? "text-emerald-400" : "text-muted";
                  return (
                    <div key={cat.name} className="rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-2">
                      <p className="text-[11px] text-white truncate font-medium">{cat.name}</p>
                      <p className="text-xs text-muted tabular-nums mt-0.5">
                        {formatMB(cat.vram)} <span className="text-muted/60">({share.toFixed(0)}%)</span>
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        {trendIcon(cat.trend)}
                        <span className={`text-[10px] tabular-nums ${trendColor}`}>
                          {deltaSign}
                          {deltaStr}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
