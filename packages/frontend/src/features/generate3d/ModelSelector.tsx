import { Cpu, Sliders, CheckCircle, Clock } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface ModelSelectorProps {
  hook: UseGeneration3DReturn;
}

export function ModelSelector({ hook }: ModelSelectorProps) {
  const { models, model, setModel, steps, setSteps, estimatedSec } = hook;

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <label className="text-sm font-medium text-gray-300 block mb-3 flex items-center gap-2"><Cpu size={14} /> Model & Quality</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => m.available && setModel(m.id)}
            disabled={!m.available}
            title={m.available ? m.desc : "Hunyuan3D-2 full is not installed — use Hunyuan3D-2mini"}
            className={`text-left p-3 rounded-xl border-2 transition-all ${
              model === m.id ? "bg-violet-500/10 border-violet-500" : m.available ? "bg-gray-900 border-gray-700 hover:border-gray-600" : "bg-gray-900 border-gray-800 opacity-50 cursor-not-allowed"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${model === m.id ? "text-white" : "text-gray-300"}`}>{m.name}</span>
              {model === m.id && <CheckCircle size={14} className="text-violet-400" />}
            </div>
            <p className="text-xs text-gray-400 mt-1">{m.desc}</p>
            <div className="flex gap-2 mt-2">
              <span className={`text-xs px-1.5 py-0.5 rounded ${m.id === "hunyuan3d-2mini" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>{m.vram}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 flex items-center gap-1"><Clock size={10} /> {m.time}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <label className="text-xs text-gray-400 flex items-center justify-between">
          <span className="flex items-center gap-1"><Sliders size={12} /> Steps: {steps} <span className="text-gray-500">({steps <= 10 ? "fast" : steps <= 18 ? "balanced" : "quality"})</span></span>
          <span className="text-gray-500">~{Math.round(estimatedSec / 60)} min</span>
        </label>
        <input
          type="range"
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          min={5}
          max={50}
          step={1}
          className="w-full mt-1 accent-violet-500"
        />
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>5 (fast)</span><span>15 (balanced)</span><span>50 (max)</span>
        </div>
      </div>
    </div>
  );
}
