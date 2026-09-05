import { useRef, useEffect, useState, useCallback } from "react";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { SHADER_PRESETS, type ShaderPresetName } from "./shaders";
import { getShaderPresetForTrack, SHADER_PRESET_INFO } from "./shaderPresets";
import type { AudioData } from "./types";
import type { LyricLine } from "./components/LyricOverlay";

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
  const uniformsRef = useRef({
    bass: 0, mid: 0, treble: 0, beat: 0, energy: 0, peak: 0,
  });
  const userSelectedPreset = useRef(false);
  const lrcSyncPropRef = useRef(lrcSync);
  lrcSyncPropRef.current = lrcSync;

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
    if (!userSelectedPreset.current) {
      const newPreset = getShaderPresetForTrack(trackName);
      setPreset(newPreset);
    }
  }, [trackName]);

  const handlePresetChange = useCallback((newPreset: ShaderPresetName) => {
    userSelectedPreset.current = true;
    setPreset(newPreset);
    setShowSelector(false);
  }, []);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      <ShaderCanvas
        fragmentShader={SHADER_PRESETS[preset]}
        uniformsRef={uniformsRef}
        className="absolute inset-0"
      />

      {/* Preset selector overlay */}
      <div className="absolute top-2 right-2 z-10">
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
