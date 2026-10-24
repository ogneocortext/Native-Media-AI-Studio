/**
 * PlaybackModal — plays a media file in an overlay.
 *
 * Audio: shows extracted cover art (`cover_image`) above `<audio controls autoplay>`;
 * no cover → Music placeholder + "No embedded cover" hint.
 * Video: `<video src="..." controls autoplay>`.
 *
 * All media is served via `getOutputUrl(relative_path)`.
 */
import { useCallback } from "react";
import { X, Music } from "lucide-react";
import { getOutputUrl } from "../../../utils/url";

interface PlaybackModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: {
    filename: string;
    file_type: string;
    cover_image: string | null;
    has_cover: boolean;
    relative_path: string;
  };
}

export function PlaybackModal({
  isOpen,
  onClose,
  file,
}: PlaybackModalProps) {
  if (!isOpen) return null;

  const isAudio = file.file_type === "audio";
  const isVideo = file.file_type === "video";
  const src = getOutputUrl(file.relative_path);
  const coverUrl = file.cover_image ? getOutputUrl(file.cover_image) : null;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={`Playback: ${file.filename}`}
    >
      <div
        className="bg-black/90 border border-white/10 rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full px-4 py-2">
          <h3 className="text-lg font-semibold text-white truncate">
            {file.filename}
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-white"
            aria-label="Close playback"
          >
            <X size={18} />
          </button>
        </div>

        {/* Media cover / player area */}
        <div className="w-full max-h-[60vh] flex items-center justify-center bg-gray-900/50 rounded-lg p-2">
          {coverUrl && isAudio ? (
            <div className="relative group">
              <img
                src={coverUrl}
                alt="Cover art"
                className="max-w-[300px] max-h-[300px] object-contain rounded bg-black"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl text-violet-400">♫</span>
              </div>
            </div>
          ) : null}
          {isAudio && !coverUrl ? (
            <div className="flex flex-col items-center justify-center h-64 w-64 bg-gray-800 rounded border border-gray-700">
              <Music size={48} className="text-gray-500 mb-2" />
              <p className="text-xs text-gray-500">No embedded cover</p>
            </div>
          ) : null}
          {isVideo ? (
            <video
              src={src}
              controls
              autoPlay
              className="max-w-full max-h-[60vh] rounded bg-black"
              aria-label={`Video: ${file.filename}`}
            />
          ) : null}
          {isAudio && coverUrl ? (
            <audio
              src={src}
              controls
              autoPlay
              className="w-full max-w-md mt-4"
              aria-label={`Audio: ${file.filename}`}
            />
          ) : null}
          {isAudio && !coverUrl ? (
            <audio
              src={src}
              controls
              autoPlay
              className="w-full max-w-md mt-4"
              aria-label={`Audio: ${file.filename}`}
            />
          ) : null}
        </div>

        <div className="w-full px-4 py-2 text-xs text-muted">
          <span>{file.file_type}</span>
          {src && (
            <span className="ml-2">· {file.relative_path}</span>
          )}
        </div>

        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary/20 text-primary rounded hover:bg-primary/30"
        >
          Close
        </button>
      </div>
    </div>
  );
}
