import React, { useRef, useEffect, useState, useCallback } from "react";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { SHADER_PRESETS, type ShaderPresetName } from "./shaders";
import { getShaderPresetForTrack, SHADER_PRESET_INFO } from "./shaderPresets";
import { getPreferences, setPreference } from "../../services/api";
import type { AudioData, StemAnalysisData } from "./types";
import type { StemName } from "./components/StemMixer";
import type { LyricLine } from "./components/LyricOverlay";
import { getSectionPreset } from "./sectionStateMachine";
import { useSpectralTimeline } from "./useSpectralTimeline";
import { AudioReactivityProcessor, type ReactivityConfig } from "./audioReactivityProcessor";
import { useKeyPalette } from "./useKeyPalette";

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
          brightness:
            typeof candidate.brightness === "number" ? candidate.brightness : DEFAULT_FX.brightness,
          contrast:
            typeof candidate.contrast === "number" ? candidate.contrast : DEFAULT_FX.contrast,
          hue: typeof candidate.hue === "number" ? candidate.hue : DEFAULT_FX.hue,
          saturation:
            typeof candidate.saturation === "number" ? candidate.saturation : DEFAULT_FX.saturation,
        };
        return next;
      }
      return null;
    })
    .catch(() => null);
}

function sampleStemEnergy(
  stem: StemAnalysisData[keyof StemAnalysisData] | undefined,
  elapsed: number,
): number {
  if (!stem || stem.energy_curve.length === 0 || !Number.isFinite(elapsed)) return 0;
  const duration = stem.duration > 0 ? stem.duration : 1;
  const index = Math.min(
    stem.energy_curve.length - 1,
    Math.max(0, Math.floor((elapsed / duration) * stem.energy_curve.length)),
  );
  return Math.min(1, Math.max(0, stem.energy_curve[index] ?? 0));
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
  /** Per-stem energy curves from the backend, sampled at the current audio clock. */
  stems?: StemAnalysisData | null;
  /** Current audio position used to sample stem energy curves. */
  sampleAudio?: () => number;
  /** Current mute state from the stem mixer. Muted stems contribute zero energy. */
  stemsMuted?: Record<StemName, boolean>;
  /** Current volume state from the stem mixer. Stems are scaled by volume. */
  stemsVolumes?: Record<StemName, number>;
  /** Live per-stem meters from the professional mixer (overrides stemsVolumes when present). */
  stemsProMeters?: Record<StemName, { rms: number; peak: number; dBFS: number }>;
}

/**
 * Shader-driven visualization that auto-selects a preset based on track mood.
 * Audio data drives shader uniforms in real-time.
 */
