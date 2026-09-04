import { useState, useEffect } from "react";
import {
  CpuIcon,
  MemoryStick,
  Activity,
  Thermometer,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Card } from "../../components/common";
import { getGPUSnapshot, getGPUProcesses } from "../../services/api";
import type { GPUSnapshot, GPUProcessInfo } from "../../services/api";
import { getUsageColor } from "./utils";

export function GPUCard() {
  const [gpu, setGpu] = useState<GPUSnapshot | null>(null);
  const [processes, setProcesses] = useState<GPUProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchGPU = async () => {
    setLoading(true);
    try {
      const [snapshot, procs] = await Promise.all([
        getGPUSnapshot(),
        getGPUProcesses().catch(() => ({ processes: [] })),
      ]);
      setGpu(snapshot);
      setProcesses(procs.processes || []);
    } catch {
      // GPU monitoring not available
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchGPU();
    const interval = setInterval(fetchGPU, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

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
          <button onClick={fetchGPU} disabled={loading} className="text-xs text-muted hover:text-white">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
        <p className="text-xs text-muted">GPU monitoring requires NVIDIA drivers with NVML support</p>
      </Card>
    );
  }

  const memPercent = gpu.memory_percent || 0;
  const tempColor = gpu.temperature_c > 80 ? "#ef4444" : gpu.temperature_c > 70 ? "#f59e0b" : "#22c55e";

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <CpuIcon size={20} className="text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{gpu.name || "GPU"}</h3>
            <p className="text-xs text-muted">
              {gpu.memory_free_mb}MB free / {gpu.memory_total_mb}MB total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-1 rounded-full font-medium"
            style={{
              background: `${getUsageColor(memPercent)}20`,
              color: getUsageColor(memPercent),
            }}
          >
            {memPercent.toFixed(0)}%
          </span>
          <button onClick={fetchGPU} disabled={loading} className="text-xs text-muted hover:text-white">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
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
              style={{ width: `${gpu.gpu_utilization}%`, background: getUsageColor(gpu.gpu_utilization) }}
            />
          </div>
        </div>

        {/* Temperature */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted flex items-center gap-1">
            <Thermometer size={12} /> Temperature
          </span>
          <span className="font-bold" style={{ color: tempColor }}>
            {gpu.temperature_c}°C
          </span>
        </div>

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
