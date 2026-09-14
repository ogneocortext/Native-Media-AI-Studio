// ---------------------------------------------------------------------------
// GpuTrendingControls.tsx — range selector, export/clear, inline stat tiles
// ---------------------------------------------------------------------------
import { useCallback, useMemo } from "react";
import { Card } from "../../components/common";
import {
  Download,
  Trash2,
  BarChart3,
  History,
  Thermometer,
  MemoryStick,
  Activity,
} from "lucide-react";
import { RANGE_OPTIONS, RangeId } from "./gpuConstants";
import { calcStats, trendIcon } from "./gpuHelpers";

interface TrendingControlsProps {
  range: RangeId;
  windowHistory: { time: number; temp?: number; vram?: number; util?: number }[];
  history: { time: number; temp?: number; vram?: number; util?: number }[];
  dbSynced: boolean;
  tempStats: ReturnType<typeof calcStats>;
  vramStats: ReturnType<typeof calcStats>;
  utilStats: ReturnType<typeof calcStats>;
  onSetRange: (r: RangeId) => void;
  onExport: () => void;
  onClear: () => void;
  confirmClear: boolean;
  rangeLabel: string;
}

export function GpuTrendingControls({
  range,
  windowHistory,
  history,
  dbSynced,
  tempStats,
  vramStats,
  utilStats,
  onSetRange,
  onExport,
  onClear,
  confirmClear,
  rangeLabel,
}: TrendingControlsProps) {
  const handleExport = useCallback(() => {
    onExport();
  }, [onExport]);

  const handleClear = useCallback(() => {
    onClear();
  }, [onClear]);

  const patternHint = useMemo(() => {
    if (windowHistory.length < 6) return null;
    if (vramStats.trend === "up" && tempStats.trend === "up")
      return "Pattern: load building — VRAM and temp rising together. Consider closing a heavy app before next render.";
    if (vramStats.trend === "up" && utilStats.trend === "flat")
      return "Pattern: VRAM creeping up while GPU idle — likely a leak or cached model not released.";
    if (utilStats.trend === "up" && vramStats.trend === "flat")
      return "Pattern: compute-bound burst — GPU busy without extra VRAM (shaders / encode).";
    if (tempStats.trend === "up" && vramStats.trend === "flat")
      return "Pattern: thermal climb without VRAM growth — check fan curve / airflow.";
    if (vramStats.trend === "down")
      return "Pattern: VRAM easing — recent release or process exit freed memory.";
    return "Pattern: stable window — no strong drift in VRAM/temp/util.";
  }, [windowHistory.length, vramStats.trend, tempStats.trend, utilStats.trend]);

  return (
    <Card className="!p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs text-muted flex items-center gap-1.5">
          <History size={12} /> Window
        </span>
        <div
          className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 p-1"
          role="group"
          aria-label="History time window"
        >
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => onSetRange(r.id)}
              aria-pressed={range === r.id}
              className={`text-[11px] px-2.5 py-1 rounded-md transition ${
                range === r.id ? "bg-violet-600 text-white" : "text-muted hover:text-white hover:bg-white/10"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted/70 tabular-nums">
          {windowHistory.length} points in view • {history.length} stored • {rangeLabel} window
          {dbSynced ? " • DB ✓" : " • local only"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={handleExport}
            disabled={windowHistory.length < 2}
            title={
              windowHistory.length < 2
                ? "Need at least 2 points to export"
                : `Export ${windowHistory.length} points as CSV`
            }
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 disabled:opacity-40"
          >
            <Download size={12} /> Export CSV
          </button>
          <button
            onClick={handleClear}
            disabled={history.length === 0}
            title={
              confirmClear
                ? "Click again to confirm wipe of local cache + database"
                : "Clear local cache + database history"
            }
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border disabled:opacity-40 transition ${
              confirmClear ? "bg-red-500/20 border-red-500/40 text-red-200" : "bg-white/5 border-white/10 text-muted hover:text-red-300"
            }`}
          >
            <Trash2 size={12} /> {confirmClear ? "Confirm wipe?" : "Clear"}
          </button>
        </div>
      </div>
      {/* inline stats — responsive: 1 col on <640px */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Thermometer size={11} className="text-rose-400" /> Temp
            <span className="ml-auto flex items-center gap-1">
              {trendIcon(tempStats.trend)} <span className="text-[10px]">{tempStats.trend}</span>
            </span>
          </div>
          <p className="text-sm font-semibold text-white mt-1">
            {tempStats.cur.toFixed(0)}°C{" "}
            <span className="text-[11px] font-normal text-muted">
              avg {tempStats.avg.toFixed(0)}° • {tempStats.min.toFixed(0)}–{tempStats.max.toFixed(0)}°
            </span>
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <MemoryStick size={11} className="text-violet-400" /> VRAM
            <span className="ml-auto flex items-center gap-1">
              {trendIcon(vramStats.trend)} <span className="text-[10px]">{vramStats.trend}</span>
            </span>
          </div>
          <p className="text-sm font-semibold text-white mt-1">
            {vramStats.cur.toFixed(1)}%{" "}
            <span className="text-[11px] font-normal text-muted">
              avg {vramStats.avg.toFixed(1)}% • {vramStats.min.toFixed(1)}–{vramStats.max.toFixed(1)}%
            </span>
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Activity size={11} className="text-emerald-400" /> Util
            <span className="ml-auto flex items-center gap-1">
              {trendIcon(utilStats.trend)} <span className="text-[10px]">{utilStats.trend}</span>
            </span>
          </div>
          <p className="text-sm font-semibold text-white mt-1">
            {utilStats.cur.toFixed(0)}%{" "}
            <span className="text-[11px] font-normal text-muted">
              avg {utilStats.avg.toFixed(0)}% • {utilStats.min.toFixed(0)}–{utilStats.max.toFixed(0)}%
            </span>
          </p>
        </div>
      </div>
      {patternHint && (
        <p className="text-[11px] text-muted/60 mt-2 flex items-center gap-1.5">
          <BarChart3 size={11} />
          {patternHint}
        </p>
      )}
    </Card>
  );
}
