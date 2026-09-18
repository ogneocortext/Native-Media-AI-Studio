import React, { useRef, useEffect, useState, useCallback } from "react";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { SHADER_PRESETS, type ShaderPresetName } from "./shaders";
import { getShaderPresetForTrack, SHADER_PRESET_INFO } from "./shaderPresets";
import { getPreferences, setPreference } from "../../services/api";
import type { AudioData } from "./types";
import type { LyricLine } from "./components/LyricOverlay";

const FX_STORAGE_PREFIX = "visualizerFx:";
const FX_PREF_KEY = "visualizer_fx_defaults";

type FxValues = {
  speed: number;
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
};

const DEFAULT_FX: FxValues = {
  speed: 1,
  brightness: 1,
  contrast: 1,
  hue: 0,
  saturation: 1,
};

function readFxNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(FX_STORAGE_PREFIX + key);
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // no-op
  }
  return fallback;
}

function writeFxNumber(key: string, value: number) {
  try {
    localStorage.setItem(FX_STORAGE_PREFIX + key, String(value));
  } catch {
    // no-op
  }
}

function readFxFromApi(): Promise<FxValues | null> {
  return getPreferences("visualizer")
    .then((prefs) => {
      const raw = prefs[FX_PREF_KEY];
      if (raw && typeof raw === "object") {
        const candidate = raw as Partial<FxValues>;
        const next: FxValues = {
          speed: typeof candidate.speed === "number" ? candidate.speed : DEFAULT_FX.speed,
          brightness: typeof candidate.brightness === "number" ? candidate.brightness : DEFAULT_FX.brightness,
          contrast: typeof candidate.contrast === "number" ? candidate.contrast : DEFAULT_FX.contrast,
          hue: typeof candidate.hue === "number" ? candidate.hue : DEFAULT_FX.hue,
          saturation: typeof candidate.saturation === "number" ? candidate.saturation : DEFAULT_FX.saturation,
        };
        return next;
      }
      return null;
    })
    .catch(() => null);
}

function writeFxToApi(values: FxValues): Promise<void> {
  return setPreference(FX_PREF_KEY, values, "visualizer").catch(() => {
    // no-op
  });
}

interface ShaderVisualizerProps {
  audioData: React.MutableRefObject<AudioData>;
  trackName: string;
  isPlaying: boolean;
  className?: string;
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
  } | null;
  /**
   * Per-frame live sync written by the parent's elapsed loop (see audioTiming.ts).
   * Preferred over `lrcSync` in the rAF loop — the React-state snapshot is
   * quantized to ~20 fps. Falls back to `lrcSync` when null (e.g. demo mode).
   */
  lrcSyncLive?: { current: ShaderVisualizerProps["lrcSync"] };
  lyrics?: LyricLine[];
}

/**
 * Shader-driven visualization that auto-selects a preset based on track mood.
 * Audio data drives shader uniforms in real-time.
 */
