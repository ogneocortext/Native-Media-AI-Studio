import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Card } from "../../components/common";
import {
  getGPUSnapshot,
  getGPUProcesses,
  getGPUHistory,
  clearGPUHistory,
  type GPUSnapshot,
  type GPUProcessInfo,
} from "../../services/api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
  LineChart,
  Line,
} from "recharts";
import {
  Cpu as CpuIcon,
  Thermometer,
  MemoryStick,
  Activity,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Search,
  Eye,
  EyeOff,
  Pause,
  Play,
  Clock3,
  Zap,
  Filter,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  Trash2,
  BarChart3,
  History,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Process → app-function mapping (best-effort, user-facing labels)
// ---------------------------------------------------------------------------
const PROCESS_LABELS: Record<string, string> = {
  "Unity.exe": "Unity Editor — 3D scene / animation",
  "Unity Hub.exe": "Unity Hub — project manager",
  "Blender.exe": "Blender — 3D rendering / scene build",
  "ollama.exe": "Ollama — model server",
  "llama-server.exe": "Ollama — active model inference",
  "python.exe": "Python — backend / audio analysis",
  "node.exe": "Node.js — MCP servers / frontend",
  "chrome.exe": "Chrome — UI / BrowserOS",
  "msedge.exe": "Edge — UI / BrowserOS",
  "ComfyUI.exe": "ComfyUI — image / video generation",
  "main.py": "ComfyUI — diffusion worker",
  "uvicorn.exe": "FastAPI — backend server",
  "Remotion.exe": "Remotion — video render",
  "DaVinci Resolve.exe": "DaVinci Resolve — video editing",
};

function labelForProcess(name: string): string {
  const lower = name.toLowerCase();
  if (PROCESS_LABELS[name]) return PROCESS_LABELS[name];
  for (const [key, label] of Object.entries(PROCESS_LABELS)) {
    if (lower.includes(key.toLowerCase())) return label;
  }
  if (lower.includes("ollama") || lower.includes("llama")) return "Ollama — AI inference";
  if (lower.includes("comfy")) return "ComfyUI — generation";
  if (lower.includes("unity")) return "Unity — 3D pipeline";
  if (lower.includes("blender")) return "Blender — 3D pipeline";
  if (lower.includes("python")) return "Python — backend service";
  if (lower.includes("node")) return "Node.js — server / tooling";
  if (lower.includes("chrome") || lower.includes("edge") || lower.includes("browser"))
    return "Browser — UI";
  if (lower.includes("ffmpeg")) return "FFmpeg — media encode / decode";
  if (lower.includes("remotion")) return "Remotion — video compositing";
  if (lower.includes("dwm.exe")) return "Desktop Window Manager";
  if (lower.includes("csrss")) return "Windows subsystem";
  if (lower.includes("explorer")) return "Windows Explorer";
  if (lower.includes("code.exe")) return "VS Code";
  if (lower.includes("opencode")) return "OpenCode — agent runtime";
  return "GPU compute";
}

function iconForProcess(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("python")) return "🐍";
  if (l.includes("unity")) return "🎮";
  if (l.includes("blender")) return "🎨";
  if (l.includes("ollama") || l.includes("llama")) return "🦙";
  if (l.includes("comfy")) return "🖼️";
  if (l.includes("chrome") || l.includes("edge") || l.includes("browser")) return "🌐";
  if (l.includes("node")) return "⬢";
  if (l.includes("ffmpeg") || l.includes("remotion")) return "🎬";
  if (l.includes("dwm") || l.includes("csrss") || l.includes("explorer") || l.includes("system") || l.includes("svchost")) return "🪟";
  return "▣";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTempColor(c: number): string {
  if (c >= 85) return "#ef4444";
  if (c >= 75) return "#f97316";
  if (c >= 65) return "#f59e0b";
  return "#22c55e";
}

function getUsageColor(pct: number): string {
  if (pct < 50) return "#22c55e";
  if (pct < 75) return "#f59e0b";
  return "#ef4444";
}

const MAX_HISTORY = 17280; // 24h at 5s poll (~500KB JSON)
const HISTORY_KEY = "gpu:history:v2";
const POLL_OPTIONS = [5, 10, 30] as const;

const RANGE_OPTIONS = [
  { id: "5m", label: "5m", ms: 5 * 60 * 1000 },
  { id: "15m", label: "15m", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1h", ms: 60 * 60 * 1000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60 * 1000 },
  { id: "12h", label: "12h", ms: 12 * 60 * 60 * 1000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
] as const;
type RangeId = (typeof RANGE_OPTIONS)[number]["id"];

interface DataPoint {
  time: number;
  label: string;
  temp?: number;
  vram?: number;
  util?: number;
}

function loadHistory(): DataPoint[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DataPoint[];
    if (!Array.isArray(parsed)) return [];
    // cap and filter to last 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return parsed.filter((p) => p.time > cutoff).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function downsample(data: DataPoint[], maxPoints: number): DataPoint[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const out: DataPoint[] = [];
  for (let i = 0; i < data.length; i += step) {
    // average bucket for smoother long ranges
    const bucket = data.slice(i, i + step);
    const avg = (key: keyof DataPoint) => {
      const vals = bucket.map((d) => d[key] as number).filter((v) => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
    };
    out.push({
      time: bucket[Math.floor(bucket.length / 2)].time,
      label: bucket[Math.floor(bucket.length / 2)].label,
      temp: avg("temp"),
      vram: avg("vram"),
      util: avg("util"),
    });
  }
  return out;
}

function calcStats(values: (number | undefined)[]) {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return { avg: 0, min: 0, max: 0, cur: 0, trend: "flat" as const, slope: 0 };
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const cur = nums[nums.length - 1];
  // trend via simple linear regression over last 40 points or full if smaller
  const n = Math.min(nums.length, 40);
  const slice = nums.slice(-n);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < slice.length; i++) { sumX += i; sumY += slice[i]; sumXY += i * slice[i]; sumX2 += i * i; }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
  const trend = slope > 0.08 ? "up" : slope < -0.08 ? "down" : "flat";
  return { avg, min, max, cur, trend: trend as "up" | "down" | "flat", slope };
}

export function GpuMonitorPage() {
  const [snapshot, setSnapshot] = useState<GPUSnapshot | null>(null);
  const [processes, setProcesses] = useState<GPUProcessInfo[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DataPoint[]>(() => loadHistory());
  const [showIdle, setShowIdle] = useState(false);
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [range, setRange] = useState<RangeId>(() => {
    const v = localStorage.getItem("gpu:range") as RangeId | null;
    return (RANGE_OPTIONS.some((r) => r.id === v) ? v : "1h") as RangeId;
  });
  const [intervalSec, setIntervalSec] = useState<number>(() => {
    const v = Number(localStorage.getItem("gpu:pollInterval"));
    return POLL_OPTIONS.includes(v as (typeof POLL_OPTIONS)[number]) ? v : 5;
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const isHiddenRef = useRef(false);

  // persist interval + range
  useEffect(() => {
    localStorage.setItem("gpu:pollInterval", String(intervalSec));
  }, [intervalSec]);
  useEffect(() => {
    localStorage.setItem("gpu:range", range);
  }, [range]);
  // persist history (debounced via effect)
  useEffect(() => {
    if (history.length === 0) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch {
      // storage full — trim to 6h
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-4320))); } catch { /* ignore */ }
    }
  }, [history]);

  // visibility pause (don't waste NVML while tab hidden)
  useEffect(() => {
    const onVis = () => {
      isHiddenRef.current = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const [dbSynced, setDbSynced] = useState(false);
  const hasLoadedRef = useRef(false);

  // Database-backed history hydration (survives reloads / reboots / across devices if DB shared)
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
        // merge DB points + any newer live points not yet in DB (last 30s)
        const newestDb = dbPoints[dbPoints.length - 1]?.time ?? 0;
        const liveTail = prev.filter((x) => x.time > newestDb);
        const merged = [...dbPoints, ...liveTail].sort((a, b) => a.time - b.time).slice(-MAX_HISTORY);
        // also refresh localStorage cache from merged
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(merged.slice(-MAX_HISTORY))); } catch { /* ignore */ }
        return merged;
      });
      setDbSynced(true);
    } catch {
      // fallback to localStorage-only — already loaded
      setDbSynced(false);
    }
  }, []);

  useEffect(() => { hydrateFromDB(range); }, [hydrateFromDB, range]);

  const fetchAll = useCallback(
    async (isManual = false) => {
      if (isHiddenRef.current && !isManual) return;
      if (!hasLoadedRef.current) setInitialLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [gpu, procs] = await Promise.all([
          getGPUSnapshot(),
          getGPUProcesses().catch(() => ({ processes: [] as GPUProcessInfo[], count: 0 })),
        ]);
        setSnapshot(gpu);
        setProcesses(procs.processes || []);
        setLastUpdated(Date.now());
        hasLoadedRef.current = true;
        if (gpu.available) {
          setHistory((prev) => {
            const now = Date.now();
            const point: DataPoint = {
              time: now,
              label: new Date(now).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }),
              temp: gpu.temperature_c,
              vram: gpu.memory_percent,
              util: gpu.gpu_utilization,
            };
            return [...prev, point].slice(-MAX_HISTORY);
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch GPU telemetry");
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => fetchAll(false), intervalSec * 1000);
    return () => clearInterval(id);
  }, [fetchAll, paused, intervalSec]);

  const temp = snapshot?.temperature_c ?? 0;
  const memPct = snapshot?.memory_percent ?? 0;
  const util = snapshot?.gpu_utilization ?? 0;
  const tempColor = getTempColor(temp);

  const thermalStatus = useMemo(() => {
    if (!snapshot?.available) return { text: "Unavailable", color: "text-muted", icon: null as React.ReactNode };
    if (temp >= 90) return { text: "Critical", color: "text-red-400", icon: <AlertTriangle size={14} /> };
    if (temp >= 80) return { text: "Hot", color: "text-orange-400", icon: <AlertTriangle size={14} /> };
    if (temp >= 70) return { text: "Warm", color: "text-amber-400", icon: null };
    if (temp >= 50) return { text: "Normal", color: "text-emerald-400", icon: <CheckCircle2 size={14} /> };
    return { text: "Cool", color: "text-emerald-400", icon: <CheckCircle2 size={14} /> };
  }, [snapshot, temp]);

  const filtered = useMemo(() => {
    let list = processes;
    if (!showIdle) list = list.filter((p) => (p.mem_mb ?? 0) > 1);
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
  }, [processes, showIdle, query]);

  const hiddenIdleCount = processes.length - processes.filter((p) => (p.mem_mb ?? 0) > 1).length;
  const totalAccounted = processes.reduce((a, p) => a + (p.mem_mb || 0), 0);

  // ---- Trending history: window + downsample + stats ----
  const rangeMs = useMemo(() => RANGE_OPTIONS.find((r) => r.id === range)?.ms ?? 3600000, [range]);
  const windowHistory = useMemo(() => {
    if (history.length === 0) return [];
    const cutoff = Date.now() - rangeMs;
    // keep at least 2 points even if range is small and history sparse
    const win = history.filter((p) => p.time >= cutoff);
    return win.length >= 2 ? win : history.slice(-20);
  }, [history, rangeMs]);
  const chartData = useMemo(() => downsample(windowHistory, 300), [windowHistory]);
  const tempStats = useMemo(() => calcStats(windowHistory.map((d) => d.temp)), [windowHistory]);
  const vramStats = useMemo(() => calcStats(windowHistory.map((d) => d.vram)), [windowHistory]);
  const utilStats = useMemo(() => calcStats(windowHistory.map((d) => d.util)), [windowHistory]);
  const rangeLabel = useMemo(() => RANGE_OPTIONS.find((r) => r.id === range)?.label ?? range, [range]);
  const trendIcon = (t: string) => (t === "up" ? <TrendingUp size={12} className="text-red-400" /> : t === "down" ? <TrendingDown size={12} className="text-emerald-400" /> : <Minus size={12} className="text-muted" />);

  const handleExport = useCallback(() => {
    const rows = [["time", "iso", "temp_c", "vram_pct", "gpu_pct"]];
    for (const p of windowHistory) rows.push([String(p.time), new Date(p.time).toISOString(), String(p.temp ?? ""), String(p.vram ?? ""), String(p.util ?? "")]);
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gpu-history-${range}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [windowHistory, range]);
  const handleClear = useCallback(async () => {
    if (!confirm(`Clear ${history.length} stored points? This wipes local cache + database (14-day retention).`)) return;
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
    try { await clearGPUHistory(0); hydrateFromDB(range); } catch { /* ignore */ }
  }, [history.length, hydrateFromDB, range]);

  return (
    <div className="max-w-[1100px] mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CpuIcon size={22} className="text-violet-400" />
            GPU Monitor
            {refreshing && <Loader2 size={14} className="animate-spin text-violet-400" />}
            {paused && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20">Paused</span>}
          </h1>
          <p className="text-xs text-muted mt-1">
            Real-time telemetry for {snapshot?.name || "your GPU"} — temperature, VRAM, utilization, and per-process attribution.
          </p>
          {lastUpdated && (
            <p className="text-[11px] text-muted/60 mt-1 flex items-center gap-1.5">
              <Clock3 size={11} />
              Last updated {new Date(lastUpdated).toLocaleTimeString()} • every {intervalSec}s{paused ? " (paused)" : isHiddenRef.current ? " (tab hidden)" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 p-1">
            {POLL_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setIntervalSec(s)}
                className={`text-[11px] px-2 py-1 rounded-md transition ${intervalSec === s ? "bg-violet-600 text-white" : "text-muted hover:text-white hover:bg-white/10"}`}
              >
                {s}s
              </button>
            ))}
          </div>
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10"
            title={paused ? "Resume polling" : "Pause polling"}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing || initialLoading}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {refreshing || initialLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {initialLoading ? (
        <Card>
          <div className="flex items-center gap-3 py-6 justify-center text-sm text-muted">
            <Loader2 size={16} className="animate-spin" /> Loading GPU telemetry…
          </div>
        </Card>
      ) : !snapshot?.available ? (
        <Card>
          <p className="text-sm text-muted">GPU monitoring requires NVIDIA drivers with NVML support.</p>
          <p className="text-xs text-muted/60 mt-1">Checked NVML + torch.cuda fallback — neither reported a GPU.</p>
        </Card>
      ) : (
        <>
          {/* Top metrics — with inline sparklines + donut for VRAM */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Temperature */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Thermometer size={14} className="text-rose-400" />
                <span className="text-xs text-muted">Temperature</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-muted">{history.length} samples</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: tempColor }}>
                {temp.toFixed(0)}°C
              </p>
              <p className={`text-xs mt-1 flex items-center gap-1 ${thermalStatus.color}`}>
                {thermalStatus.icon}
                {thermalStatus.text}
              </p>
              <div className="h-[36px] mt-2 -mx-1 opacity-90">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history.slice(-30)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <Area type="monotone" dataKey="temp" stroke={tempColor} strokeWidth={1.5} fill={tempColor + "33"} dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* VRAM */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <MemoryStick size={14} className="text-violet-400" />
                <span className="text-xs text-muted">VRAM</span>
                <span className="ml-auto text-[11px] text-muted">{snapshot.memory_used_mb} / {snapshot.memory_total_mb} MB</span>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-2xl font-bold" style={{ color: getUsageColor(memPct) }}>
                  {memPct.toFixed(1)}%
                </p>
                {/* donut */}
                <svg width={36} height={36} viewBox="0 0 36 36" className="ml-auto shrink-0">
                  <circle cx={18} cy={18} r={14} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
                  <circle cx={18} cy={18} r={14} fill="none" stroke={getUsageColor(memPct)} strokeWidth={4} strokeLinecap="round"
                    strokeDasharray={`${(memPct / 100) * 87.96} 87.96`} transform="rotate(-90 18 18)" className="transition-all" />
                </svg>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden relative">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(memPct, 100)}%`, background: getUsageColor(memPct) }} />
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/30" style={{ left: "75%" }} title="75% warn" />
              </div>
              <p className="text-[11px] text-muted mt-1.5 flex items-center gap-1">
                <Zap size={11} className="text-violet-400" /> {snapshot.memory_free_mb} MB free
              </p>
              <div className="h-[28px] mt-1 -mx-1 opacity-90">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history.slice(-30)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <Area type="monotone" dataKey="vram" stroke="#a855f7" strokeWidth={1.5} fill="#a855f733" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* GPU Utilization */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-emerald-400" />
                <span className="text-xs text-muted">GPU Utilization</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: getUsageColor(util) }}>
                {util.toFixed(0)}%
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(util, 100)}%`, background: getUsageColor(util) }} />
              </div>
              <p className="text-xs text-muted mt-1.5">Mem ctrl: {snapshot.memory_controller_utilization ?? 0}%</p>
              <div className="h-[36px] mt-2 -mx-1 opacity-90">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history.slice(-30)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <Area type="monotone" dataKey="util" stroke="#22c55e" strokeWidth={1.5} fill="#22c55e33" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Thermal headroom */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-amber-400" />
                <span className="text-xs text-muted">Thermal Headroom</span>
              </div>
              <p className="text-2xl font-bold text-white">{temp >= 85 ? "Low" : temp >= 70 ? "Medium" : "High"}</p>
              <div className="mt-2 flex gap-1">
                <div className={`h-1.5 flex-1 rounded-full ${temp < 65 ? "bg-emerald-500" : "bg-white/10"}`} />
                <div className={`h-1.5 flex-1 rounded-full ${temp >= 65 && temp < 85 ? "bg-amber-500" : temp >= 85 ? "bg-amber-500/40" : "bg-white/10"}`} />
                <div className={`h-1.5 flex-1 rounded-full ${temp >= 85 ? "bg-red-500" : "bg-white/10"}`} />
              </div>
              <p className="text-xs text-muted mt-1.5">
                {temp >= 85
                  ? "Approaching throttle — reduce concurrent workloads"
                  : temp >= 70
                    ? "Warm — fan curve active"
                    : "Cool — safe for sustained loads"}
              </p>
            </Card>
          </div>

          {/* Trending controls */}
          <Card className="!p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted flex items-center gap-1.5"><History size={12} /> Window</span>
              <div className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 p-1">
                {RANGE_OPTIONS.map((r) => (
                  <button key={r.id} onClick={() => setRange(r.id)} className={`text-[11px] px-2.5 py-1 rounded-md transition ${range === r.id ? "bg-violet-600 text-white" : "text-muted hover:text-white hover:bg-white/10"}`}>{r.label}</button>
                ))}
              </div>
              <span className="text-[11px] text-muted/70">{windowHistory.length} points • {history.length} stored • {rangeLabel} window{dbSynced ? " • DB ✓" : " • local only"}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={handleExport} disabled={windowHistory.length < 2} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 disabled:opacity-40"><Download size={12} /> Export CSV</button>
                <button onClick={handleClear} disabled={history.length === 0} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted hover:text-red-300 disabled:opacity-40"><Trash2 size={12} /> Clear</button>
              </div>
            </div>
            {/* inline stats — responsive: 1 col on <640px */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
              <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted"><Thermometer size={11} className="text-rose-400" /> Temp <span className="ml-auto flex items-center gap-1">{trendIcon(tempStats.trend)} <span className="text-[10px]">{tempStats.trend}</span></span></div>
                <p className="text-sm font-semibold text-white mt-1">{tempStats.cur.toFixed(0)}°C <span className="text-[11px] font-normal text-muted">avg {tempStats.avg.toFixed(0)}° • {tempStats.min.toFixed(0)}–{tempStats.max.toFixed(0)}°</span></p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted"><MemoryStick size={11} className="text-violet-400" /> VRAM <span className="ml-auto flex items-center gap-1">{trendIcon(vramStats.trend)} <span className="text-[10px]">{vramStats.trend}</span></span></div>
                <p className="text-sm font-semibold text-white mt-1">{vramStats.cur.toFixed(1)}% <span className="text-[11px] font-normal text-muted">avg {vramStats.avg.toFixed(1)}% • {vramStats.min.toFixed(1)}–{vramStats.max.toFixed(1)}%</span></p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted"><Activity size={11} className="text-emerald-400" /> Util <span className="ml-auto flex items-center gap-1">{trendIcon(utilStats.trend)} <span className="text-[10px]">{utilStats.trend}</span></span></div>
                <p className="text-sm font-semibold text-white mt-1">{utilStats.cur.toFixed(0)}% <span className="text-[11px] font-normal text-muted">avg {utilStats.avg.toFixed(0)}% • {utilStats.min.toFixed(0)}–{utilStats.max.toFixed(0)}%</span></p>
              </div>
            </div>
            {windowHistory.length >= 6 && (
              <p className="text-[11px] text-muted/60 mt-2 flex items-center gap-1.5"><BarChart3 size={11} />
                {vramStats.trend === "up" && tempStats.trend === "up" ? "Pattern: load building — VRAM and temp rising together. Consider closing a heavy app before next render." :
                 vramStats.trend === "up" && utilStats.trend === "flat" ? "Pattern: VRAM creeping up while GPU idle — likely a leak or cached model not released." :
                 utilStats.trend === "up" && vramStats.trend === "flat" ? "Pattern: compute-bound burst — GPU busy without extra VRAM (shaders / encode)." :
                 tempStats.trend === "up" && vramStats.trend === "flat" ? "Pattern: thermal climb without VRAM growth — check fan curve / airflow." :
                 vramStats.trend === "down" ? "Pattern: VRAM easing — recent release or process exit freed memory." :
                 "Pattern: stable window — no strong drift in VRAM/temp/util."}
              </p>
            )}
          </Card>

          {/* Charts — now range-aware */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Temperature history */}
            <Card title={`Temperature — ${rangeLabel}`} className="!p-4">
              {chartData.length < 2 ? (
                <div className="h-48 flex items-center justify-center text-xs text-muted">Collecting data… {chartData.length}/2 points ({history.length} stored)</div>
              ) : (
                <div className="h-52" role="img" aria-label={`Temperature trend over ${rangeLabel}, drag brush handles to zoom, throttle at 83°C`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} syncId="gpu">
                      <defs>
                        <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} interval="preserveStartEnd" minTickGap={50} />
                      <YAxis domain={[30, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} label={{ value: "°C", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: "rgba(15,15,20,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "#e5e7eb" }}
                      />
                      <ReferenceLine y={83} stroke="#f97316" strokeDasharray="4 4" label={{ value: "throttle", position: "insideTopRight", fill: "#fb923c", fontSize: 9 }} />
                      <Area type="monotone" dataKey="temp" stroke="#ef4444" strokeWidth={2} fill="url(#tempGrad)" name="Temp °C" dot={false} activeDot={{ r: 3, strokeWidth: 1 }} isAnimationActive={false} />
                      {chartData.length > 40 && <Brush dataKey="label" height={18} stroke="#ef4444" fill="rgba(255,255,255,0.03)" tickFormatter={() => ""} aria-label="Brush to zoom temperature history" />}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* VRAM & Utilization history */}
            <Card title={`VRAM & Utilization — ${rangeLabel}`} className="!p-4">
              {chartData.length < 2 ? (
                <div className="h-48 flex items-center justify-center text-xs text-muted">Collecting data… {chartData.length}/2 points</div>
              ) : (
                <div className="h-52" role="img" aria-label={`VRAM and GPU utilization over ${rangeLabel}, drag brush handles to zoom, warn at 75%`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} syncId="gpu">
                      <defs>
                        <linearGradient id="vramGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} interval="preserveStartEnd" minTickGap={50} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} label={{ value: "%", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: "rgba(15,15,20,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "#e5e7eb" }}
                      />
                      <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="vram" stroke="#a855f7" strokeWidth={2} fill="url(#vramGrad)" name="VRAM %" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                      <Area type="monotone" dataKey="util" stroke="#22c55e" strokeWidth={2} fill="url(#utilGrad)" name="GPU %" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                      {chartData.length > 40 && <Brush dataKey="label" height={18} stroke="#a855f7" fill="rgba(255,255,255,0.03)" tickFormatter={() => ""} aria-label="Brush to zoom VRAM and utilization history" />}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          {/* Long-term overview when we have >15m of data */}
          {history.length > 30 && (
            <Card title="Long-term overview (all stored)" className="!p-4"
              headerActions={<span className="text-[11px] text-muted">{history.length} points • ~{((history[history.length-1].time - history[0].time)/60000).toFixed(0)} min</span>}>
              <div className="h-36" role="img" aria-label="Long-term overview of all stored GPU history, drag brush to zoom">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={downsample(history, 200)} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" minTickGap={60} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#6b7280" }} />
                    <Tooltip contentStyle={{ background: "rgba(15,15,20,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }} />
                    <Line type="monotone" dataKey="vram" stroke="#a855f7" strokeWidth={1.5} dot={false} name="VRAM %" />
                    <Line type="monotone" dataKey="util" stroke="#22c55e" strokeWidth={1.5} dot={false} name="GPU %" />
                    <Line type="monotone" dataKey="temp" stroke="#ef4444" strokeWidth={1} dot={false} name="Temp °C" />
                    <Brush dataKey="label" height={16} stroke="#6366f1" fill="rgba(255,255,255,0.02)" tickFormatter={() => ""} aria-label="Brush to zoom long-term overview" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted/60 mt-2">Persisted in database ({dbSynced ? "DB + local cache" : "local fallback"}) — 14-day retention, survives reloads & reboots. Background logger snapshots every 10s even when page closed.</p>
            </Card>
          )}

          {/* Processes */}
          <Card
            title="GPU Processes"
            className="!p-4"
            headerActions={
              <span className="text-[11px] text-muted">
                {filtered.length} shown • {totalAccounted.toLocaleString()} MB accounted • {snapshot.memory_used_mb} MB total
              </span>
            }
          >
            {/* Stacked attribution bar — top 6 share */}
            {filtered.length > 1 && (
              <div className="mb-3">
                <div className="flex h-2 rounded-full overflow-hidden bg-white/10">
                  {filtered.slice(0, 6).map((p, i) => {
                    const colors = ["bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-teal-500"];
                    const share = totalAccounted ? ((p.mem_mb || 0) / totalAccounted) * 100 : 0;
                    if (share < 1) return null;
                    return <div key={p.pid} className={`${colors[i % colors.length]} transition-all`} style={{ width: `${share}%` }} title={`${labelForProcess(p.name)} ${share.toFixed(1)}%`} />;
                  })}
                  {(() => {
                    const top6 = filtered.slice(0, 6).reduce((a, p) => a + (p.mem_mb || 0), 0);
                    const rest = totalAccounted - top6;
                    const restShare = totalAccounted ? (rest / totalAccounted) * 100 : 0;
                    return restShare > 1 ? <div className="bg-white/20" style={{ width: `${restShare}%` }} title={`Other ${restShare.toFixed(1)}%`} /> : null;
                  })()}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                  {filtered.slice(0, 6).map((p, i) => {
                    const colors = ["bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-teal-500"];
                    const share = totalAccounted ? ((p.mem_mb || 0) / totalAccounted) * 100 : 0;
                    if (share < 2) return null;
                    return <span key={p.pid} className="flex items-center gap-1 text-[11px] text-muted"><span className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />{labelForProcess(p.name).split(" —")[0]} {share.toFixed(0)}%</span>;
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by name or PID…"
                  aria-label="Filter GPU processes by name or PID"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-muted focus:outline-none focus:border-violet-500/50"
                />
              </div>
              <button
                onClick={() => setShowIdle((v) => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition ${showIdle ? "bg-white/10 border-white/15 text-white" : "bg-white/5 border-white/10 text-muted hover:text-white"}`}
              >
                {showIdle ? <Eye size={14} /> : <EyeOff size={14} />}
                {showIdle ? "Hide idle" : `Show idle (${hiddenIdleCount})`}
              </button>
              {query && (
                <button onClick={() => setQuery("")} className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-muted hover:text-white flex items-center gap-1">
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
                  const share = snapshot.memory_total_mb ? (mem / snapshot.memory_total_mb) * 100 : 0;
                    return (
                    <div
                      key={`${proc.pid}-${proc.name}`}
                      className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2 hover:bg-white/[0.04] transition border-l-2"
                      style={{ borderLeftColor: isLarge ? "#f59e0b" : share > 5 ? "#a855f7" : "rgba(255,255,255,0.08)" }}
                      title={`PID ${proc.pid} — ${proc.name} — ${mem} MB (${share.toFixed(1)}% of VRAM)`}
                    >
                      <span className="text-sm leading-none shrink-0" aria-hidden>
                        {iconForProcess(proc.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">{label}</p>
                        <p className="text-[11px] text-muted truncate">
                          PID {proc.pid} • {proc.name}
                        </p>
                        <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden max-w-[220px]">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(share, 100)}%`, background: getUsageColor(share * 2) }} />
                        </div>
                      </div>
                      <span className={`font-mono text-xs shrink-0 ${isLarge ? "text-amber-300" : "text-gray-300"}`}>
                        {isLarge ? `${(mem / 1024).toFixed(1)} GB` : `${mem} MB`}
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
        </>
      )}
    </div>
  );
}
