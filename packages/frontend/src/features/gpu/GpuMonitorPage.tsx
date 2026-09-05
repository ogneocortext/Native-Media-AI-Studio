import { useEffect, useState, useMemo, useCallback } from "react";
import { Card } from "../../components/common";
import {
  getGPUSnapshot,
  getGPUProcesses,
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
  // Direct match first
  if (PROCESS_LABELS[name]) return PROCESS_LABELS[name];
  // Substring match
  for (const [key, label] of Object.entries(PROCESS_LABELS)) {
    if (lower.includes(key.toLowerCase())) return label;
  }
  // Heuristics
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
  return "GPU compute";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTempColor(c: number): string {
  if (c >= 85) return "#ef4444"; // red
  if (c >= 75) return "#f97316"; // orange
  if (c >= 65) return "#f59e0b"; // amber
  return "#22c55e"; // green
}

function getUsageColor(pct: number): string {
  if (pct < 50) return "#22c55e";
  if (pct < 75) return "#f59e0b";
  return "#ef4444";
}

const MAX_HISTORY = 60; // points (~5 min at 5s poll)

interface DataPoint {
  time: number;
  label: string;
  temp?: number;
  vram?: number;
  util?: number;
}

export function GpuMonitorPage() {
  const [snapshot, setSnapshot] = useState<GPUSnapshot | null>(null);
  const [processes, setProcesses] = useState<GPUProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<DataPoint[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [gpu, procs] = await Promise.all([
        getGPUSnapshot(),
        getGPUProcesses().catch(() => ({ processes: [] })),
      ]);
      setSnapshot(gpu);
      setProcesses(procs.processes || []);

      if (gpu.available) {
        setHistory((prev) => {
          const now = Date.now();
          const point: DataPoint = {
            time: now,
            label: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            temp: gpu.temperature_c,
            vram: gpu.memory_percent,
            util: gpu.gpu_utilization,
          };
          const next = [...prev, point].slice(-MAX_HISTORY);
          return next;
        });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const temp = snapshot?.temperature_c ?? 0;
  const memPct = snapshot?.memory_percent ?? 0;
  const util = snapshot?.gpu_utilization ?? 0;
  const tempColor = getTempColor(temp);

  // Thermal status label
  const thermalStatus = useMemo(() => {
    if (!snapshot?.available) return { text: "Unavailable", color: "text-muted", icon: null };
    if (temp >= 90) return { text: "Critical", color: "text-red-400", icon: <AlertTriangle size={14} /> };
    if (temp >= 80) return { text: "Hot", color: "text-orange-400", icon: <AlertTriangle size={14} /> };
    if (temp >= 70) return { text: "Warm", color: "text-amber-400", icon: null };
    if (temp >= 50) return { text: "Normal", color: "text-emerald-400", icon: <CheckCircle2 size={14} /> };
    return { text: "Cool", color: "text-emerald-400", icon: <CheckCircle2 size={14} /> };
  }, [snapshot, temp]);

  return (
    <div className="max-w-[1100px] mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CpuIcon size={22} className="text-violet-400" />
            GPU Monitor
          </h1>
          <p className="text-xs text-muted mt-1">
            Real-time telemetry for {snapshot?.name || "your GPU"} — temperature, VRAM, utilization, and per-process attribution.
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {!snapshot?.available && (
        <Card>
          <p className="text-sm text-muted">GPU monitoring requires NVIDIA drivers with NVML support.</p>
        </Card>
      )}

      {snapshot?.available && (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Temperature */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Thermometer size={14} className="text-rose-400" />
                <span className="text-xs text-muted">Temperature</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: tempColor }}>
                {temp.toFixed(0)}°C
              </p>
              <p className={`text-xs mt-1 flex items-center gap-1 ${thermalStatus.color}`}>
                {thermalStatus.icon}
                {thermalStatus.text}
              </p>
            </Card>

            {/* VRAM */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <MemoryStick size={14} className="text-violet-400" />
                <span className="text-xs text-muted">VRAM</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: getUsageColor(memPct) }}>{memPct.toFixed(1)}%</p>
              <p className="text-xs text-muted mt-1">
                {snapshot.memory_used_mb}MB / {snapshot.memory_total_mb}MB
              </p>
            </Card>

            {/* GPU Utilization */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-emerald-400" />
                <span className="text-xs text-muted">GPU Utilization</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: getUsageColor(util) }}>{util.toFixed(0)}%</p>
              <p className="text-xs text-muted mt-1">
                Memory controller: {snapshot.memory_controller_utilization ?? 0}%
              </p>
            </Card>

            {/* Fan / Thermal hint */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-amber-400" />
                <span className="text-xs text-muted">Thermal Headroom</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {temp >= 85 ? "Low" : temp >= 70 ? "Medium" : "High"}
              </p>
              <p className="text-xs text-muted mt-1">
                {temp >= 85
                  ? "Approaching throttle — reduce concurrent workloads"
                  : temp >= 70
                    ? "Warm — fan curve active"
                    : "Cool — safe for sustained loads"}
              </p>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Temperature history */}
            <Card title="Temperature" className="!p-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      interval="preserveStartEnd"
                      minTickGap={60}
                    />
                    <YAxis
                      domain={[30, 100]}
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      label={{ value: "°C", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{ background: "rgba(15,15,20,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#e5e7eb" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="temp"
                      stroke="#ef4444"
                      strokeWidth={2}
                      fill="url(#tempGrad)"
                      name="Temp °C"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* VRAM + Utilization history */}
            <Card title="VRAM & Utilization" className="!p-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
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
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      interval="preserveStartEnd"
                      minTickGap={60}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                      label={{ value: "%", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{ background: "rgba(15,15,20,0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#e5e7eb" }}
                    />
                    <Area type="monotone" dataKey="vram" stroke="#a855f7" strokeWidth={2} fill="url(#vramGrad)" name="VRAM %" />
                    <Area type="monotone" dataKey="util" stroke="#22c55e" strokeWidth={2} fill="url(#utilGrad)" name="GPU %" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Processes */}
          <Card title="GPU Processes" className="!p-4">
            {processes.length === 0 ? (
              <p className="text-xs text-muted">No GPU compute processes detected.</p>
            ) : (
              <div className="space-y-2">
                {processes
                  .slice()
                  .sort((a, b) => (b.mem_mb || 0) - (a.mem_mb || 0))
                  .map((proc, i) => {
                    const label = labelForProcess(proc.name);
                    const mem = proc.mem_mb ?? 0;
                    const isLarge = mem >= 1024;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate" title={`PID ${proc.pid} — ${proc.name}`}>
                            {label}
                          </p>
                          <p className="text-[11px] text-muted">
                            PID {proc.pid} • {proc.name}
                          </p>
                        </div>
                        <span
                          className={`ml-3 font-mono text-xs shrink-0 ${
                            isLarge ? "text-amber-300" : "text-gray-300"
                          }`}
                        >
                          {isLarge ? `${(mem / 1024).toFixed(1)}GB` : `${mem}MB`}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
