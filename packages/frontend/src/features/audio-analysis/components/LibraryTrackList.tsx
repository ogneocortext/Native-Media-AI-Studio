/**
 * LibraryTrackList — displays track selection from media library
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
      {tracks.map((track) => (
        <button
          key={track.filename}
          onClick={() => onSelect(track.filename)}
          className="w-full text-left px-3 py-2 bg-surface hover:bg-surface-hover rounded-lg text-sm text-foreground border border-border transition-colors"
        >
          <div className="flex items-center gap-2">
            <Music size={14} className="text-muted" />
            <span className="truncate">{track.optionLabel}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
