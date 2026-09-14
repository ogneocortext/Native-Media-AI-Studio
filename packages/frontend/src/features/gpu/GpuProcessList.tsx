// ---------------------------------------------------------------------------
// GpuProcessList.tsx — GPU processes card with attribution bar, filter, list
// ---------------------------------------------------------------------------
import { Card } from "../../components/common";
import { Search, Eye, EyeOff, Filter } from "lucide-react";
import { formatMB, labelForProcess, iconForProcess, getUsageColor } from "./gpuHelpers";

interface ProcessRow {
  pid: number;
  name: string;
  mem_mb: number;
}

interface GpuProcessListProps {
  processes: ProcessRow[];
  filtered: ProcessRow[];
  query: string;
  showIdle: boolean;
  hiddenIdleCount: number;
  vramTotal: number;
  totalAccounted: number;
  snapshotMemoryUsed: number;
  unaccountedMb: number;
  unaccountedShare: number;
  onSetQuery: (q: string) => void;
  onToggleShowIdle: () => void;
}

export function GpuProcessList({
  processes,
  filtered,
  query,
  showIdle,
  hiddenIdleCount,
  vramTotal,
  totalAccounted,
  snapshotMemoryUsed,
  unaccountedMb,
  unaccountedShare,
  onSetQuery,
  onToggleShowIdle,
}: GpuProcessListProps) {
  return (
    <Card
      title="GPU Processes"
      className="!p-4"
      headerActions={
        <div className="flex flex-col items-end gap-0.5">
          <span
            className="text-[11px] text-muted tabular-nums"
            title={
              vramTotal
                ? `${formatMB(totalAccounted)} attributed of ${formatMB(snapshotMemoryUsed)} used (${formatMB(vramTotal)} total)`
                : undefined
            }
          >
            {filtered.length} shown • {formatMB(totalAccounted)} attributed • {formatMB(snapshotMemoryUsed)} used
          </span>
          {unaccountedMb > 0 && (
            <span
              className="text-[10px] text-amber-300/80 tabular-nums"
              title={`${formatMB(unaccountedMb)} used but not tied to a listed process (driver reserve, cached models, kernel contexts)`}
            >
              +{formatMB(unaccountedMb)} unattributed
            </span>
          )}
        </div>
      }
    >
      {/* Stacked attribution bar — top 6 share of total VRAM */}
      {filtered.length > 0 && vramTotal > 0 && (
        <div className="mb-3">
          <div
            className="flex h-2 rounded-full overflow-hidden bg-white/10"
            role="img"
            aria-label={`VRAM attribution: ${formatMB(totalAccounted)} attributed, ${formatMB(unaccountedMb)} unaccounted`}
          >
            {filtered.slice(0, 6).map((p, i) => {
              const colors = ["bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-teal-500"];
              const share = ((p.mem_mb || 0) / vramTotal) * 100;
              if (share < 1) return null;
              return (
                <div
                  key={p.pid}
                  className={`${colors[i % colors.length]} transition-all`}
                  style={{ width: `${share}%` }}
                  title={`${labelForProcess(p.name)} ${share.toFixed(1)}% of VRAM`}
                />
              );
            })}
            {unaccountedShare > 1 ? (
              <div className="bg-white/20" style={{ width: `${Math.min(unaccountedShare, 100)}%` }} title={`Unattributed / driver reserve ${unaccountedShare.toFixed(1)}%`} />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {filtered.slice(0, 6).map((p, i) => {
              const colors = ["bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-teal-500"];
              const share = vramTotal ? ((p.mem_mb || 0) / vramTotal) * 100 : 0;
              if (share < 2) return null;
              return (
                <span key={p.pid} className="flex items-center gap-1 text-[11px] text-muted">
                  <span className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
                  {labelForProcess(p.name).split(" —")[0]} {share.toFixed(0)}%
                </span>
              );
            })}
            {unaccountedShare >= 2 && (
              <span
                className="flex items-center gap-1 text-[11px] text-muted/70"
                title="VRAM used but not attributed to a listed process (driver reserve, caches, untracked PIDs)"
              >
                <span className="w-2 h-2 rounded-full bg-white/25" />Unattributed {unaccountedShare.toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => onSetQuery(e.target.value)}
            placeholder="Filter by name or PID…"
            aria-label="Filter GPU processes by name or PID"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-muted focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <button
          onClick={onToggleShowIdle}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition ${
            showIdle ? "bg-white/10 border-white/15 text-white" : "bg-white/5 border-white/10 text-muted hover:text-white"
          }`}
        >
          {showIdle ? <Eye size={14} /> : <EyeOff size={14} />}
          {showIdle ? "Hide idle" : `Show idle (${hiddenIdleCount})`}
        </button>
        {query && (
          <button
            onClick={() => onSetQuery("")}
            className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-muted hover:text-white flex items-center gap-1"
          >
            <Filter size={12} /> Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted py-4 text-center">
          {processes.length === 0 ? "No GPU compute processes detected." : "No processes match your filter."}
        </p>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
          {filtered.map((proc) => {
            const label = labelForProcess(proc.name);
            const mem = proc.mem_mb ?? 0;
            const isLarge = mem >= 1024;
            const share = vramTotal ? (mem / vramTotal) * 100 : 0;
            return (
              <div
                key={`${proc.pid}-${proc.name}`}
                className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2 hover:bg-white/[0.04] transition border-l-2"
                style={{ borderLeftColor: isLarge ? "#f59e0b" : share > 5 ? "#a855f7" : "rgba(255,255,255,0.08)" }}
                title={`PID ${proc.pid} — ${proc.name} — ${formatMB(mem)} (${share.toFixed(1)}% of VRAM)`}
              >
                <span className="text-sm leading-none shrink-0" aria-hidden>
                  {iconForProcess(proc.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{label}</p>
                  <p className="text-[11px] text-muted truncate tabular-nums">
                    PID {proc.pid} • {proc.name} • {share.toFixed(1)}% of VRAM
                  </p>
                  <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden max-w-[220px]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(share, 100)}%`, background: getUsageColor(Math.min(share * 2.5, 100)) }}
                    />
                  </div>
                </div>
                <span className={`font-mono text-xs shrink-0 tabular-nums ${isLarge ? "text-amber-300" : "text-gray-300"}`}>
                  {formatMB(mem)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!showIdle && hiddenIdleCount > 0 && (
        <p className="text-[11px] text-muted/60 mt-2 text-center">
          {hiddenIdleCount} idle process{hiddenIdleCount !== 1 ? "es" : ""} hidden (0–1 MB) — toggle “Show idle” to reveal.
        </p>
      )}
    </Card>
  );
}
