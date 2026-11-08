/**
 * VizTopbar — visualizer header: brand, track selector, analyze + enhance.
 *
 * Presentational only. All behavior is owned by Visualizer and passed in as
 * handlers, so this file is easy for an agent to restyle without touching
 * playback or analysis logic.
 */
import { FolderOpen, ListVideo, Music } from "lucide-react";
import type { LibraryFile } from "../visualizerHelpers";
import { audioRefForFile, optionLabelForFile } from "../visualizerHelpers";
import type { AudioAnalysisData } from "../types";

interface VizTopbarProps {
  openOverlay: boolean;
  currentFilename: string | null;
  libraryFiles: LibraryFile[];
  onSelectTrack: (ref: string) => void;
  autoPlay: boolean;
  onToggleAutoPlay: () => void;
  analyzing: boolean;
  onAnalyzeTrack: (filename: string) => void;
  currentAnalysisData: AudioAnalysisData | null;
  trackMetadata: Record<string, { bpm?: number; duration?: number }>;
  analysisData: Record<string, AudioAnalysisData>;
  activeVisualPresetId: string | null;
  visualPresets: Record<string, { name: string; description: string }>;
  onEnhanceWithAI: () => void;
  aiEnhancing: boolean;
  loadedPreset: { name?: string } | null;
  /** Library fetch state — drives the empty-option label. */
  libraryLoading?: boolean;
  libraryError?: string | null;
  /** Open the searchable audio-file browser (available after a track loads too). */
  onBrowseLibrary?: () => void;
}

export function VizTopbar({
  currentFilename,
  libraryFiles,
  onSelectTrack,
  autoPlay,
  onToggleAutoPlay,
  analyzing,
  onAnalyzeTrack,
  currentAnalysisData,
  trackMetadata,
  analysisData,
  activeVisualPresetId,
  visualPresets,
  onEnhanceWithAI,
  aiEnhancing,
  loadedPreset,
  libraryLoading = false,
  libraryError = null,
  onBrowseLibrary,
}: VizTopbarProps) {
  // Record lookups can miss at runtime despite the index type.
  const preset = activeVisualPresetId
    ? (visualPresets[activeVisualPresetId] as (typeof visualPresets)[string] | undefined)
    : null;

  return (
    <div className="viz-topbar-row">
      <div className="viz-brand">
        <Music size={20} />
        <h1 className="viz-page-title">Visualizer</h1>
      </div>
      <div className="viz-track-selector">
        <select
          data-testid="viz-track-select"
          id="viz-track-select"
          aria-label="Select a track"
          onChange={(e) => onSelectTrack(e.target.value)}
          value={currentFilename ?? ""}
          className="viz-track-select"
        >
          <option value="" disabled>
            {libraryLoading
              ? "Loading tracks…"
              : libraryError
                ? "Track library unavailable"
                : "Select a track…"}
          </option>
          {libraryFiles.map((f) => {
            const ref = audioRefForFile(f);
            const name = optionLabelForFile(f);
            const meta = trackMetadata[ref] as (typeof trackMetadata)[string] | undefined;
            const analyzed = analysisData[ref] as (typeof analysisData)[string] | undefined;
            const badge = analyzed ? " ✓" : "";
            const metaStr = meta?.bpm ? ` (${meta.bpm} BPM)` : "";
            return (
              <option key={ref} value={ref}>
                {name}
                {metaStr}
                {badge}
              </option>
            );
          })}
        </select>
        {onBrowseLibrary && (
          <button
            onClick={onBrowseLibrary}
            className="viz-icon-btn"
            aria-label="Browse audio library"
            title="Browse audio library (search, preview, pick a track)"
          >
            <FolderOpen size={14} />
          </button>
        )}
        <button
          onClick={onToggleAutoPlay}
          className={`viz-icon-btn ${autoPlay ? "active" : ""}`}
          aria-label={autoPlay ? "Auto-play ON" : "Auto-play OFF"}
          aria-pressed={autoPlay}
          title={
            autoPlay
              ? "Auto-play ON — tracks start automatically"
              : "Auto-play OFF — pick a track then press Play"
          }
        >
          {/* ListVideo, not Play: this toggles auto-play of the NEXT track;
              the Play glyph made it read as a duplicate transport (plan 1.1). */}
          <ListVideo size={14} />
        </button>
        {currentFilename && !currentAnalysisData && (
          <button
            className="viz-analyze-btn"
            onClick={() => onAnalyzeTrack(currentFilename)}
            disabled={analyzing}
            aria-describedby="viz-analyze-status"
          >
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>
        )}
        <span id="viz-analyze-status" className="sr-only" aria-live="polite">
          {analyzing ? "Analyzing track…" : currentAnalysisData ? "Analysis complete" : ""}
        </span>
        {currentFilename && preset && (
          <span
            className="viz-preset-badge"
            title={`Active preset: ${preset.name}\n${preset.description}`}
          >
            {preset.name}
          </span>
        )}
        {currentAnalysisData && !loadedPreset && (
          <button
            className="viz-enhance-btn"
            onClick={onEnhanceWithAI}
            disabled={aiEnhancing}
            title="Generate AI preset tuned to this track (manual, visible)"
          >
            {aiEnhancing ? "Enhancing…" : "Enhance with AI"}
          </button>
        )}
      </div>
    </div>
  );
}
