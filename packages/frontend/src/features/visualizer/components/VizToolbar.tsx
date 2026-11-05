/**
 * VizToolbar — the visualizer's right-hand action toolbar (mode, layers,
 * capture, focus, shortcuts + more menus).
 *
 * Presentational + orchestration: it owns no persistent state; every value
 * and handler is passed in by Visualizer. Keeping the control surface in one
 * file makes it easy for an agent to locate and restyle.
 */
import {
  Camera,
  EyeOff,
  Keyboard,
  Layers,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  User,
} from "lucide-react";
import type { Canvas2DMode } from "../visualizerHelpers";
import type { VisualPreset } from "../aiPresetCatalog";
import {
  CANVAS_2D_MODES,
  CANVAS_2D_MODE_LABELS,
} from "../visualizerHelpers";
import { PresetFileUpload } from "./PresetFileUpload";
import { VizMoreMenu } from "./VizMoreMenu";

interface VizToolbarProps {
  // --- preset file upload ---
  onPresetLoaded: (preset: VisualPreset) => void;
  loadedPresetName: string | null;
  onClearPreset: () => void;

  // --- mode cycle ---
  vizMode: "3d" | "shader" | "2d";
  onCycleMode: () => void;

  // --- layers (visuals / lyrics / character) ---
  visualsVisible: boolean;
  onToggleVisuals: () => void;
  lyricsVisible: boolean;
  onToggleLyrics: () => void;
  lyricsLength: number;
  characterVisible: boolean;
  onToggleCharacter: () => void;

  // --- capture / focus ---
  onCaptureFrame: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;

  // --- shortcuts overlay ---
  showShortcuts: boolean;
  onToggleShortcuts: () => void;

  // --- more overlay ---
  showMoreMenu: boolean;
  onToggleMore: () => void;

  // --- more menu pass-through (owned by VizMoreMenu) ---
  canvas2DMode: Canvas2DMode;
  onSelect2DMode: (m: Canvas2DMode) => void;
  isRecording: boolean;
  recordingTime: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onExportFrameAccurate: (seconds: number) => void;
  isExporting: boolean;
  exportProgress: number;
  recordedBlob: Blob | null;
  onDownloadRecording: () => void;
  onToggleExportModal: () => void;
  onToggleLoop: () => void;
  loopRegion: { start: number; end: number } | null;
  loopAnchor: number | null;
  sceneFrozen: boolean;
  onToggleSceneFrozen: () => void;
  onToggleFocusFromMenu: () => void;
  onToggleSettings: () => void;
  showSettings: boolean;
  onToggleAnimDemo: () => void;
  showAnimDemo: boolean;
  onToggleTheatre: () => void;
  showTheatreStudio: boolean;
  onToggleAIPanel: () => void;
  showAIPanel: boolean;
  onCloseOverlay: () => void;
  prefersReducedMotion: boolean;
  onToggleReducedMotion: () => void;
}

