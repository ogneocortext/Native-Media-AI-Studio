/**
 * LibraryTrackList — displays track selection from media library.
 *
 * Each row shows the track's display name plus its file type and size so users
 * can distinguish between tracks with similar names. Unnamed tracks (stored as
 * bare content hashes) are labeled "Unnamed track …" instead of showing a hex
 * string.
 */
import { useAudioLibrary } from "../../../hooks/useAudioLibrary";
import { Music } from "lucide-react";

export function LibraryTrackList({ onSelect }: { onSelect: (track: string) => void }) {
  const { entries: tracks, isLoading: loading } = useAudioLibrary();

  if (loading) {
    return <p className="text-xs text-muted">Loading library...</p>;
  }

  if (tracks.length === 0) {
    return <p className="text-xs text-muted">No tracks in library</p>;
  }

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {tracks.map((track) => {
        const ext = track.filename.split(".").pop()?.toUpperCase();
        const sizeKB = ((track.size_bytes || 0) / 1024).toFixed(0);
        return (
          <button
            key={track.filename}
            onClick={() => onSelect(track.ref)}
            className="w-full text-left px-3 py-2 bg-surface hover:bg-surface-hover rounded-lg text-sm text-foreground border border-border transition-colors"
          >
            <div className="flex items-center gap-2">
              <Music size={14} className="text-muted" />
              <div className="flex-1 min-w-0">
                <span className="block truncate text-sm text-foreground">{track.optionLabel}</span>
                <span className="block text-[10px] text-muted truncate">
                  {ext} • {sizeKB} KB
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
