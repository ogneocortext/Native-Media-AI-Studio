/**
 * useTrackSelection &mdash; "pick a track &rarr; parse &rarr; decode &rarr; reset derived state".
 *
 * Extracted from Visualizer.tsx (T-VIZ-10). The hook owns everything that
 * happens between the user picking a track (file picker, library dropdown or
 * pending-track handoff) and that track being ready to render:
 *
 * - resolving the file ref + object URL,
 * - kicking off (or reusing) stem/tempo analysis,
 * - loading LRC lyrics,
 * - auto-selecting kinetic preset, genre reactivity preset and visual preset,
 * - resetting per-track derived audio state so stale beats/peaks/lyrics
 *   never linger on the canvas.
 *
 * The component supplies state, setters, refs and api collaborators; the hook
 * returns the callbacks the component wires into JSX. Zero behavior change.
 */
import { useCallback, useEffect, useRef } from "react";
import { parseLrcContent } from "./lyricsParser";
import type { LyricLine } from "./components/LyricOverlay";
import type { AudioAnalysisData, AudioData } from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";
import type { VizMode } from "./visualizerHelpers";
import type { LibraryFile } from "./visualizerHelpers";
import type { ReactivityGenrePreset } from "./reactivityGenrePresets";
import type { VisualPreset } from "./visualPresets";
import type { TrackVisualProfile } from "./trackVisualProfiles";
import type { VisualizerState, VisualizerStateSetters } from "./useVisualizerState";
import type { LrcSyncData } from "./useLrcSync";
import { consumePendingTrack } from "../../utils/pendingTrack";
import type { ToastOptions, ToastType } from "../../utils/toast";

export interface UseTrackSelectionApi {
  ensureAnalysis(fileRef: string): Promise<{ analysis?: unknown } | null>;
  ensureAudioContext(): Promise<void>;
  cleanTrackName(fileRef: string): string;
  encodeAudioRef(fileRef: string): string;
  audioRefForFile(file: LibraryFile): string;
  showToast(message: string, typeOrOptions?: ToastType | ToastOptions): void;
  selectPresetForTrack(cleanName: string, energy: number): string;
  matchReactivityGenrePreset(names: string[]): ReactivityGenrePreset | null;
  resolveTrackVisualProfile(cleanName: string): TrackVisualProfile | null;
  selectVisualPreset(
    cleanName: string,
    kineticPreset: string | undefined,
    energy: number,
    realBpm: number | undefined,
  ): string;
  visualizationStyleToPresetId(style: string): string | null;
  visualPresets: Record<string, VisualPreset>;
  buildTunedPreset(profile: TrackVisualProfile): VisualPreset;
  selectVizMode(
    cleanName: string,
    kineticPreset: string | undefined,
    energy: number,
    realBpm: number | undefined,
  ): VizMode;
  toAnalysisData(raw: unknown): AudioAnalysisData | null;
  resetClock(): void;
  resetGraph(): void;
}

export interface UseTrackSelectionOptions {
  state: {
    analysisData: VisualizerState["analysisData"];
    trackMetadata: VisualizerState["trackMetadata"];
    vizMode: VisualizerState["vizMode"];
    pendingTrack: VisualizerState["pendingTrack"];
    libraryFiles: LibraryFile[];
  };
  setters: Pick<
    VisualizerStateSetters,
    | "setError"
    | "setCurrentFilename"
    | "setAudioUrl"
    | "setDemoEnabled"
    | "setIsPaused"
    | "setActiveVisualPresetId"
    | "setLoopRegion"
    | "setLoopAnchor"
    | "setAnalyzing"
    | "setTrackMetadata"
    | "setLyrics"
    | "setLyricsVisible"
    | "setKineticPreset"
    | "setReactivityTriad"
    | "setFrequencyFocus"
    | "setReactivityGain"
    | "setActiveGenrePresetId"
    | "setVizParams"
    | "setBgColor"
    | "setMeshColor"
    | "setVisualizationStyle"
    | "setVizMode"
    | "setLiveAudioData"
    | "setPendingTrack"
    | "setElapsed"
    | "setAnalysisData"
  >;
  refs: {
    audioElRef: React.MutableRefObject<HTMLAudioElement | null>;
    objectUrlRef: React.MutableRefObject<string | null>;
    liveAudioDataRef: React.MutableRefObject<AudioData>;
    lastBeatIdxRef: React.MutableRefObject<number>;
    lastBeatAtRef: React.MutableRefObject<number>;
    last3DUiUpdateRef: React.MutableRefObject<number>;
    lrcSyncLiveRef: React.MutableRefObject<LrcSyncData | null>;
    audioElapsedRef: React.MutableRefObject<number>;
    userPickedGenrePresetRef: React.MutableRefObject<boolean>;
    userPickedVizModeRef: React.MutableRefObject<boolean>;
    visualPresetLockRef: React.MutableRefObject<number>;
  };
  api: UseTrackSelectionApi;
}

