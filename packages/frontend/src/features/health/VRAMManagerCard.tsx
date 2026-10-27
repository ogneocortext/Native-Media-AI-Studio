// ---------------------------------------------------------------------------
// VRAMManagerCard.tsx — VRAM manager workload & model state
//
// Shows what the VRAM manager is doing (which workload is active, which
// models are resident, whether ComfyUI is busy) and lets the operator
// manually offload/reload Ollama without visiting the full GPU page.
//
// Null/void handling:
//   - While the first API poll is in flight, a "Loading…" state is shown
//     instead of blank "0 GB / 0 GB" numbers.
//   - If the API returns no data at all, an "No data" empty state renders
//     with a refresh button.
//   - Individual null/void fields are evaluated before display so no
//     "0" or "Unloaded" leaks through when the backend hasn't reported.
// ---------------------------------------------------------------------------
import { useCallback } from "react";
import { Activity, Cpu, Loader2, MemoryStick } from "lucide-react";
import { Card } from "../../components/common";
import { getApiBaseUrl } from "../../services/portConfig";
import { useHealthStore } from "../../state/healthStore";

interface VRAMManagerCardProps {
  className?: string;
}

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

export function VRAMManagerCard({ className = "" }: VRAMManagerCardProps) {
  const fetchVRAM = useHealthStore((s) => s.fetchVRAMStatus);
  const granular = useHealthStore((s) => s.granular);

  const manager = (granular.manager ?? {}) as Record<string, unknown>;
  const vramData = granular.vram as
    | {
        percent: number;
        used_mb: number;
        total_mb: number;
        free_mb: number;
        gpu_utilization: number;
        temperature: number;
      }
    | null;

  // ---- Null/void evaluation ------------------------------------------------
  // hasData is true only when the backend has actually returned a payload.
  // Until then we render a loading state instead of blank "0 GB / 0 GB" numbers.
  const hasData = vramData != null && Object.keys(vramData).length > 0;
  const hasManager = manager != null && Object.keys(manager).length > 0;

  // ---- Hooks must run unconditionally (same order every render) -----------
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

  // ---- Empty state ---------------------------------------------------------
  // No data at all: show a refreshable empty panel instead of zeros.
  // Hooks already ran above, so this early return is hook-safe.
  if (!hasData) {
    return (
      <Card title="VRAM Manager" icon={<Activity size={18} className="text-violet-400" />} className={className}>
        <div className="flex flex-col items-center justify-center py-8 text-muted">
          <Loader2 size={20} className="animate-spin mb-3" />
          <p className="text-sm">Loading VRAM manager status…</p>
          <button
            onClick={() => fetchVRAM()}
            className="mt-3 text-[11px] px-2 py-1 rounded bg-white/10 border border-white/10 text-white hover:bg-white/20"
          >
            Refresh now
          </button>
        </div>
      </Card>
    );
  }

  // ---- Safe value extraction (null/void evaluated AFTER early return) -------
  // TypeScript can now narrow these to `number` because hasData is true.
  const percent = vramData!.percent;
  const usedGB = vramData!.used_mb / 1024;
  const totalGB = vramData!.total_mb / 1024;
  const freeGB = vramData!.free_mb / 1024;

  const workload = (manager.current_workload ?? "idle") as string;
  const hasWorkload = hasManager && manager.current_workload != null;
  const workloadColor = WORKLOAD_COLORS[workload] ?? WORKLOAD_COLORS.idle;
  const workloadLabel = WORKLOAD_LABELS[workload] ?? workload;

  const ollamaLoaded = hasManager && manager.ollama_loaded === true;
  const atomicLoaded = hasManager && manager.atomic_chat_loaded === true;
  const comfyuiBusy = hasManager && manager.comfyui_busy === true;
  const comfyuiModelsLoaded = hasManager && manager.comfyui_models_loaded === true;
  const musicGenRunning = hasManager && manager.music_gen_running === true;

  return (
    <Card title="VRAM Manager" icon={<Activity size={18} className="text-violet-400" />} className={className}>
      <div className="space-y-4">
        {/* VRAM usage bar */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted flex items-center gap-1">
              <MemoryStick size={12} /> VRAM
            </span>
            <span className="font-bold tabular-nums">{percent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(percent, 100)}%`,
                background: percent < 50 ? "#22c55e" : percent < 75 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
          <p className="text-[11px] text-muted mt-1 flex items-center gap-1">
            {usedGB.toFixed(1)} GB / {totalGB.toFixed(1)} GB ({freeGB.toFixed(1)} GB free)
          </p>
        </div>

        {/* Workload */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted flex items-center gap-1">
              <Cpu size={12} /> Workload
            </span>
            <span className={`font-bold tabular-nums ${workloadColor}`}>
              {hasWorkload ? workloadLabel : "—"}
            </span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: hasWorkload ? "100%" : "0%",
                background:
                  workload === "idle"
                    ? "#22c55e"
                    : workload === "llm_inference"
                      ? "#a855f7"
                      : workload === "render_3d"
                        ? "#3b82f6"
                        : workload === "music_generation"
                          ? "#f97316"
                          : workload === "audio_analysis"
                            ? "#06b6d4"
                            : workload === "lipsync"
                              ? "#f43f5e"
                              : "#94a3b8",
              }}
            />
          </div>
        </div>

        {/* Model states grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <ModelPill
            label="Ollama"
            loaded={ollamaLoaded}
            hasData={hasManager}
            onOffload={handleOffloadOllama}
            onReload={handleReloadOllama}
          />
          <ModelPill label="Atomic Chat" loaded={atomicLoaded} hasData={hasManager} />
          <ModelPill
            label="ComfyUI"
            loaded={comfyuiModelsLoaded}
            busy={comfyuiBusy}
            hasData={hasManager}
          />
          <ModelPill label="Music Gen" loaded={musicGenRunning} hasData={hasManager} />
        </div>

        {/* GPU stats */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-white/5 p-2 rounded">
            <div className="text-muted text-[10px]">GPU Util</div>
            <div className="font-bold tabular-nums">{vramData.gpu_utilization ?? "—"}%</div>
          </div>
          <div className="bg-white/5 p-2 rounded">
            <div className="text-muted text-[10px]">Temperature</div>
            <div className="font-bold tabular-nums">{vramData.temperature ?? "—"}°C</div>
          </div>
        </div>
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
