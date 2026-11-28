/**
 * ModelsView — full-depth Ollama model management page (/analyze/ai/models).
 *
 * Item 3: the "full depth" of two-depth model management. The rail's Model tab
 * shows a summary block (Installed N · Loaded M, loaded-in-VRAM list, Pull
 * field — no delete). This page carries the complete OllamaModelManager with
 * per-model delete, refresh, and pull. Reached from the AI Tools page's Model
 * tab summary block; no new top-level sidebar entry.
 */

import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DS } from "../../styles/designSystem";
import { OllamaModelManager } from "./OllamaModelManager";

export function ModelsView() {
  const navigate = useNavigate();

  return (
    <div className={DS.page}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/analyze/ai")}>
          <ArrowLeft size={14} className="text-muted hover:text-white" />
          <span className="text-sm text-muted hover:text-white">Back to AI Tools</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <span className="text-primary">📦</span>
          </div>
          <div>
            <h1 className={DS.pageTitle}>Ollama Models</h1>
            <p className={DS.pageSubtitle}>
              Install, inspect, and remove models in your local Ollama library.
            </p>
          </div>
        </div>
      </div>

      <OllamaModelManager selectedModel={null} showDelete={true} />
    </div>
  );
}
