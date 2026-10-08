/**
 * AudioFileBrowser - Browse the audio library and pick a track before the
 * visualizer starts. Reads the shared audio library store (D16) so this
 * selector, the Visualizer's own dropdowns, and every other audio picker
 * render the same deduplicated, display-name-tagged list from one request.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock, FileAudio, Loader2, Search, X } from "lucide-react";
import { formatBytes } from "../../../utils/format";
import { useAudioLibrary } from "../../../hooks/useAudioLibrary";
import type { AudioLibraryEntry } from "../../../state/audioLibraryStore";

export interface AudioFileBrowserProps {
  onClose: () => void;
  onSelect: (ref: string) => void;
}

export function AudioFileBrowser({ onClose, onSelect }: AudioFileBrowserProps) {
  const { entries, isLoading, error, refresh } = useAudioLibrary();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        f.filename.toLowerCase().includes(q) ||
        f.folder.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const handleSelect = useCallback(
    (entry: AudioLibraryEntry) => onSelect(entry.ref),
    [onSelect],
  );

  return (
    <div className="viz-file-browser-backdrop" onClick={onClose}>
      <div
        className="viz-file-browser"
        role="dialog"
        aria-label="Audio file browser"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="viz-file-browser-head">
          <div className="viz-file-browser-title">
            <FileAudio size={16} />
            <span>Audio files</span>
          </div>
          <button
            type="button"
            className="viz-file-browser-close"
            onClick={onClose}
            aria-label="Close file browser"
          >
            <X size={16} />
          </button>
        </div>

        <div className="viz-file-browser-toolbar">
          <div className="viz-file-browser-search">
            <Search size={14} className="viz-file-browser-search-icon" />
            <input
              type="search"
              value={query}
              placeholder="Filter files…"
              aria-label="Filter audio files"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="viz-file-browser-count">
            {isLoading
              ? "Loading…"
              : `${filtered.length} file${filtered.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {isLoading && (
          <div className="viz-file-browser-empty">
            <Loader2 size={16} className="viz-file-browser-spinner" />
            <span>Loading audio files…</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="viz-file-browser-empty" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button
              type="button"
              className="viz-file-browser-retry"
              onClick={() => {
                setQuery("");
                void refresh();
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="viz-file-browser-empty">
            Nothing matches "{query}"
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <ul className="viz-file-browser-list">
            {filtered.map((entry) => (
              <li key={entry.ref}>
                <button
                  type="button"
                  className="viz-file-browser-card"
                  onClick={() => handleSelect(entry)}
                  aria-label={`Play ${entry.displayName}`}
                >
                  <span className="viz-file-browser-card-name">
                    {entry.displayName}
                  </span>
                  {entry.folder && (
                    <span className="viz-file-browser-card-folder">
                      {entry.folder}
                    </span>
                  )}
                  <span className="viz-file-browser-card-meta">
                    <Clock size={12} />
                    {formatBytes(entry.size_bytes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="viz-file-browser-foot">
          <a href="/audio-analysis" className="viz-file-browser-foot-link">
            Open Audio Analysis →
          </a>
          <span className="viz-file-browser-foot-note">
            Select a track to start the visualizer
          </span>
        </div>
      </div>
    </div>
  );
}