export interface UseTrackSelectionResult {
  handleFile(file: File): void;
  handleSelectLibraryTrack(fileRef: string): Promise<void>;
  parseLyricsForTrack(trackName: string, folder?: string): Promise<LyricLine[]>;
  deriveTrackMeta(analysis: AudioAnalysisData | null): {
    bpm?: number;
    energy?: number;
    duration_seconds?: number;
  } | null;
  /** Reset per-track derived audio state so a new track never inherits stale beats/peaks/lyrics timing. */
  resetAudioDerivedState(): void;
}

export function useTrackSelection({
  state,
  setters,
  refs,
  api,
}: UseTrackSelectionOptions): UseTrackSelectionResult {
  const {
    analysisData,
    trackMetadata,
    vizMode,
    pendingTrack,
    libraryFiles,
  } = state;
  const {
    setError,
    setCurrentFilename,
    setAudioUrl,
    setDemoEnabled,
    setIsPaused,
    setActiveVisualPresetId,
    setLoopRegion,
    setLoopAnchor,
    setAnalyzing,
    setTrackMetadata,
    setLyrics,
    setLyricsVisible,
    setKineticPreset,
    setReactivityTriad,
    setFrequencyFocus,
    setReactivityGain,
    setActiveGenrePresetId,
    setVizParams,
    setBgColor,
    setMeshColor,
    setVisualizationStyle,
    setVizMode,
    setLiveAudioData,
    setPendingTrack,
    setElapsed,
    setAnalysisData,
  } = setters;
  const {
    audioElRef,
    objectUrlRef,
    liveAudioDataRef,
    lastBeatIdxRef,
    lastBeatAtRef,
    last3DUiUpdateRef,
    lrcSyncLiveRef,
    audioElapsedRef,
    userPickedGenrePresetRef,
    userPickedVizModeRef,
    visualPresetLockRef,
  } = refs;
  const {
    ensureAnalysis,
    ensureAudioContext,
    cleanTrackName,
    encodeAudioRef,
    audioRefForFile,
    showToast,
    selectPresetForTrack,
    matchReactivityGenrePreset,
    resolveTrackVisualProfile,
    selectVisualPreset,
    visualizationStyleToPresetId,
    visualPresets,
    buildTunedPreset,
    selectVizMode,
    toAnalysisData,
    resetClock,
    resetGraph,
  } = api;

  const trackRequestRef = useRef(0);

  const parseLyricsForTrack = useCallback(
    async (trackName: string, folder?: string): Promise<LyricLine[]> => {
      if (!trackName) return [];

      // Ensure the filename has .lrc extension
      const lrcBase = trackName.endsWith(".lrc")
        ? trackName
        : trackName.replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") + ".lrc";
      const candidates = folder ? [`${folder}/${lrcBase}`, lrcBase] : [lrcBase];

      // Try public directory first (fast, no backend needed)
      for (const candidate of candidates) {
        try {
          const publicLrc = await fetch(`/audio/${encodeAudioRef(candidate)}`);
          if (publicLrc.ok) {
            const lrcContent = await publicLrc.text();
            const lrcLyrics = parseLrcContent(lrcContent);
            if (lrcLyrics.length > 0) return lrcLyrics;
          }
        } catch {
          // Fall through
        }
      }

      // Try backend API
      for (const candidate of candidates) {
        try {
          const apiLrc = await fetch(`/api/audio/file/${encodeAudioRef(candidate)}`);
          if (apiLrc.ok) {
            const lrcContent = await apiLrc.text();
            const lrcLyrics = parseLrcContent(lrcContent);
            if (lrcLyrics.length > 0) return lrcLyrics;
          }
        } catch {
          // Fall through
        }
      }

      // No LRC found — return empty so the canvas stays text-free.
      return [];
    },
    [],
  );

  /** Reset per-track derived audio state so a new track never inherits stale beats/peaks/lyrics timing. */
  const resetAudioDerivedState = useCallback(() => {
    audioElapsedRef.current = 0;
    setElapsed(0);
    resetClock();
    lrcSyncLiveRef.current = null;
    // Lyrics are strictly LRC-derived: a new track starts wordless so stale
    // lines can never linger on the canvas when the next track has no LRC.
    setLyrics([]);
    setLyricsVisible(false);
    lastBeatIdxRef.current = -1;
    lastBeatAtRef.current = 0;
    last3DUiUpdateRef.current = 0;
    // Fade the main track back in (hard gain cuts cause clicks/pops) and
    // reset its EQ to flat on track change.
    resetGraph();
    const idle: AudioData = {
      bass: 0,
      mid: 0,
      treble: 0,
      overall: 0,
      beat: false,
      peak: 0,
      energy: 0,
      drumType: null,
      nextBeatIn: 0,
    };
    liveAudioDataRef.current = idle;
    setLiveAudioData(idle);
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      // Stop the previous element before revoking its object URL — revoking mid-play
      // aborts playback with a network error on the remounting element.
      audioElRef.current?.pause();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      resetAudioDerivedState();
      setCurrentFilename(null);
      setAudioUrl(url);
      setDemoEnabled(false);
      setIsPaused(false);
      // Ensure shared AudioContext exists so stems can reuse it.
      void ensureAudioContext();
    },
    [resetAudioDerivedState, ensureAudioContext],
  );

  const handleSelectLibraryTrack = useCallback(
    async (fileRef: string) => {
      if (!fileRef) return;
      const requestId = ++trackRequestRef.current;
      const isStale = () => requestId !== trackRequestRef.current;
      const presetLockAtStart = visualPresetLockRef.current;
      setError(null);
      resetAudioDerivedState();
      setCurrentFilename(fileRef);
      // Segment-wise encoding keeps subfolder slashes intact for :path routes.
      setAudioUrl(`/api/audio/file/${encodeAudioRef(fileRef)}`);
      setDemoEnabled(false);
      setIsPaused(false);
      // Ensure shared AudioContext exists before stems can load.
      void ensureAudioContext();
      // New track: clear manual preset lock so auto-apply is allowed to run.
      setActiveVisualPresetId(null);
      // New track: an A-B loop from the previous track makes no sense.
      setLoopRegion(null);
      setLoopAnchor(null);
      // New track: the manual genre-preset guard resets so auto-apply
      // may run again (a pick made mid-load still wins — see below).
      userPickedGenrePresetRef.current = false;
      // Q4 — reset the manual-viz-mode guard so auto-selection can run
      // for the new track (a manual pick on the previous track doesn't
      // carry over).
      userPickedVizModeRef.current = false;
      const trackFolder = fileRef.includes("/") ? fileRef.slice(0, fileRef.lastIndexOf("/")) : "";
      const cleanName = cleanTrackName(fileRef);
      let analysis: AudioAnalysisData | null = analysisData[fileRef] ?? null;
      let realBpm = trackMetadata[fileRef].bpm;
      if (!analysis) {
        // Surface progress: a fresh analysis can take a while, during which the
        // visualizer runs on the fallback (threshold) beat detector — visibly
        // looser timing than analysis beat_times. The Analyze button doubles as
        // the progress indicator via the shared `analyzing` flag.
        setAnalyzing(true);
        try {
          // Try to get cached analysis first, then ensure analysis (runs if needed)
          const result = await ensureAnalysis(fileRef);
          if (isStale()) return;
          const ensuredAnalysis = toAnalysisData(result?.analysis);
          if (ensuredAnalysis) {
            analysis = ensuredAnalysis;
            setAnalysisData((prev) => ({ ...prev, [fileRef]: ensuredAnalysis }));
            realBpm = ensuredAnalysis.tempo_bpm ? Math.round(ensuredAnalysis.tempo_bpm) : undefined;
            if (realBpm) setTrackMetadata((prev) => ({ ...prev, [fileRef]: { bpm: realBpm } }));
          } else if (result && !result.analysis) {
            showToast("Analysis came back empty — visuals use live audio only", "warning");
          }
        } catch {
          // Never fail silently: without analysis there is no beat sync.
          showToast("Track analysis failed — visuals use live audio only", "error");
        } finally {
          if (!isStale()) setAnalyzing(false);
        }
      }
      if (isStale()) return;

      // Load lyrics for this track (LRC only — no LRC means a text-free canvas)
      const trackLyrics = await parseLyricsForTrack(cleanName, trackFolder);
      if (isStale()) return;
      setLyrics(trackLyrics);
      setLyricsVisible(trackLyrics.length > 0);

      // Auto-select kinetic preset based on track genre
      const energy = analysis.energy_curve.length
        ? analysis.energy_curve.reduce((a, b) => a + b, 0) / analysis.energy_curve.length
        : 0.5;
      let kineticPresetId = selectPresetForTrack(cleanName, energy);
      // Backend decision-model fallback: if the genre heuristic fell back to the
      // generic "cinematic" default and the analysis carries a confident kinetic
      // suggestion, prefer the data-driven pick.
      if (
        kineticPresetId === "cinematic" &&
        analysis.suggested_kinetic_preset &&
        (analysis.suggested_kinetic_preset_confidence ?? 0) > 0.6
      ) {
        kineticPresetId = analysis.suggested_kinetic_preset;
      }
      if (isStale()) return;
      setKineticPreset(kineticPresetId);

      // Plan 2.3 — auto-select a genre reactivity preset from the
      // track name (the same signal the kinetic auto-select uses).
      // Guard: a preset the user picked by hand while analysis was
      // loading wins over the auto-apply.
      if (!userPickedGenrePresetRef.current) {
        const genrePreset = matchReactivityGenrePreset([cleanName]);
        if (genrePreset) {
          setReactivityTriad(genrePreset.triad);
          setFrequencyFocus(genrePreset.focus);
          setReactivityGain(genrePreset.gain);
          setActiveGenrePresetId(genrePreset.id);
        } else {
          setActiveGenrePresetId(null);
        }
      }

      // Auto-apply optimized visual preset based on track characteristics.
      // Track-specific tuned profiles (trackVisualProfiles.ts) win over the
      // generic genre/energy/BPM guess; unknown tracks fall back to
      // selectVisualPreset(). Guard: if the user manually picked a preset
      // while we were awaiting ensureAnalysis()/parseLyrics, do not clobber
      // that choice.
      const trackProfile = resolveTrackVisualProfile(cleanName);
      let visualPresetId = selectVisualPreset(cleanName, undefined, energy, realBpm);
      let usedBackendVisualFallback = false;
      // Backend decision-model fallback: when no tuned profile exists and the
      // generic selector returned the balanced default, promote a confident
      // backend visualization suggestion onto a matching preset.
      if (
        !trackProfile &&
        visualPresetId === "balanced" &&
        analysis.suggested_visualization &&
        (analysis.suggested_visualization_confidence ?? 0) > 0.55
      ) {
        const styleMapped = visualizationStyleToPresetId(analysis.suggested_visualization);
        if (styleMapped && visualPresets[styleMapped]) {
          visualPresetId = styleMapped;
          usedBackendVisualFallback = true;
        }
      }
      let visualPreset = visualPresets[visualPresetId];
      let tunedTitle: string | null = null;
      if (trackProfile && visualPresets[trackProfile.basePresetId]) {
        visualPreset = buildTunedPreset(trackProfile);
        visualPresetId = trackProfile.basePresetId;
        tunedTitle = trackProfile.title;
      }
      if (visualPreset) {
        if (visualPresetLockRef.current !== presetLockAtStart || isStale()) {
          // Skip auto-apply: user manually picked a preset while we were awaiting analysis/lyrics.
        } else {
          setVizParams({ ...DEFAULT_VIZ_PARAMS, ...visualPreset.vizParams });
          setBgColor(visualPreset.bgColor);
          setMeshColor(visualPreset.meshColor);
          setVisualizationStyle(visualPreset.visualizationStyle);
          setKineticPreset(visualPreset.kineticPreset);
          setActiveVisualPresetId(visualPresetId);
          showToast(
            tunedTitle
              ? `Applied tuned visuals for "${tunedTitle}" (based on ${visualPreset.name})`
              : usedBackendVisualFallback
                ? `Applied "${visualPreset.name}" preset — ${visualPreset.description} (suggested by analysis)`
                : `Applied "${visualPreset.name}" preset — ${visualPreset.description}`,
            "info",
          );
        }
      }

      // Q4 — auto-select the viz mode from the track's characteristics,
      // falling back down VIZ_MODE_PRIORITY if the top choice isn't suitable.
      // A manual pick made while loading wins (guard ref). Only set when it
      // differs, to avoid a needless re-render / crossfade.
      if (!userPickedVizModeRef.current && !isStale()) {
        const autoMode = selectVizMode(cleanName, undefined, energy, realBpm);
        if (vizMode !== autoMode) setVizMode(autoMode);
      }

      // Store analysis for manual AI enrichment — user explicitly clicks "Enhance with AI"
      // (previous fire-and-forget auto-generation removed: it overwrote the visible preset silently)
      (window as any).__pendingAIAnalysis = analysis;
      (window as any).__pendingAICleanName = cleanName;
      (window as any).__pendingAIRealBpm = realBpm;
    },
    [
      analysisData,
      trackMetadata,
      parseLyricsForTrack,
      resetAudioDerivedState,
      setError,
      setCurrentFilename,
      setAudioUrl,
      setDemoEnabled,
      setIsPaused,
      setActiveVisualPresetId,
      setLoopRegion,
      setLoopAnchor,
      setAnalyzing,
      setTrackMetadata,
      setLyrics,
      setLyricsVisible,
      setKineticPreset,
      setReactivityTriad,
      setFrequencyFocus,
      setReactivityGain,
      setActiveGenrePresetId,
      setVizParams,
      setBgColor,
      setMeshColor,
      setVisualizationStyle,
      setVizMode,
      ensureAnalysis,
      ensureAudioContext,
      showToast,
      selectPresetForTrack,
      matchReactivityGenrePreset,
      resolveTrackVisualProfile,
      selectVisualPreset,
      visualizationStyleToPresetId,
      visualPresets,
      buildTunedPreset,
      selectVizMode,
      vizMode,
    ],
  );

  const deriveTrackMeta = useCallback((analysis: AudioAnalysisData | null) => {
    if (!analysis) return null;
    const energyAvg = analysis.energy_curve.length
      ? analysis.energy_curve.reduce((a, b) => a + b, 0) / analysis.energy_curve.length
      : undefined;
    return {
      bpm: analysis.tempo_bpm ? Math.round(analysis.tempo_bpm) : undefined,
      energy: energyAvg,
      duration_seconds: analysis.duration_seconds || undefined,
    };
  }, []);

  // Media Library handoff: auto-select a pending track exactly once. The handoff
  // may carry a bare filename while the library entry lives in a subfolder, so
  // resolve against the loaded library (by ref or bare name) before selecting.
  useEffect(() => {
    const pending = consumePendingTrack();
    if (pending) setPendingTrack(pending);
  }, []);

  useEffect(() => {
    if (!pendingTrack || libraryFiles.length === 0) return;
    const match = libraryFiles.find(
      (f) => audioRefForFile(f) === pendingTrack || f.filename === pendingTrack,
    );
    void handleSelectLibraryTrack(match ? audioRefForFile(match) : pendingTrack);
    setPendingTrack(null);
  }, [pendingTrack, libraryFiles]);

  return {
    handleFile,
    handleSelectLibraryTrack,
    parseLyricsForTrack,
    deriveTrackMeta,
    resetAudioDerivedState,
  };
}
