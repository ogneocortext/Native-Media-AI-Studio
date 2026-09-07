import { FileText, Cpu, Sliders } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface ConfigurationSummaryProps {
  hook: UseGeneration3DReturn;
}

export function ConfigurationSummary({ hook }: ConfigurationSummaryProps) {
  const { prompt, wordCount, selectedModel, steps, vizParams, seed, genMode, charName, charNotes, refFile } = hook;

  const truncatedPrompt = prompt.length > 120 ? prompt.slice(0, 120) + "..." : prompt;

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">Configuration Summary</h3>
      <div className="space-y-2.5 text-xs">
        <div className="flex items-start gap-2">
          <FileText size={14} className="text-sky-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-gray-400 block">Prompt ({wordCount} words)</span>
            <span className="text-gray-300 block truncate" title={prompt}>{truncatedPrompt}</span>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Cpu size={14} className="text-violet-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-gray-400 block">Model</span>
            <span className="text-gray-300">{selectedModel.name} • {selectedModel.vram} • ~{selectedModel.time}</span>
            {selectedModel.desc && <span className="text-gray-500 block text-[10px]">{selectedModel.desc}</span>}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Sliders size={14} className="text-orange-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-gray-400 block">Parameters</span>
            <span className="text-gray-300">
              {steps} steps • CFG {vizParams.cfg.toFixed(1)} • seed {seed}
            </span>
            {charName && (
              <span className="text-gray-400 block text-[10px] mt-0.5">
                Character: {charName}{charNotes ? ` — ${charNotes.slice(0, 60)}` : ""}
              </span>
            )}
            {genMode === "reference" && refFile && (
              <span className="text-gray-400 block text-[10px] mt-0.5">
                Reference: {refFile.name}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
