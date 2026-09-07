import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface ServiceStatusCardProps {
  hook: UseGeneration3DReturn;
}

export function ServiceStatusCard({ hook }: ServiceStatusCardProps) {
  const { status3d, statusLoading, loadStatus } = hook;
  const isAvailable = (status3d.available as boolean) ?? false;
  const comfyRunning = (status3d.comfyui_running as boolean) ?? false;

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-medium flex items-center gap-2">
          <Sparkles size={16} className={status3d.available ? "text-emerald-400" : "text-red-400"} />
          Service Status
        </h3>
        <button onClick={loadStatus} disabled={statusLoading} className="p-1 hover:bg-gray-700 rounded">
          <RefreshCw size={14} className={statusLoading ? "animate-spin text-gray-400" : "text-gray-400"} />
        </button>
      </div>
      {statusLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" /> Checking...</div>
      ) : Object.keys(status3d).length > 0 ? (
        <div className="space-y-2">
          <div className={`flex items-center justify-between p-2 rounded-lg border ${isAvailable && comfyRunning ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
            <span className="text-sm text-gray-300">Service</span>
            <span className={`text-sm font-medium ${isAvailable && comfyRunning ? "text-emerald-400" : "text-red-400"}`}>{isAvailable && comfyRunning ? "● Ready" : "● Offline"}</span>
          </div>
          {Object.entries(status3d).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between p-2 bg-gray-900 rounded-lg">
              <span className="text-gray-400 text-xs capitalize">{key.replace(/_/g, " ")}</span>
              <span className={`text-xs truncate max-w-[150px] ${typeof value === "boolean" ? (value ? "text-emerald-400" : "text-red-400") : "text-white"}`} title={String(value)}>
                {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value).split(/[\\/]/).pop() || String(value)}
              </span>
            </div>
          ))}
          {!isAvailable && <p className="text-xs text-amber-400 p-2 bg-amber-500/10 rounded">Check ComfyUI at {String(status3d.model_path as string || "D:\\ComfyUI")} and model exists</p>}
        </div>
      ) : (
        <button
          onClick={loadStatus}
          className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300"
        >
          Check Status
        </button>
      )}
    </div>
  );
}
