import { Cpu } from "lucide-react";
import { PIPELINE_STEPS } from "./useGeneration3D";

export function PipelineCard() {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <h3 className="text-white font-medium mb-3 flex items-center gap-2">
        <Cpu size={16} className="text-orange-400" />
        Pipeline
      </h3>
      <div className="space-y-2">
        {PIPELINE_STEPS.map((s) => (
          <div key={s.n} className={`flex items-center gap-2 p-2 rounded-lg ${s.n === 3 ? "bg-violet-500/10 border border-violet-500/30" : "bg-gray-900/50"}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.n === 3 ? "bg-violet-600 text-white" : "bg-gray-700 text-gray-400"}`}>{s.n}</span>
            <span className={`text-xs ${s.c}`}>{s.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
