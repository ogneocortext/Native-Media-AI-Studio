import { memo, useState } from "react";
import { Sliders, Zap, ChevronDown, ChevronUp } from "lucide-react";
import type { AudioData } from "../types";
import type { ReactivityTriad } from "../audioReactivityProcessor";
import {
  REACTIVITY_GENRE_PRESETS,
  type ReactivityGenrePreset,
} from "../reactivityGenrePresets";

interface ReactivityHUDProps {
  audioData: AudioData;
  isPlaying?: boolean;
  gain: number;
  onGainChange: (gain: number) => void;
  frequencyFocus: "balanced" | "bass" | "mid" | "treble";
  onFrequencyFocusChange: (focus: "balanced" | "bass" | "mid" | "treble") => void;
  /**
   * Plan 2.2 — the reactivity triad (sensitivity / attack /
   * release) plus beat response. Wired to the
   * AudioReactivityProcessor's config via the parent, so the
   * controls move the visuals, not just the meters.
   */
  triad: ReactivityTriad;
  onTriadChange: (triad: ReactivityTriad) => void;
  /**
   * Plan 2.3 — genre preset chips. The parent applies the
   * preset (triad + focus + gain) and reports which preset is
   * active, if any. A manual slider drag does not clear the
   * chip highlight; picking a chip always wins.
   */
  activeGenrePresetId?: string | null;
  onGenrePresetSelect?: (preset: ReactivityGenrePreset) => void;
  /**
   * Which visualization mode the parent is in. The reactivity
   * controls (focus emphasis, boost, triad, genre presets) are
   * consumed only by the shader renderer, so the HUD says so
   * when the parent is in another mode instead of leaving the
   * user with buttons that visibly change nothing.
   */
  vizMode?: "3d" | "2d" | "shader";
  className?: string;
}

/** One triad slider row. Labelled, with a live numeric readout. */
function TriadSlider({
  label,
  value,
  min,
  max,
  step,
  title,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  title: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px] text-white/60">
        <span>{label}</span>
        <span className="font-mono text-white/80">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-white/15 rounded-lg appearance-none cursor-pointer accent-violet-500"
        title={title}
        aria-label={label}
      />
    </div>
  );
}

