import React from "react";
import { OutputFile } from "../../state/outputStore";
import { getOutputUrl } from "../../utils/url";
import { WaveformDisplay } from "./WaveformDisplay";
import { ExportMatrixPanel } from "./ExportMatrixPanel";
import { ExtractAudioPanel } from "./ExtractAudioPanel";
import { UpscalePanel } from "./UpscalePanel";
import { ModelPreview } from "../generate3d/ModelPreview";
import {
  Tag,
  ExternalLink,
  Download,
  X,
  Activity,
  FileType,
  HardDrive,
  Clock,
  Copy,
  Music,
  Video,
  Play,
  Maximize2,
  Pencil,
  Trash2,
  Sparkles,
  Box,
  Layers,
  RefreshCw,
} from "lucide-react";

/** Strongly-typed media inspection payloads. */
export interface MediaProbeFormat {
  duration?: string;
  bit_rate?: string;
  format_name?: string;
}

export interface MediaProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  codec_name?: string;
}

export interface MediaProbe {
  format: MediaProbeFormat;
  streams: MediaProbeStream[];
}

export interface LoudnessResult {
  integrated_lufs?: number | null;
  loudness_range?: number | null;
  true_peak?: number | null;
}

export interface WaveformResult {
  peaks: number[];
  duration?: number;
}

export interface MediaInfoPayload {
  probe: { probe: MediaProbe } | null;
  loudness: LoudnessResult | null;
  waveform: WaveformResult | null;
}

export interface MediaDetailModalProps {
  output: OutputFile | null;
  onClose: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  mediaInfo: MediaInfoPayload | null;
  mediaInfoLoading: boolean;
  mediaInfoError: string | null;
  thumbnailUrl: string | null;
  thumbnailLoading: boolean;
  onExtractThumbnail: () => void;
  onRegenerateCover: () => void;
  onAddToStudio: (output: OutputFile, openInNewTab?: boolean) => void;
  onOpenBlender: (output: OutputFile) => void;
  onOpenUnity: (output: OutputFile) => void;
  onRename: (output: OutputFile) => void;
  onDelete: (output: OutputFile) => void;
  onShowFullImage: () => void;
  is3DModelFile: (filename: string) => boolean;
  getOutputUrl: (path: string) => string;
  formatFileSize: (bytes: number) => string;
  formatDateTime: (date: string) => string;
  onFetchOutputs: () => void;
  openingApp: null | "blender" | "unity" | "studio";
  setOutputToDelete: (output: OutputFile | null) => void;
  setRenameTarget: (output: OutputFile | null) => void;
  setRenameValue: (value: string) => void;
}

