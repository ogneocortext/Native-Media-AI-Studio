/**
 * useVisualPresets &mdash; preset application and AI enrichment.
 *
 * Extracted from Visualizer.tsx (T-VIZ-12). Owns everything that happens
 * when a preset is chosen or generated:
 *
 * - `handleGenrePresetSelect` — reactivity genre preset (guard ref:
 *   a manual pick while a track loads wins over auto-apply),
 * - `applyPreset` — applies a VisualPreset to vizParams/bg/mesh/style,
 *   track-aware multipliers, postfx clamping and kinetic mapping,
 *   never mutating the shared catalog,
 * - `handleVisualPresetSelect` / `handlePresetLoaded` — catalog preset
 *   selection with the monotonic lock that preserves manual picks,
 * - `handleClearPreset` — resets to defaults,
 * - `handleEnhanceWithAI` — Ollama-backed preset generation from the
 *   current track's analysis.
 *
 * Zero behavior change.
 */
import { useCallback } from "react";
import { showToast } from "../../utils/toast";
import { cleanTrackName, clampNum } from "./visualizerHelpers";
import { getVisualizationForTrack } from "./trackConceptAnalyzer";
import type { AudioAnalysisData, VizParams } from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";
import type { ReactivityGenrePreset } from "./reactivityGenrePresets";
import type { VizMode } from "./visualizerHelpers";
import type { VisualPreset } from "./visualPreset";
import { visualPresets } from "./visualPresets";
import { toVisualPreset } from "./visualizerHelpers";
import type { VisualizerStateSetters } from "./useVisualizerState";

export interface UseVisualPresetsOptions {
  state: {
    currentFilename: string | null;
    currentAnalysisData: AudioAnalysisData | null;
    csvContent: string;
    vizMode: VizMode;
    aiEnhancing: boolean;
  };
  setters: Pick<
    VisualizerStateSetters,
    | "setActiveGenrePresetId"
    | "setReactivityTriad"
    | "setFrequencyFocus"
    | "setReactivityGain"
    | "setActiveVisualPresetId"
    | "setVizMode"
    | "setVizParams"
    | "setBgColor"
    | "setMeshColor"
    | "setVisualizationStyle"
    | "setKineticPreset"
    | "setLoadedPreset"
    | "setAiEnhancing"
    | "setError"
  >;
  refs: {
    userPickedGenrePresetRef: React.MutableRefObject<boolean>;
    visualPresetLockRef: React.MutableRefObject<number>;
    vizParamsRef: React.MutableRefObject<VizParams>;
  };
}

export interface UseVisualPresetsResult {
  handleGenrePresetSelect(preset: ReactivityGenrePreset): void;
  applyPreset(preset: VisualPreset, trackAnalysis?: AudioAnalysisData | null): void;
  handleVisualPresetSelect(presetId: string): void;
  handlePresetLoaded(preset: VisualPreset): void;
  handleClearPreset(): void;
  handleEnhanceWithAI(): Promise<void>;
}