export function ShaderVisualizer({
  audioData,
  trackName,
  isPlaying,
  className,
  lrcSync,
  lrcSyncLive,
  stems,
  sampleAudio,
  stemsMuted,
  stemsVolumes,
  stemsProMeters,
}: ShaderVisualizerProps) {
  const [preset, setPreset] = useState<ShaderPresetName>(() => getShaderPresetForTrack(trackName));
  const [showSelector, setShowSelector] = useState(false);
  const [showFx, setShowFx] = useState(true);
  const [fxSpeed, setFxSpeed] = useState(() => readFxNumber("fxSpeed", DEFAULT_FX.speed));
  const [fxBrightness, setFxBrightness] = useState(() =>
    readFxNumber("fxBrightness", DEFAULT_FX.brightness),
  );
  const [fxContrast, setFxContrast] = useState(() =>
    readFxNumber("fxContrast", DEFAULT_FX.contrast),
  );
  const [fxHue, setFxHue] = useState(() => readFxNumber("fxHue", DEFAULT_FX.hue));
  const [fxSaturation, setFxSaturation] = useState(() =>
    readFxNumber("fxSaturation", DEFAULT_FX.saturation),
  );
  const [loadedFromApi, setLoadedFromApi] = useState(false);
  const uniformsRef = useRef({
    bass: 0,
    mid: 0,
    treble: 0,
    beat: 0,
    energy: 0,
    peak: 0,
    sub: 0,
    high: 0,
    transient: 0,
    centroid: 0,
    trail: 0,
    // Key-derived palette, written by the rAF loop each frame from
    // keyPaletteRef (static per track). Declared here so the ref's inferred type
    // matches what the loop assigns.
    keyHue: 0,
    keySat: 0.08,
    keyConf: 0,
  });
  // Key-derived palette (docs/architecture/chroma-hue-mapping.md, Q5). Static
  // per track, so it lives in its own ref rather than in uniformsRef: the rAF
  // loop reassigns uniformsRef.current wholesale every frame and would discard
  // these values if they were part of that object.
  const { palette: keyPaletteState } = useKeyPalette(trackName ?? null);
  const keyPaletteRef = useRef(keyPaletteState);
  keyPaletteRef.current = keyPaletteState;
  const userSelectedPreset = useRef(false);
  const lrcSyncPropRef = useRef(lrcSync);
  lrcSyncPropRef.current = lrcSync;
  const stemsMutedRef = useRef(stemsMuted);
  stemsMutedRef.current = stemsMuted;
  const stemsVolumesRef = useRef(stemsVolumes);
  stemsVolumesRef.current = stemsVolumes;
  const stemsProMetersRef = useRef(stemsProMeters);
  stemsProMetersRef.current = stemsProMeters;

  const reactivityProcessorRef = useRef<AudioReactivityProcessor | null>(null);
  const reactivityConfigRef = useRef<ReactivityConfig>({
    smoothing: 0.35,
    gamma: 2.2,
    transientSensitivity: 1.0,
    bassSensitivity: 1.0,
    midSensitivity: 1.0,
    highSensitivity: 1.0,
  });

  const { sampleAtTime: sampleSpectral } = useSpectralTimeline(trackName, 24);
  const sectionPresetRef = useRef(getSectionPreset("verse"));
  const lastSectionRef = useRef<string>("");
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  const [feedbackZoom, setFeedbackZoom] = useState(1.0);
  const [feedbackRotation, setFeedbackRotation] = useState(0.0);
  const [feedbackDecay, setFeedbackDecay] = useState(0.97);

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

  // Initialize audio reactivity processor
  useEffect(() => {
    reactivityProcessorRef.current = new AudioReactivityProcessor(reactivityConfigRef.current);
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
      const elapsed = sampleAudio?.() ?? 0;
      const stemEnergy = {
        vocals:
          (stemsMutedRef.current?.vocals ? 0 : sampleStemEnergy(stems?.vocals, elapsed)) *
          (stemsVolumesRef.current?.vocals ?? 1),
        drums:
          (stemsMutedRef.current?.drums ? 0 : sampleStemEnergy(stems?.drums, elapsed)) *
          (stemsVolumesRef.current?.drums ?? 1),
        bass:
          (stemsMutedRef.current?.bass ? 0 : sampleStemEnergy(stems?.bass, elapsed)) *
          (stemsVolumesRef.current?.bass ?? 1),
        other:
          (stemsMutedRef.current?.other ? 0 : sampleStemEnergy(stems?.other, elapsed)) *
          (stemsVolumesRef.current?.other ?? 1),
      };

      // Professional mixer meters override analysis-based stem energy when active.
      // This gives the visualizer accurate real-time levels per stem channel.
      if (stemsProMetersRef.current) {
        const pm = stemsProMetersRef.current;
        stemEnergy.vocals = pm.vocals?.rms ?? stemEnergy.vocals;
        stemEnergy.drums = pm.drums?.rms ?? stemEnergy.drums;
        stemEnergy.bass = pm.bass?.rms ?? stemEnergy.bass;
        stemEnergy.other = pm.other?.rms ?? stemEnergy.other;
      }
      const stemBoost =
        stemEnergy.vocals * 0.18 +
        stemEnergy.drums * 0.32 +
        stemEnergy.bass * 0.28 +
        stemEnergy.other * 0.12;

      const spectral = sampleSpectral(elapsed);
      const sectionType = sync?.currentSection ?? "verse";

      if (sectionType && sectionType !== lastSectionRef.current) {
        lastSectionRef.current = sectionType;
        const mapping = getSectionPreset(sectionType);
        if (!userSelectedPreset.current) {
          setPreset(mapping.preset);
          applyFxDefaults(mapping.preset);
        }
        setFeedbackEnabled(mapping.feedback);
        setFeedbackZoom(mapping.feedbackZoom);
        setFeedbackRotation(mapping.feedbackRotation);
        setFeedbackDecay(mapping.feedbackDecay);
      }

      const sectionMapping = getSectionPreset(sectionType);
      sectionPresetRef.current = sectionMapping;

      // Update audio reactivity processor with spectral data
      const processor = reactivityProcessorRef.current;
      const bpm = 120; // Default BPM; AudioData doesn't carry tempo_bpm directly
      if (processor && spectral) {
        processor.update(spectral, [], bpm);
      }
      const reactivityUniforms = processor?.getUniforms() ?? null;

      // Base uniforms from audio + stems
      const baseBass = Math.min(1, d.bass * 0.7 + stemEnergy.bass * 0.3);
      const baseMid = Math.min(1, d.mid * 0.75 + stemEnergy.vocals * 0.25);
      const baseHigh = Math.min(1, d.treble * 0.75 + stemEnergy.other * 0.25);
      const baseBeat = Math.min(1, beatPulse + stemEnergy.drums * 0.45);
      const baseEnergy = Math.min(1, lrcEnergy + stemBoost * 0.25);

      uniformsRef.current = {
        bass: reactivityUniforms
          ? Math.min(1, reactivityUniforms.bass * 0.6 + baseBass * 0.4)
          : baseBass,
        mid: reactivityUniforms
          ? Math.min(1, reactivityUniforms.mid * 0.6 + baseMid * 0.4)
          : baseMid,
        treble: reactivityUniforms
          ? Math.min(1, reactivityUniforms.high * 0.6 + baseHigh * 0.4)
          : baseHigh,
        beat: reactivityUniforms
          ? Math.min(1, reactivityUniforms.beatPhase * 0.3 + baseBeat * 0.7)
          : baseBeat,
        energy: reactivityUniforms
          ? Math.min(1, reactivityUniforms.energy * 0.5 + baseEnergy * 0.5)
          : baseEnergy,
        peak: Math.max(d.peak, stemBoost),
        sub: spectral?.sub ?? 0,
        high: spectral?.high ?? 0,
        transient: reactivityUniforms
          ? Math.min(1, reactivityUniforms.transient * 0.7 + (spectral?.transient ?? 0) * 0.3)
          : (spectral?.transient ?? 0),
        centroid: spectral?.centroid ?? 0,
        trail: sectionMapping.trailIntensity,
        // Static per track; merged here because uniformsRef is rebuilt each frame.
        keyHue: keyPaletteRef.current.hue,
        keySat: keyPaletteRef.current.saturation,
        keyConf: keyPaletteRef.current.confidence,
      };
      raf = requestAnimationFrame(update);
    };
    if (isPlaying) raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, audioData, lrcSyncLive, stems, sampleAudio, sampleSpectral]);

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
    const values: FxValues = {
      speed: fxSpeed,
      brightness: fxBrightness,
      contrast: fxContrast,
      hue: fxHue,
      saturation: fxSaturation,
    };
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
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
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
          feedback={feedbackEnabled}
          feedbackZoom={feedbackZoom}
          feedbackRotation={feedbackRotation}
          feedbackDecay={feedbackDecay}
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