export function VizToolbar({
  onPresetLoaded,
  loadedPresetName,
  onClearPreset,
  vizMode,
  onCycleMode,
  visualsVisible,
  onToggleVisuals,
  lyricsVisible,
  onToggleLyrics,
  lyricsLength,
  characterVisible,
  onToggleCharacter,
  onCaptureFrame,
  focusMode,
  onToggleFocus,
  showShortcuts,
  onToggleShortcuts,
  showMoreMenu,
  onToggleMore,
  canvas2DMode,
  onSelect2DMode,
  isRecording,
  recordingTime,
  onStartRecording,
  onStopRecording,
  onExportFrameAccurate,
  isExporting,
  exportProgress,
  recordedBlob,
  onDownloadRecording,
  onToggleExportModal,
  onToggleLoop,
  loopRegion,
  loopAnchor,
  sceneFrozen,
  onToggleSceneFrozen,
  onToggleFocusFromMenu,
  onToggleSettings,
  showSettings,
  onToggleAnimDemo,
  showAnimDemo,
  onToggleTheatre,
  showTheatreStudio,
  onToggleAIPanel,
  showAIPanel,
  onCloseOverlay,
  prefersReducedMotion,
  onToggleReducedMotion,
}: VizToolbarProps) {
  return (
    <div className="viz-actions" role="toolbar" aria-label="Visualizer controls">
      <PresetFileUpload
        onPresetLoaded={onPresetLoaded}
        loadedPresetName={loadedPresetName ?? null}
        onClearPreset={onClearPreset}
      />

      <div className="viz-btn-group">
        <button
          onClick={onCycleMode}
          className={`viz-icon-btn ${vizMode !== "3d" ? "active" : ""}`}
          title={`Visualization mode: ${vizMode} — cycles FX → 2D → 3D`}
          aria-label={`Visualization mode: ${vizMode}. Activate to cycle FX → 2D → 3D.`}
          aria-controls="viz-canvas-wrap"
        >
          <span className="viz-mode-label">
            {vizMode === "3d" ? (
              <span className="viz-mode-chip">3D</span>
            ) : vizMode === "shader" ? (
              <span className="viz-mode-chip">FX</span>
            ) : (
              <span className="viz-mode-chip">2D</span>
            )}
          </span>
        </button>
      </div>

      <div className="viz-btn-group viz-layers-group" title="Layers">
        <button
          onClick={onToggleVisuals}
          className={`viz-icon-btn ${visualsVisible ? "active" : ""}`}
          aria-label={visualsVisible ? "Hide visuals" : "Show visuals"}
          aria-pressed={visualsVisible}
          title={`Visuals: ${visualsVisible ? "on" : "off"} — 3D/shader/2D`}
        >
          {visualsVisible ? <Layers size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          onClick={onToggleLyrics}
          className={`viz-icon-btn viz-lyrics-btn ${lyricsVisible ? "active" : ""}`}
          aria-label={lyricsVisible ? "Hide lyrics" : "Show lyrics"}
          aria-pressed={lyricsVisible}
          title={`Lyrics: ${lyricsVisible ? "on" : "off"}${lyricsLength === 0 ? " — no lyrics loaded" : ""}`}
        >
          <MessageSquare size={14} />
        </button>
        <button
          onClick={onToggleCharacter}
          className={`viz-icon-btn ${characterVisible ? "active" : ""}`}
          aria-label={characterVisible ? "Hide character" : "Show character"}
          aria-pressed={characterVisible}
          title={`Character: ${characterVisible ? "on" : "off"}`}
        >
          <User size={14} />
        </button>
      </div>

      <div className="viz-btn-group">
        <button
          onClick={onCaptureFrame}
          className="viz-icon-btn"
          aria-label="Capture high-res frame snapshot (PNG)"
          title="Quick Snapshot (PNG)"
        >
          <Camera size={14} />
        </button>
        <button
          onClick={onToggleFocus}
          className={`viz-icon-btn ${focusMode ? "active" : ""}`}
          aria-label={
            focusMode ? "Exit Stage Mode (F)" : "Enter Fullscreen Stage Mode (F)"
          }
          aria-pressed={focusMode}
          title={focusMode ? "Exit Stage Mode (F)" : "Stage / Focus Mode (F)"}
        >
          {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      <div className="viz-btn-group">
        <button
          onClick={onToggleShortcuts}
          className={`viz-icon-btn viz-shortcuts-toggle ${showShortcuts ? "active" : ""}`}
          data-viz-overlay-toggle="shortcuts"
          aria-label="Keyboard shortcuts"
          aria-expanded={showShortcuts}
          aria-pressed={showShortcuts}
          title="Keyboard shortcuts (H)"
        >
          <Keyboard size={14} />
        </button>
        {showShortcuts && <VizShortcutsMenu />}
      </div>

      <div className="viz-btn-group">
        <button
          onClick={onToggleMore}
          className={`viz-icon-btn viz-more-menu-toggle ${showMoreMenu ? "active" : ""}`}
          data-testid="viz-more-toggle"
          data-viz-overlay-toggle="more"
          aria-label="More controls"
          aria-expanded={showMoreMenu}
          aria-pressed={showMoreMenu}
          title="More controls"
        >
          <MoreHorizontal size={14} />
        </button>
        {showMoreMenu && (
          <VizMoreMenu
            vizMode={vizMode}
            canvas2DMode={canvas2DMode}
            onSelect2DMode={onSelect2DMode}
            isRecording={isRecording}
            recordingTime={recordingTime}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            onExportFrameAccurate={onExportFrameAccurate}
            isExporting={isExporting}
            exportProgress={exportProgress}
            recordedBlob={recordedBlob}
            onDownloadRecording={onDownloadRecording}
            onToggleExportModal={onToggleExportModal}
            onToggleLoop={onToggleLoop}
            loopRegion={loopRegion}
            loopAnchor={loopAnchor}
            sceneFrozen={sceneFrozen}
            onToggleSceneFrozen={onToggleSceneFrozen}
            onToggleFocus={onToggleFocusFromMenu}
            focusMode={focusMode}
            onToggleSettings={onToggleSettings}
            showSettings={showSettings}
            onToggleAnimDemo={onToggleAnimDemo}
            showAnimDemo={showAnimDemo}
            onToggleTheatre={onToggleTheatre}
            showTheatreStudio={showTheatreStudio}
            onToggleAIPanel={onToggleAIPanel}
            showAIPanel={showAIPanel}
            onCloseOverlay={onCloseOverlay}
            prefersReducedMotion={prefersReducedMotion}
            onToggleReducedMotion={onToggleReducedMotion}
          />
        )}
      </div>
    </div>
  );
}

// Kept local so the toolbar's shortcut list stays collocated with its toggle.
function VizShortcutsMenu() {
  return (
    <div className="viz-shortcuts-menu" role="dialog" aria-label="Keyboard shortcuts">
      <div className="viz-shortcuts-title">Keyboard shortcuts</div>
      <div className="viz-shortcut-row">
        <span>Play / pause</span>
        <kbd>Space</kbd>
      </div>
      <div className="viz-shortcut-row">
        <span>Cycle mode FX → 2D → 3D</span>
        <span className="viz-shortcut-keys">
          <kbd>←</kbd>
          <kbd>→</kbd>
        </span>
      </div>
      {CANVAS_2D_MODES.slice(0, 9).map((m, i) => (
        <div className="viz-shortcut-row" key={m}>
          <span>2D · {CANVAS_2D_MODE_LABELS[m]}</span>
          <kbd>{i + 1}</kbd>
        </div>
      ))}
      <div className="viz-shortcut-row">
        <span>Focus mode</span>
        <kbd>F</kbd>
      </div>
      <div className="viz-shortcut-row">
        <span>Loop A–B (start / end / clear)</span>
        <kbd>L</kbd>
      </div>
      <div className="viz-shortcut-row">
        <span>This list</span>
        <span className="viz-shortcut-keys">
          <kbd>H</kbd>
          <kbd>?</kbd>
        </span>
      </div>
      <div className="viz-shortcut-row">
        <span>Close list</span>
        <kbd>Esc</kbd>
      </div>
    </div>
  );
}
