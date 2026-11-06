/**
 * VizToolbar — the visualizer's slim right-hand action toolbar.
 *
 * Layout, left → right:
 *   1. Mode segmented control (FX / 2D / 3D — direct pick, not a cycle)
 *   2. Layer toggles (visuals / lyrics / character)
 *   3. Stage tools (snapshot, focus mode)
 *   4. Inspector drawer toggle + chrome pin
 *   5. Shortcuts (?) and More (…) menus
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
  PanelRight,
  Pin,
  PinOff,
  User,
} from "lucide-react";
import type { Canvas2DMode } from "../visualizerHelpers";
import { VizMoreMenu } from "./VizMoreMenu";

interface VizToolbarProps {
  // --- mode (direct segmented switch; cycle stays on arrow keys) ---
  vizMode: "3d" | "shader" | "2d";
  onSelectMode: (mode: "3d" | "shader" | "2d") => void;

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

  // --- inspector drawer + stage-chrome pin ---
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  chromePinned: boolean;
  onToggleChromePin: () => void;
  /** Opens the dedicated Remix Studio page with this track carried over. */
  onOpenRemixStudio: () => void;

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

const MODE_ORDER: { id: "3d" | "shader" | "2d"; label: string }[] = [
  { id: "shader", label: "FX" },
  { id: "2d", label: "2D" },
  { id: "3d", label: "3D" },
];

export function VizToolbar({
  vizMode,
  onSelectMode,
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
  inspectorOpen,
  onToggleInspector,
  chromePinned,
  onToggleChromePin,
  onOpenRemixStudio,
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
      <div className="viz-btn-group viz-mode-switch" role="group" aria-label="Visualization mode">
        {MODE_ORDER.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onSelectMode(id)}
            className={`viz-icon-btn viz-mode-btn ${vizMode === id ? "active" : ""}`}
            aria-pressed={vizMode === id}
            title={`Switch to ${label} mode`}
          >
            {label}
          </button>
        ))}
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
          aria-label={focusMode ? "Exit Stage Mode (F)" : "Enter Fullscreen Stage Mode (F)"}
          aria-pressed={focusMode}
          title={focusMode ? "Exit Stage Mode (F)" : "Stage / Focus Mode (F)"}
        >
          {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      <div className="viz-btn-group">
        <button
          onClick={onToggleChromePin}
          className={`viz-icon-btn ${chromePinned ? "active" : ""}`}
          aria-label={
            chromePinned
              ? "Unpin controls — auto-hide during playback"
              : "Pin controls — keep visible during playback"
          }
          aria-pressed={chromePinned}
          title={
            chromePinned
              ? "Controls pinned visible"
              : "Controls auto-hide while playing — click to pin"
          }
        >
          {chromePinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button
          onClick={onToggleInspector}
          className={`viz-icon-btn ${inspectorOpen ? "active" : ""}`}
          data-testid="viz-inspector-toggle"
          aria-label="Toggle inspector panel"
          aria-expanded={inspectorOpen}
          aria-pressed={inspectorOpen}
          title="Inspector — scene, tuning, mixer, EQ, remix, AI"
        >
          <PanelRight size={14} />
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
            onOpenRemixStudio={onOpenRemixStudio}
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
      <div className="viz-shortcut-row">
        <span>2D modes 1–9</span>
        <kbd>1–9</kbd>
      </div>
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
