import { useState } from "react";
import { AlertCircle, CheckCircle, Box, Download, ArrowRight, Layers, Loader2 } from "lucide-react";
import { ModelPreview } from "./ModelPreview";
import type { UseGeneration3DReturn } from "./useGeneration3D";
import { openInBlender, openInUnity } from "../../services/api";

interface ResultPanelProps {
  hook: UseGeneration3DReturn;
}

export function ResultPanel({ hook }: ResultPanelProps) {
  const { result, error, setError, glbUrl, glbFilename, sendToStudio, navigate } = hook;
  const [opening, setOpening] = useState<null | "blender" | "unity">(null);

  if (!result && !error) return null;

  const handleOpenBlender = async () => {
    if (!glbFilename) return;
    setOpening("blender");
    try {
      await openInBlender(`generated_3d/${glbFilename}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to open in Blender");
    } finally { setOpening(null); }
  };
  const handleOpenUnity = async () => {
    if (!glbFilename) return;
    setOpening("unity");
    try {
      await openInUnity(`generated_3d/${glbFilename}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to open in Unity");
    } finally { setOpening(null); }
  };

  return (
    <>
      {/* Error */}
      {error && (
        <div className="p-4 bg-red-900/20 border border-red-700 rounded-xl flex items-start gap-3 text-red-300">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">{error}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={hook.handleGenerate} className="text-xs px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-white">Retry</button>
              <button onClick={() => setError(null)} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-white">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-gray-800 rounded-xl p-4 border border-green-500/20">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-green-400" />
            <span className="text-white font-medium">Generation Result</span>
            {(result as { success?: boolean }).success ? (
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">Success</span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">Failed</span>
            )}
          </div>
          {(result as { model_path?: string }).model_path ? (
            <div className="space-y-3">
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                <p className="text-xs text-gray-400">Model</p>
                <p className="text-sm text-white font-mono truncate" title={String((result as { model_path?: string }).model_path)}>{String((result as { model_path?: string }).model_path).split(/[\\/]/).pop()}</p>
                <p className="text-xs text-gray-500 mt-1">{String((result as { model_path?: string }).model_path)}</p>
              </div>
              {glbUrl && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400 flex items-center gap-1"><Box size={12} className="text-violet-400" /> Live 3D preview</p>
                  <ModelPreview url={glbUrl} />
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <a
                  href={`/output/generated_3d/${String((result as { model_path?: string }).model_path).split(/[\\/]/).pop()}`}
                  download
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white text-sm flex items-center gap-2"
                >
                  <Download size={14} />
                  Download .glb
                </a>
                {glbFilename && (
                  <>
                    <button
                      onClick={handleOpenBlender}
                      disabled={opening === "blender"}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-white text-sm flex items-center gap-2 disabled:opacity-50"
                      title="Open this GLB in Blender (launches Blender with auto-import)"
                    >
                      {opening === "blender" ? <Loader2 size={14} className="animate-spin" /> : <Box size={14} />}
                      Open in Blender
                    </button>
                    <button
                      onClick={handleOpenUnity}
                      disabled={opening === "unity"}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm flex items-center gap-2 disabled:opacity-50"
                      title="Copy to Unity project Assets/GeneratedModels and trigger import"
                    >
                      {opening === "unity" ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                      Open in Unity
                    </button>
                    <button
                      onClick={() => sendToStudio(glbFilename)}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-white text-sm flex items-center gap-2"
                      title="Open in Three.js Studio with this model loaded as a character + bible"
                    >
                      <Box size={14} />
                      Send to Studio
                    </button>
                  </>
                )}
                <button
                  onClick={() => navigate("/music-video-wizard")}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm flex items-center gap-2"
                >
                  Use in Music Video <ArrowRight size={14} />
                </button>
              </div>
              <details className="text-xs">
                <summary className="text-gray-400 cursor-pointer">Raw JSON</summary>
                <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400 overflow-auto max-h-48 mt-2">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <>
              <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-400 overflow-auto max-h-48">
                {JSON.stringify(result, null, 2)}
              </pre>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => navigate("/music-video-wizard")}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm flex items-center gap-2"
                >
                  Use in Music Video <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
