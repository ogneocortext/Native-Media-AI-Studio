import { PROMPT_EXAMPLES, CHARACTER_TEMPLATES, MATERIAL_TEMPLATES } from "./useGeneration3D";

interface PromptSectionProps {
  prompt: string;
  setPrompt: (v: string) => void;
  wordCount: number;
  genMode: "text" | "reference";
  setGenMode: (v: "text" | "reference") => void;
  onCharacterTemplateSelect?: (prompt: string, bible: string, label: string) => void;
}

export function PromptSection({ prompt, setPrompt, wordCount, genMode, setGenMode, onCharacterTemplateSelect }: PromptSectionProps) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-gray-300">Prompt</label>
        <span className={`text-xs ${wordCount > 75 ? "text-red-400" : wordCount > 60 ? "text-amber-400" : "text-gray-500"}`}>{wordCount}/75 words • {prompt.length}/500 chars</span>
      </div>
      {/* Text vs reference-image source tabs */}
      <div className="flex gap-1.5 mb-4 p-1 bg-gray-900 rounded-lg w-fit" role="tablist" aria-label="Generation source">
        {(["text", "reference"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={genMode === m}
            onClick={() => setGenMode(m)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${genMode === m ? "bg-violet-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
          >
            {m === "text" ? "Text prompt" : "Reference image"}
          </button>
        ))}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className={`w-full px-3 py-2 bg-gray-900 border rounded-lg text-white resize-none focus:outline-none ${wordCount > 75 ? "border-red-500 focus:border-red-500" : "border-gray-700 focus:border-violet-500"}`}
        rows={3}
        placeholder="Describe the 3D model you want to generate..."
        onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { /* handled by parent */ } }}
        aria-label="3D prompt"
      />
      <p className="text-[11px] text-gray-500 mt-2">
        Format: <code className="text-violet-300">[object], [material], [style], [orientation]</code> • <span className="text-gray-400">Ctrl+Enter to generate</span>
      </p>
      <div className="flex flex-wrap gap-1.5 mt-4">
        {PROMPT_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => setPrompt(ex.prompt)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              prompt === ex.prompt
                ? "bg-violet-600 border-violet-500 text-white"
                : "bg-gray-900 border-gray-700 text-gray-400 hover:border-violet-500/30 hover:text-gray-200"
            }`}
          >
            + {ex.label} <span className="opacity-50">• {ex.tag}</span>
          </button>
        ))}
      </div>
      {/* Material templates */}
      <div className="mt-4 pt-4 border-t border-gray-700/60">
        <p className="text-[11px] text-gray-500 mb-2">Materials & Skins <span className="text-gray-600">— concept prompts for textures, clothing, skin</span></p>
        <div className="flex flex-wrap gap-1.5">
          {MATERIAL_TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => setPrompt(t.prompt)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                prompt === t.prompt
                  ? "bg-emerald-600 border-emerald-500 text-white"
                  : "bg-gray-900 border-gray-700 text-gray-400 hover:border-emerald-500/40 hover:text-gray-200"
              }`}
              title={`${t.tag}: ${t.prompt}`}
            >
              + {t.label} <span className="opacity-50">• {t.tag}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Character templates */}
      <div className="mt-4 pt-4 border-t border-gray-700/60">
        <p className="text-[11px] text-gray-500 mb-2">Characters <span className="text-gray-600">— set prompt + bible starter</span></p>
        <div className="flex flex-wrap gap-1.5">
          {CHARACTER_TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => {
                setPrompt(t.prompt);
                if (onCharacterTemplateSelect) onCharacterTemplateSelect(t.prompt, t.bible, t.label);
              }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                prompt === t.prompt
                  ? "bg-amber-600 border-amber-500 text-white"
                  : "bg-gray-900 border-gray-700 text-gray-400 hover:border-amber-500/40 hover:text-gray-200"
              }`}
              title={t.bible}
            >
              + {t.label} <span className="opacity-50">• character</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