export function MediaDetailModal({
  output,
  onClose,
  audioRef,
  mediaInfo,
  mediaInfoLoading,
  mediaInfoError,
  thumbnailUrl,
  thumbnailLoading,
  onExtractThumbnail,
  onRegenerateCover,
  onAddToStudio,
  onOpenBlender,
  onOpenUnity,
  onRename,
  onDelete,
  onShowFullImage,
  is3DModelFile,
  getOutputUrl,
  formatFileSize,
  formatDateTime,
  onFetchOutputs,
  openingApp,
  setOutputToDelete,
  setRenameTarget,
  setRenameValue,
}: MediaDetailModalProps) {
  if (!output) return null;

  const probe = mediaInfo?.probe?.probe;
  const format = probe?.format;
  const streams = probe?.streams;
  const videoStream = streams?.find((s) => s.codec_type === "video");
  const audioStream = streams?.find((s) => s.codec_type === "audio");
  const duration = typeof format?.duration === "string" ? format.duration : undefined;
  const bitRate = typeof format?.bit_rate === "string" ? format.bit_rate : undefined;
  const formatName = typeof format?.format_name === "string" ? format.format_name : undefined;
  const loudness = mediaInfo?.loudness ?? null;
  const waveform = mediaInfo?.waveform ?? null;
  const peaks = waveform?.peaks;
  const waveformDuration =
    typeof waveform?.duration === "number"
      ? waveform.duration
      : typeof format?.duration === "string"
        ? Number(format.duration)
        : undefined;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="card max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl shadow-black/50 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10 sticky top-0 bg-black/60 backdrop-blur z-10">
          <h3 className="text-lg font-semibold text-white truncate pr-4 flex items-center gap-2">
            <Tag size={16} className="text-primary" />
            {output.filename}
          </h3>
          <div className="flex items-center gap-1">
            <a href={getOutputUrl(output.relative_path)} target="_blank" rel="noopener" className="p-2 hover:bg-white/10 rounded-xl text-muted hover:text-white" title="Open in new tab">
              <ExternalLink size={18} />
            </a>
            <a href={getOutputUrl(output.relative_path)} download className="p-2 hover:bg-white/10 rounded-xl text-muted hover:text-white" title="Download">
              <Download size={18} />
            </a>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-muted hover:text-white">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="p-4">
          <div className="rounded-xl overflow-hidden bg-black/40 mb-4 border border-white/5 relative group">
            {output.file_type === "image" ? (
              <img src={getOutputUrl(output.relative_path)} alt={output.filename} className="w-full max-h-[60vh] object-contain cursor-zoom-in" onClick={onShowFullImage} />
            ) : output.file_type === "video" ? (
              <video src={getOutputUrl(output.relative_path)} controls autoPlay className="w-full max-h-[60vh] bg-black" />
            ) : output.file_type === "audio" ? (
              <div className="flex flex-col">
                {output.cover_image && <img src={getOutputUrl(output.cover_image)} alt={output.filename} className="w-full max-h-[50vh] object-contain bg-black" />}
                <audio ref={audioRef} src={getOutputUrl(output.relative_path)} controls autoPlay className="w-full" />
                {!output.cover_image && (
                  <div className="py-3 flex items-center justify-center gap-2 text-muted text-sm">
                    <Music size={16} /> No embedded cover
                  </div>
                )}
              </div>
            ) : is3DModelFile(output.filename) ? (
              <ModelPreview url={getOutputUrl(output.relative_path)} />
            ) : (
              <div className="h-64 flex items-center justify-center text-muted">
                <div className="text-center">
                  <FileType className="w-16 h-16 mx-auto mb-2 opacity-50" />
                  <p>Preview not available</p>
                </div>
              </div>
            )}
            {output.file_type === "image" && (
              <button onClick={onShowFullImage} className="absolute bottom-3 right-3 p-2 bg-black/60 backdrop-blur rounded-xl text-white hover:bg-black/80 flex items-center gap-1.5 text-xs">
                <Maximize2 size={14} /> Fullscreen
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
              <div className="flex items-center gap-2 text-xs text-muted mb-1">
                <FileType size={12} /> Type
              </div>
              <p className="text-sm text-white capitalize font-medium">{output.file_type}</p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
              <div className="flex items-center gap-2 text-xs text-muted mb-1">
                <HardDrive size={12} /> Size
              </div>
              <p className="text-sm text-white font-medium">{formatFileSize(output.size_bytes)}</p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
              <div className="flex items-center gap-2 text-xs text-muted mb-1">
                <Clock size={12} /> Created
              </div>
              <p className="text-sm text-white text-xs">{formatDateTime(output.created_at)}</p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
              <div className="flex items-center gap-2 text-xs text-muted mb-1">
                <Copy size={12} /> Path
              </div>
              <p className="text-sm text-white truncate text-xs font-mono" title={output.relative_path}>
                {output.relative_path}
              </p>
            </div>
          </div>

          {["audio", "video"].includes(output.file_type) && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <Activity size={14} className="text-primary" /> Media Inspection
              </h4>
              {mediaInfoLoading && <p className="text-xs text-muted">Loading media info…</p>}
              {mediaInfoError && <p className="text-xs text-red-400">{mediaInfoError}</p>}
              {mediaInfo && (
                <div className="space-y-3">
                  {probe && format && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {duration && (
                        <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                          <div className="flex items-center gap-2 text-xs text-muted mb-1">
                            <Clock size={12} /> Duration
                          </div>
                          <p className="text-sm text-white font-medium">{Number(duration).toFixed(2)}s</p>
                        </div>
                      )}
                      {bitRate && (
                        <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                          <div className="flex items-center gap-2 text-xs text-muted mb-1">
                            <HardDrive size={12} /> Bitrate
                          </div>
                          <p className="text-sm text-white font-medium">{(Number(bitRate) / 1000).toFixed(0)} kbps</p>
                        </div>
                      )}
                      {formatName && (
                        <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                          <div className="flex items-center gap-2 text-xs text-muted mb-1">
                            <FileType size={12} /> Format
                          </div>
                          <p className="text-sm text-white font-medium">{formatName}</p>
                        </div>
                      )}
                      {videoStream && (
                        <>
                          <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                            <div className="flex items-center gap-2 text-xs text-muted mb-1">
                              <Video size={12} /> Resolution
                            </div>
                            <p className="text-sm text-white font-medium">
                              {String(videoStream.width || "")}×{String(videoStream.height || "")}
                            </p>
                          </div>
                          <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                            <div className="flex items-center gap-2 text-xs text-muted mb-1">
                              <FileType size={12} /> Video Codec
                            </div>
                            <p className="text-sm text-white font-medium">{String(videoStream.codec_name || "")}</p>
                          </div>
                        </>
                      )}
                      {audioStream && (
                        <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                          <div className="flex items-center gap-2 text-xs text-muted mb-1">
                            <Music size={12} /> Audio Codec
                          </div>
                          <p className="text-sm text-white font-medium">{String(audioStream.codec_name || "")}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {output.file_type === "audio" && loudness && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {loudness.integrated_lufs !== undefined && loudness.integrated_lufs !== null && (
                        <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                          <div className="flex items-center gap-2 text-xs text-muted mb-1">
                            <Activity size={12} /> Integrated LUFS
                          </div>
                          <p className="text-sm text-white font-medium">{Number(loudness.integrated_lufs).toFixed(1)}</p>
                        </div>
                      )}
                      {loudness.loudness_range !== undefined && loudness.loudness_range !== null && (
                        <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                          <div className="flex items-center gap-2 text-xs text-muted mb-1">
                            <Activity size={12} /> LRA
                          </div>
                          <p className="text-sm text-white font-medium">{Number(loudness.loudness_range).toFixed(1)}</p>
                        </div>
                      )}
                      {loudness.true_peak !== undefined && loudness.true_peak !== null && (
                        <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                          <div className="flex items-center gap-2 text-xs text-muted mb-1">
                            <Activity size={12} /> True Peak
                          </div>
                          <p className="text-sm text-white font-medium">{Number(loudness.true_peak).toFixed(1)} dB</p>
                        </div>
                      )}
                    </div>
                  )}

                  {output.file_type === "audio" && peaks?.length && (
                    <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                      <p className="text-xs text-muted mb-1">Waveform</p>
                      <WaveformDisplay peaks={peaks} duration={waveformDuration ?? undefined} audioElement={audioRef.current} className="bg-black/40 rounded-lg border border-white/5" />
                    </div>
                  )}

                  {(output.file_type === "video" || output.file_type === "audio") && (
                    <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/5">
                      <p className="text-xs text-muted mb-2">{output.file_type === "video" ? "Thumbnail" : "Cover Art"}</p>
                      <div className="flex items-center gap-3">
                        {thumbnailUrl ? (
                          <img src={thumbnailUrl} alt={output.file_type === "video" ? "Thumbnail" : "Cover"} className="w-24 h-24 object-cover rounded-lg border border-white/10 bg-black" />
                        ) : (
                          <div className="w-24 h-24 flex items-center justify-center rounded-lg border border-white/10 bg-black/40 text-muted text-xs">No preview</div>
                        )}
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={output.file_type === "video" ? onExtractThumbnail : onRegenerateCover}
                            disabled={thumbnailLoading}
                            className="btn btn-secondary text-xs flex items-center gap-1.5"
                          >
                            {thumbnailLoading ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : output.file_type === "video" ? (
                              <Play size={12} />
                            ) : (
                              <Music size={12} />
                            )}
                            {output.file_type === "video" ? "Extract Thumbnail" : "Regenerate Cover"}
                          </button>
                          {output.file_type === "audio" && output.cover_image && (
                            <img src={getOutputUrl(output.cover_image)} alt="Current cover" className="w-10 h-10 object-cover rounded border border-white/10" title="Current cover" />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setRenameTarget(output); setRenameValue(output.filename); }} className="btn btn-secondary flex-1">
              <Pencil size={14} /> Rename
            </button>
            <a href={getOutputUrl(output.relative_path)} download className="btn btn-secondary flex-1 flex items-center justify-center gap-2">
              <Download size={14} /> Download
            </a>
            <button onClick={() => setOutputToDelete(output)} className="btn btn-danger flex-1">
              <Trash2 size={14} /> Delete
            </button>
          </div>
          {is3DModelFile(output.filename) && (
            <div className="flex gap-2 mt-3 flex-wrap">
              <button onClick={() => onAddToStudio(output, false)} disabled={openingApp === "studio"} className="btn flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">
                {openingApp === "studio" ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} Add to Studio
              </button>
              <button onClick={() => onAddToStudio(output, true)} disabled={openingApp === "studio"} className="btn flex-1 flex items-center justify-center gap-2 bg-violet-600/80 hover:bg-violet-500 text-white border border-violet-500/30 disabled:opacity-50">
                <ExternalLink size={14} /> Add & Open
              </button>
              <button onClick={() => onOpenBlender(output)} disabled={openingApp === "blender"} className="btn flex-1 flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50">
                {openingApp === "blender" ? <RefreshCw size={14} className="animate-spin" /> : <Box size={14} />} Open in Blender
              </button>
              <button onClick={() => onOpenUnity(output)} disabled={openingApp === "unity"} className="btn flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
                {openingApp === "unity" ? <RefreshCw size={14} className="animate-spin" /> : <Layers size={14} />} Open in Unity
              </button>
            </div>
          )}
          {output.file_type === "video" && (
            <ExportMatrixPanel sourcePath={output.relative_path} onComplete={onFetchOutputs} />
          )}
          {output.file_type === "video" && (
            <ExtractAudioPanel sourcePath={output.relative_path} onComplete={onFetchOutputs} />
          )}
          {output.file_type === "image" && (
            <UpscalePanel imagePath={output.relative_path} onComplete={onFetchOutputs} />
          )}
        </div>
      </div>
    </div>
  );
}
