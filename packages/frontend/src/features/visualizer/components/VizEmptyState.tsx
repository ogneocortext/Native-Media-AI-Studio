/**
 * VizEmptyState — guided onboarding card shown when no track is loaded.
 *
 * Presentational only: receives library + handlers from Visualizer.
 */
import { Music } from "lucide-react";
import type { LibraryFile } from "../visualizerHelpers";

interface VizEmptyStateProps {
  /** Library entries referenced by the "pick a track" step count. */
  libraryFiles: LibraryFile[];
  /** Open the file browser. */
  onBrowse: () => void;
}

export function VizEmptyState({ libraryFiles, onBrowse }: VizEmptyStateProps) {
  return (
    <div
      className="viz-empty-hero"
      role="status"
      aria-label="Get started with the visualizer"
    >
      <div className="viz-empty-card">
        <div className="viz-empty-icon">
          <Music size={28} />
        </div>
        <h3>Drop a song to see it</h3>
        <p className="viz-empty-sub">
          Three steps — no setup. Pick a track, pick a vibe, hit play.
          Beat-synced shader + 3D + lyrics.
        </p>
        <ol className="viz-empty-steps">
          <li>
            <span className="viz-empty-n">1</span> <b>Pick a track</b> →
            choose from the library above
            {libraryFiles.length > 0
              ? ` (${libraryFiles.length} tracks ready)`
              : ", or upload an MP3/WAV"}
          </li>
          <li>
            <span className="viz-empty-n">2</span> <b>Pick a vibe</b> →
            shader, 3D, or 2D from the toolbar
          </li>
          <li>
            <span className="viz-empty-n">3</span> Press <b>Play</b> — cuts
            land on beats, chorus = maximal
          </li>
        </ol>
        <div className="viz-empty-actions">
          <button
            className="viz-empty-cta"
            onClick={onBrowse}
          >
            Browse library…
          </button>
          <a href="/audio-analysis" className="viz-empty-link">
            Open Audio Analysis →
          </a>
        </div>
        <p className="viz-empty-tip">
          Tip: first 3s are the hook — start on the chorus for Shorts.
          Drag & drop audio files anywhere to load them.
        </p>
      </div>
    </div>
  );
}