export function useVisualPresets({
  state,
  setters,
  refs,
}: UseVisualPresetsOptions): UseVisualPresetsResult {
  const { currentFilename, currentAnalysisData, csvContent, vizMode, aiEnhancing } = state;
  const {
    setActiveGenrePresetId,
    setReactivityTriad,
    setFrequencyFocus,
    setReactivityGain,
    setActiveVisualPresetId,
    setVizMode,
    setVizParams,
    setBgColor,
    setMeshColor,
    setVisualizationStyle,
    setKineticPreset,
    setLoadedPreset,
    setAiEnhancing,
    setError,
  } = setters;
  const { userPickedGenrePresetRef, visualPresetLockRef, vizParamsRef } = refs;

  // Plan 2.3 — genre reactivity presets. The active chip highlight;
  // the guard ref mirrors the visual-preset lock: a preset the user
  // picks by hand while a track is loading wins over auto-apply.
  const handleGenrePresetSelect = useCallback((preset: ReactivityGenrePreset) => {
    userPickedGenrePresetRef.current = true;
    setReactivityTriad(preset.triad);
    setFrequencyFocus(preset.focus);
    setReactivityGain(preset.gain);
    setActiveGenrePresetId(preset.id);
  }, []);

  // Apply preset callback - defined early because handlePresetLoaded depends on it.
  // Never mutates the input preset: shared catalog entries (visualPresets) and
  // state-held objects must not absorb per-track alignment data.
  const applyPreset = useCallback(
    (preset: VisualPreset, trackAnalysis?: AudioAnalysisData | null) => {
      const incoming = toVisualPreset(preset);
      if (!incoming) {
        showToast("Ignoring malformed preset (missing name)", "warning");
        return;
      }

      // Map visualizer style → VisualizationStyle (expanded mapping)
      const styleMap: Record<string, string> = {
        particles: "particles",
        waveform: "waveform",
        pulse: "pulse",
        bars: "synthwave",
        galaxy: "cosmic",
        terrain: "ocean",
        fire: "inferno",
        glitch: "storm",
        neon: "synthwave",
        spiral: "geometric",
        vortex: "geometric",
        fractal: "fractal",
        rings: "pulse",
        terrain3d: "waveform",
        embers: "inferno",
        shockwave: "storm",
      };
      if (incoming.visualizer?.style && styleMap[incoming.visualizer.style]) {
        setVisualizationStyle(styleMap[incoming.visualizer.style] as any);
      }

      // Apply theme colors
      if (incoming.theme?.background) setBgColor(incoming.theme.background);
      if (incoming.theme?.primary) setMeshColor(incoming.theme.primary);

      // Compute track-aware multipliers
      const bpm = trackAnalysis?.tempo_bpm ?? 120;
      const energyAvg = trackAnalysis?.energy_curve?.length
        ? trackAnalysis.energy_curve.reduce((a, b) => a + b, 0) / trackAnalysis.energy_curve.length
        : 0.5;
      const duration = trackAnalysis?.duration_seconds ?? 240;
      const bpmFactor = bpm / 120;
      const energyFactor = 0.5 + energyAvg;

      // Apply postfx simulation via fog and light intensity
      const postfx = (incoming as any).postfx || {};
      const bloomIntensity = clampNum(postfx.bloom, 0, 1, 0);
      // Accept both `vignette` (built-in catalog) and `vignetteStrength` (AI-generated presets)
      const vignetteStrength = clampNum(postfx.vignette ?? postfx.vignetteStrength, 0, 1, 0);
      const glitchAmount = clampNum(postfx.glitch, 0, 1, 0);

      // Apply visualizer params with track alignment + postfx (all numerics clamped —
      // AI-generated presets are unvalidated backend output and previously could yield
      // NaN particle counts or scene-killing extremes).
      setVizParams((prev) => ({
        ...prev,
        particleCount: Math.round(
          clampNum(
            incoming.visualizer?.particleCount ?? prev.particleCount,
            50,
            2000,
            prev.particleCount,
          ) * clampNum(energyFactor, 0.5, 1.5, 1),
        ),
        scale: clampNum(incoming.visualizer?.scale ?? prev.scale, 0.1, 5, prev.scale),
        glowIntensity: incoming.visualizer?.glow
          ? Math.min(1.0, 0.8 * energyFactor + bloomIntensity * 0.2)
          : 0.2,
        rotationSpeed: clampNum((incoming.visualizer?.rotation ? 1.0 : 0.0) * bpmFactor, -5, 5, 0),
        colorShift: clampNum(
          incoming.visualizer?.intensity ?? prev.colorShift,
          0,
          3,
          prev.colorShift,
        ),
        lerpSpeed: clampNum(0.35 / bpmFactor, 0.05, 2, prev.lerpSpeed),
        matchTrack: !!trackAnalysis,
        lightIntensity: clampNum(
          0.8 + bloomIntensity * 0.4 - vignetteStrength * 0.2,
          0.2,
          3,
          prev.lightIntensity,
        ),
        fogDensity: clampNum(vignetteStrength * 0.02, 0, 0.1, prev.fogDensity),
        fogEnabled: vignetteStrength > 0.3,
        postfx: { bloom: bloomIntensity, vignette: vignetteStrength, glitch: glitchAmount },
      }));

      // Map lyric animation style → kinetic preset
      const kineticMap: Record<string, string> = {
        glitch: "phonk",
        neon: "synthwave",
        fade: "ambient",
        bounce: "dubstep",
        typewriter: "grime",
        kinetic: "cinematic",
        shake: "phonk",
        disappear: "ambient",
      };
      if (incoming.lyrics?.style && kineticMap[incoming.lyrics.style]) {
        setKineticPreset(kineticMap[incoming.lyrics.style]);
      }

      // Store a COPY with alignment attached — the input object is left untouched.
      setLoadedPreset({
        ...incoming,
        _trackAlignment: {
          bpm,
          energyAvg,
          duration,
          beatTimes: trackAnalysis?.beat_times,
          onsetTimes: trackAnalysis?.onset_times,
          sections: trackAnalysis?.sections,
          postfx: (incoming as any).postfx,
          audioReactivity: (incoming as any).audioReactivity,
          camera: (incoming as any).camera,
        },
      } as VisualPreset);
    },
    [],
  );

  const handleVisualPresetSelect = useCallback(
    (presetId: string) => {
      const preset = visualPresets[presetId];
      if (!preset) return;
      visualPresetLockRef.current++;
      setActiveVisualPresetId(presetId);
      // Batch all visual updates together so the 3D scene sees a single
      // consistent transition instead of 5 intermediate renders.
      // Note: intentionally does NOT touch kineticPreset — visual and lyric
      // presets are independent. Previously this also set kineticPreset, which
      // made the Lyric Animation list light up a *different* name (e.g.
      // visual "Trap Metal" -> lyric "Dubstep Impact") and looked like
      // "multiple presets selected automatically".
      setVizParams({ ...DEFAULT_VIZ_PARAMS, ...preset.vizParams });
      setBgColor(preset.bgColor);
      setMeshColor(preset.meshColor);
      setVisualizationStyle(preset.visualizationStyle);
      if (vizMode !== "3d") setVizMode("3d");
    },
    [vizMode],
  );

  const handlePresetLoaded = useCallback(
    (preset: VisualPreset) => {
      // Pass current track analysis so preset aligns to loaded track
      applyPreset(preset, currentAnalysisData);
    },
    [applyPreset, currentAnalysisData],
  );

  const handleClearPreset = useCallback(() => {
    setLoadedPreset(null);
    setVizParams(DEFAULT_VIZ_PARAMS);
    setBgColor("#050505");
    setMeshColor("#6366f1");
    setKineticPreset("cinematic");
  }, []);

  const handleEnhanceWithAI = useCallback(async () => {
    if (!currentAnalysisData || aiEnhancing) return;
    setAiEnhancing(true);
    setError(null);
    try {
      const cleanName = cleanTrackName(currentFilename ?? "") || "track";
      const concept = csvContent ? getVisualizationForTrack(cleanName, csvContent) : null;
      const desc = (concept as any)?.prompt || (concept as any)?.visualConcept || cleanName;
      const genre = (concept as any)?.genre?.join(", ") || "";
      const energy = currentAnalysisData.energy_curve?.length
        ? currentAnalysisData.energy_curve.reduce((a, b) => a + b, 0) /
          currentAnalysisData.energy_curve.length
        : 0.5;
      // Dynamic import keeps Ollama out of the critical module graph.
      const { generateVisualizerPreset } = await import("../../services/api");
      const res = await generateVisualizerPreset(
        `${desc} — ${genre} — mood: ${(concept as any)?.mood?.join(", ") || "auto"}`.trim(),
        undefined,
        0.7,
        {
          bpm: currentAnalysisData.tempo_bpm
            ? Math.round(currentAnalysisData.tempo_bpm)
            : undefined,
          energy,
          duration_seconds: currentAnalysisData.duration_seconds,
          genre,
        },
      );
      const preset = toVisualPreset(res?.preset);
      if (preset) {
        const beforeCount = vizParamsRef.current.particleCount;
        applyPreset(preset, currentAnalysisData);
        showToast(
          `AI applied: "${preset.name}" (was ${beforeCount} particles → ${preset.visualizer?.particleCount ?? "?"})`,
          "success",
        );
      } else {
        setError("AI returned an unusable preset — try again");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enrichment failed — check Ollama is running");
    } finally {
      setAiEnhancing(false);
    }
  }, [currentAnalysisData, currentFilename, csvContent, aiEnhancing]);

  return {
    handleGenrePresetSelect,
    applyPreset,
    handleVisualPresetSelect,
    handlePresetLoaded,
    handleClearPreset,
    handleEnhanceWithAI,
  };
}
