/**
 * ExportMatrixPanel — publish-ready derivatives from one master video.
 *
 * Implements the documented-but-missing "Export Matrix" step (ai-video-trends-2026
 * Trend 5 + §5 P1): from a single master video, derive
 *   - 1080×1920 vertical master (TikTok/Reels/Shorts)
 *   - 3-8s beat-aligned Spotify Canvas loop
 *   - 3 thumbnail variants (A/B/C) for YouTube CTR testing
 * via POST /api/video/export-matrix.
 */

import { useState } from "react";
import { Layers, Loader2, Check, AlertTriangle, Download, RotateCw, Play } from "lucide-react";
import { buildExportMatrix, type MatrixArtifact, type ExportMatrixResponse } from "../../services/api";
import { getOutputUrl } from "../../utils/url";

interface Props {
  sourcePath: string; // output-relative path, e.g. "video/foo.mp4"
  onComplete?: () => void;
}

const KNOWN_SUFFIXES = ["_vertical.mp4", "_loop.mp4", "_thumb_A.jpg", "_thumb_B.jpg", "_thumb_C.jpg"];

export function isMatrixDerivative(filename: string): boolean {
  return KNOWN_SUFFIXES.some((s) => filename.toLowerCase().endsWith(s.toLowerCase()));
}

const KIND_STYLE: Record<string, string> = {
  vertical: "bg-blue-500/20 text-blue-300",
  loop: "bg-emerald-500/20 text-emerald-300",
  thumbnail: "bg-amber-500/20 text-amber-300",
};

export function ExportMatrixPanel({ sourcePath, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportMatrixResponse | null>(null);
  const [loopSeconds, setLoopSeconds] = useState(4);

  const handleBuild = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const matrix = await buildExportMatrix({ source_path: sourcePath, loop_seconds: loopSeconds });
      setResult(matrix);
      if (!matrix.success && matrix.errors.length === matrix.artifacts.length && matrix.errors.length > 0) {
        setError(matrix.errors.map((e) => e.error).join(" · "));
      }
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 mt-3" data-testid="export-matrix">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <Layers size={16} className="text-primary" /> Export Matrix
        </span>
        <span className="text-[10px] text-muted">Trend 5 · 16:9 → 9:16 + loop + thumbnails</span>
      </div>

      <p className="text-xs text-muted mb-3">
        From this master video, derive the full publishing matrix: vertical Shorts/Reels/
        TikTok master, a beat-aligned Spotify Canvas loop, and 3 A/B/C thumbnail variants.
      </p>

      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-muted">Canvas loop:</label>
        <select
          value={loopSeconds}
          onChange={(e) => setLoopSeconds(parseInt(e.target.value, 10))}
          className="bg-black/30 border border-white/10 rounded-lg text-xs text-white px-2 py-1.5"
          aria-label="Canvas loop duration"
        >
          {[3, 4, 5, 6, 8].map((s) => <option key={s} value={s}>{s}s</option>)}
        </select>
      </div>

      <button
        onClick={handleBuild}
        disabled={running}
        className="w-full py-2 rounded-lg bg-violet-600/80 hover:bg-violet-500 disabled:bg-gray-700 disabled:cursor-wait text-white text-sm flex items-center justify-center gap-2 transition-colors"
      >
        {running ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Building matrix…</>
        ) : (
          <><RotateCw size={15} /> Build Export Matrix</>
        )}
      </button>

      {error && (
        <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {result && result.success && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-emerald-400 mb-2">
            <Check size={14} /> {result.message} · {result.render_s}s
          </div>
          <div className="grid grid-cols-1 gap-2">
            {result.artifacts.map((a: MatrixArtifact) => (
              <div key={a.kind + a.relative_path} className="flex items-center justify-between gap-2 bg-white/5 hover:bg-white/[0.08] rounded-lg px-3 py-2 border border-white/5" data-artifact={a.kind}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-md ${KIND_STYLE[a.kind] || "bg-gray-500/20 text-gray-300"}`}>
                    {a.kind.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-white font-mono truncate" title={a.relative_path}>{a.relative_path.split("/").pop()}</p>
                    <p className="text-[10px] text-muted truncate">
                      {a.width && a.height ? `${a.width}×${a.height}` : ""}
                      {a.duration ? ` · ${a.duration.toFixed(1)}s` : ""}
                      {a.notes ? ` · ${a.notes}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {a.kind !== "loop" && (
                    <a href={getOutputUrl(a.relative_path)} target="_blank" rel="noopener" className="p-1.5 hover:bg-white/10 rounded-lg text-muted hover:text-white" title="Open"><Play size={13} /></a>
                  )}
                  <a href={getOutputUrl(a.relative_path)} download className="p-1.5 hover:bg-white/10 rounded-lg text-muted hover:text-white" title="Download"><Download size={13} /></a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}