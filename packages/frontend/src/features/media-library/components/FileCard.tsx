import type { MediaFile } from "../hooks/useMediaFiles";
import { formatFileSize, formatDateTime } from "../../../utils/format";

export interface FileCardProps {
  file: MediaFile;
  onClick?: (file: MediaFile) => void;
  onDelete?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  className?: string;
}

export function FileCard({
  file,
  onClick,
  onDelete,
  onRename,
  className,
}: FileCardProps) {
  const extension = file.file_type.split(".").pop()?.toLowerCase() || "";
  const icons = {
    audio: "🎵",
    video: "🎬",
    image: "🖼️",
    model: "🤖",
    document: "📄",
    txt: "📝",
    json: "📋",
    zip: "🗜️",
    gbx: "🎮",
  };

  const icon = (icons as Record<string, string>)[extension] || "📁";

  return (
    <div
      className={`${className || "bg-black/40 border border-white/10 rounded hover:bg-black/50 cursor-pointer"} p-3 transition-colors`}
      onClick={() => onClick?.(file)}
    >
      <div className="flex items-start gap-2">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">
            {file.filename}
          </div>
          <div className="text-xs text-muted truncate mt-0.5">
            {file.file_type} · {formatFileSize(file.size)}
          </div>
          <div className="text-xs text-muted">
            {formatDateTime(file.modified_time)}
          </div>
        </div>
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(file);
              }}
              className="text-xs text-red-500 hover:text-red-300 p-1"
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
              className="text-xs text-blue-500 hover:text-blue-300 p-1"
            >
              Rename
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
