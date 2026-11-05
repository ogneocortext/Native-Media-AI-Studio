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
import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  setPendingTrack as handoffPendingTrack,
  setPendingRemixOpen,
} from "../../utils/pendingTrack";
import { Canvas } from "@react-three/fiber";
import {
  AlertCircle,
  Wand2,
} from "lucide-react";
import { ensureAnalysis, getStemsAnalysis } from "../../services/api";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { AudioFileBrowser } from "./components/AudioFileBrowser";
import { AudioLatencyCard } from "../../components/AudioLatencyCard";
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
import type { StemName } from "./components/StemMixer";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { StylePicker } from "./components/StylePicker";
import { QuickPresetBar } from "./components/QuickPresetBar";
import { ReactivityHUD } from "./components/ReactivityHUD";
import { VizFooter } from "./components/VizFooter";
import { VizEmptyState } from "./components/VizEmptyState";
import { VizTopbar } from "./components/VizTopbar";
import { VizToolbar } from "./components/VizToolbar";
import { VizInspector, type VizInspectorTab } from "./components/VizInspector";
import { useVisualizerTrackEffects } from "./useVisualizerTrackEffects";
import { VizAudioBar } from "./components/VizAudioBar";
import { VizMixerTab } from "./components/VizMixerTab";
import { VizPlayhead } from "./components/VizPlayhead";
import { PresetFileUpload } from "./components/PresetFileUpload";
import {
  matchReactivityGenrePreset,
} from "./reactivityGenrePresets";
import { SettingsPanel } from "./components/SettingsPanel";
import { UploadPrompt } from "./components/UploadPrompt";
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
import { RenderStatsProbe, RenderStatsBadge, QualityGovernorProbe } from "./components/RenderStats";
import {
  CANVAS_2D_MODES,
  CANVAS_2D_MODE_LABELS,
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
    showAnimDemo, setShowAnimDemo,
    showTheatreStudio, setShowTheatreStudio,
    showExportModal, setShowExportModal,
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
  const {
    entries: sharedLibraryEntries,
    isLoading: libraryLoading,
    error: libraryError,
    refresh: refreshLibrary,
  } = useAudioLibrary();
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
  // The playback rAF loop reads the region through this ref (stable identity);
  // without the sync the A-B loop painted its UI but never wrapped.
  useEffect(() => {
    loopRegionRef.current = loopRegion;
  }, [loopRegion]);

  const prevModeRef = useRef(vizMode);
  // --- Stage chrome auto-hide ---
  // During playback the stage overlays (preset bar, latency card, style
  // picker, spectrum footer) fade out after a short idle so the visuals get
  // the full frame. Any pointer movement over the canvas reveals them again;
  // the pin button in the toolbar keeps them visible permanently.
  const [chromePinned, setChromePinned] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeIdleTimer = useRef<number | undefined>(undefined);
  // --- Tabbed inspector drawer ---
  // Replaces the old always-on settings aside, AI prompt panel and the
  // bottom-bar mixer/EQ/remix stack: one docked drawer, one tab at a time.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<VizInspectorTab>("scene");
  // T-VIZ-18 — governor-driven quality: DPR ladder + postfx gate.
  const [postfxEnabled, setPostfxEnabled] = useState(true);

  // Stage-chrome auto-hide: arm the idle timer whenever playback state or
  // the pin changes; pointer movement over the canvas re-arms it via
  // revealStageChrome below.
  useEffect(() => {
    window.clearTimeout(chromeIdleTimer.current);
    if (!isPlaying || chromePinned) {
      setChromeVisible(true);
      return;
    }
    chromeIdleTimer.current = window.setTimeout(
      () => setChromeVisible(false),
      2600,
    );
    return () => window.clearTimeout(chromeIdleTimer.current);
  }, [isPlaying, chromePinned]);

  const revealStageChrome = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(chromeIdleTimer.current);
    if (isPlaying && !chromePinned) {
      chromeIdleTimer.current = window.setTimeout(
        () => setChromeVisible(false),
        2600,
      );
    }
  }, [isPlaying, chromePinned]);

  const navigate = useNavigate();
  // Mashup building lives on /create/remix — the visualizer only previews.
  // The pending-track + pending-open handoffs carry this track over so the
  // studio opens on the same song with the panel expanded (same mechanism
  // Media Library's LineagePanel uses in reverse).
  const openRemixStudio = useCallback(() => {
    if (currentFilename) handoffPendingTrack(currentFilename);
    setPendingRemixOpen();
    navigate("/create/remix");
  }, [currentFilename, navigate]);
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
      vocals: currentStemsData.vocals?.url ?? "",
      drums: currentStemsData.drums?.url ?? "",
      bass: currentStemsData.bass?.url ?? "",
      other: currentStemsData.other?.url ?? "",
    };
    return Object.values(stems).some((v) => v) ? stems : null;
  }, [currentStemsData, currentFilename]);

  const audioElapsedRef = useRef(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Shared Web Audio graph (context + EQ + analyser + gain). Owns setup/reset/teardown.
  const {
    audioCtxRef,
    analyserRef,
    transientRef,
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
      energy: currentAnalysisData?.energy_curve.length
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
      // WebGPU renderer (Three.js r185) handles tone mapping via TSL node materials;
      // ACESFilmicToneMapping is supported on both backends.
      try {
        gl.toneMapping = ACESFilmicToneMapping;
      } catch {
        /* WebGPU tone mapping handled by TSL pipeline */
      }
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
      setModeFade,
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
        const analysis = toAnalysisData(result.analysis);
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

  // Track/audio side-effects: lazy stems fetch, auto-play on select, and
  // playback resume across a track switch (extracted — T-VIZ-33).
  useVisualizerTrackEffects({
    state: {
      currentFilename,
      vizMode,
      inspectorOpen,
      inspectorTab,
      audioUrl,
      autoPlay,
      isPlaying,
    },
    refs: { audioElRef },
    setters: { setStemsData },
    api: { getStemsAnalysis },
  });



  // (was: always-on loop re-rendering ~12fps when idle).


  // A-B loop and lifecycle handlers now live in useVisualizerLifecycle (T-VIZ-13).

  // Media Library handoff: auto-select a pending track exactly once. The handoff
  // may carry a bare filename while the library entry lives in a subfolder, so
  // resolve against the loaded library (by ref or bare name) before selecting.

  return (
    <div
      className={`viz-page ${focusMode ? "viz-focus-mode" : ""} ${chromeVisible ? "" : "viz-chrome-hidden"}`}
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
                aria-label="Select track"
                onChange={async (e) => handleSelectLibraryTrack(e.target.value)}
                value={currentFilename ?? ""}
              >
                <option value="" disabled>
                  Select a track...
                </option>
                {libraryFiles.map((f) => {
                  const ref = audioRefForFile(f);
                  return (
                    <option key={ref} value={ref}>
                      {optionLabelForFile(f)}
                      {trackMetadata[ref]?.bpm ? ` (${trackMetadata[ref].bpm} BPM)` : ""}
                      {analysisData[ref] ? " ✓" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
              <label>
                Mode
                <select
                  aria-label="Visualization mode"
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
                    aria-label="2D canvas mode"
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
        <VizTopbar
          openOverlay={openOverlay !== null}
          currentFilename={currentFilename}
          libraryFiles={libraryFiles}
          onSelectTrack={handleSelectLibraryTrack}
          autoPlay={autoPlay}
          onToggleAutoPlay={toggleAutoPlay}
          analyzing={analyzing}
          onAnalyzeTrack={handleAnalyzeTrack}
          currentAnalysisData={currentAnalysisData}
          trackMetadata={trackMetadata}
          analysisData={analysisData}
          activeVisualPresetId={activeVisualPresetId}
          visualPresets={visualPresets}
          onEnhanceWithAI={handleEnhanceWithAI}
          aiEnhancing={aiEnhancing}
          loadedPreset={loadedPreset}
          libraryLoading={libraryLoading}
          libraryError={libraryError}
          onBrowseLibrary={() => setShowAudioBrowser(true)}
        />
        <VizToolbar
          vizMode={vizMode}
          onSelectMode={(m) => {
            userPickedVizModeRef.current = true;
            setVizMode(m);
          }}
          visualsVisible={visualsVisible}
          onToggleVisuals={() => setVisualsVisible((v) => !v)}
          lyricsVisible={lyricsVisible}
          onToggleLyrics={() => setLyricsVisible((v) => !v)}
          lyricsLength={lyrics.length}
          characterVisible={characterVisible}
          onToggleCharacter={() => setCharacterVisible((v) => !v)}
          onCaptureFrame={captureFrame}
          focusMode={focusMode}
          onToggleFocus={toggleFocusMode}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
          chromePinned={chromePinned}
          onToggleChromePin={() => setChromePinned((v) => !v)}
          onOpenRemixStudio={openRemixStudio}
          showShortcuts={showShortcuts}
          onToggleShortcuts={() => toggleOverlay("shortcuts")}
          showMoreMenu={showMoreMenu}
          onToggleMore={() => toggleOverlay("more")}
          canvas2DMode={canvas2DMode}
          onSelect2DMode={(m) => setCanvas2DMode(m)}
          isRecording={isRecording}
          recordingTime={recordingTime}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onExportFrameAccurate={(seconds) => startFrameAccurateExport(seconds)}
          isExporting={isExporting}
          exportProgress={exportProgress}
          recordedBlob={recordedBlob}
          onDownloadRecording={downloadRecording}
          onToggleExportModal={() => setShowExportModal(!showExportModal)}
          onToggleLoop={handleLoopToggle}
          loopRegion={loopRegion}
          loopAnchor={loopAnchor}
          sceneFrozen={sceneFrozen}
          onToggleSceneFrozen={() => setSceneFrozen(!sceneFrozen)}
          onToggleFocusFromMenu={toggleFocusMode}
          onToggleSettings={() => {
            setInspectorTab("scene");
            setInspectorOpen(true);
            setOpenOverlay(null);
          }}
          showSettings={inspectorOpen && inspectorTab === "scene"}
          onToggleAnimDemo={() => setShowAnimDemo(!showAnimDemo)}
          showAnimDemo={showAnimDemo}
          onToggleTheatre={() => setShowTheatreStudio(!showTheatreStudio)}
          showTheatreStudio={showTheatreStudio}
          onToggleAIPanel={() => {
            setInspectorTab("ai");
            setInspectorOpen(true);
          }}
          showAIPanel={inspectorOpen && inspectorTab === "ai"}
          onCloseOverlay={() => setOpenOverlay(null)}
          prefersReducedMotion={prefersReducedMotion}
          onToggleReducedMotion={() => setPrefersReducedMotion((p) => !p)}
        />
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
                  if (!isRecording) void startRecording();
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
        <div
          className="viz-canvas-wrap"
          ref={containerRef}
          onPointerMove={revealStageChrome}
        >
          {!audioUrl && !currentFilename && (
            <VizEmptyState
              libraryFiles={libraryFiles}
              onBrowse={() => setShowAudioBrowser(true)}
              libraryLoading={libraryLoading}
              libraryError={libraryError}
              onRetryLibrary={() => void refreshLibrary()}
            />
          )}
          {/* Playhead + click-to-seek over the stage (VizPlayhead). */}
          {audioUrl && (
            <VizPlayhead
              elapsed={elapsed}
              audioDuration={audioDuration}
              loopRegion={loopRegion}
              loopAnchor={loopAnchor}
              onSeek={handlePlayheadClick}
            />
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
            <QualityGovernorProbe
              onLevel={(dpr, postfx) => {
                setAdaptiveDpr([1, dpr]);
                setPostfxEnabled(postfx);
              }}
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
              transientRef={transientRef}
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
              postfxEnabled={postfxEnabled}
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
                  stemsProMeters={proMixerMeters ?? undefined}
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
                  transientRef={transientRef}
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
              {/* Renderer backend + live stats render inside the latency
                  panel column below (viz-stats-stack) — keeping them here
                  would collide with the AudioLatencyCard at top-right. */}
              {vizMode === "3d" && rendererReady && openOverlay === null && (
                <StylePicker active={visualizationStyle} onChange={setVisualizationStyle} />
              )}
            </>
          )         : (
            <div className="viz-layer-hidden" style={{ background: bgColor }}>
              <span className="viz-layer-hidden-label">Visuals hidden</span>
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
              showModeSwitch={false}
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

          {/* Audio Latency card — the R3F probe only runs in 3D mode, so FPS
              telemetry lives in the canvas stats stack (RenderStatsBadge)
              instead of a card with fabricated jank/drop metrics. */}
          <div className="absolute top-3 right-3 z-40 pointer-events-none max-w-xs viz-latency-panel">
            <AudioLatencyCard audioCtxRef={audioCtxRef} />
            {vizMode === "3d" && rendererReady && (
              <div className="viz-stats-stack">
                <div className="viz-backend-badge">{rendererBackend}</div>
                {renderStats && <RenderStatsBadge stats={renderStats} />}
              </div>
            )}
          </div>
        </div>
        {/* Tabbed inspector — one docked drawer hosts scene settings,
            reactivity tuning, stem mixer, master EQ, remix and the AI
            preset tools. Panels stay mounted while the drawer is open so
            mixer/audio-graph state survives tab switches; the drawer
            unmounts when closed, which also gates RemixPanel's probes. */}
        <VizInspector
          open={inspectorOpen}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          trackLoaded={!!currentFilename}
          panels={{
            scene: (
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
            ),
            tuning: (
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
            ),
            mixer: (
              <VizMixerTab
                useProMixer={useProMixer}
                onToggleProMixer={() => setUseProMixer((v) => !v)}
                proMixerStems={proMixerStems}
                currentFilename={currentFilename}
                audioCtx={audioCtxRef.current}
                onMixerStateChange={setStemsMixerState}
                audioElRef={audioElRef}
                mainGainRef={mainGainRef}
                onOpenRemixStudio={openRemixStudio}
              />
            ),
            eq: currentFilename ? (
              <EqualizerPanel title="Master EQ" eqRef={eqRef} />
            ) : null,
            ai: (
              <div className="viz-inspector-ai">
                <PresetFileUpload
                  onPresetLoaded={handlePresetLoaded}
                  loadedPresetName={loadedPreset?.name ?? null}
                  onClearPreset={handleClearPreset}
                />
                <AIVisualizerPrompt
                  onApplyPreset={handlePresetLoaded}
                  trackMeta={deriveTrackMeta(currentAnalysisData)}
                  trackName={currentFilename ?? undefined}
                />
              </div>
            ),
          }}
        />
      </div>

      {audioUrl && (
        <VizAudioBar
          audioUrl={audioUrl}
          audioElRef={audioElRef}
          setupAudio={setupAudio}
          setIsPlaying={setIsPlaying}
          setIsPaused={setIsPaused}
          setAudioDuration={setAudioDuration}
          setError={setError}
          resetAudioDerivedState={resetAudioDerivedState}
        />
      )}

      {/* Spectrum meters sit above the transport so play/pause stays the
          bottom-most, thumb-reachable control. */}
      <VizFooter audioData={liveAudioData} />

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
