/**
 * VizMoreMenu — the "More controls" dropdown (record, export, loop, freeze,
 * focus, settings, demos, AI panel, reduced motion).
 *
 * Presentational only: every value and handler is passed in by VizToolbar.
 */
import type { Canvas2DMode } from "../visualizerHelpers";
import { CANVAS_2D_MODES, shortModeLabel } from "../visualizerHelpers";
import { formatTime } from "../../../utils/format";
import {
  Accessibility,
  Download,
  Film,
  Maximize2,
  Minimize2,
  Play,
  Repeat,
  Settings,
  Shuffle,
  Snowflake,
  Sparkles,
  Square,
  Video,
  Wand2,
} from "lucide-react";

interface VizMoreMenuProps {
  vizMode: "3d" | "shader" | "2d";
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
  onToggleFocus: () => void;
  focusMode: boolean;
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
  /** Opens the dedicated Remix Studio page with the current track carried over. */
  onOpenRemixStudio: () => void;
}

export function VizMoreMenu({
  vizMode,
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
  onToggleFocus,
  focusMode,
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
  onOpenRemixStudio,
}: VizMoreMenuProps) {
  const loopActive = !!loopRegion;
  const loopPending = loopAnchor !== null && !loopRegion;

  return (
    <div className="viz-more-menu">
      {vizMode === "2d" && (
        <select
          value={canvas2DMode}
          onChange={(e) => onSelect2DMode(e.target.value as Canvas2DMode)}
          className="viz-2d-mode-select viz-more-item"
          title="2D mode"
        >
          {CANVAS_2D_MODES.map((m) => (
            <option key={m} value={m}>
              {shortModeLabel(m)}
            </option>
          ))}
        </select>
      )}
      {isRecording && (
        <span className="viz-rec viz-more-item" aria-live="polite">
          <span className="viz-rec-dot" />
          {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, "0")}
        </span>
      )}
      <button
        onClick={isRecording ? onStopRecording : onStartRecording}
        className={`viz-icon-btn viz-more-item ${isRecording ? "rec" : ""}`}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        aria-pressed={isRecording}
        title={isRecording ? "Stop recording" : "Start recording"}
      >
        {isRecording ? <Square size={14} /> : <Video size={14} />}
        <span className="viz-more-label">{isRecording ? "Stop recording" : "Record"}</span>
      </button>
      {/* Plan 2.9 — deterministic 10 s @ 30 fps export, exactly 300 frames. */}
      {(vizMode === "shader" || vizMode === "2d") && (
        <button
          onClick={() => onExportFrameAccurate(10)}
          disabled={isRecording || isExporting}
          className="viz-icon-btn viz-more-item"
          aria-label="Export 10 seconds frame-accurate"
          title="Export 10 s @ 30 fps frame-accurate (exactly 300 frames, deterministic)"
        >
          <Film size={14} />
          <span className="viz-more-label">
            {isExporting ? `Exporting ${Math.round(exportProgress * 100)}%` : "Export 10s HQ"}
          </span>
        </button>
      )}
      {recordedBlob && !isRecording && (
        <button
          onClick={onDownloadRecording}
          className="viz-icon-btn viz-more-item"
          aria-label="Download recording"
          title="Download recording"
        >
          <Download size={14} />
          <span className="viz-more-label">Download</span>
        </button>
      )}
      <button
        onClick={onToggleExportModal}
        className="viz-icon-btn viz-more-item"
        aria-label="Export MP4"
        title="Export MP4 (WebCodecs)"
      >
        <Film size={14} />
        <span className="viz-more-label">Export MP4</span>
      </button>
      <button
        onClick={onOpenRemixStudio}
        className="viz-icon-btn viz-more-item"
        aria-label="Open Remix Studio"
        title="Build a mashup from stems of different songs — opens Remix Studio with this track"
      >
        <Shuffle size={14} />
        <span className="viz-more-label">Remix Studio</span>
      </button>
      <button
        onClick={onToggleLoop}
        data-testid="viz-loop-toggle"
        className={`viz-icon-btn viz-more-item ${loopActive ? "active" : ""}`}
        aria-label={
          loopActive
            ? `Looping ${formatTime(loopRegion!.start)} to ${formatTime(loopRegion!.end)} — click to clear`
            : loopPending
              ? `Loop start set at ${formatTime(loopAnchor!)} — click to set the end`
              : "Loop A–B: click to set start, again for end, again to clear"
        }
        aria-pressed={loopActive}
        title={
          loopActive
            ? `Loop ${formatTime(loopRegion!.start)}–${formatTime(loopRegion!.end)} — click to clear`
            : loopPending
              ? `Start set at ${formatTime(loopAnchor!)} — click to set end`
              : "Loop A–B"
        }
      >
        <Repeat size={14} />
        <span className="viz-more-label">
          {loopActive ? "Loop on" : loopPending ? "Set end" : "Loop A–B"}
        </span>
      </button>
      <button
        onClick={onToggleSceneFrozen}
        className={`viz-icon-btn viz-more-item ${sceneFrozen ? "active" : ""}`}
        aria-label={sceneFrozen ? "Unfreeze scene" : "Freeze scene"}
        aria-pressed={sceneFrozen}
        title={sceneFrozen ? "Unfreeze scene" : "Freeze scene"}
      >
        <Snowflake size={14} />
        <span className="viz-more-label">{sceneFrozen ? "Unfreeze" : "Freeze"}</span>
      </button>
      <button
        onClick={onToggleFocus}
        className={`viz-icon-btn viz-more-item`}
        aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
        aria-pressed={focusMode}
        title={focusMode ? "Exit focus mode" : "Enter focus mode"}
      >
        {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        <span className="viz-more-label">{focusMode ? "Exit focus" : "Focus mode"}</span>
      </button>
      <button
        onClick={() => {
          onToggleSettings();
          // Menu and settings must not coexist (plan 1.3).
          onCloseOverlay();
        }}
        className={`viz-icon-btn viz-more-item ${showSettings ? "active" : ""}`}
        aria-label={showSettings ? "Close settings" : "Open settings"}
        aria-pressed={showSettings}
        title={showSettings ? "Close settings" : "Open settings"}
      >
        <Settings size={14} />
        <span className="viz-more-label">{showSettings ? "Close settings" : "Settings"}</span>
      </button>
      <button
        onClick={onToggleAnimDemo}
        className={`viz-icon-btn viz-more-item ${showAnimDemo ? "active" : ""}`}
        aria-label="Animation demo"
        aria-pressed={showAnimDemo}
        title="Animation demo"
      >
        <Play size={14} />
        <span className="viz-more-label">Animation demo</span>
      </button>
      <button
        onClick={onToggleTheatre}
        className={`viz-icon-btn viz-more-item ${showTheatreStudio ? "active" : ""}`}
        aria-label="Theatre.js Studio"
        aria-pressed={showTheatreStudio}
        title="Theatre.js Studio — Visual animation editor"
      >
        <Wand2 size={14} />
        <span className="viz-more-label">Theatre.js Studio</span>
      </button>
      <button
        onClick={() => {
          onCloseOverlay();
          onToggleAIPanel();
        }}
        data-testid="viz-ai-toggle"
        className={`viz-icon-btn viz-more-item viz-ai-toggle ${showAIPanel ? "active" : ""}`}
        aria-label="AI generate preset"
        aria-pressed={showAIPanel}
        title="AI generate preset"
      >
        <Sparkles size={14} />
        <span className="viz-more-label">AI preset</span>
      </button>
      <button
        onClick={onToggleReducedMotion}
        className={`viz-icon-btn viz-more-item ${prefersReducedMotion ? "active" : ""}`}
        aria-label={prefersReducedMotion ? "Motion on" : "Motion off"}
        aria-pressed={prefersReducedMotion}
        title={
          prefersReducedMotion
            ? "Reduced motion: ON (click to disable)"
            : "Reduced motion: OFF (click to enable)"
        }
      >
        <Accessibility size={14} />
        <span className="viz-more-label">
          {prefersReducedMotion ? "Motion: on" : "Motion: off"}
        </span>
      </button>
    </div>
  );
}
