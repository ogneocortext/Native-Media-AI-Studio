/**
 * ExtractAudioPanel — one-click song extraction from a library video.
 *
 * Sits in the Media Library video detail view next to ExportMatrixPanel:
 * pulls the video's audio track out via POST /api/audio/extract and drops it
 * into output/audio so it shows up in the Audio Library (Audio Analysis page)
 * for tempo/beat analysis. "Original" copies the source stream bit-for-bit
 * (no quality loss); MP3 re-encodes at the chosen bitrate.
 */

import { useState } from "react";
import { Music, Loader2, Check, AlertTriangle, Download } from "lucide-react";
import { extractVideoAudio, type ExtractAudioResponse } from "../../services/api";
import { getOutputUrl } from "../../utils/url";

interface Props {
  sourcePath: string; // output-relative path, e.g. "video/foo.mp4"
  onComplete?: () => void;
}

const FORMATS = [
  { id: "original", label: "Original (best quality)" },
  { id: "mp3-320k", label: "MP3 · 320 kbps" },
  { id: "mp3-192k", label: "MP3 · 192 kbps" },
  { id: "mp3-128k", label: "MP3 · 128 kbps" },
] as const;

type FormatId = (typeof FORMATS)[number]["id"];

export function ExtractAudioPanel({ sourcePath, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractAudioResponse | null>(null);
  const [formatId, setFormatId] = useState<FormatId>("original");

  const handleExtract = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const params: { source_path: string; format: "original" | "mp3"; bitrate?: "128k" | "192k" | "320k" } =
        formatId === "original"
          ? { source_path: sourcePath, format: "original" }
          : { source_path: sourcePath, format: "mp3", bitrate: formatId.slice(4) as "128k" | "192k" | "320k" };
      const res = await extractVideoAudio(params);
      setResult(res);
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 mt-3" data-testid="extract-audio">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <Music size={16} className="text-emerald-400" /> Extract Audio
        </span>
        <span className="text-[10px] text-muted">video → song · audio library</span>
      </div>

      <p className="text-xs text-muted mb-3">
        Pull just the song out of this video. <strong className="text-white">Original</strong> keeps
        the source audio bit-for-bit (best quality); MP3 re-encodes smaller.
      </p>

      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-muted" htmlFor="extract-format">Format:</label>
        <select
          id="extract-format"
          value={formatId}
          onChange={(e) => setFormatId(e.target.value as FormatId)}
          className="bg-black/30 border border-white/10 rounded-lg text-xs text-white px-2 py-1.5"
          aria-label="Audio format"
        >
          {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>

      <button
        onClick={handleExtract}
        disabled={running}
        className="w-full py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-wait text-white text-sm flex items-center justify-center gap-2 transition-colors"
      >
        {running ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Extracting…</>
        ) : (
          <><Music size={15} /> Extract Song</>
        )}
      </button>

      {error && (
        <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5" role="alert">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {result?.success && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <Check size={14} /> {result.message} · {result.render_s}s{result.lossless ? " · lossless" : ""}
          </div>
          {result.source_codec && (
            <p className="text-[11px] text-muted font-mono">
              source: {result.source_codec}{result.source_sample_rate ? ` · ${(Number(result.source_sample_rate) / 1000).toFixed(1)} kHz` : ""}{result.lossless ? " · copied" : " · re-encoded"}
            </p>
          )}
          <audio controls src={getOutputUrl(result.relative_path)} className="w-full rounded" aria-label={`Play ${result.filename}`} />
          <div className="flex items-center justify-between gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p className="text-xs text-white font-mono truncate" title={result.relative_path}>{result.filename}</p>
            <a href={getOutputUrl(result.relative_path)} download className="p-1.5 hover:bg-white/10 rounded-lg text-muted hover:text-white shrink-0" title="Download audio file">
              <Download size={13} />
            </a>
          </div>
          <p className="text-[11px] text-muted">
            Saved to the audio library — open <span className="text-white">Audio Analysis</span> to analyze tempo &amp; beats.
          </p>
        </div>
      )}
    </div>
  );
}
