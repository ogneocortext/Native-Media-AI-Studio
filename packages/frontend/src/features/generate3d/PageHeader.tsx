import { useNavigate } from "react-router-dom";
import { Box, RefreshCw, Wand2, ArrowRight, HardDrive, FileBox, Loader2, Triangle } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface PageHeaderProps {
  hook: UseGeneration3DReturn;
}

export function PageHeader({ hook }: PageHeaderProps) {
  const navigate = useNavigate();
  const { status3d, statusLoading, loadStatus, comfyRunning } = hook;

  return (
    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2 flex-wrap">
          <Box size={24} className="text-purple-400" />
          3D Model Generation
          <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">8GB VRAM-safe</span>
          {comfyRunning ? (
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Ready</span>
          ) : (
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 flex items-center gap-1"><Triangle size={10} /> ComfyUI Offline</span>
          )}
        </h1>
        <p className="text-gray-400 mt-1">
          Generate 3D models from text prompts using Hunyuan3D. Fits your 8GB GPU budget.
        </p>
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
          <span className="flex items-center gap-1"><HardDrive size={12} /> {String(status3d.model_path as string || "hunyuan3d-2mini")}</span>
          <span className="flex items-center gap-1"><FileBox size={12} /> {String((status3d.generated_count as number) ?? 0)} generated</span>
          {statusLoading && <Loader2 size={12} className="animate-spin" />}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={loadStatus}
          disabled={statusLoading}
          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm text-gray-300 flex items-center gap-2"
          title="Refresh status"
        >
          <RefreshCw size={14} className={statusLoading ? "animate-spin" : ""} /> Refresh
        </button>
        <button
          onClick={() => navigate("/music-video-wizard")}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2"
        >
          <Wand2 size={14} /> Open Wizard <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