export const ReactivityHUD = memo(function ReactivityHUD({
  audioData,
  isPlaying,
  gain,
  onGainChange,
  frequencyFocus,
  onFrequencyFocusChange,
  triad,
  onTriadChange,
  activeGenrePresetId = null,
  onGenrePresetSelect,
  vizMode,
  className = "",
}: ReactivityHUDProps) {
  const [collapsed, setCollapsed] = useState(false);

  const bassPercent = Math.min(100, Math.round((audioData.bass ?? 0) * 100));
  const midPercent = Math.min(100, Math.round((audioData.mid ?? 0) * 100));
  const treblePercent = Math.min(100, Math.round((audioData.treble ?? 0) * 100));
  const energyPercent = Math.min(100, Math.round((audioData.energy ?? 0) * 100));

  return (
    <div
      className={`viz-reactivity-hud bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-2.5 shadow-2xl text-xs transition-all ${className}`}
      data-testid="viz-reactivity-hud"
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-white/90">
          <Zap
            size={13}
            className={`transition-colors ${
              audioData.beat ? "text-amber-400 animate-pulse" : "text-violet-400"
            }`}
          />
          <span>Reactivity Tuning</span>
          {isPlaying === false && (
            <span className="viz-paused-badge viz-status-badge viz-status-badge--paused">
              Paused
            </span>
          )}
          {audioData.beat && (
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              BEAT
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-white/40 hover:text-white p-0.5 rounded transition-colors"
          title={collapsed ? "Expand tuning controls" : "Collapse tuning controls"}
          aria-label={collapsed ? "Expand tuning controls" : "Collapse tuning controls"}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-2 pt-1 border-t border-white/10">
          {vizMode && vizMode !== "shader" && (
            <p className="text-[9px] leading-tight px-1.5 py-1 rounded bg-amber-500/10 text-amber-300/80 border border-amber-500/20">
              Tuning applies to Shader mode only — switch modes in the
              preset bar above to hear/see it take effect.
            </p>
          )}
          {/* Energy meters */}
          <div className="viz-tuning-group">
            <div className="viz-tuning-group-label">
              <span className="viz-group-icon">⚡</span>Overall Energy
            </div>
            <div className="flex items-center justify-between text-[10px] text-white/60">
              <span>Overall Energy</span>
              <span className="viz-slider-value font-mono text-white/80">{energyPercent}%</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-pink-500 transition-all duration-75"
                style={{ width: `${energyPercent}%` }}
              />
            </div>
          </div>

          {/* Quick Frequency Focus */}
          <div className="viz-tuning-group">
            <div className="viz-tuning-group-label">
              <span className="viz-group-icon">🎯</span>Focus Emphasis
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  { id: "balanced", label: "All" },
                  { id: "bass", label: "Bass" },
                  { id: "mid", label: "Vocals" },
                  { id: "treble", label: "Highs" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  onClick={() => onFrequencyFocusChange(f.id)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    frequencyFocus === f.id
                      ? "viz-focus-btn--active bg-violet-600 text-white font-semibold shadow-sm"
                      : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                  title={f.label}
                  aria-pressed={frequencyFocus === f.id}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Live Gain / Reactivity Boost Slider */}
          <div className="viz-tuning-group">
            <div className="viz-tuning-group-label">
              <span className="viz-group-icon">🎚️</span>Reactivity Boost
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 viz-slider-label">
                  <Sliders size={10} />
                  Reactivity Boost
                </span>
                <span className="viz-slider-value font-mono text-white/90">{gain.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.5"
                step="0.1"
                value={gain}
                onChange={(e) => onGainChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/15 rounded-lg appearance-none cursor-pointer accent-violet-500"
                title="Scale reactivity intensity"
              />
            </div>
          </div>

          {/* Plan 2.3 — genre reactivity presets. Chips live in the
              reactivity panel (not Master EQ): one click applies the
              preset's triad + focus + gain via the parent. */}
          {onGenrePresetSelect && (
            <div className="viz-tuning-group">
              <div className="viz-tuning-group-label">
                <span className="viz-group-icon">🎵</span>Genre Presets
              </div>
              <div className="flex flex-wrap gap-1">
                {REACTIVITY_GENRE_PRESETS.map((p) => {
                  const isActive = activeGenrePresetId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => onGenrePresetSelect(p)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
                        isActive
                          ? "viz-genre-chip--active bg-violet-600 text-white border-violet-400 shadow-sm"
                          : "bg-white/5 text-white/60 border-white/10 hover:text-white hover:bg-white/10"
                      }`}
                      title={p.description}
                      aria-pressed={isActive}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Plan 2.2 — reactivity triad: sensitivity / attack /
              release + beat response. These move the
              AudioReactivityProcessor's config, so they change
              the visuals, not just the meters. */}
          <div className="viz-tuning-group">
            <div className="viz-tuning-group-label">
              <span className="viz-group-icon">🔧</span>Reactivity Triad
            </div>
            <TriadSlider
              label="Sensitivity"
              value={triad.sensitivity}
              min={0.2}
              max={2.5}
              step={0.05}
              title="Overall reactivity gain — how hard the visualization reacts"
              onChange={(v) => onTriadChange({ ...triad, sensitivity: v })}
            />
            <TriadSlider
              label="Attack"
              value={triad.attack}
              min={0.05}
              max={0.95}
              step={0.01}
              title="How fast the visuals snap onto onsets (higher = snappier)"
              onChange={(v) => onTriadChange({ ...triad, attack: v })}
            />
            <TriadSlider
              label="Release"
              value={triad.release}
              min={0.01}
              max={0.5}
              step={0.01}
              title="How long energy rings out after an onset (lower = longer tail)"
              onChange={(v) => onTriadChange({ ...triad, release: v })}
            />
            <TriadSlider
              label="Beat Response"
              value={triad.beatResponse}
              min={0}
              max={2.5}
              step={0.05}
              title="Transient (beat) response multiplier"
              onChange={(v) => onTriadChange({ ...triad, beatResponse: v })}
            />
          </div>

          {/* Live Low/Mid/High bar meters */}
          <div className="viz-tuning-group">
            <div className="viz-tuning-group-label">
              <span className="viz-group-icon">📊</span>Live Bands
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-white/5 text-[9px]">
              <div className="space-y-0.5">
                <div className="flex justify-between text-white/50">
                  <span className="viz-slider-label">Low</span>
                  <span className="viz-slider-value font-mono">{bassPercent}%</span>
                </div>
                <div className="h-1 bg-white/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 transition-all duration-75"
                    style={{ width: `${bassPercent}%` }}
                  />
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="flex justify-between text-white/50">
                  <span className="viz-slider-label">Mid</span>
                  <span className="viz-slider-value font-mono">{midPercent}%</span>
                </div>
                <div className="h-1 bg-white/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-fuchsia-400 transition-all duration-75"
                    style={{ width: `${midPercent}%` }}
                  />
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="flex justify-between text-white/50">
                  <span className="viz-slider-label">High</span>
                  <span className="viz-slider-value font-mono">{treblePercent}%</span>
                </div>
                <div className="h-1 bg-white/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-pink-400 transition-all duration-75"
                    style={{ width: `${treblePercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
