import { useState, useEffect, useCallback } from "react";
import {
  CpuIcon,
  MemoryStick,
  Activity,
  Thermometer,
  RefreshCw,
} from "lucide-react";
import { Card } from "../../components/common";
import { useHealthStore } from "../../state/healthStore";
import { getApiBaseUrl } from "../../services/portConfig";
import { getUsageColor, getUsageTextColor } from "./utils";

const WORKLOAD_LABELS: Record<string, string> = {
  idle: "Idle",
  llm_inference: "LLM Inference",
  render_3d: "3D Render",
  image_generation: "Image Generation",
  music_generation: "Music Generation",
  audio_analysis: "Audio Analysis",
  lipsync: "Lip Sync",
};

const WORKLOAD_COLORS: Record<string, string> = {
  idle: "text-emerald-400 border-emerald-500/20",
  llm_inference: "text-violet-400 border-violet-500/20",
  render_3d: "text-blue-400 border-blue-500/20",
  image_generation: "text-pink-400 border-pink-500/20",
  music_generation: "text-orange-400 border-orange-500/20",
  audio_analysis: "text-cyan-400 border-cyan-500/20",
  lipsync: "text-rose-400 border-rose-500/20",
};

export function GPUCard() {
  const [gpu, setGpu] = useState<Awaited<
    ReturnType<typeof import("../../services/api").getGPUSnapshot>
  > | null>(null);
  const [processes, setProcesses] = useState<import("../../services/api").GPUProcessInfo[]>([]);
  const fetchGPUData = useHealthStore((s) => s.fetchGPUData);
  const fetchVRAM = useHealthStore((s) => s.fetchVRAMStatus);
  const granular = useHealthStore((s) => s.granular);

  useEffect(() => {
    void fetchGPUData();
    const interval = setInterval(fetchGPUData, 10000); // Increased from 5s to 10s
    return () => clearInterval(interval);
  }, [fetchGPUData]);

  useEffect(() => {
    const snapshot = granular.gpu.snapshot;
    const procData = granular.gpu.processes;
    if (snapshot) setGpu(snapshot);
    if (procData.processes) setProcesses(procData.processes);
  }, [granular.gpu.snapshot, granular.gpu.processes]);

  const manager = granular.manager ?? null;
  const hasManager = manager != null && Object.keys(manager).length > 0;

  const handleOffloadOllama = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/integrations/vram/offload-ollama`, {
        method: "POST",
      });
      if (res.ok) await fetchVRAM();
    } catch {
      /* ignore */
    }
  }, [fetchVRAM]);

  const handleReloadOllama = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/integrations/vram/reload-ollama`, {
        method: "POST",
      });
      if (res.ok) await fetchVRAM();
    } catch {
      /* ignore */
    }
  }, [fetchVRAM]);

  const workload = (manager?.current_workload ?? "idle") as string;
  const hasWorkload = hasManager && manager?.current_workload != null;
  const workloadLabel = WORKLOAD_LABELS[workload] ?? workload;

  // VRAM-manager section — shared by both the available and unavailable
  // branches so workload/model state still renders if NVML is missing.
  const managerSection = hasManager ? (
    <div className="space-y-3 pt-3 border-t border-white/5">
      <div className="flex justify-between text-sm">
        <span className="text-muted flex items-center gap-1">
          <CpuIcon size={12} /> Workload
        </span>
        <span
          className={`font-bold tabular-nums ${WORKLOAD_COLORS[workload] ?? WORKLOAD_COLORS.idle}`}
        >
          {hasWorkload ? workloadLabel : "—"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <ModelPill
          label="Ollama"
          loaded={manager?.ollama_loaded === true}
          hasData
          onOffload={handleOffloadOllama}
          onReload={handleReloadOllama}
        />
        <ModelPill
          label="Atomic Chat"
          loaded={manager?.atomic_chat_loaded === true}
          hasData
        />
        <ModelPill
          label="ComfyUI"
          loaded={manager?.comfyui_models_loaded === true}
          busy={manager?.comfyui_busy === true}
          hasData
        />
        <ModelPill
          label="Music Gen"
          loaded={manager?.music_gen_running === true}
          hasData
        />
      </div>
    </div>
  ) : null;

  if (!gpu?.available) {
    return (
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <CpuIcon size={20} className="text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">GPU</h3>
              <p className="text-xs text-muted">Not available</p>
            </div>
          </div>
          <button
            onClick={fetchGPUData}
            className="h-6 w-6 flex items-center justify-center rounded text-muted hover:text-white hover:bg-white/10"
            title="Refresh GPU data"
            aria-label="Refresh GPU data"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <p className="text-xs text-muted">
          GPU monitoring requires NVIDIA drivers with NVML support
        </p>
        {managerSection}
      </Card>
    );
  }

  const memPercent = gpu.memory_percent || 0;
  const tempColor =
    gpu.temperature_c > 80 ? "#ef4444" : gpu.temperature_c > 70 ? "#f59e0b" : "#22c55e";
  const formatGB = (mb: number) =>
    mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
            <CpuIcon size={20} className="text-purple-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{gpu.name ?? "GPU"}</h3>
            <p className="text-xs text-muted tabular-nums truncate">
              {formatGB(gpu.memory_free_mb)} free / {formatGB(gpu.memory_total_mb)} total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-xs px-2 py-1 rounded-full font-medium tabular-nums"
            style={{
              background: `${getUsageColor(memPercent)}20`,
              color: getUsageTextColor(memPercent),
            }}
          >
            {memPercent.toFixed(1)}%
          </span>
          <a
            href="/gpu"
            className="text-[11px] text-violet-300 hover:text-violet-200"
            title="Open full GPU monitor"
          >
            Details →
          </a>
          <button
            onClick={fetchGPUData}
            className="h-6 w-6 flex items-center justify-center rounded text-muted hover:text-white hover:bg-white/10"
            title="Refresh GPU data"
            aria-label="Refresh GPU data"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* VRAM Usage */}
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted flex items-center gap-1">
              <MemoryStick size={12} /> VRAM
            </span>
            <span className="font-bold">{memPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2.5 bg-background rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${memPercent}%`, background: getUsageColor(memPercent) }}
            />
          </div>
          <p className="text-[11px] text-muted mt-1 tabular-nums">
            {formatGB(gpu.memory_total_mb - gpu.memory_free_mb)} used
          </p>
        </div>

        {/* GPU Utilization */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted flex items-center gap-1">
              <Activity size={12} /> GPU Utilization
            </span>
            <span className="font-bold">{gpu.gpu_utilization}%</span>
          </div>
          <div className="h-2.5 bg-background rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${gpu.gpu_utilization}%`,
                background: getUsageColor(gpu.gpu_utilization),
              }}
            />
          </div>
        </div>

        {/* Temperature */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted flex items-center gap-1">
            <Thermometer size={12} /> Temperature
          </span>
          <span
            className="font-bold tabular-nums"
            style={{ color: tempColor }}
            title={
              gpu.temperature_c >= 80
                ? "Hot — approaching throttle"
                : gpu.temperature_c >= 70
                  ? "Warm"
                  : "Normal"
            }
          >
            {gpu.temperature_c}°C
          </span>
        </div>

        {managerSection}

        {/* GPU Processes */}
        {processes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted">GPU Processes ({processes.length}):</p>
            </div>
            <div className="space-y-1">
              {processes.slice(0, 8).map((proc, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted truncate flex-1" title={`PID: ${proc.pid}`}>
                    {proc.name}
                  </span>
                  <span
                    className={`ml-2 font-mono ${proc.mem_mb >= 1024 ? "text-yellow-400" : "text-white"}`}
                  >
                    {proc.mem_mb >= 1024
                      ? `${(proc.mem_mb / 1024).toFixed(1)}GB`
                      : `${proc.mem_mb}MB`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

interface ModelPillProps {
  label: string;
  loaded: boolean;
  busy?: boolean;
  hasData: boolean;
  onOffload?: () => void;
  onReload?: () => void;
}

function ModelPill({ label, loaded, busy, hasData, onOffload, onReload }: ModelPillProps) {
  const canOffload = loaded && hasData && !!onOffload;
  const canReload = !loaded && hasData && !!onReload;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            hasData
              ? loaded
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
              : "bg-white/10 text-muted"
          }`}
        >
          {hasData ? (loaded ? "Loaded" : "Unloaded") : "—"}
        </span>
      </div>
      {busy && hasData && (
        <span className="text-[10px] text-amber-400 flex items-center gap-1">
          <Activity size={10} /> Busy
        </span>
      )}
      {!hasData && (
        <span className="text-[10px] text-muted/50 flex items-center gap-1">
          No data
        </span>
      )}
      <div className="flex gap-1">
        {canOffload && (
          <button
            onClick={onOffload}
            className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/40 hover:text-red-300 border border-red-500/30 disabled:opacity-50"
            title="Offload Ollama to free VRAM"
          >
            Offload
          </button>
        )}
        {canReload && (
          <button
            onClick={onReload}
            className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40 hover:text-emerald-300 border border-emerald-500/30 disabled:opacity-50"
            title="Reload Ollama to GPU"
          >
            Reload
          </button>
        )}
        {!canOffload && !canReload && (
          <span className="text-[10px] text-muted/50">—</span>
        )}
      </div>
    </div>
  );
}
