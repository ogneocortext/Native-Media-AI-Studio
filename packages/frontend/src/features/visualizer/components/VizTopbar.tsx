/**
 * VizTopbar — visualizer header: brand, track selector, analyze + enhance.
 *
 * Presentational only. All behavior is owned by Visualizer and passed in as
 * handlers, so this file is easy for an agent to restyle without touching
 * playback or analysis logic.
 */
import { ListVideo, Music } from "lucide-react";
import type { LibraryFile } from "../visualizerHelpers";
import {
  audioRefForFile,
  optionLabelForFile,
} from "../visualizerHelpers";
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
}

export function VizTopbar({
  openOverlay,
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
}: VizTopbarProps) {
  const preset =
    activeVisualPresetId && visualPresets[activeVisualPresetId]
      ? visualPresets[activeVisualPresetId]
      : null;

  return (
    <header
      className={`viz-topbar${openOverlay ? " viz-topbar--overlay" : ""}`}
    >
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
            Select a track…
          </option>
          {libraryFiles.map((f) => {
            const ref = audioRefForFile(f);
            const name = optionLabelForFile(f);
            const meta = trackMetadata[ref];
            const badge = analysisData[ref] ? " ✓" : "";
            const metaStr = meta.bpm ? ` (${meta.bpm} BPM)` : "";
            return (
              <option key={ref} value={ref}>
                {name}
                {metaStr}
                {badge}
              </option>
            );
          })}
        </select>
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
          {analyzing
            ? "Analyzing track…"
            : currentAnalysisData
            ? "Analysis complete"
            : ""}
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
    </header>
  );
}
