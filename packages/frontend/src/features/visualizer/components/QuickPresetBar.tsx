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
const FEATURED_2D_MODES: Array<{ mode: Canvas2DMode; label: string }> = [
  { mode: "bars", label: "Bars" },
  { mode: "mirrored-bars", label: "Mirrored" },
  { mode: "radial", label: "Radial" },
  { mode: "waveform", label: "Waveform" },
  { mode: "constellation", label: "Constellation" },
  { mode: "aurora", label: "Aurora" },
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
  className = "",
}: QuickPresetBarProps) {
  return (
    <div
      className={`viz-quick-preset-bar flex items-center gap-2 p-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl ${className}`}
      role="toolbar"
      aria-label="Visualization quick vibes"
    >
      {/* Mode pills */}
      <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
        <button
          onClick={() => onVizModeChange("shader")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
            vizMode === "shader"
              ? "bg-violet-600 text-white shadow"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
          title="Switch to Shader / GLSL FX Mode"
        >
          <Flame size={12} />
          <span>FX</span>
        </button>
        <button
          onClick={() => onVizModeChange("3d")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
            vizMode === "3d"
              ? "bg-violet-600 text-white shadow"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
          title="Switch to 3D Stage Mode"
        >
          <Sparkles size={12} />
          <span>3D</span>
        </button>
        <button
          onClick={() => onVizModeChange("2d")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
            vizMode === "2d"
              ? "bg-violet-600 text-white shadow"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
          title="Switch to Canvas 2D Mode"
        >
          <Activity size={12} />
          <span>2D</span>
        </button>
      </div>

      <div className="h-4 w-px bg-white/15 mx-0.5" />

      {/* Mode specific quick switchers */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5 max-w-full">
        {vizMode === "3d" &&
          FEATURED_3D_PRESETS.map((p) => {
            const isActive = active3DPresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelect3DPreset(p.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-white/20 text-white font-medium border border-white/25 shadow-sm"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
                title={visualPresets[p.id]?.description ?? p.name}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: p.color }}
                />
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
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-white/20 text-white font-medium border border-white/25 shadow-sm"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
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
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-white/20 text-white font-medium border border-white/25 shadow-sm"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
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
