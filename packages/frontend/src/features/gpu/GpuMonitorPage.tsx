// ---------------------------------------------------------------------------
// GpuMonitorPage.tsx — orchestrator: state + effects + sub-components
// ---------------------------------------------------------------------------
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  getGPUSnapshot,
  getGPUProcesses,
  getGPUHistory,
  clearGPUHistory,
  getSettings,
  type GPUSnapshot,
  type GPUProcessInfo,
} from "../../services/api";
import {
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  downsample,
  calcStats,
  loadHistory,
  trendIcon,
  labelForProcess,
} from "./gpuHelpers";
import {
  GpuMonitorHeader,
} from "./GpuMonitorHeader";
import {
  GpuMetricCards,
} from "./GpuMetricCards";
import {
  GpuTrendingControls,
} from "./GpuTrendingControls";
import {
  GpuCharts,
} from "./GpuCharts";
import {
  GpuLongTermOverview,
} from "./GpuLongTermOverview";
import {
  GpuProcessList,
} from "./GpuProcessList";
import {
  MAX_HISTORY,
  RANGE_OPTIONS,
  RangeId,
  DataPoint,
} from "./gpuConstants";

const POLL_OPTIONS = [5, 10, 30] as const;

export function GpuMonitorPage() {
  const [snapshot, setSnapshot] = useState<GPUSnapshot | null>(null);
  const [processes, setProcesses] = useState<GPUProcessInfo[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [history, setHistory] = useState<DataPoint[]>(() => loadHistory());
  const [showIdle, setShowIdle] = useState(false);
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [showOverview, setShowOverview] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [range, setRange] = useState<RangeId>(() => {
    const v = localStorage.getItem("gpu:range");
    return (v && RANGE_OPTIONS.some((r) => r.id === v) ? v : "1h") as RangeId;
  });
  const [intervalSec, setIntervalSec] = useState<number>(() => {
    const v = Number(localStorage.getItem("gpu:pollInterval"));
    return POLL_OPTIONS.includes(v as (typeof POLL_OPTIONS)[number]) ? v : 5;
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [inferenceEngine, setInferenceEngine] = useState<string | null>(null);
  const [dbSynced, setDbSynced] = useState(false);

  const isHiddenRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const inFlightRef = useRef(false);
  const prevCategoriesRef = useRef<Record<string, number>>({});

  // Load active inference engine setting
  useEffect(() => {
    let cancelled = false;
    getSettings().then((s) => {
      if (cancelled) return;
      const hasOllama = processes.some((p) => /ollama|llama-server/i.test(p.name));
      setInferenceEngine(s.atomic_chat_enabled && !hasOllama ? "Atomic Chat" : "Ollama");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [processes]);

  // persist interval + range
  useEffect(() => {
    localStorage.setItem("gpu:pollInterval", String(intervalSec));
  }, [intervalSec]);
  useEffect(() => {
    localStorage.setItem("gpu:range", range);
  }, [range]);

  // persist history (throttled)
  const persistAtRef = useRef(0);
  useEffect(() => {
    if (history.length === 0) return;
    const now = Date.now();
    if (now - persistAtRef.current < 15000) return;
    persistAtRef.current = now;
    try {
      localStorage.setItem("gpu:history:v2", JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch {
      try { localStorage.setItem("gpu:history:v2", JSON.stringify(history.slice(-4320))); } catch { /* ignore */ }
    }
  }, [history]);

  // visibility pause
  useEffect(() => {
    const onVis = () => {
      isHiddenRef.current = document.hidden;
      setTabHidden(document.hidden);
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ticking clock so "updated Xs ago" stays fresh while paused
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, [paused]);

  // hydrate from DB when range changes
  const hydrateFromDB = useCallback(async (rangeId: RangeId) => {
    try {
      const { points } = await getGPUHistory(rangeId, 4000);
      if (points.length === 0) return;
      const dbPoints: DataPoint[] = points.map((p) => ({
        time: p.ts_ms,
        label: new Date(p.ts_ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        temp: p.temperature_c,
        vram: p.memory_percent,
        util: p.gpu_util,
      }));
      setHistory((prev) => {
        const newestDb = dbPoints[dbPoints.length - 1]?.time ?? 0;
        const liveTail = prev.filter((x) => x.time > newestDb);
        const seen = new Set<number>();
        const merged = [...dbPoints, ...liveTail]
          .sort((a, b) => a.time - b.time)
          .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
          .slice(-MAX_HISTORY);
        persistAtRef.current = 0;
        try { localStorage.setItem("gpu:history:v2", JSON.stringify(merged.slice(-MAX_HISTORY))); } catch { /* ignore */ }
        return merged;
      });
      setDbSynced(true);
    } catch {
      setDbSynced(false);
    }
  }, []);
  useEffect(() => { hydrateFromDB(range); }, [hydrateFromDB, range]);

  const fetchAll = useCallback(
    async (isManual = false) => {
      if (isHiddenRef.current && !isManual) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (!hasLoadedRef.current) setInitialLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [gpu, procs] = await Promise.all([
          getGPUSnapshot(),
          getGPUProcesses().catch(() => ({ processes: [] as GPUProcessInfo[], count: 0 })),
        ]);
        setSnapshot(gpu);
        const snapshotProcs = (gpu.processes || [])
          .map((p) => ({ pid: p.pid, name: p.name, mem_mb: (p.used_mb || 0) as number }));
        const hasSnapshotMemory = snapshotProcs.some((p) => p.mem_mb > 0);
        setProcesses(hasSnapshotMemory ? snapshotProcs : (procs.processes || []));
        setLastUpdated(Date.now());
        setNowTick(Date.now());
        setConsecutiveErrors(0);
        hasLoadedRef.current = true;
        if (gpu.available) {
          setHistory((prev) => {
            const now = Date.now();
            if (prev.length && now - prev[prev.length - 1].time < 2000) return prev;
            const point: DataPoint = {
              time: now,
              label: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              temp: gpu.temperature_c,
              vram: gpu.memory_percent,
              util: gpu.gpu_utilization,
            };
            return [...prev, point].slice(-MAX_HISTORY);
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch GPU telemetry");
        setConsecutiveErrors((c) => c + 1);
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
        inFlightRef.current = false;
      }
    },
    [],
  );

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => fetchAll(false), intervalSec * 1000);
    return () => clearInterval(id);
  }, [fetchAll, paused, intervalSec]);

  // Derived values
  const rangeMs = useMemo(() => RANGE_OPTIONS.find((r) => r.id === range)?.ms ?? 3600000, [range]);
  const windowHistory = useMemo(() => {
    if (history.length === 0) return [];
    const cutoff = nowTick - rangeMs;
    const win = history.filter((p) => p.time >= cutoff);
    return win.length >= 2 ? win : history.slice(-20);
  }, [history, rangeMs, nowTick]);
  const chartData = useMemo(() => downsample(windowHistory, 300), [windowHistory]);
  const tempStats = useMemo(() => calcStats(windowHistory.map((d) => d.temp)), [windowHistory]);
  const vramStats = useMemo(() => calcStats(windowHistory.map((d) => d.vram)), [windowHistory]);
  const utilStats = useMemo(() => calcStats(windowHistory.map((d) => d.util)), [windowHistory]);
  const rangeLabel = useMemo(() => RANGE_OPTIONS.find((r) => r.id === range)?.label ?? range, [range]);

  const filtered = useMemo(() => {
    let list = processes;
    if (!showIdle && snapshot?.memory_available) list = list.filter((p) => (p.mem_mb ?? 0) > 1);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          labelForProcess(p.name).toLowerCase().includes(q) ||
          String(p.pid).includes(q),
      );
    }
    return [...list].sort((a, b) => (b.mem_mb || 0) - (a.mem_mb || 0));
  }, [processes, showIdle, query, snapshot?.memory_available]);

  const hiddenIdleCount = processes.length - processes.filter((p) => (p.mem_mb ?? 0) > 1).length;
  const totalAccounted = processes.reduce((a, p) => a + (p.mem_mb || 0), 0);
  const vramTotal = snapshot?.memory_total_mb ?? 0;
  const unaccountedMb = Math.max(0, (snapshot?.memory_used_mb ?? 0) - totalAccounted);
  const unaccountedShare = vramTotal ? (unaccountedMb / vramTotal) * 100 : 0;

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of processes) {
      const cat = labelForProcess(p.name).split(" —")[0].trim();
      map[cat] = (map[cat] || 0) + (p.mem_mb || 0);
    }
    return map;
  }, [processes]);

  const categoryTrends = useMemo(() => {
    const prev = prevCategoriesRef.current;
    const result: { name: string; vram: number; trend: "up" | "down" | "flat"; delta: number }[] = [];
    for (const [name, vram] of Object.entries(categoryBreakdown)) {
      const prevVram = prev[name] || 0;
      const delta = vram - prevVram;
      const pct = prevVram > 0 ? (delta / prevVram) * 100 : 0;
      const trend = pct > 5 ? "up" : pct < -5 ? "down" : "flat";
      result.push({ name, vram, trend, delta });
    }
    result.sort((a, b) => b.vram - a.vram);
    return result;
  }, [categoryBreakdown]);

  useEffect(() => {
    prevCategoriesRef.current = categoryBreakdown;
  }, [categoryBreakdown]);

  const handleExport = useCallback(() => {
    const rows = [["time", "iso", "temp_c", "vram_pct", "gpu_pct"]];
    for (const p of windowHistory)
      rows.push([String(p.time), new Date(p.time).toISOString(), String(p.temp ?? ""), String(p.vram ?? ""), String(p.util ?? "")]);
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gpu-history-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [windowHistory, range]);

  const handleClear = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    setHistory([]);
    localStorage.removeItem("gpu:history:v2");
    try { await clearGPUHistory(0); hydrateFromDB(range); } catch { /* ignore */ }
  }, [confirmClear, hydrateFromDB, range]);

  const lastUpdatedAgo = lastUpdated ? Math.max(0, Math.round((nowTick - lastUpdated) / 1000)) : null;

  if (initialLoading) {
    return (
      <div className="max-w-[1100px] mx-auto p-6 pb-24 space-y-4">
        <div className="flex items-center gap-3 py-6 justify-center text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading GPU telemetry…
        </div>
      </div>
    );
  }

  if (!snapshot?.available) {
    return (
      <div className="max-w-[1100px] mx-auto p-6 pb-24 space-y-4">
        <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-6 text-sm text-muted">
          GPU monitoring requires NVIDIA drivers with NVML support.
          <p className="text-xs text-muted/60 mt-1">Checked NVML + torch.cuda fallback — neither reported a GPU.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto p-6 pb-24 space-y-4">
      <GpuMonitorHeader
        refreshing={refreshing}
        paused={paused}
        tabHidden={tabHidden}
        intervalSec={intervalSec}
        inferenceEngine={inferenceEngine}
        lastUpdated={lastUpdated}
        lastUpdatedAgo={lastUpdatedAgo}
        snapshotName={snapshot.name}
        onSetIntervalSec={setIntervalSec}
        onTogglePaused={() => setPaused((p) => !p)}
        onRefresh={() => fetchAll(true)}
        onSyncDB={() => hydrateFromDB(range)}
        syncDisabled={refreshing || initialLoading}
      />

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300 flex flex-wrap items-center gap-2" role="alert">
          <AlertTriangle size={14} />
          <span className="flex-1 min-w-[200px]">
            {error}
            {consecutiveErrors > 1 && ` (attempt ${consecutiveErrors} — auto-retries every ${intervalSec}s)`}
          </span>
          <button
            onClick={() => fetchAll(true)}
            className="text-[11px] px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/25 text-red-200 hover:bg-red-500/25"
          >
            Retry now
          </button>
        </div>
      )}

      <GpuMetricCards
        snapshot={snapshot}
        history={history}
        windowHistory={windowHistory}
        tempStats={tempStats}
        vramStats={vramStats}
        utilStats={utilStats}
        historyLength={history.length}
      />

      <GpuTrendingControls
        range={range}
        windowHistory={windowHistory}
        history={history}
        dbSynced={dbSynced}
        tempStats={tempStats}
        vramStats={vramStats}
        utilStats={utilStats}
        onSetRange={setRange}
        onExport={handleExport}
        onClear={handleClear}
        confirmClear={confirmClear}
        rangeLabel={rangeLabel}
      />

      <GpuCharts
        rangeMs={rangeMs}
        chartData={chartData}
        tempStats={tempStats}
        vramStats={vramStats}
        utilStats={utilStats}
        rangeLabel={rangeLabel}
      />

      <GpuLongTermOverview
        history={history}
        categoryTrends={categoryTrends}
        showOverview={showOverview}
        onToggleOverview={() => setShowOverview((v) => !v)}
        trendIcon={trendIcon}
      />

      <GpuProcessList
        processes={processes}
        filtered={filtered}
        query={query}
        showIdle={showIdle}
        hiddenIdleCount={hiddenIdleCount}
        vramTotal={vramTotal}
        totalAccounted={totalAccounted}
        snapshotMemoryUsed={snapshot.memory_used_mb}
        unaccountedMb={unaccountedMb}
        unaccountedShare={unaccountedShare}
        onSetQuery={setQuery}
        onToggleShowIdle={() => setShowIdle((v) => !v)}
      />
    </div>
  );
}
