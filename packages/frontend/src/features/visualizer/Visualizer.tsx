/**
 * Visualizer — main 2D/3D audio-reactive visualizer page.
 *
 * Purpose: the studio's visualizer. Renders an audio-reactive scene (Three.js
 * @react-three/fiber 3D lane plus a Canvas2D 2D lane) driven by the track's
 * analysis (beats, downbeats, energy curve, spectral curves, sections) and LRC
 * lyrics sync. Owns the track picker, playback transport, style presets, EQ
 * bands, and capture/export controls.
 *
 * Module split (AGENTS.md D14): Visualizer.tsx used to be a 2,318-line
 * monolith mixing pure helpers, canvas capture, the Web Audio graph, track
 * selection, preset application, and JSX. Pure helpers now live in sibling
 * modules (canvas2dHelpers, canvas2dModeBudget, audioEQ, trackConceptAnalyzer,
 * useLrcSync, useSpectralTimeline, services/analysisAudioFrame,
 * services/frameAccurateExport). Capture and audio-graph lifecycles live in
 * hooks that own their own teardown. New visualizer work should go in the
 * matching module rather than growing this file.
 *
 * Audio-context rule (D4/D14): only one AudioContext may exist per visualizer
 * page. useAudioGraph.ensureAudioContext is the single creation site within
 * the visualizer. BeatTimeline and the StemMixer fallback still construct
 * their own outside the visualizer — app-wide consolidation is open (D14).
 *
 * Audio-library rule (D16): the track list comes from useAudioLibrary() only.
 * Do NOT call listAudioFiles() from this component.
 *
 * Backend endpoints used: ensureAnalysis, getStemsAnalysis (services/api).
 * Analysis results carry ANALYSIS_SCHEMA_VERSION (currently 2 in
 * backend app/api/audio_analysis.py); treat results below the current schema
 * as stale.
 */
