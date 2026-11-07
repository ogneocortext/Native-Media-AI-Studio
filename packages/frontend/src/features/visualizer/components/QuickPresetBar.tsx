import { memo } from "react";
import { Sparkles, Activity, Flame } from "lucide-react";
import type { Canvas2DMode } from "../visualizerHelpers";
import { visualPresets } from "../visualPresets";
import { SHADER_PRESET_INFO } from "../shaderPresets";
import type { ShaderPresetName } from "../shaders";

interface QuickPresetBarProps {
  vizMode: "3d" | "shader" | "2d";
  onVizModeChange: (mode: "3d" | "shader" | "2d") => void;
  // 3D preset
  active3DPresetId: string | null;
  onSelect3DPreset: (presetId: string) => void;
  // 2D mode
  canvas2DMode: Canvas2DMode;
  onSelect2DMode: (mode: Canvas2DMode) => void;
  // Shader preset
  activeShaderPreset?: ShaderPresetName;
  onSelectShaderPreset?: (preset: ShaderPresetName) => void;
  /**
   * Render the FX/2D/3D mode pills. The slim topbar owns the persistent
   * mode switch, so the stage bar passes false to avoid showing the same
   * control twice.
   */
  showModeSwitch?: boolean;
  className?: string;
}

// Popular featured 3D presets for instant 1-click vibe switching
const FEATURED_3D_PRESETS = [
  { id: "synthwave", name: "Synthwave", color: "#ff00ff" },
  { id: "phonk", name: "Phonk Drift", color: "#ff0044" },
  { id: "ambient", name: "Ambient Flow", color: "#00ccff" },
  { id: "gfunk", name: "G-Funk Warm", color: "#ff8800" },
  { id: "dubstep", name: "Bass Heavy", color: "#a855f7" },
  { id: "balanced", name: "Balanced", color: "#6366f1" },
];

// Curated 2D modes for immediate one-click visual variety
const FEATURED_2D_MODES: { mode: Canvas2DMode; label: string }[] = [
  { mode: "bars", label: "Bars" },
  { mode: "mirrored-bars", label: "Mirrored" },
  { mode: "radial", label: "Radial" },
  { mode: "waveform", label: "Waveform" },
  { mode: "constellation", label: "Constellation" },
  { mode: "aurora", label: "Aurora" },
];

const MODE_PILLS: { id: "3d" | "shader" | "2d"; label: string; icon: typeof Flame }[] = [
  { id: "shader", label: "FX", icon: Flame },
  { id: "3d", label: "3D", icon: Sparkles },
  { id: "2d", label: "2D", icon: Activity },
];

export const QuickPresetBar = memo(function QuickPresetBar({
  vizMode,
  onVizModeChange,
  active3DPresetId,
  onSelect3DPreset,
  canvas2DMode,
  onSelect2DMode,
  activeShaderPreset,
  onSelectShaderPreset,
  showModeSwitch = true,
  className = "",
}: QuickPresetBarProps) {
  return (
    <div
      className={`viz-preset-bar ${className}`}
      role="toolbar"
      aria-label="Visualization quick vibes"
    >
      {/* Mode pills — optional; the topbar segmented control is the
          persistent switch, this bar focuses on per-mode presets. */}
      {showModeSwitch && (
        <div className="viz-mode-pills">
          {MODE_PILLS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onVizModeChange(id)}
              className={`viz-mode-pill ${vizMode === id ? "active" : ""}`}
              aria-pressed={vizMode === id}
              title={`Switch to ${label} mode`}
            >
              <Icon size={12} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {showModeSwitch && <div className="viz-preset-divider" aria-hidden="true" />}

      {/* Mode specific quick switchers */}
      <div className="viz-preset-pills">
        {vizMode === "3d" &&
          FEATURED_3D_PRESETS.map((p) => {
            const isActive = active3DPresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelect3DPreset(p.id)}
                className={`viz-preset-pill ${isActive ? "active" : ""}`}
                aria-pressed={isActive}
                title={visualPresets[p.id].description ?? p.name}
              >
                <span className="viz-preset-dot" style={{ background: p.color }} />
                <span>{p.name}</span>
              </button>
            );
          })}

        {vizMode === "2d" &&
          FEATURED_2D_MODES.map((item) => {
            const isActive = canvas2DMode === item.mode;
            return (
              <button
                key={item.mode}
                onClick={() => onSelect2DMode(item.mode)}
                className={`viz-preset-pill ${isActive ? "active" : ""}`}
                aria-pressed={isActive}
              >
                <span>{item.label}</span>
              </button>
            );
          })}

        {vizMode === "shader" &&
          (Object.keys(SHADER_PRESET_INFO) as ShaderPresetName[]).slice(0, 6).map((key) => {
            const info = SHADER_PRESET_INFO[key];
            if (!info) return null;
            const isActive = activeShaderPreset === key;
            return (
              <button
                key={key}
                onClick={() => onSelectShaderPreset?.(key)}
                className={`viz-preset-pill ${isActive ? "active" : ""}`}
                aria-pressed={isActive}
                title={info.description}
              >
                <span>{info.name}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
});
