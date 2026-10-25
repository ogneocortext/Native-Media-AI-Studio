import type { MediaFile } from "../hooks/useMediaFiles";
import type { Collection, Tag } from "../../../services/api";
import {
  formatFileSize,
  formatDateTime,
} from "../../../utils/format";
import { getOutputUrl } from "../../../utils/url";
import { Heart, Play, Image } from "lucide-react";

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
  className?: string;
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
  className,
}: FileCardProps) {
  const isAudio = file.file_type === "audio";
  const isVideo = file.file_type === "video";
  const coverUrl = file.cover_image ? getOutputUrl(file.cover_image) : null;
  const sizeLabel =
    file.size_bytes != null
      ? formatFileSize(file.size_bytes)
      : formatFileSize(file.size ?? 0);
  const typeColor = FILE_TYPE_COLORS[file.file_type] || "bg-gray-500/20";
  const typeIcon = FILE_TYPE_ICONS[file.file_type] || "📁";

  const handleCardClick = () => {
    if (onSelect) onSelect(file);
    else if (onClick) onClick(file);
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

      <div className="flex flex-col gap-2">
        {/* Thumbnail / cover area */}
        <div
          className={`aspect-square rounded overflow-hidden relative ${
            viewMode === "list" ? "w-12 h-12 flex-shrink-0" : "w-full"
          }`}
        >
          {coverUrl && isAudio ? (
            <div className="relative">
              <img
                src={coverUrl}
                alt="Cover art"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <span className="absolute bottom-1 right-1 text-xl bg-black/60 rounded">
                ♫
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.(file);
                }}
                className="absolute inset-0 bg-black/40 hover:bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Play"
              >
                <Play size={28} className="text-white ml-1" />
              </button>
            </div>
          ) : (
            <div className={`w-full h-full bg-black/40 flex items-center justify-center border border-gray-700/50 group`}>
              {coverUrl && !isAudio ? (
                <img
                  src={coverUrl}
                  alt={file.filename}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    // Fall through to placeholder handled by CSS
                  }}
                />
              ) : null}
              {!coverUrl || (file.file_type !== "audio" && !coverUrl) ? (
                <>
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
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div
            className="text-base font-semibold text-white truncate leading-tight"
            title={file.filename}
          >
            {file.filename}
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