import { useRef, useEffect, useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import {
  Music,
  AlertCircle,
  Maximize2,
  Minimize2,
  Video,
  Square,
  Download,
  Settings,
  Snowflake,
  MessageSquare,
  Sparkles,
  Play,
  Wand2,
  Accessibility,
  EyeOff,
  User,
  Layers,
  ListVideo,
  MoreHorizontal,
  Keyboard,
  Film,
  Camera,
  Repeat,
} from "lucide-react";
import { formatTime } from "../../utils/format";
import { ensureAnalysis, getStemsAnalysis } from "../../services/api";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { AudioTransport } from "../../components/audio";
import { AudioFileBrowser } from "./components/AudioFileBrowser";
import { AudioLatencyCard } from "../../components/AudioLatencyCard";
import { FrameRateCard } from "../../components/FrameRateCard";
import type {
  AudioData,
} from "./types";
import { useUIStore } from "../../state/uiStore";
import {
  Canvas2DVisualizer,
  type Canvas2DFrameAccurateApi,
} from "./Canvas2DVisualizer";
import { VisualizerScene } from "./VisualizerScene";
import { useLrcSync, computeLrcSync, computeSectionBounds } from "./useLrcSync";
import type { LrcSyncData } from "./useLrcSync";
import { ShaderVisualizer, type ShaderFrameAccurateApi } from "./ShaderVisualizer";
import { ACESFilmicToneMapping } from "three";
import {
  useWebGPUDector,
  createVisualizerRenderer,
  isWebGPUOptIn,
} from "./webgpu/WebGPURendererDetector";
import { SpectrumBar } from "./components/SpectrumBar";
import { StemMixerPanel, type StemName } from "./components/StemMixer";
import { RemixPanel } from "./remix/RemixPanel";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { ProfessionalMixer } from "./professionalMixer/ProfessionalMixer";
import { StylePicker } from "./components/StylePicker";
import { QuickPresetBar } from "./components/QuickPresetBar";
import { ReactivityHUD } from "./components/ReactivityHUD";
import {
  matchReactivityGenrePreset,
} from "./reactivityGenrePresets";
import { SettingsPanel } from "./components/SettingsPanel";
import { UploadPrompt } from "./components/UploadPrompt";
import { PresetFileUpload } from "./components/PresetFileUpload";
import { AIVisualizerPrompt } from "./components/AIVisualizerPrompt";
import { KineticLyricOverlay } from "./components/KineticLyricOverlay";
import { AnimationDemo } from "./components/AnimationDemo";
import { TheatreStudioPanel } from "./components/TheatreStudioPanel";
import { showToast } from "../../utils/toast";
import { visualPresets, selectVisualPreset } from "./visualPresets";
import { resolveTrackVisualProfile, buildTunedPreset } from "./trackVisualProfiles";
import { selectPresetForTrack } from "./components/KineticPresets";
import { buildStoryboard, getStoryState } from "./storyboard";
import { BuilderFigure } from "./components/BuilderFigure";
import { useMCPContextSync } from "./useMCPContextSync";
import { useVisualizerRecording } from "./useVisualizerRecording";
import { useAudioGraph } from "./useAudioGraph";
import { useVisualizerState } from "./useVisualizerState";
import { useTrackSelection } from "./useTrackSelection";
import { useVisualizerPlayback } from "./useVisualizerPlayback";
import { useVisualPresets } from "./useVisualPresets";
import { useVisualizerLifecycle } from "./useVisualizerLifecycle";
import { RenderStatsProbe, RenderStatsBadge } from "./components/RenderStats";
import {
  CANVAS_2D_MODES,
  CANVAS_2D_MODE_LABELS,
  shortModeLabel,
  BEAT_LATCH_MS,
  audioRefForFile,
  optionLabelForFile,
  cleanTrackName,
  encodeAudioRef,
  visualizationStyleToPresetId,
  toAnalysisData,
  type Canvas2DMode,
  type LibraryFile,
  selectVizMode,
} from "./visualizerHelpers";

export function Visualizer() {
  const {
    // Colors
    bgColor, setBgColor,
    meshColor, setMeshColor,
    // Demo
    demoEnabled, setDemoEnabled,
    // Audio
    audioUrl, setAudioUrl,
    currentFilename, setCurrentFilename,
    isPlaying, setIsPlaying,
    isPaused, setIsPaused,
    error, setError,
    // Live audio
    liveAudioData, setLiveAudioData,
    // Render
    adaptiveDpr, setAdaptiveDpr,
    renderStats, setRenderStats,
    aiEnhancing, setAiEnhancing,
    // UI overlays
    openOverlay, setOpenOverlay,
    // Presets
    activeVisualPresetId, setActiveVisualPresetId,
    activeShaderPreset, setActiveShaderPreset,
    // Reactivity
    reactivityGain, setReactivityGain,
    frequencyFocus, setFrequencyFocus,
    reactivityTriad, setReactivityTriad,
    activeGenrePresetId, setActiveGenrePresetId,
    // Mixer
    stemsMixerState, setStemsMixerState,
    proMixerMeters,
    useProMixer, setUseProMixer,
    // Playback
    elapsed, setElapsed,
    audioDuration, setAudioDuration,
    // Viz mode
    vizMode, setVizMode,
    canvas2DMode, setCanvas2DMode,
    sceneFrozen, setSceneFrozen,
    prefersReducedMotion, setPrefersReducedMotion,
    // Timing refs
    lastBeatIdxRef, lastBeatAtRef,
    lastAudioDataAtRef, last3DUiUpdateRef,
    // Test harness
    testStateRef, prevTestState,
    // Visibility
    visualsVisible, setVisualsVisible,
    lyricsVisible, setLyricsVisible,
    characterVisible, setCharacterVisible,
    // Dev panels/modals
    showTestPanel, setShowTestPanel,
    showSettings, setShowSettings,
    showAnimDemo, setShowAnimDemo,
    showTheatreStudio, setShowTheatreStudio,
    showExportModal, setShowExportModal,
    showAIPanel, setShowAIPanel,
    showAudioBrowser, setShowAudioBrowser,
    // Pending track / loop
    pendingTrack, setPendingTrack,
    loopAnchor, setLoopAnchor,
    loopRegion, setLoopRegion,
    // Kinetic / style / scale / preset
    kineticPreset, setKineticPreset,
    visualizationStyle, setVisualizationStyle,
    perceptualScale, setPerceptualScale,
    loadedPreset, setLoadedPreset,
    // Library / analysis / stem data (moved out of local state)
    csvContent, setCsvContent,
    vizParams, setVizParams,
    trackMetadata, setTrackMetadata,
    analysisData, setAnalysisData,
    stemsData, setStemsData,
    analyzing, setAnalyzing,
    // Canvas / renderer state
    rendererReady, setRendererReady,
    rendererBackend, setRendererBackend,
    // Lyrics + mode crossfade
    lyrics, setLyrics,
    modeFade, setModeFade,
  } = useVisualizerState();
  const demoBpm = 120;
  // Shared media-library source. `LibraryFile` consumers still work because the
  // store entries are a superset (they add `displayName`, `optionLabel`, `ref`).
  const { entries: sharedLibraryEntries } = useAudioLibrary();
  const libraryFiles = useMemo<LibraryFile[]>(
    () => sharedLibraryEntries.map((f) => ({ ...f })),
    [sharedLibraryEntries],
  );
  const liveAudioDataRef = useRef<AudioData>({
    bass: 0,
    mid: 0,
    treble: 0,
    overall: 0,
    beat: false,
    peak: 0,
    energy: 0,
    drumType: null,
    nextBeatIn: 0,
  });
  // A-B loop region on the timeline. `loopAnchor` holds the pending
  // start while the user walks to the end point: one button cycles
  // set-A → set-B → clear (see handleLoopToggle).
  const loopRegionRef = useRef<{ start: number; end: number } | null>(null);
  const prevModeRef = useRef(vizMode);
  // One definition of the mode list, in visualizerHelpers.ts. This used to be an
  // inline 12-member union that had already drifted from the picker's list (it
  // was missing `aurora`), which is how an implemented, budgeted mode ended up
  // unreachable from the UI.
  // Plan 1.3 — one floating overlay at a time. The shortcuts popover, the
  // More-controls menu and the FX panel are mutually exclusive: opening one
  // closes the others, a scrim dims the canvas, and Esc dismisses. The 3D
  // preset column hides while an overlay is open (Visualizer.tsx render).
  const showShortcuts = openOverlay === "shortcuts";
  const showMoreMenu = openOverlay === "more";
  const toggleOverlay = useCallback((id: "shortcuts" | "more" | "fx") => {
    setOpenOverlay((o) => (o === id ? null : id));
  }, []);

  // Plan 1.3 — click-away dismissal: tapping the scrim or anywhere outside an
  // open overlay closes it. Without this the more menu stays open and its
  // z-200 layer intercepts clicks on panel controls (the Playwright
  // interception failure). The menu container itself is excluded so clicking
  // a menu item doesn't immediately re-close the overlay.
  useEffect(() => {
    const onDocumentClick = (e: MouseEvent) => {
      if (openOverlay === null) return;
      const target = e.target as HTMLElement;
      // Clicking the scrim itself always dismisses.
      if (target.closest(".viz-overlay-scrim")) {
        setOpenOverlay(null);
        return;
      }
      // If we're inside any overlay container, leave it open.
      if (
        target.closest(".viz-more-menu") ||
        target.closest(".viz-shortcuts-menu") ||
        target.closest(".viz-fx-panel") ||
        target.closest("[data-viz-overlay-toggle]")
      ) {
        return;
      }
      setOpenOverlay(null);
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [openOverlay]);
  // Single source of truth for which visual preset is currently active (fixes
  // Plan 2.3 — genre reactivity presets. The active chip highlight;
  // the guard ref mirrors the visual-preset lock: a preset the user
  // picks by hand while a track is loading wins over auto-apply.
  const userPickedGenrePresetRef = useRef(false);
  // Q4 — guard ref so a manual viz-mode pick mid-load is never clobbered by
  // auto-apply on the next track. Mirrors userPickedGenrePresetRef.
  const userPickedVizModeRef = useRef(false);
  // Monotonic lock so a manual preset click that happens while
  // handleSelectLibraryTrack is still awaiting ensureAnalysis() is not
  // clobbered by the pending auto-apply.
  const visualPresetLockRef = useRef(0);

  const { focusMode, toggleFocusMode, autoPlay, toggleAutoPlay } = useUIStore();

  // WebGPU detection — prefer WebGPURenderer when available (r185 TSL-native path)
  const gpuResult = useWebGPUDector();

  const currentAnalysisData = currentFilename ? (analysisData[currentFilename] ?? null) : null;
  const currentAnalysisDataRef = useRef(currentAnalysisData);
  currentAnalysisDataRef.current = currentAnalysisData;
  const currentStemsData = currentFilename ? (stemsData[currentFilename] ?? null) : null;
  const currentStemsDataRef = useRef(currentStemsData);
  currentStemsDataRef.current = currentStemsData;
  // Toggle between simple stem mixer and professional mixer
  // Build stems URL record for the professional mixer from current stems data
  const proMixerStems = useMemo(() => {
    if (!currentStemsData || !currentFilename) return null;
    const stems: Record<StemName, string> = {
      vocals: currentStemsData.vocals?.url || "",
      drums: currentStemsData.drums?.url || "",
      bass: currentStemsData.bass?.url || "",
      other: currentStemsData.other?.url || "",
    };
    return Object.values(stems).some((v) => v) ? stems : null;
  }, [currentStemsData, currentFilename]);

  const audioElapsedRef = useRef(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Shared Web Audio graph (context + EQ + analyser + gain). Owns setup/reset/teardown.
  const {
    audioCtxRef,
    analyserRef,
    mainGainRef,
    eqRef,
    ensureAudioContext,
    setupAudio,
    sampleAudio,
    resetGraph,
    resetClock,
    audioClockRef,
    latencyRef,
  } = useAudioGraph(audioElRef);

  // Plan 2.4 — retry audio context initialization when the user clicks "Retry"
  // in the Audio Latency card (shown when the context is not initialized).
  useEffect(() => {
    const onRetry = () => {
      void ensureAudioContext();
    };
    window.addEventListener("viz-audio-ctx-retry", onRetry);
    return () => window.removeEventListener("viz-audio-ctx-retry", onRetry);
  }, [ensureAudioContext]);

  // Latest vizParams for callbacks that must not re-subscribe on every slider tick.
  const vizParamsRef = useRef(vizParams);
  vizParamsRef.current = vizParams;

  // LRC sync for precise phrase-synchronized visuals — now reactive via elapsed state
  const lrcSync = useLrcSync(lyrics, elapsed);
  // Storyboard: LRC sections + analysis energy → narrative beats (acts).
  // Rebuilds per track/lyrics/analysis; state lookup below runs at lyric-DOM rate.
  const storyboard = useMemo(
    () =>
      buildStoryboard(
        cleanTrackName(currentFilename ?? "") || "untitled",
        lyrics,
        currentAnalysisData,
      ),
    [currentFilename, lyrics, currentAnalysisData],
  );
  const storyState = useMemo(() => getStoryState(storyboard, elapsed), [storyboard, elapsed]);
  // Per-frame LRC state for rAF/useFrame consumers (see useLrcSync note): written by
  // the elapsed loop at full frame rate. The React-state `lrcSync` above remains for
  // DOM and slow consumers; frame-critical visuals read this ref (never stale).
  const lrcSyncLiveRef = useRef<LrcSyncData | null>(null);
  const sectionBounds = useMemo(() => computeSectionBounds(lyrics), [lyrics]);
  // Mirrors for the elapsed rAF loop (its deps can't include per-track lyrics data
  // without re-subscribing mid-playback and capturing stale closures).
  const liveTimingRefs = useRef({ lyrics, sectionBounds });
  liveTimingRefs.current = { lyrics, sectionBounds };
  // Sync key visualizer state to shared MCP context for prompt/context-aware tools.
  useMCPContextSync({
    visualization: { style: visualizationStyle, mode: vizMode, preset: loadedPreset?.name },
    audio: {
      filename: currentFilename ?? undefined,
      bpm: currentAnalysisData?.tempo_bpm,
      energy: currentAnalysisData?.energy_curve?.length
        ? currentAnalysisData.energy_curve.reduce((a, b) => a + b, 0) /
          currentAnalysisData.energy_curve.length
        : undefined,
      beat: false,
    },
  });
  // Handle Canvas onCreated
  const handleCanvasCreated = useCallback(({ gl }: { gl: any }) => {
    gl.toneMappingExposure = 0.8;
    if ((gl)?.isWebGPURenderer) {
      setRendererBackend("WebGPU");
    } else {
      gl.toneMapping = ACESFilmicToneMapping;
      setRendererBackend("WebGL2");
    }
    setRendererReady(true);
  }, []);
  // Interpolated, latency-compensated audio clock lives in useAudioGraph.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // Canvas capture (MP4 via WebCodecs, else WebM). Owns its recorder + timer teardown.
  // Plan 2.9 — each render path publishes its deterministic render API here
  // for frame-accurate export: shader mode and 2D mode each have a ref, and
  // the exporter is given the one the current mode publishes (3D mode has its
  // own studio-lane exporter in StudioHeader).
  const shaderFrameAccurateApiRef = useRef<ShaderFrameAccurateApi | null>(null);
  const canvas2dFrameAccurateApiRef = useRef<Canvas2DFrameAccurateApi | null>(null);
  const {
    isRecording,
    recordingTime,
    recordedBlob,
    startRecording,
    stopRecording,
    downloadRecording,
    isExporting,
    exportProgress,
    startFrameAccurateExport,
  } = useVisualizerRecording(containerRef, setError, () =>
    vizMode === "2d"
      ? canvas2dFrameAccurateApiRef.current
      : shaderFrameAccurateApiRef.current,
  );
  // Track selection: file picker, library dropdown and pending-track handoff.
  // Owned by useTrackSelection (T-VIZ-10); the component only wires JSX to it.
  const {
    handleFile,
    handleSelectLibraryTrack,
    deriveTrackMeta,
    resetAudioDerivedState,
  } = useTrackSelection({
    state: {
      analysisData,
      trackMetadata,
      vizMode,
      pendingTrack,
      libraryFiles,
    },
    setters: {
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
    },
    refs: {
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
    },
    api: {
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
    },
  });
  // Playback clock, seek and blob-URL lifecycle (T-VIZ-11).
  const { togglePlayPause, cycleVizMode, handlePlayheadClick } = useVisualizerPlayback({
    state: { isPlaying, audioUrl },
    setters: { setElapsed, setVizMode },
    refs: {
      audioElRef,
      objectUrlRef,
      audioElapsedRef,
      lrcSyncLiveRef,
      liveTimingRefs,
      loopRegionRef,
      userPickedVizModeRef,
    },
    api: { audioClockRef, latencyRef },
  });
  // Preset application and AI enrichment (T-VIZ-12).
  const {
    handleGenrePresetSelect,
    handleVisualPresetSelect,
    handlePresetLoaded,
    handleClearPreset,
    handleEnhanceWithAI,
  } = useVisualPresets({
    state: {
      currentFilename,
      currentAnalysisData,
      csvContent,
      vizMode,
      aiEnhancing,
    },
    setters: {
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
    },
    refs: {
      userPickedGenrePresetRef,
      visualPresetLockRef,
      vizParamsRef,
    },
  });

  const handleAnalyzeTrack = useCallback(
    async (filename: string) => {
      if (!filename || analyzing) return;
      setAnalyzing(true);
      try {
        const result = await ensureAnalysis(filename);
        const analysis = toAnalysisData(result?.analysis);
        if (!analysis) {
          setError("Analysis returned an unusable payload — try again");
          return;
        }
        setAnalysisData((prev) => ({ ...prev, [filename]: analysis }));
        setTrackMetadata((prev) => ({
          ...prev,
          [filename]: {
            bpm: Math.round(analysis.tempo_bpm),
            duration: Math.round(analysis.duration_seconds),
          },
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setAnalyzing(false);
      }
    },
    [analyzing],
  );

  // Lifecycle: global input, loop, capture, crossfade, reduced motion,
  // outside-click dismisser and the __VIZ_TEST__ harness (T-VIZ-13).
  const { handleLoopToggle, captureFrame } = useVisualizerLifecycle({
    state: {
      vizMode,
      loopRegion,
      loopAnchor,
      prefersReducedMotion,
      openOverlay,
      showTestPanel,
      currentFilename,
      isPlaying,
      liveAudioData,
      visualizationStyle,
      kineticPreset,
      storyboard,
      loadedPreset,
      visualsVisible,
      lyricsVisible,
      characterVisible,
      canvas2DMode,
      activeVisualPresetId,
    },
    setters: {
      setLoopRegion,
      setLoopAnchor,
      setPrefersReducedMotion,
      setShowTestPanel,
      setVizMode,
      setCanvas2DMode,
      setOpenOverlay,
      setVisualsVisible,
      setLyricsVisible,
      setCharacterVisible,
      setModeFade,
    },
    refs: {
      audioElRef,
      audioElapsedRef,
      prevModeRef,
      testStateRef,
      prevTestState,
    },
    api: {
      togglePlayPause,
      cycleVizMode,
      toggleFocusMode,
      toggleOverlay,
      handleAnalyzeTrack,
      handleSelectLibraryTrack,
    },
  });
  // Latest perceptual scale for the shader/2D rAF loop (which only re-subscribes
  // on mode/playback changes, not on scale changes).
  const perceptualScaleRef = useRef(perceptualScale);
  perceptualScaleRef.current = perceptualScale;
  // Load CSV and library
  useEffect(() => {
    fetch("/track-prompts-lyrics.csv")
      .then(async (r) => r.text())
      .then(setCsvContent)
      .catch(() => { void 0; });
  }, []);

  // Fetch per-stem visualization data when the track changes (optional enrichment).
  // Stem separation is slow, so we only fetch when a track is selected and cache
  // the result so we never re-analyze the same file twice in one session.
  useEffect(() => {
    if (!currentFilename) return;
    let cancelled = false;
    getStemsAnalysis(currentFilename)
      .then(
        (data: {
          stems: Record<
            string,
            {
              file: string;
              url: string;
              duration: number;
              sample_rate: number;
              rms_mean: number;
              rms_std: number;
              centroid_mean: number;
              zcr_mean: number;
              energy_curve: number[];
              energy_curve_points: number;
            }
          >;
          separated: boolean;
        }) => {
          if (!cancelled && data.separated && Object.keys(data.stems).length > 0) {
            setStemsData((prev) => ({
              ...prev,
              [currentFilename]: data.stems,
            }));
          }
        },
      )
      .catch(() => {
        /* stems are optional — never block playback on analysis */
      });
    return () => {
      cancelled = true;
    };
  }, [currentFilename]);

  // Auto-play when a track is selected, if the setting is enabled.
  // Uses a small delay so the <audio key={audioUrl}> remount completes
  // and the browser sees the play() as part of the active user gesture chain.
  useEffect(() => {
    if (!audioUrl || !autoPlay) return;
    const timer = setTimeout(() => {
      const el = audioElRef.current;
      if (el) {
        el.play()
          .then(() => {
            // onPlay will fire and run setupAudio()
          })
          .catch(() => {
            // Autoplay blocked by browser policy — user can still press Play manually.
          });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [audioUrl, autoPlay]);



  // (was: always-on loop re-rendering ~12fps when idle).


  // A-B loop and lifecycle handlers now live in useVisualizerLifecycle (T-VIZ-13).

  // Media Library handoff: auto-select a pending track exactly once. The handoff
  // may carry a bare filename while the library entry lives in a subfolder, so
  // resolve against the loaded library (by ref or bare name) before selecting.

  return (
    <div
      className={`viz-page ${focusMode ? "viz-focus-mode" : ""}`}
      data-viz-overlay={openOverlay ?? ""}
    >
      {/* Plan 1.3 — dims the stage while a floating overlay is open; the
          document outside-click listener above closes the overlay on tap. */}
      {openOverlay !== null && <div className="viz-overlay-scrim" aria-hidden="true" />}
      {showTestPanel && (
        <div className="viz-test-panel">
          <div className="viz-test-panel-row">
            <label>
              Track
              <select
                onChange={async (e) => handleSelectLibraryTrack(e.target.value)}
                value={currentFilename || ""}
              >
                <option value="" disabled>
                  Select a track...
                </option>
                {libraryFiles.map((f) => {
                  const ref = audioRefForFile(f);
                  return (
                    <option key={ref} value={ref}>
                      {optionLabelForFile(f)}
                      {trackMetadata[ref]?.bpm ? ` (${trackMetadata[ref]?.bpm} BPM)` : ""}
                      {analysisData[ref] ? " ✓" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Mode
              <select
                value={vizMode}
                onChange={(e) => {
                  userPickedVizModeRef.current = true;
                  setVizMode(e.target.value as any);
                }}
              >
                <option value="shader">FX</option>
                <option value="2d">2D</option>
                <option value="3d">3D</option>
              </select>
            </label>
            {vizMode === "2d" && (
              <label>
                2D Mode
                <select
                  value={canvas2DMode}
                  onChange={(e) => setCanvas2DMode(e.target.value as Canvas2DMode)}
                >
                  {CANVAS_2D_MODES.map((m) => (
                    <option key={m} value={m}>
                      {CANVAS_2D_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button onClick={() => setShowTestPanel(false)}>Close</button>
          </div>
          <pre className="viz-test-state">
            {JSON.stringify(
              {
                vizMode,
                canvas2DMode,
                currentFilename,
                isPlaying,
                liveAudioData,
                visualizationStyle,
                kineticPreset,
                loadedPreset: loadedPreset?.name ?? null,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
      <header
        className={`viz-topbar${openOverlay !== null ? " viz-topbar--overlay" : ""}`}
      >
        <div className="viz-brand">
          <Music size={20} />
          <span>Visualizer</span>
        </div>
        <div className="viz-track-selector">
          <select
            data-testid="viz-track-select"
            id="viz-track-select"
            aria-label="Select a track"
            onChange={async (e) => handleSelectLibraryTrack(e.target.value)}
            value={currentFilename || ""}
            className="viz-track-select"
          >
            <option value="" disabled>
              Select a track...
            </option>
            {libraryFiles.map((f) => {
              const ref = audioRefForFile(f);
              const name = optionLabelForFile(f);
              const meta = trackMetadata[ref];
              const badge = analysisData[ref] ? " ✓" : "";
              const metaStr = meta?.bpm ? ` (${meta.bpm} BPM)` : "";
              return (
                <option key={ref} value={ref}>
                  {name}
                  {metaStr}
                  {badge}
                </option>
              );
            })}
          </select>
          <button
            onClick={toggleAutoPlay}
            className={`viz-icon-btn ${autoPlay ? "active" : ""}`}
            aria-label={autoPlay ? "Auto-play ON" : "Auto-play OFF"}
            aria-pressed={autoPlay}
            title={
              autoPlay
                ? "Auto-play ON — tracks start automatically"
                : "Auto-play OFF — pick a track then press Play"
            }
          >
            {/* ListVideo, not Play: this toggles auto-play of the NEXT track;
                the Play glyph made it read as a duplicate transport (plan 1.1). */}
            <ListVideo size={14} />
          </button>
          {currentFilename && !currentAnalysisData && (
            <button
              className="viz-analyze-btn"
              onClick={async () => handleAnalyzeTrack(currentFilename)}
              disabled={analyzing}
              aria-describedby="viz-analyze-status"
            >
              {analyzing ? "Analyzing..." : "Analyze"}
            </button>
          )}
          <span id="viz-analyze-status" className="sr-only" aria-live="polite">
            {analyzing ? "Analyzing track..." : currentAnalysisData ? "Analysis complete" : ""}
          </span>
          {currentFilename && activeVisualPresetId && visualPresets[activeVisualPresetId] && (
            <span
              className="viz-preset-badge"
              title={`Active preset: ${visualPresets[activeVisualPresetId].name}\n${visualPresets[activeVisualPresetId].description}`}
            >
              {visualPresets[activeVisualPresetId].name}
            </span>
          )}
          {currentAnalysisData && !loadedPreset && (
            <button
              className="viz-enhance-btn"
              onClick={handleEnhanceWithAI}
              disabled={aiEnhancing}
              title="Generate AI preset tuned to this track (manual, visible)"
            >
              {aiEnhancing ? "Enhancing..." : "Enhance with AI"}
            </button>
          )}
        </div>
        <div className="viz-actions" role="toolbar" aria-label="Visualizer controls">
          <PresetFileUpload
            onPresetLoaded={handlePresetLoaded}
            loadedPresetName={loadedPreset?.name ?? null}
            onClearPreset={handleClearPreset}
          />
          <div className="viz-btn-group">
            <button
              onClick={() => {
                userPickedVizModeRef.current = true;
                setVizMode(vizMode === "3d" ? "shader" : vizMode === "shader" ? "2d" : "3d");
              }}
              className={`viz-icon-btn ${vizMode !== "3d" ? "active" : ""}`}
              title={`Mode: ${vizMode}`}
              aria-label={`Visualization mode: ${vizMode}. Activate to switch mode.`}
              aria-pressed={vizMode !== "3d"}
            >
              {vizMode === "3d" ? (
                <span style={{ fontSize: 11 }}>3D</span>
              ) : vizMode === "shader" ? (
                <span style={{ fontSize: 11 }}>FX</span>
              ) : (
                <span style={{ fontSize: 11 }}>2D</span>
              )}
            </button>
          </div>
          <div className="viz-btn-group viz-layers-group" title="Layers">
            <button
              onClick={() => setVisualsVisible((v) => !v)}
              className={`viz-icon-btn ${visualsVisible ? "active" : ""}`}
              aria-label={visualsVisible ? "Hide visuals" : "Show visuals"}
              aria-pressed={visualsVisible}
              title={`Visuals: ${visualsVisible ? "on" : "off"} — 3D/shader/2D`}
            >
              {visualsVisible ? <Layers size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              onClick={() => setLyricsVisible((v) => !v)}
              className={`viz-icon-btn viz-lyrics-btn ${lyricsVisible ? "active" : ""}`}
              aria-label={lyricsVisible ? "Hide lyrics" : "Show lyrics"}
              aria-pressed={lyricsVisible}
              title={`Lyrics: ${lyricsVisible ? "on" : "off"}${lyrics.length === 0 ? " — no lyrics loaded" : ""}`}
            >
              <MessageSquare size={14} />
            </button>
            <button
              onClick={() => setCharacterVisible((v) => !v)}
              className={`viz-icon-btn ${characterVisible ? "active" : ""}`}
              aria-label={characterVisible ? "Hide character" : "Show character"}
              aria-pressed={characterVisible}
              title={`Character: ${characterVisible ? "on" : "off"}`}
            >
              <User size={14} />
            </button>
          </div>
          <div className="viz-btn-group">
            <button
              onClick={captureFrame}
              className="viz-icon-btn"
              aria-label="Capture high-res frame snapshot (PNG)"
              title="Quick Snapshot (PNG)"
            >
              <Camera size={14} />
            </button>
            <button
              onClick={toggleFocusMode}
              className={`viz-icon-btn ${focusMode ? "active" : ""}`}
              aria-label={focusMode ? "Exit Stage Mode (F)" : "Enter Fullscreen Stage Mode (F)"}
              aria-pressed={focusMode}
              title={focusMode ? "Exit Stage Mode (F)" : "Stage / Focus Mode (F)"}
            >
              {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
          <div className="viz-btn-group">
            <button
              onClick={() => toggleOverlay("shortcuts")}
              className={`viz-icon-btn viz-shortcuts-toggle ${showShortcuts ? "active" : ""}`}
              data-viz-overlay-toggle="shortcuts"
              aria-label="Keyboard shortcuts"
              aria-expanded={showShortcuts}
              aria-pressed={showShortcuts}
              title="Keyboard shortcuts (H)"
            >
              <Keyboard size={14} />
            </button>
            {showShortcuts && (
              <div className="viz-shortcuts-menu" role="dialog" aria-label="Keyboard shortcuts">
                <div className="viz-shortcuts-title">Keyboard shortcuts</div>
                <div className="viz-shortcut-row">
                  <span>Play / pause</span>
                  <kbd>Space</kbd>
                </div>
                <div className="viz-shortcut-row">
                  <span>Cycle mode FX → 2D → 3D</span>
                  <span className="viz-shortcut-keys">
                    <kbd>←</kbd>
                    <kbd>→</kbd>
                  </span>
                </div>
                {CANVAS_2D_MODES.slice(0, 9).map((m, i) => (
                  <div className="viz-shortcut-row" key={m}>
                    <span>2D · {CANVAS_2D_MODE_LABELS[m]}</span>
                    <kbd>{i + 1}</kbd>
                  </div>
                ))}
                <div className="viz-shortcut-row">
                  <span>Focus mode</span>
                  <kbd>F</kbd>
                </div>
                <div className="viz-shortcut-row">
                  <span>Loop A–B (start / end / clear)</span>
                  <kbd>L</kbd>
                </div>
                <div className="viz-shortcut-row">
                  <span>This list</span>
                  <span className="viz-shortcut-keys">
                    <kbd>H</kbd>
                    <kbd>?</kbd>
                  </span>
                </div>
                <div className="viz-shortcut-row">
                  <span>Close list</span>
                  <kbd>Esc</kbd>
                </div>
              </div>
            )}
          </div>
          <div className="viz-btn-group">
            <button
              onClick={() => toggleOverlay("more")}
              className={`viz-icon-btn viz-more-menu-toggle ${showMoreMenu ? "active" : ""}`}
              data-testid="viz-more-toggle"
              data-viz-overlay-toggle="more"
              aria-label="More controls"
              aria-expanded={showMoreMenu}
              aria-pressed={showMoreMenu}
              title="More controls"
            >
              <MoreHorizontal size={14} />
            </button>
            {showMoreMenu && (
              <div className="viz-more-menu">
                {vizMode === "2d" && (
                  <select
                    value={canvas2DMode}
                    onChange={(e) => setCanvas2DMode(e.target.value as Canvas2DMode)}
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
                    <span className="viz-rec-dot" /> {Math.floor(recordingTime / 60)}:
                    {(recordingTime % 60).toString().padStart(2, "0")}
                  </span>
                )}
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`viz-icon-btn viz-more-item ${isRecording ? "rec" : ""}`}
                  aria-label={isRecording ? "Stop recording" : "Start recording"}
                  aria-pressed={isRecording}
                  title={isRecording ? "Stop recording" : "Start recording"}
                >
                  {isRecording ? <Square size={14} /> : <Video size={14} />}
                  <span className="viz-more-label">
                    {isRecording ? "Stop recording" : "Record"}
                  </span>
                </button>
                {/* Plan 2.9 — deterministic 10 s @ 30 fps export, exactly
                    300 frames, driven from the frame index. Shader and 2D
                    modes publish the API; 3D mode exports from the studio
                    lane's own button (it owns its clock hijack). */}
                {(vizMode === "shader" || vizMode === "2d") && (
                  <button
                    onClick={async () => startFrameAccurateExport(10)}
                    disabled={isRecording || isExporting}
                    className="viz-icon-btn viz-more-item"
                    aria-label="Export 10 seconds frame-accurate"
                    title="Export 10 s @ 30 fps frame-accurate (exactly 300 frames, deterministic)"
                  >
                    <Film size={14} />
                    <span className="viz-more-label">
                      {isExporting
                        ? `Exporting ${Math.round(exportProgress * 100)}%`
                        : "Export 10s HQ"}
                    </span>
                  </button>
                )}
                {recordedBlob && !isRecording && (
                  <button
                    onClick={downloadRecording}
                    className="viz-icon-btn viz-more-item"
                    aria-label="Download recording"
                    title="Download recording"
                  >
                    <Download size={14} />
                    <span className="viz-more-label">Download</span>
                  </button>
                )}
                <button
                  onClick={() => setShowExportModal(!showExportModal)}
                  className="viz-icon-btn viz-more-item"
                  aria-label="Export MP4"
                  title="Export MP4 (WebCodecs)"
                >
                  <Film size={14} />
                  <span className="viz-more-label">Export MP4</span>
                </button>
                <button
                  onClick={captureFrame}
                  data-testid="viz-capture-frame"
                  className="viz-icon-btn viz-more-item"
                  aria-label="Capture frame as PNG"
                  title="Capture frame as PNG"
                >
                  <Camera size={14} />
                  <span className="viz-more-label">Snapshot</span>
                </button>
                <button
                  onClick={handleLoopToggle}
                  data-testid="viz-loop-toggle"
                  className={`viz-icon-btn viz-more-item ${loopRegion ? "active" : ""}`}
                  aria-label={
                    loopRegion
                      ? `Looping ${formatTime(loopRegion.start)} to ${formatTime(loopRegion.end)} — click to clear`
                      : loopAnchor !== null
                        ? `Loop start set at ${formatTime(loopAnchor)} — click to set the end`
                        : "Loop A–B: click to set start, again for end, again to clear"
                  }
                  aria-pressed={!!loopRegion}
                  title={
                    loopRegion
                      ? `Loop ${formatTime(loopRegion.start)}–${formatTime(loopRegion.end)} — click to clear`
                      : loopAnchor !== null
                        ? `Start set at ${formatTime(loopAnchor)} — click to set end`
                        : "Loop A–B"
                  }
                >
                  <Repeat size={14} />
                  <span className="viz-more-label">
                    {loopRegion ? "Loop on" : loopAnchor !== null ? "Set end" : "Loop A–B"}
                  </span>
                </button>
                <button
                  onClick={() => setSceneFrozen(!sceneFrozen)}
                  className={`viz-icon-btn viz-more-item ${sceneFrozen ? "active" : ""}`}
                  aria-label={sceneFrozen ? "Unfreeze scene" : "Freeze scene"}
                  aria-pressed={sceneFrozen}
                  title={sceneFrozen ? "Unfreeze scene" : "Freeze scene"}
                >
                  <Snowflake size={14} />
                  <span className="viz-more-label">{sceneFrozen ? "Unfreeze" : "Freeze"}</span>
                </button>
                <button
                  onClick={toggleFocusMode}
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
                    setShowSettings(!showSettings);
                    // Menu and settings must not coexist (plan 1.3).
                    setOpenOverlay(null);
                  }}
                  className={`viz-icon-btn viz-more-item ${showSettings ? "active" : ""}`}
                  aria-label={showSettings ? "Close settings" : "Open settings"}
                  aria-pressed={showSettings}
                  title={showSettings ? "Close settings" : "Open settings"}
                >
                  <Settings size={14} />
                  <span className="viz-more-label">
                    {showSettings ? "Close settings" : "Settings"}
                  </span>
                </button>
                <button
                  onClick={() => setShowAnimDemo(!showAnimDemo)}
                  className={`viz-icon-btn viz-more-item ${showAnimDemo ? "active" : ""}`}
                  aria-label="Animation demo"
                  aria-pressed={showAnimDemo}
                  title="Animation demo"
                >
                  <Play size={14} />
                  <span className="viz-more-label">Animation demo</span>
                </button>
                <button
                  onClick={() => setShowTheatreStudio(!showTheatreStudio)}
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
                    setOpenOverlay(null);
                    setShowAIPanel(!showAIPanel);
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
                  onClick={() => setPrefersReducedMotion((p) => !p)}
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
            )}
          </div>
        </div>
      </header>

      <AnimationDemo visible={showAnimDemo} onClose={() => setShowAnimDemo(false)} />
      <TheatreStudioPanel
        visible={showTheatreStudio}
        onClose={() => setShowTheatreStudio(false)}
        activePresetId={kineticPreset}
        onPresetChange={setKineticPreset}
      />

      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Export MP4</h3>
            <p className="text-sm text-gray-400 mt-2">
              Record the visualizer canvas as an MP4 file using WebCodecs encoding.
            </p>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Format</span>
                <span className="text-white">MP4 (H.264)</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Frame Rate</span>
                <span className="text-white">60 fps</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Bitrate</span>
                <span className="text-white">8 Mbps</span>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowExportModal(false);
                  if (!isRecording) startRecording();
                }}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
              >
                Start Recording
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="viz-content">
        {/* Mode crossfade overlay */}
        <div className="viz-mode-fade" style={{ opacity: modeFade }} />
        <div className="viz-canvas-wrap" ref={containerRef}>
          {!audioUrl && !currentFilename && (
            <div
              className="viz-empty-hero"
              role="status"
              aria-label="Get started with the visualizer"
            >
              <div className="viz-empty-card">
                <div className="viz-empty-icon">
                  <Music size={28} />
                </div>
                <h3>Drop a song to see it</h3>
                <p className="viz-empty-sub">
                  Three steps — no setup. Pick a track, pick a vibe, hit play. Beat-synced shader +
                  3D + lyrics.
                </p>
                <ol className="viz-empty-steps">
                  <li>
                    <span className="viz-empty-n">1</span> <b>Pick a track</b> → choose from the
                    library above
                    {libraryFiles.length > 0
                      ? ` (${libraryFiles.length} tracks ready)`
                      : ", or upload an MP3/WAV"}
                  </li>
                  <li>
                    <span className="viz-empty-n">2</span> <b>Pick a vibe</b> → shader, 3D, or 2D
                    from the toolbar
                  </li>
                  <li>
                    <span className="viz-empty-n">3</span> Press <b>Play</b> — cuts land on beats,
                    chorus = maximal
                  </li>
                </ol>
                <div className="viz-empty-actions">
                  <button
                    className="viz-empty-cta"
                    onClick={() => document.getElementById("viz-track-select")?.focus()}
                  >
                    Choose a track…
                  </button>
                  <button
                    className="viz-empty-secondary"
                    onClick={() => setShowAudioBrowser(true)}
                  >
                    Browse files…
                  </button>
                  <a href="/audio-analysis" className="viz-empty-link">
                    Open Audio Analysis →
                  </a>
                </div>
                <p className="viz-empty-tip">
                  Tip: first 3s are the hook — start on the chorus for Shorts.
                </p>
              </div>
            </div>
          )}
          {/* Playhead + click-to-seek over the stage. Position comes from the
              reactive `elapsed` state (driven by the playback rAF loop), not the
              refs, so the marker tracks playback. The canvas paints over this
              div; only the marker and readout are pointer-events: auto so
              seeking works through the playing surface. */}
          {audioUrl && audioDuration > 0 && (
            <div
              className="viz-playhead"
              onClick={handlePlayheadClick}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.round(audioDuration)}
              aria-valuenow={Math.min(elapsed, audioDuration)}
              aria-valuetext={`${formatTime(elapsed)} of ${formatTime(audioDuration)}`}
            >
              <div className="viz-playhead-track" aria-hidden="true" />
              {audioDuration > 0 && loopRegion && (
                <div
                  className="viz-loop-region"
                  aria-hidden="true"
                  style={{
                    left: `${(loopRegion.start / audioDuration) * 100}%`,
                    width: `${((loopRegion.end - loopRegion.start) / audioDuration) * 100}%`,
                  }}
                />
              )}
              {audioDuration > 0 && loopAnchor !== null && !loopRegion && (
                <div
                  className="viz-loop-anchor"
                  aria-hidden="true"
                  style={{ left: `${(loopAnchor / audioDuration) * 100}%` }}
                />
              )}
              <div
                className="viz-playhead-marker"
                aria-hidden="true"
                style={{ left: `${Math.min(100, (elapsed / audioDuration) * 100)}%` }}
              />
              <div
                className="viz-playhead-readout"
                aria-hidden="true"
              >
                {formatTime(elapsed)} / {formatTime(audioDuration)}
              </div>
            </div>
          )}

          {showAudioBrowser && (
            <AudioFileBrowser
              onClose={() => setShowAudioBrowser(false)}
              onSelect={handleSelectLibraryTrack}
            />
          )}

          <UploadPrompt
            hasAudio={!!audioUrl}
            quiet={!audioUrl && !currentFilename}
            onFile={handleFile}
          />
          {/* Always-mounted Canvas preserves WebGL context across mode/visibility toggles */}
          <Canvas
            className="absolute inset-0"
            camera={{ position: [0, 0, 7], fov: 55 }}
            dpr={adaptiveDpr}
            frameloop="always"
            gl={createVisualizerRenderer as any}
            onCreated={handleCanvasCreated}
          >
            <PerformanceMonitor
              onDecline={() => setAdaptiveDpr([1, 1])}
              onIncline={() => setAdaptiveDpr([1, 1.5])}
              onFallback={() => setAdaptiveDpr([1, 1])}
            />
            <RenderStatsProbe
              enabled={visualsVisible && vizMode === "3d"}
              onStats={setRenderStats}
              getAudioDataAgeMs={() =>
                lastAudioDataAtRef.current !== null
                  ? performance.now() - lastAudioDataAtRef.current
                  : null
              }
            />
            <color attach="background" args={[bgColor]} />
            <VisualizerScene
              analyserRef={analyserRef}
              isPlaying={isPlaying}
              isPaused={isPaused}
              demoEnabled={demoEnabled}
              demoBpm={demoBpm}
              onAudioData={(data) => {
                liveAudioDataRef.current = data;
                const now = performance.now();
                lastAudioDataAtRef.current = now;
                if (data.beat) lastBeatAtRef.current = now;
                if (now - last3DUiUpdateRef.current > 100) {
                  last3DUiUpdateRef.current = now;
                  setLiveAudioData({
                    ...data,
                    beat: data.beat || now - lastBeatAtRef.current < BEAT_LATCH_MS,
                  });
                }
              }}
              visualizationStyle={visualizationStyle}
              vizParams={vizParams}
              bgColor={bgColor}
              meshColor={meshColor}
              analysisData={currentAnalysisData}
              audioElapsedRef={audioElapsedRef}
              sceneFrozen={sceneFrozen}
              lyrics={lyrics}
              lrcSync={lrcSync}
              storyboard={storyboard}
              prefersReducedMotion={prefersReducedMotion}
              perceptualScale={perceptualScale}
              active={visualsVisible && vizMode === "3d"}
              sampleAudio={sampleAudio}
            />
          </Canvas>
          {visualsVisible ? (
            <>
              {vizMode === "shader" && (
                <ShaderVisualizer
                  audioData={liveAudioDataRef}
                  trackName={cleanTrackName(currentFilename ?? "")}
                  trackFile={currentFilename ?? ""}
                  isPlaying={isPlaying}
                  lrcSync={lrcSync}
                  lrcSyncLive={lrcSyncLiveRef}
                  lyrics={lyrics}
                  stems={currentStemsData}
                  stemsMuted={stemsMixerState?.muted}
                  stemsVolumes={stemsMixerState?.volumes}
                  stemsProMeters={proMixerMeters || undefined}
                  sampleAudio={sampleAudio}
                  analysisData={currentAnalysisData}
                  analyserRef={analyserRef}
                  reactivity={{
                    triad: reactivityTriad,
                    gain: reactivityGain,
                    focus: frequencyFocus,
                  }}
                  fxOpen={openOverlay === "fx"}
                  onFxOpenChange={(open) => setOpenOverlay(open ? "fx" : null)}
                  activePreset={activeShaderPreset}
                  onPresetChange={setActiveShaderPreset}
                  frameAccurateApiRef={shaderFrameAccurateApiRef}
                  className="absolute inset-0"
                />
              )}
              {vizMode === "2d" && (
                <Canvas2DVisualizer
                  audioData={liveAudioDataRef}
                  analyserRef={analyserRef}
                  isPlaying={isPlaying}
                  mode={canvas2DMode}
                  lrcSync={lrcSync}
                  lrcSyncLive={lrcSyncLiveRef}
                  // Plan 2.9 — virtual frames need LRC state as a function of
                  // time, not the live snapshot (which describes *now*), and the
                  // same sampler the playing loop uses.
                  lrcSyncAt={(t) => {
                    const { lyrics: liveLyrics, sectionBounds: liveBounds } =
                      liveTimingRefs.current;
                    return liveLyrics.length
                      ? computeLrcSync(liveLyrics, t, liveBounds)
                      : null;
                  }}
                  analysisData={currentAnalysisData}
                  trackFile={currentFilename ?? null}
                  bgColor={bgColor}
                  prefersReducedMotion={prefersReducedMotion}
                  frameAccurateApiRef={canvas2dFrameAccurateApiRef}
                />
              )}
              {vizMode === "3d" && !rendererReady && (
                <div className="viz-loading-overlay">
                  <div className="viz-loading-spinner" />
                  <span>
                    Initializing{" "}
                    {rendererBackend ||
                      (gpuResult.supported && isWebGPUOptIn() ? "WebGPU" : "WebGL")}
                    ...
                  </span>
                </div>
              )}
              {vizMode === "3d" && rendererReady && (
                <div className="viz-backend-badge">{rendererBackend}</div>
              )}
              {vizMode === "3d" && rendererReady && openOverlay === null && (
                <StylePicker active={visualizationStyle} onChange={setVisualizationStyle} />
              )}
            </>
          ) : (
            <div
              className="viz-layer-hidden"
              style={{
                background: bgColor,
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, letterSpacing: 1 }}>
                Visuals hidden
              </span>
              {vizMode === "3d" && renderStats && <RenderStatsBadge stats={renderStats} />}
            </div>
          )}
          {/* Show AI preset as a custom button when loaded - visible in both modes */}
          {loadedPreset?.name && (
            <div className="viz-ai-preset-row">
              <button
                className="viz-style-btn viz-ai-preset-btn active"
                title={`AI Preset: ${loadedPreset.name}\nClick to remove`}
                onClick={handleClearPreset}
              >
                <Wand2 size={10} />
                <span className="viz-style-name">{loadedPreset.name}</span>
              </button>
            </div>
          )}
          <KineticLyricOverlay
            lyrics={lyrics}
            elapsed={elapsed}
            visible={lyricsVisible && lyrics.length > 0}
            presetId={kineticPreset}
            beat={liveAudioData.beat}
            lrcSync={lrcSync}
            audioAmplitude={liveAudioData.energy}
          />
          {/* Storyboard grammar: letterbox bars on cinematic beats.
                  Act title cards are storyboard-building UI, not visualization —
                  they never render here (see StoryActCard, used by storyboard
                  tooling). Letterbox bars are non-text visuals and stay. */}
          {visualsVisible && (
            <div className={`viz-letterbox top ${storyState.beat?.cinematic ? "on" : ""}`} />
          )}
          {visualsVisible && (
            <div className={`viz-letterbox bottom ${storyState.beat?.cinematic ? "on" : ""}`} />
          )}
          {/* Builder silhouette — separate layer, independent of lyrics (user-toggleable) */}
          <BuilderFigure
            audioData={liveAudioDataRef}
            storyBeat={storyState.beat}
            visible={characterVisible}
            calm={prefersReducedMotion}
          />

          {/* 1-Click Interactive Quick Preset & Vibe Bar */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
            <QuickPresetBar
              vizMode={vizMode}
              onVizModeChange={setVizMode}
              active3DPresetId={activeVisualPresetId}
              onSelect3DPreset={(id) => handleVisualPresetSelect(id)}
              canvas2DMode={canvas2DMode}
              onSelect2DMode={(m) => setCanvas2DMode(m)}
              activeShaderPreset={activeShaderPreset}
              onSelectShaderPreset={(sp) => setActiveShaderPreset(sp)}
            />
          </div>

          {/* Live Audio Reactivity HUD & Focus Tuning */}
          <div className="absolute bottom-12 left-3 z-40 pointer-events-auto max-w-xs">
            <ReactivityHUD
              audioData={liveAudioData}
              isPlaying={isPlaying}
              gain={reactivityGain}
              onGainChange={setReactivityGain}
              frequencyFocus={frequencyFocus}
              onFrequencyFocusChange={setFrequencyFocus}
              triad={reactivityTriad}
              onTriadChange={setReactivityTriad}
              activeGenrePresetId={activeGenrePresetId}
              onGenrePresetSelect={handleGenrePresetSelect}
              vizMode={vizMode}
            />
          </div>

          {/* Audio Latency & Frame Rate Metrics */}
          <div className="absolute top-3 right-3 z-40 pointer-events-none max-w-xs viz-latency-panel">
            <AudioLatencyCard audioCtx={audioCtxRef.current} />
            <FrameRateCard
              fps={renderStats?.fps ?? 0}
              frameTime={renderStats?.fps ? 1000 / renderStats.fps : 0}
              jankCount={0}
              droppedFrames={0}
              p95FrameTime={renderStats?.fps ? 1000 / renderStats.fps : 0}
              isMonitoring={visualsVisible}
            />
          </div>
        </div>
        {showSettings && (
          <SettingsPanel
            params={vizParams}
            onChange={setVizParams}
            bgColor={bgColor}
            meshColor={meshColor}
            onBgChange={setBgColor}
            onMeshChange={setMeshColor}
            demoEnabled={demoEnabled}
            onDemoToggle={setDemoEnabled}
            kineticPreset={kineticPreset}
            onKineticPresetChange={setKineticPreset}
            visualizationStyle={visualizationStyle}
            onVisualizationStyleChange={setVisualizationStyle}
            vizMode={vizMode}
            onVizModeChange={setVizMode}
            activeVisualPresetId={activeVisualPresetId}
            onVisualPresetSelect={handleVisualPresetSelect}
            perceptualScale={perceptualScale}
            onPerceptualScaleChange={setPerceptualScale}
          />
        )}
        {showAIPanel && (
          <AIVisualizerPrompt
            onApplyPreset={handlePresetLoaded}
            trackMeta={deriveTrackMeta(currentAnalysisData)}
            trackName={currentFilename ?? undefined}
          />
        )}
      </div>

      <footer className="viz-bottombar">
        <div className="viz-spectrum">
          <SpectrumBar label="Bass" value={liveAudioData.bass} color="#6366f1" />
          <SpectrumBar label="Mid" value={liveAudioData.mid} color="#a855f7" />
          <SpectrumBar label="Treble" value={liveAudioData.treble} color="#ec4899" />
        </div>
        <div className="viz-beat">
          <div className={`viz-beat-dot ${liveAudioData.beat ? "active" : ""}`} />
        </div>
      </footer>

      {audioUrl && (
        <div className="viz-audio-player">
          {/* Plan 1.1 — one custom transport replaces the browser's stock
              <audio controls>; the element itself stays (refs, analyser and
              keyboard map all drive it) but renders nothing. */}
          <AudioTransport audioRef={audioElRef} ariaLabel="Playback transport" className="mb-2" />
          <audio
            key={audioUrl}
            ref={audioElRef}
            src={audioUrl}
            data-main-player
            className="viz-audio"
            crossOrigin={
              audioUrl?.startsWith("http://") || audioUrl?.startsWith("https://")
                ? "anonymous"
                : undefined
            }
            onPlay={() => {
              setIsPlaying(true);
              setIsPaused(false);
              if (audioElRef.current) void setupAudio(audioElRef.current);
            }}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              setAudioDuration(Number.isFinite(d) && d > 0 ? d : 0);
            }}
            onPause={() => {
              setIsPlaying(false);
              setIsPaused(true);
            }}
            onEnded={() => {
              setIsPlaying(false);
              setIsPaused(false);
              resetAudioDerivedState();
            }}
            onError={() => {
              setIsPlaying(false);
              setError(
                `Couldn't load audio — the file may have moved. Pick another track or re-upload.`,
              );
            }}
            onCanPlay={() => {
              setError(null);
            }}
          />
          {/* Per-stem mixing (Trend 2: drums→pulse, bass→camera shake, vocals→lyric, other→palette) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseProMixer((v) => !v)}
              className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                useProMixer
                  ? "bg-violet-600/30 border-violet-500/50 text-violet-200"
                  : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
              }`}
            >
              {useProMixer ? "Professional Mixer" : "Simple Mixer"}
            </button>
          </div>
          {useProMixer && proMixerStems ? (
            <ProfessionalMixer
              audioFilename={currentFilename}
              sharedAudioContext={audioCtxRef.current}
              stems={proMixerStems}
              compact
              collapsedBuses
            />
          ) : (
            <StemMixerPanel
              audioFilename={currentFilename}
              compact
              onStateChange={setStemsMixerState}
              sharedAudioContext={audioCtxRef.current}
              mainAudioRef={audioElRef}
              mainGainRef={mainGainRef}
            />
          )}
          {currentFilename && (
            <EqualizerPanel
              title="Master EQ"
              eqRef={
                eqRef
              }
            />
          )}
          <RemixPanel currentTrack={currentFilename} />
        </div>
      )}

      {error && (
        <div className="viz-error-bar" role="alert">
          <AlertCircle size={14} />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => {
              setError(null);
              // Force the audio element to remount and retry loading.
              setAudioUrl(null);
              setTimeout(() => {
                if (currentFilename) {
                  setAudioUrl(`/api/audio/file/${encodeAudioRef(currentFilename)}`);
                }
              }, 50);
            }}
            className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
