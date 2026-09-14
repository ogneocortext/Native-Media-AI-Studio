// ---------------------------------------------------------------------------
// GpuMonitorHeader.tsx — title bar, subtitle, polling controls, action buttons
// ---------------------------------------------------------------------------
import {
  Cpu as CpuIcon,
  Clock3,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Database,
} from "lucide-react";
import { POLL_OPTIONS } from "./gpuConstants";

interface HeaderProps {
  refreshing: boolean;
  paused: boolean;
  tabHidden: boolean;
  intervalSec: number;
  inferenceEngine: string | null;
  lastUpdated: number | null;
  lastUpdatedAgo: number | null;
  snapshotName: string | undefined;
  onSetIntervalSec: (s: number) => void;
  onTogglePaused: () => void;
  onRefresh: () => void;
  onSyncDB: () => void;
  syncDisabled: boolean;
}

export function GpuMonitorHeader({
  refreshing,
  paused,
  tabHidden,
  intervalSec,
  inferenceEngine,
  lastUpdated,
  lastUpdatedAgo,
  snapshotName,
  onSetIntervalSec,
  onTogglePaused,
  onRefresh,
  onSyncDB,
  syncDisabled,
}: HeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <CpuIcon size={22} className="text-violet-400" />
          GPU Monitor
          {refreshing && <Loader2 size={14} className="animate-spin text-violet-400" aria-label="Refreshing" />}
          {paused && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20">
              Paused
            </span>
          )}
          {inferenceEngine && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
              {inferenceEngine}
            </span>
          )}
        </h1>
        <p className="text-xs text-muted mt-1">
          Real-time telemetry for {snapshotName || "your GPU"} — temperature, VRAM, utilization, and per-process attribution.
        </p>
        {lastUpdated && (
          <p className="text-[11px] text-muted/60 mt-1 flex items-center gap-1.5">
            <Clock3 size={11} />
            {lastUpdatedAgo != null && lastUpdatedAgo >= 2 ? (
              <>
                Updated {lastUpdatedAgo}s ago • every {intervalSec}s
                {paused ? " (paused)" : tabHidden ? " (tab hidden — polling paused)" : ""}
              </>
            ) : (
              <>
                Last updated {new Date(lastUpdated).toLocaleTimeString()} • every {intervalSec}s
                {paused ? " (paused)" : tabHidden ? " (tab hidden)" : ""}
              </>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 p-1">
          {POLL_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSetIntervalSec(s)}
              className={`text-[11px] px-2 py-1 rounded-md transition ${
                intervalSec === s ? "bg-violet-600 text-white" : "text-muted hover:text-white hover:bg-white/10"
              }`}
            >
              {s}s
            </button>
          ))}
        </div>
        <button
          onClick={onTogglePaused}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10"
          title={paused ? "Resume polling" : "Pause polling"}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
        <button
          onClick={onSyncDB}
          disabled={syncDisabled}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 disabled:opacity-50"
          title="Reload history from the backend database"
        >
          <Database size={14} />
          Sync DB
        </button>
      </div>
    </div>
  );
}
