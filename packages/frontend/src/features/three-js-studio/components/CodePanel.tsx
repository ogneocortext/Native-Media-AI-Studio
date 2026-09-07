import { ChevronDown, FileCode, Zap } from "lucide-react";

interface CodePanelProps {
  open: boolean;
  pastedCode: string;
  codeError: string | null;
  onCodeChange: (code: string) => void;
  onApply: () => void;
  onClose: () => void;
}

export function CodePanel({
  open,
  pastedCode,
  codeError,
  onCodeChange,
  onApply,
  onClose,
}: CodePanelProps) {
  if (!open) return null;
  return (
    <div
      className={`code-panel absolute top-2 left-2 w-80 max-h-[calc(100%-1rem)] z-10 flex flex-col gap-2`}
    >
      <div className="bg-[#0e0e16] border border-emerald-500/30 rounded-lg overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-3 py-2 bg-emerald-900/20 border-b border-emerald-500/20">
          <div className="flex items-center gap-2">
            <FileCode size={14} className="text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">
              Paste Code
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-0.5"
          >
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="p-3 space-y-2">
          <textarea
            value={pastedCode}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder={`// Available: scene, camera, renderer, THREE\n// Define: function applyScene(scene, camera, renderer) { ... }\n// Or return JSON: { "objects": [...] }`}
            spellCheck={false}
            className="w-full h-40 bg-gray-900 border border-gray-700 rounded p-2 text-xs font-mono text-green-300 placeholder-gray-600 resize-none focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={onApply}
            disabled={!pastedCode.trim()}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <Zap size={12} /> Apply to Scene
          </button>
          {codeError && (
            <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded p-2">
              Error: {codeError}
            </div>
          )}
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Paste JavaScript or JSON from an AI agent. The code runs in
            the scene context with access to Three.js.
          </p>
        </div>
      </div>
    </div>
  );
}
