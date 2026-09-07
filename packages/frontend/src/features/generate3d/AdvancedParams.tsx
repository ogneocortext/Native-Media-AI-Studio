import { Sliders, Triangle } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface AdvancedParamsProps {
  hook: UseGeneration3DReturn;
}

export function AdvancedParams({ hook }: AdvancedParamsProps) {
  const { vizParams, setVizParams, comfyRunning } = hook;

  const update = (patch: Partial<typeof vizParams>) => {
    setVizParams({ ...vizParams, ...patch });
  };

  return (
    <div className={`mt-3 space-y-3 ${!comfyRunning ? "opacity-50 pointer-events-none" : ""}`}>
      <details className="group">
        <summary className="text-xs text-gray-400 flex items-center justify-between cursor-pointer hover:text-gray-300">
          <span className="flex items-center gap-1"><Sliders size={12} /> Advanced Generation</span>
          <span className="text-gray-500 group-open:rotate-90 transition-transform">▸</span>
        </summary>
        <div className="mt-2 space-y-3 text-xs">
          <div>
            <label className="flex justify-between text-gray-400">
              <span>CFG Guidance: {vizParams.cfg.toFixed(1)}</span><span className="text-gray-500">1.0–20.0</span>
            </label>
            <input type="range" value={vizParams.cfg} min={1.0} max={20.0} step={0.1} onChange={(e) => update({ cfg: Number(e.target.value) })} className="w-full mt-1 accent-violet-500" />
          </div>
          <div>
            <label className="flex justify-between text-gray-400">
              <span>Color: {vizParams.color}</span>
            </label>
            <input type="color" value={vizParams.color} onChange={(e) => update({ color: e.target.value })} className="w-full h-6 mt-1 rounded cursor-pointer" />
          </div>
          <div>
            <label className="flex justify-between text-gray-400">
              <span>Metalness: {vizParams.metalness.toFixed(1)}</span><span className="text-gray-500">0–1</span>
            </label>
            <input type="range" value={vizParams.metalness} min={0} max={1} step={0.1} onChange={(e) => update({ metalness: Number(e.target.value) })} className="w-full mt-1 accent-violet-500" />
          </div>
          <div>
            <label className="flex justify-between text-gray-400">
              <span>Roughness: {vizParams.roughness.toFixed(1)}</span><span className="text-gray-500">0–1</span>
            </label>
            <input type="range" value={vizParams.roughness} min={0} max={1} step={0.1} onChange={(e) => update({ roughness: Number(e.target.value) })} className="w-full mt-1 accent-violet-500" />
          </div>
          <div>
            <label className="flex justify-between text-gray-400">
              <span>Scale: {vizParams.scale.toFixed(1)}</span><span className="text-gray-500">0.1–2.0</span>
            </label>
            <input type="range" value={vizParams.scale} min={0.1} max={2.0} step={0.1} onChange={(e) => update({ scale: Number(e.target.value) })} className="w-full mt-1 accent-violet-500" />
          </div>
          <div>
            <label className="flex justify-between text-gray-400">
              <span>Resolution: {vizParams.resolution}</span><span className="text-gray-500">128–512</span>
            </label>
            <input type="range" value={vizParams.resolution} min={128} max={512} step={64} onChange={(e) => update({ resolution: Number(e.target.value) })} className="w-full mt-1 accent-violet-500" />
          </div>
          {!comfyRunning && (
            <p className="text-amber-300 text-[10px] flex items-center gap-1">
              <Triangle size={10} /> Advanced params require ComfyUI running
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
