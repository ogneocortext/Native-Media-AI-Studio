import { Wand2, Loader2 } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface GenerateButtonProps {
  hook: UseGeneration3DReturn;
}

export function GenerateButton({ hook }: GenerateButtonProps) {
  const { generating, handleGenerate, handleGenerateFromReference, genMode, comfyRunning, elapsed, estimatedSec, selectedModel, prompt, wordCount, refFile } = hook;

  return (
    <>
      <button
        onClick={genMode === "reference" ? handleGenerateFromReference : handleGenerate}
        disabled={generating || !comfyRunning || (genMode === "reference" ? !refFile : (!prompt.trim() || wordCount > 75))}
        className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-400 text-white rounded-xl font-medium flex items-center justify-center gap-2"
      >
        {generating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
        {generating ? `Generating... ${elapsed}s / ~${estimatedSec}s` : genMode === "reference" ? `Generate 3D from Reference • ~${Math.round(estimatedSec / 60)} min` : `Generate 3D Model • ${selectedModel.vram} • ~${Math.round(estimatedSec / 60)} min`}
      </button>
      {generating && (
        <div className="bg-gray-800 rounded-xl p-3 border border-violet-500/20">
          <div className="flex items-center gap-2 text-sm text-violet-300">
            <Loader2 size={14} className="animate-spin" />
            Generating on {selectedModel.name} • {elapsed}s elapsed • ~{Math.max(0, estimatedSec - elapsed)}s left
          </div>
          <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${Math.min(95, (elapsed / estimatedSec) * 100)}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1">VRAM will offload Ollama, then reload. Do not close tab.</p>
        </div>
      )}
    </>
  );
}