export function ShaderVisualizer({ audioData, trackName, isPlaying, className, lrcSync, lrcSyncLive }: ShaderVisualizerProps) {
  const [preset, setPreset] = useState<ShaderPresetName>(() => getShaderPresetForTrack(trackName));
  const [showSelector, setShowSelector] = useState(false);
  const [showFx, setShowFx] = useState(true);
  const [fxSpeed, setFxSpeed] = useState(() => readFxNumber("fxSpeed", DEFAULT_FX.speed));
  const [fxBrightness, setFxBrightness] = useState(() => readFxNumber("fxBrightness", DEFAULT_FX.brightness));
  const [fxContrast, setFxContrast] = useState(() => readFxNumber("fxContrast", DEFAULT_FX.contrast));
  const [fxHue, setFxHue] = useState(() => readFxNumber("fxHue", DEFAULT_FX.hue));
  const [fxSaturation, setFxSaturation] = useState(() => readFxNumber("fxSaturation", DEFAULT_FX.saturation));
  const [loadedFromApi, setLoadedFromApi] = useState(false);
  const uniformsRef = useRef({
    bass: 0, mid: 0, treble: 0, beat: 0, energy: 0, peak: 0,
  });
  const userSelectedPreset = useRef(false);
  const lrcSyncPropRef = useRef(lrcSync);
  lrcSyncPropRef.current = lrcSync;

  // Load FX defaults from backend preferences once, then fall back to localStorage.
  useEffect(() => {
    let cancelled = false;
    readFxFromApi().then((values) => {
      if (cancelled) return;
      if (values) {
        setFxSpeed(values.speed);
        setFxBrightness(values.brightness);
        setFxContrast(values.contrast);
        setFxHue(values.hue);
        setFxSaturation(values.saturation);
      }
      setLoadedFromApi(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Update uniforms from audio — tight, analysis-driven (2026 fix: was lagging ~80ms)
  useEffect(() => {
    let raf: number;
    let phraseFlash = 0;
    let beatPulse = 0;
    const update = () => {
      const d = audioData.current;
      const sync = lrcSyncLive?.current ?? lrcSyncPropRef.current;
      if (sync?.isPhraseStart) phraseFlash = 1;
      else phraseFlash = Math.max(0, phraseFlash - 0.07);
      // Beat pulse: snap on beat, exponential decay (half-life ~80ms, not linear 0.12) — matches audioTiming RELEASE
      if (d.beat) {
        beatPulse = 1;
      } else {
        // decay with dt-agnostic factor ~0.08 per frame @60fps
        beatPulse *= 0.88;
        if (beatPulse < 0.01) beatPulse = 0;
        // also shape by nextBeatIn for anticipatory swell (BPM-scaled)
        const nb = (d as any).nextBeatIn ?? 0;
        if (nb > 0 && nb < 0.12) {
          // tiny pre-beat lift (anticipation) — not a full beat
          beatPulse = Math.max(beatPulse, 0.15 * (1 - nb / 0.12));
        }
      }
      // Energy: live + phrase flash only (sectionProgress was biasing lag); analysis energy already blended in Visualizer
      const lrcEnergy = d.energy + phraseFlash * 0.3;
      uniformsRef.current = {
        bass: d.bass,
        mid: d.mid,
        treble: d.treble,
        beat: beatPulse,
        energy: Math.min(1, lrcEnergy),
        peak: d.peak,
      };
      raf = requestAnimationFrame(update);
    };
    if (isPlaying) raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, audioData, lrcSyncLive]);

  // Auto-change preset when track changes (only if user hasn't manually overridden)
  useEffect(() => {
    const next = getShaderPresetForTrack(trackName);
    if (!userSelectedPreset.current) {
      setPreset(next);
      applyFxDefaults(next);
    }
  }, [trackName]);

  const handlePresetChange = useCallback((newPreset: ShaderPresetName) => {
    userSelectedPreset.current = true;
    setPreset(newPreset);
    setShowSelector(false);
    applyFxDefaults(newPreset);
  }, []);

  const applyFxDefaults = useCallback((presetName: ShaderPresetName) => {
    const defaults = SHADER_PRESET_INFO[presetName]?.fxDefaults;
    if (!defaults) return;
    if (defaults.speed !== undefined) setFxSpeed(defaults.speed);
    if (defaults.brightness !== undefined) setFxBrightness(defaults.brightness);
    if (defaults.contrast !== undefined) setFxContrast(defaults.contrast);
    if (defaults.hue !== undefined) setFxHue(defaults.hue);
    if (defaults.saturation !== undefined) setFxSaturation(defaults.saturation);
  }, []);

  // Persist FX values to localStorage and backend whenever they change
  useEffect(() => {
    const values: FxValues = { speed: fxSpeed, brightness: fxBrightness, contrast: fxContrast, hue: fxHue, saturation: fxSaturation };
    writeFxNumber("fxSpeed", fxSpeed);
    writeFxNumber("fxBrightness", fxBrightness);
    writeFxNumber("fxContrast", fxContrast);
    writeFxNumber("fxHue", fxHue);
    writeFxNumber("fxSaturation", fxSaturation);
    if (loadedFromApi) {
      writeFxToApi(values);
    }
  }, [fxSpeed, fxBrightness, fxContrast, fxHue, fxSaturation, loadedFromApi]);

  // Keyboard shortcut: F to toggle FX panel visibility
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "f" || e.key === "F") {
        setShowFx((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`w-full h-full ${className ?? ""}`} style={{ position: "absolute", inset: 0 }}>
      <div
        className="absolute inset-0"
        style={{
          filter: `brightness(${fxBrightness}) contrast(${fxContrast}) saturate(${fxSaturation}) hue-rotate(${fxHue}deg)`,
          transition: "filter 0.1s ease-out",
          willChange: "filter",
        }}
      >
        <ShaderCanvas
          fragmentShader={SHADER_PRESETS[preset]}
          uniformsRef={uniformsRef}
          className="absolute inset-0"
          timeScale={fxSpeed}
        />
      </div>

      {/* Preset selector overlay */}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-2">
        <button
          onClick={() => setShowSelector(!showSelector)}
          className="px-2 py-1 text-xs bg-black/50 hover:bg-black/70 text-white/80 rounded backdrop-blur-sm transition-colors"
          title="Change shader preset"
        >
          {SHADER_PRESET_INFO[preset].name}
        </button>

        {showSelector && (
          <div className="absolute top-8 right-0 w-64 bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl overflow-hidden">
            <div className="p-2 border-b border-white/10">
              <span className="text-xs text-white/60 font-medium">Shader Presets</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {(Object.keys(SHADER_PRESET_INFO) as ShaderPresetName[]).map((key) => (
                <button
                  key={key}
                  onClick={() => handlePresetChange(key)}
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

        {/* FX Controls */}
        <div className="bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-2">
            <span className="text-xs text-white/60 font-medium">FX</span>
            <button
              onClick={() => {
                setShowFx(!showFx);
              }}
              className="text-xs text-white/60 hover:text-white/90 transition-colors"
              title={showFx ? "Hide FX controls" : "Show FX controls"}
            >
              {showFx ? "Hide" : "Show"}
            </button>
          </div>
          {showFx && (
            <div className="p-2 pt-0 space-y-2">
              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs text-white/70">
                  <span>Speed</span>
                  <span>{fxSpeed.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={fxSpeed}
                  onChange={(e) => setFxSpeed(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs text-white/70">
                  <span>Brightness</span>
                  <span>{fxBrightness.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0.2"
                  max="2"
                  step="0.1"
                  value={fxBrightness}
                  onChange={(e) => setFxBrightness(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs text-white/70">
                  <span>Contrast</span>
                  <span>{fxContrast.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0.2"
                  max="2"
                  step="0.1"
                  value={fxContrast}
                  onChange={(e) => setFxContrast(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs text-white/70">
                  <span>Hue</span>
                  <span>{fxHue}°</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={fxHue}
                  onChange={(e) => setFxHue(parseInt(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs text-white/70">
                  <span>Saturation</span>
                  <span>{fxSaturation.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={fxSaturation}
                  onChange={(e) => setFxSaturation(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <button
                onClick={() => {
                  setFxSpeed(1);
                  setFxBrightness(1);
                  setFxContrast(1);
                  setFxHue(0);
                  setFxSaturation(1);
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

      {/* Track info */}
      <div className="absolute bottom-2 left-2 z-10">
        <span className="text-xs text-white/40 bg-black/30 px-2 py-0.5 rounded">
          {trackName} · {SHADER_PRESET_INFO[preset].name}
        </span>
      </div>
    </div>
  );
}
