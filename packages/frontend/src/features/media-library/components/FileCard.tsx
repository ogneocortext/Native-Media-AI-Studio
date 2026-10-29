import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaFile } from "../hooks/useMediaFiles";
import type { Collection, Tag } from "../../../services/api";
import {
  formatFileSize,
  formatDateTime,
} from "../../../utils/format";
import { getOutputUrl } from "../../../utils/url";
import { Heart, Pause, Play, Image, RefreshCw } from "lucide-react";
import { getMediaWaveform } from "../../../services/api/media";
import { audioDisplayName } from "../../../state/audioNaming";

const FILE_TYPE_COLORS: Record<string, string> = {
  audio: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  video: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  image: "bg-green-500/20 text-green-300 border-green-500/30",
  "3d": "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const FILE_TYPE_ICONS: Record<string, string> = {
  audio: "🎵",
  video: "🎬",
  image: "🖼️",
  "3d": "🤖",
};

const WAVEFORM_BAR_COUNT = 48;

/** Tracks audio elements currently playing so only one track plays at a time. */
const playingAudios = new Set<HTMLAudioElement>();

/**
 * Pauses every playing audio element except the one that just started.
 * Ensures only one track plays at a time (no duplicated/overlapping audio).
 */
function pauseOtherAudios(current: HTMLAudioElement) {
  for (const audio of playingAudios) {
    if (audio !== current && !audio.paused) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  playingAudios.add(current);
}

export interface FileCardProps {
  file: MediaFile;
  viewMode?: "grid" | "list";
  selected?: boolean;
  isFavorited?: boolean;
  tags?: Tag[];
  collections?: Collection[];
  onSelect?: (file: MediaFile) => void;
  onClick?: (file: MediaFile) => void;
  onDelete?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  onSendToWizard?: (file: MediaFile) => void;
  onToggleFavorite?: (file: MediaFile) => void;
  onGenerateThumbnail?: (file: MediaFile) => void;
  className?: string;
}

/**
 * WaveformVisualizer renders a per-file waveform using server-computed
 * peak data from GET /api/media/waveform.
 *
 * Features:
 * - Real per-file waveform data (not placeholder bars)
 * - Gradient fill with peak/RMS indication
 * - Canvas-based rendering
 * - Fetches waveform from backend API (no CORS issues)
 * - Falls back to server-provided waveform data
 * - Graceful fallback to placeholder if fetch fails
 * - Static full-track waveform (always shows complete structure)
 * - Optional playhead that moves left-to-right during playback
 */
function WaveformVisualizer({
  file,
  waveform,
  audioRef,
  className = "",
}: {
  file: MediaFile;
  waveform?: number[] | null;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const waveformDataRef = useRef<number[] | null>(null);

  const drawWaveform = useCallback(
    (data: number[], playheadX?: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.scale(dpr, dpr);

      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      ctx.clearRect(0, 0, width, height);

      // Gradient fill for a professional look
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "rgba(139, 92, 246, 0.8)");
      gradient.addColorStop(0.5, "rgba(168, 85, 247, 0.6)");
      gradient.addColorStop(1, "rgba(192, 132, 252, 0.4)");
      ctx.fillStyle = gradient;

      const sliceWidth = width / data.length;
      let x = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]) / 128.0;
        const barHeight = Math.max(2, v * (height / 2));
        const y = height / 2 - barHeight / 2;
        ctx.fillRect(x, y, Math.max(1, sliceWidth - 0.5), barHeight);
        x += sliceWidth;
      }

      // Draw playhead line when playing
      if (playheadX != null) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();

        // Playhead dot at top
        ctx.fillStyle = "rgba(255, 255, 255, 1)";
        ctx.beginPath();
        ctx.arc(playheadX, 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [],
  );

  // Animation loop: reads currentTime directly from the audio element
  // so the playhead moves smoothly without depending on React state updates.
  useEffect(() => {
    if (!audioRef?.current) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const audio = audioRef.current;
    const isPlaying = !audio.paused && !audio.ended;
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const animate = () => {
      if (audio.paused || audio.ended) return;
      const duration = audio.duration || 0;
      const currentTime = audio.currentTime || 0;
      const rect = canvas.getBoundingClientRect();
      const playheadX = duration > 0 ? (currentTime / duration) * rect.width : 0;
      drawWaveform(getCurrentWaveform(), playheadX);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [audioRef, drawWaveform]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  function getCurrentWaveform(): number[] {
    if (waveform && waveform.length > 0) {
      waveformDataRef.current = waveform;
      return waveform;
    }
    if (waveformDataRef.current) {
      return waveformDataRef.current;
    }
    return [];
  }

  useEffect(() => {
    // Use server-provided waveform if available
    if (waveform && waveform.length > 0) {
      drawWaveform(waveform);
      waveformDataRef.current = waveform;
      return;
    }

    // Otherwise fetch from backend API
    const filePath = file.relative_path || file.filename;
    getMediaWaveform(filePath, WAVEFORM_BAR_COUNT)
      .then((res) => {
        if (res.peaks && res.peaks.length > 0) {
          drawWaveform(res.peaks);
          waveformDataRef.current = res.peaks;
        } else {
          drawPlaceholder();
        }
      })
      .catch(() => {
        drawPlaceholder();
      });
  }, [file.relative_path, file.filename, waveform, drawWaveform]);

  function drawPlaceholder() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.scale(dpr, dpr);

    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(139, 92, 246, 0.25)";
    const barWidth = width / WAVEFORM_BAR_COUNT;
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
      const h = 12 + Math.random() * (height - 24);
      const y = (height - h) / 2;
      ctx.fillRect(i * barWidth, y, Math.max(1, barWidth - 0.5), h);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-6 ${className || ""}`}
      style={{ display: "block" }}
    />
  );
}

export function FileCard({
  file,
  viewMode = "grid",
  selected = false,
  isFavorited = false,
  tags = [],
  collections = [],
  onSelect,
  onClick,
  onDelete,
  onRename,
  onSendToWizard,
  onToggleFavorite,
  onGenerateThumbnail,
  className,
}: FileCardProps) {
  const isAudio = file.file_type === "audio";
  const isVideo = file.file_type === "video";
  const coverUrl = file.cover_image ? getOutputUrl(file.cover_image) : null;
  const mediaUrl = getOutputUrl(file.relative_path);
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sizeLabel =
    file.size_bytes != null
      ? formatFileSize(file.size_bytes)
      : formatFileSize(file.size ?? 0);
  const typeColor = FILE_TYPE_COLORS[file.file_type] || "bg-gray-500/20";
  const typeIcon = FILE_TYPE_ICONS[file.file_type] || "📁";
  // Audio files carry stacked content-hash prefixes (e.g. `5eab45eb_3a288113_`
  // `music_video.m4a`) that must be stripped for display — the raw filename is
  // kept on the `title` attribute and used for rename so the real file is
  // untouched. Non-audio types keep their filename unchanged.
  const displayName = isAudio ? audioDisplayName(file.filename) : file.filename;
  const durationLabel = file.duration != null ? file.duration.toFixed(0) + "s" : "";

  const handleCardClick = () => {
    if (onSelect) onSelect(file);
    else if (onClick) onClick(file);
  };

  // Pause audio when component unmounts
  useEffect(() => {
    return () => {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);

  const handleGenerateThumbnail = async () => {
    if (!onGenerateThumbnail) return;
    setGeneratingThumbnail(true);
    try {
      await onGenerateThumbnail(file);
    } finally {
      setGeneratingThumbnail(false);
    }
  };

  return (
    <div
      className={`
        ${className || ""} p-2 transition-colors rounded-lg cursor-pointer group
        ${selected ? "ring-2 ring-violet-500 bg-black/60" : "bg-black/40 border border-white/10 hover:bg-black/50"}
      `}
      onClick={handleCardClick}
    >
      {/* Selection checkbox */}
      {onSelect && (
        <div className="absolute top-1 right-1 z-10">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect(file);
            }}
            className="rounded border-gray-600 bg-black checked:bg-violet-600 checked:border-violet-500 checked:ring-1"
            aria-label={`Select ${file.filename}`}
          />
        </div>
      )}

      {/* Favorite heart */}
      {onToggleFavorite && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(file);
          }}
          className={`absolute top-1 left-1 z-10 p-1 rounded ${
            isFavorited
              ? "text-violet-400 bg-violet-900/30"
              : "text-gray-500 bg-black/50 hover:text-white hover:bg-black/80"
          }`}
          aria-label={isFavorited ? "Unfavorite" : "Favorite"}
          title={isFavorited ? "Unfavorite" : "Favorite"}
        >
          <Heart size={16} fill={isFavorited ? "currentColor" : "none"} />
        </button>
      )}

      {/* Duration badge (top-right)} */}
      {durationLabel && (
        <div className="absolute top-1 right-1 z-10">
          <span className="text-[10px] bg-black/60 text-violet-300 px-1 py-0.5 rounded border border-violet-500/30">
            {durationLabel}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {/* Media area */}
        <div
          className={`relative aspect-square overflow-hidden ${
            viewMode === "list" ? "w-20 h-20 flex-shrink-0" : "w-full"
          }`}
        >
          {/* Audio: hidden audio element + play/pause button + static waveform with playhead */}
          {isAudio ? (
            <div className="relative w-full h-full">
              <audio
                ref={audioRef}
                src={mediaUrl}
                preload="metadata"
                onPlay={() => {
                  pauseOtherAudios(audioRef.current!);
                }}
                onPause={() => {
                  playingAudios.delete(audioRef.current!);
                }}
                onEnded={() => {
                  playingAudios.delete(audioRef.current!);
                }}
              />
              <div className="flex items-center justify-between mt-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const audio = audioRef.current;
                    if (!audio) return;
                    if (audio.paused) {
                      audio.play().catch(() => {});
                    } else {
                      audio.pause();
                    }
                  }}
                  className="p-1.5 bg-violet-600/30 hover:bg-violet-600/50 rounded text-violet-300"
                  aria-label={audioRef.current?.paused ? "Play audio" : "Pause audio"}
                  title={audioRef.current?.paused ? "Play audio" : "Pause audio"}
                >
                  {audioRef.current?.paused ? (
                    <Play size={16} className="text-white" />
                  ) : (
                    <Pause size={16} className="text-white" />
                  )}
                </button>
                <WaveformVisualizer
                  file={file}
                  waveform={file.waveform}
                  audioRef={audioRef}
                  className="flex-1"
                />
              </div>
            </div>
          ) : isVideo ? (
            <div className="relative w-full h-full">
              {/* Video with inline preview (playsInline only - no autoplay/loop) */}
              <video
                ref={videoRef}
                src={mediaUrl}
                className="w-full h-full object-cover"
                playsInline
                muted
                poster={coverUrl || undefined}
                onPlay={() => setIsVideoPlaying(true)}
                onPause={() => setIsVideoPlaying(false)}
                onEnded={() => setIsVideoPlaying(false)}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.paused) {
                    video.play().catch(() => {});
                    setIsVideoPlaying(true);
                  } else {
                    video.pause();
                    setIsVideoPlaying(false);
                  }
                }}
                className="absolute inset-0 bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={isVideoPlaying ? "Pause video" : "Play video"}
              >
                {isVideoPlaying ? (
                  <Pause size={28} className="text-white ml-1" />
                ) : (
                  <Play size={28} className="text-white ml-1" />
                )}
              </button>
              {/* Generate / regenerate thumbnail for ALL video files */}
              {onGenerateThumbnail && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 bg-black/80 border border-white/10 rounded-lg px-2 py-1 backdrop-blur">
                  {generatingThumbnail ? (
                    <RefreshCw size={14} className="animate-spin text-violet-400" />
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleGenerateThumbnail();
                      }}
                      className="text-xs text-violet-400 hover:text-violet-300"
                      title={coverUrl ? "Regenerate thumbnail" : "Generate thumbnail"}
                    >
                      {coverUrl ? "Regenerate thumb" : "Gen thumb"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : file.file_type === "image" ? (
            <div className="relative">
              <img
                src={mediaUrl}
                alt={file.filename}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.(file);
                }}
                className="absolute inset-0 bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Open image"
              >
                <Image size={24} className="text-white" />
              </button>
            </div>
          ) : coverUrl && !isAudio ? (
            <div className="relative">
              <img
                src={coverUrl}
                alt={file.filename}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.(file);
                }}
                className="absolute inset-0 bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Open"
              >
                {isVideo ? (
                  <Play size={28} className="text-white ml-1" />
                ) : (
                  <Image size={24} className="text-white" />
                )}
              </button>
            </div>
          ) : (
            <div className={`w-full h-full bg-black/40 flex items-center justify-center border border-gray-700/50 group`}>
              <span className="text-3xl">{typeIcon}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.(file);
                }}
                className="absolute inset-0 bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={isVideo ? "Play video" : "Open"}
              >
                {isVideo || file.file_type === "image" ? (
                  <Play size={28} className="text-white ml-1" />
                ) : (
                  <Image size={24} className="text-white" />
                )}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div
            className="text-base font-semibold text-white truncate leading-tight"
            title={file.filename}
          >
            {displayName}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted truncate">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded ${typeColor}`}>
              {typeIcon} {file.file_type}
            </span>
            <span>{sizeLabel}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted truncate">
            <time title={formatDateTime(file.modified_at || file.modified_time || "")}>
              {formatDateTime(file.modified_at || file.modified_time || "")}
            </time>
          </div>

          {/* Tag chips */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    tag.color ? `bg-${hexToTailwind(tag.color)}` : "bg-gray-600"
                  } text-white`}
                  title={tag.name}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Collection badges */}
          {collections.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {collections.map((c) => (
                <span
                  key={c.id}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/50"
                  title={`Collection: ${c.name}`}
                >
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Hover actions (grid only) */}
        {viewMode === "grid" && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(file);
                }}
                className="text-xs text-red-500 hover:text-red-300 p-1"
                title="Move to trash"
              >
                Delete
              </button>
            )}
            {onRename && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(file);
                }}
                className="text-xs text-violet-500 hover:text-violet-300 p-1"
                title="Rename"
              >
                Rename
              </button>
            )}
            {onSendToWizard && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSendToWizard(file);
                }}
                className="text-xs text-blue-500 hover:text-blue-300 p-1"
                title="Send to Music Video Wizard"
              >
                Wizard
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function hexToTailwind(hex: string): string {
  const map: Record<string, string> = {
    "#8b5cf6": "violet-600",
    "#3b82f6": "blue-600",
    "#22c55e": "green-600",
    "#f59e0b": "amber-600",
    "#ef4444": "red-600",
    "#ec4899": "pink-600",
    "#06b6d4": "cyan-600",
    "#a855f7": "purple-600",
  };
  return map[hex] || "gray-600";
}
