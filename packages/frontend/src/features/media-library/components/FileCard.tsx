import type { MediaFile } from "../hooks/useMediaFiles";
import { formatFileSize, formatDateTime } from "../../../utils/format";
import { getOutputUrl } from "../../../utils/url";

export interface FileCardProps {
  file: MediaFile;
  viewMode?: "grid" | "list";
  selected?: boolean;
  onSelect?: (file: MediaFile) => void;
  onClick?: (file: MediaFile) => void;
  onDelete?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  onSendToWizard?: (file: MediaFile) => void;
  className?: string;
}

export function FileCard({
  file,
  viewMode = "grid",
  selected = false,
  onSelect,
  onClick,
  onDelete,
  onRename,
  onSendToWizard,
  className,
}: FileCardProps) {
  const isAudio = file.file_type === "audio";
  const coverUrl = file.cover_image ? getOutputUrl(file.cover_image) : null;
  const sizeLabel =
    file.size_bytes != null
      ? formatFileSize(file.size_bytes)
      : formatFileSize(file.size ?? 0);

  return (
    <div
      className={`
        ${className || ""} p-2 transition-colors rounded-lg cursor-pointer
        ${selected ? "ring-2 ring-violet-500 bg-black/60" : "bg-black/40 border border-white/10 hover:bg-black/50"}
      `}
      onClick={() => {
        if (onSelect) onSelect(file);
        else if (onClick) onClick(file);
      }}
    >
      {/* Selection checkbox (only meaningful with external selection state) */}
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
              />
              <span className="absolute bottom-1 right-1 text-xl bg-black/60 rounded">
                ♫
              </span>
            </div>
          ) : (
            <div className="w-full h-full bg-gray-800/60 flex items-center justify-center border border-gray-700/50">
              {isAudio ? (
                <>
                  <span className="text-2xl">🎵</span>
                </>
              ) : file.file_type === "video" ? (
                <>
                  <span className="text-2xl">🎬</span>
                </>
              ) : file.file_type === "image" ? (
                <img
                  src={getOutputUrl(file.relative_path)}
                  alt={file.filename}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="text-lg">{getFileIcon(file.file_type)}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div
            className="text-sm font-medium text-white truncate"
            title={file.filename}
          >
            {file.filename}
          </div>
          <div className="text-xs text-muted truncate">
            {file.file_type} · {sizeLabel}
          </div>
          <div className="text-xs text-muted">
            {formatDateTime(file.modified_at || file.modified_time || "")}
          </div>
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
                title="Delete"
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

function getFileIcon(fileType: string): string {
  const ext = fileType.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    mp3: "🎵",
    wav: "🎵",
    flac: "🎵",
    ogg: "🎵",
    m4a: "🎵",
    mp4: "🎬",
    webm: "🎬",
    jpg: "🖼️",
    jpeg: "🖼️",
    png: "🖼️",
    glb: "🤖",
    obj: "🤖",
    pdf: "📄",
    txt: "📝",
    json: "📋",
  };
  return iconMap[ext] || (fileType.includes("audio") ? "🎵" : "📁");
}
