/**
 * UpscalePanel — 4x post-process pass for YouTube 4K export.
 *
 * Implements the documented-but-missing upscaler (ai-video-trends-2026 Trend 4:
 * "add 4x upscaler pass (ComfyUI 4x-ClearRealityV1) as optional post-process
 * for YouTube 4K export without 4K render cost"; comfyui-workflows §5).
 * Uses ComfyUI when available, FFmpeg lanczos fallback otherwise.
 */

import { useState } from "react";
import { ZoomIn, Loader2, Check, AlertTriangle, Download } from "lucide-react";
import { upscaleImage, type UpscaleResponse } from "../../services/api";
import { getOutputUrl } from "../../utils/url";

interface Props {
  imagePath: string; // output-relative path, e.g. "images/foo.png"
  onComplete?: () => void;
}

export function UpscalePanel({ imagePath, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UpscaleResponse | null>(null);
  const [scale, setScale] = useState<2 | 4>(4);

  const handleUpscale = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await upscaleImage({ image: imagePath, scale });
      setResult(r);
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 mt-3" data-testid="upscale-panel">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <ZoomIn size={16} className="text-primary" /> Upscale
        </span>
        <span className="text-[10px] text-muted">Trend 4 · 4x pass for 4K export</span>
      </div>

      <p className="text-xs text-muted mb-3">
        Upscale this image without re-rendering at 4K. Uses ComfyUI 4x-ClearRealityV1 when
        running, otherwise an FFmpeg lanczos resize.
      </p>

      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-muted">Scale:</label>
        <select
          value={scale}
          onChange={(e) => setScale(parseInt(e.target.value, 10) as 2 | 4)}
          className="bg-black/30 border border-white/10 rounded-lg text-xs text-white px-2 py-1.5"
          aria-label="Upscale factor"
        >
          <option value={4}>4×</option>
          <option value={2}>2×</option>
        </select>
      </div>

      <button
        onClick={handleUpscale}
        disabled={running}
        className="w-full py-2 rounded-lg bg-violet-600/80 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-wait text-white text-sm flex items-center justify-center gap-2 transition-colors"
      >
        {running ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Upscaling…</>
        ) : (
          <><ZoomIn size={15} /> Upscale {scale}×</>
        )}
      </button>

      {error && (
        <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {result && result.success && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-xs text-emerald-400 mb-2">
            <Check size={14} /> {result.engine} upscale · {result.elapsed_s}s
            {result.model && result.model !== "lanczos" ? ` · ${result.model}` : ""}
          </div>
          {result.warnings.length > 0 && (
            <p className="text-[10px] text-amber-400 mb-2">{result.warnings.join(" · ")}</p>
          )}
          {result.relative_path && (
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/5">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300">OUT</span>
              <p className="text-xs text-white font-mono truncate flex-1" title={result.relative_path!}>
                {result.relative_path.split("/").pop()}
              </p>
              <a href={getOutputUrl(result.relative_path)} download className="p-1.5 hover:bg-white/10 rounded-lg text-muted hover:text-white" title="Download"><Download size={13} /></a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}