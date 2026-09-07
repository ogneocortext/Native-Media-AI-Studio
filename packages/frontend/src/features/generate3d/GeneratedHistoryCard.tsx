import { History, RefreshCw, Loader2, Box, Download } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface GeneratedHistoryCardProps {
  hook: UseGeneration3DReturn;
}

export function GeneratedHistoryCard({ hook }: GeneratedHistoryCardProps) {
  const { generatedList, historyLoading, loadHistory, sendToStudio, setResult, bibles } = hook;

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-medium flex items-center gap-2"><History size={16} /> Recent Models</h3>
        <button onClick={loadHistory} disabled={historyLoading} className="p-1 hover:bg-gray-700 rounded">
          <RefreshCw size={14} className={historyLoading ? "animate-spin" : ""} />
        </button>
      </div>
      {historyLoading ? (
        <div className="text-xs text-gray-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading...</div>
      ) : generatedList.length > 0 ? (
        <div className="divide-y divide-gray-800 max-h-72 overflow-auto rounded-lg border border-gray-800 bg-gray-900/30">
          {generatedList.map((f) => {
            const ageMs = f.modified ? Date.now() - f.modified * 1000 : 0;
            const ageLabel = ageMs < 60_000
              ? "just now"
              : ageMs < 3_600_000
                ? `${Math.round(ageMs / 60_000)}m ago`
                : ageMs < 86_400_000
                  ? `${Math.round(ageMs / 3_600_000)}h ago`
                  : `${Math.round(ageMs / 86_400_000)}d ago`;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => {
                  setResult({ success: true, model_path: f.path, filename: f.filename });
                }}
                className="w-full text-left flex items-center gap-2 px-2.5 py-2 hover:bg-gray-800/60 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate font-mono" title={f.filename}>{f.filename}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{ageLabel}{bibles[f.filename]?.name ? ` • ${bibles[f.filename].name}` : ""}</div>
                </div>
                <span className="text-xs text-gray-400 shrink-0 tabular-nums">{(f.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                <span
                  role="button"
                  tabIndex={0}
                  title="Send to Three.js Studio as character"
                  onClick={(e) => { e.stopPropagation(); sendToStudio(f.filename); }}
                  onKeyDown={(e) => { if (e.key === "Enter") sendToStudio(f.filename); }}
                  className="text-gray-500 hover:text-amber-300 shrink-0"
                >
                  <Box size={12} />
                </span>
                <a
                  href={f.servable_url ?? `/output/generated_3d/${f.filename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-gray-500 hover:text-violet-300 shrink-0"
                  title="Download .glb"
                >
                  <Download size={12} />
                </a>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-500">No models yet. Generate one to see it here.</p>
      )}
    </div>
  );
}
