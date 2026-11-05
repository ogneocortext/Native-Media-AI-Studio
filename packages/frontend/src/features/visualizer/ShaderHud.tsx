/**
 * ShaderHud — the shader mode's on-stage overlay chrome: preset picker,
 * FX sliders, and the reset control. Extracted from ShaderVisualizer so
 * the canvas component stays focused on the render loop; the selector
 * open-state is HUD-local and lives here.
 */
import { useState } from "react";
import type { ShaderPresetName } from "./shaders";
import { SHADER_PRESET_INFO } from "./shaderPresets";

export interface ShaderFxValues {
  speed: number;
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
}

interface ShaderHudProps {
  preset: ShaderPresetName;
  onPresetChange: (preset: ShaderPresetName) => void;
  /** Whether the FX panel is visible (owned by the parent overlay state). */
  showFx: boolean;
  onFxOpenChange: (open: boolean) => void;
  fx: ShaderFxValues;
  onFxChange: (key: keyof ShaderFxValues, value: number) => void;
}

const FX_SLIDERS: {
  key: keyof ShaderFxValues;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  parse: (v: string) => number;
}[] = [
  { key: "speed", label: "Speed", min: 0.1, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)}x`, parse: parseFloat },
  { key: "brightness", label: "Brightness", min: 0.2, max: 2, step: 0.1, format: (v) => v.toFixed(1), parse: parseFloat },
  { key: "contrast", label: "Contrast", min: 0.2, max: 2, step: 0.1, format: (v) => v.toFixed(1), parse: parseFloat },
  { key: "hue", label: "Hue", min: 0, max: 360, step: 1, format: (v) => `${v}°`, parse: (v) => parseInt(v, 10) },
  { key: "saturation", label: "Saturation", min: 0.2, max: 2, step: 0.1, format: (v) => v.toFixed(1), parse: parseFloat },
];

export const DEFAULT_SHADER_FX: ShaderFxValues = { speed: 1, brightness: 1, contrast: 1, hue: 0, saturation: 1 };

export function ShaderHud({ preset, onPresetChange, showFx, onFxOpenChange, fx, onFxChange }: ShaderHudProps) {
  const [showSelector, setShowSelector] = useState(false);

  return (
    // Preset selector overlay + FX controls (plan 1.3 — `viz-shader-hud` is
    // the allowlist token the parent's outside-click listener passes; its
    // z-index comes only from visualizer.css, because that file lives in
    // layer(components) and a Tailwind `z-10` utility would beat it).
    <div className="absolute top-2 right-2 flex flex-col gap-2 viz-shader-hud">
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setShowSelector(!showSelector)}
          aria-label={`Select shader preset: ${SHADER_PRESET_INFO[preset].name}`}
          className="px-2 py-1 text-xs bg-black/50 hover:bg-black/70 text-white/80 rounded backdrop-blur-sm transition-colors"
          title="Change shader preset"
        >
          {SHADER_PRESET_INFO[preset].name}
        </button>
        {!showFx && (
          <button
            onClick={() => onFxOpenChange(true)}
            data-viz-overlay-toggle="fx"
            aria-label="Open FX controls"
            aria-expanded={showFx}
            className="px-2 py-1 text-xs bg-black/50 hover:bg-black/70 text-white/80 rounded backdrop-blur-sm transition-colors"
            title="FX controls"
          >
            FX
          </button>
        )}
      </div>

      {showSelector && (
        <div className="absolute top-8 right-0 w-64 bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl overflow-hidden">
          <div className="p-2 border-b border-white/10">
            <span className="text-xs text-white/60 font-medium">Shader Presets</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(Object.keys(SHADER_PRESET_INFO) as ShaderPresetName[]).map((key) => (
              <button
                key={key}
                onClick={() => {
                  onPresetChange(key);
                  setShowSelector(false);
                }}
                className={`w-full text-left px-3 py-2 hover:bg-white/10 transition-colors ${
                  preset === key ? "bg-indigo-500/20 text-indigo-300" : "text-white/80"
                }`}
              >
                <div className="text-sm font-medium">{SHADER_PRESET_INFO[key].name}</div>
                <div className="text-xs text-white/50">{SHADER_PRESET_INFO[key].description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FX Controls — hidden (not unmounted) while another overlay owns
          the stage; the FX button above reopens it. */}
      <div
        className={`bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl overflow-hidden${showFx ? "" : " hidden"}`}
      >
        <div className="flex items-center justify-between p-2">
          <span className="text-xs text-white/60 font-medium">FX</span>
          <button
            onClick={() => {
              onFxOpenChange(false);
            }}
            className="text-xs text-white/60 hover:text-white/90 transition-colors"
            title="Hide FX controls"
          >
            Hide
          </button>
        </div>
        {showFx && (
          <div className="p-2 pt-0 space-y-2">
            {FX_SLIDERS.map((slider) => (
              <div key={slider.key} className="space-y-1">
                <label className="flex items-center justify-between text-xs text-white/70">
                  <span>{slider.label}</span>
                  <span>{slider.format(fx[slider.key])}</span>
                </label>
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={fx[slider.key]}
                  onChange={(e) => onFxChange(slider.key, slider.parse(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            ))}
            <button
              onClick={() => {
                (Object.keys(DEFAULT_SHADER_FX) as (keyof ShaderFxValues)[]).forEach((key) =>
                  onFxChange(key, DEFAULT_SHADER_FX[key]),
                );
              }}
              className="w-full text-xs bg-white/10 hover:bg-white/20 text-white/80 py-1 rounded transition-colors"
              title="Reset FX to defaults"
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
