import { useRef, useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { ensureAnalysis, getStemsAnalysis } from "../../services/api";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { AudioTransport } from "../../components/audio";
import type {
  AudioAnalysisData,
  AudioData,
  StemAnalysisData,
  VizParams,
  PerceptualScale,
} from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";
import { useUIStore } from "../../state/uiStore";
import { getVisualizationForTrack, VisualizationStyle } from "./trackConceptAnalyzer";
import { Canvas2DVisualizer } from "./Canvas2DVisualizer";
import { VisualizerScene } from "./VisualizerScene";
import { useLrcSync, computeLrcSync, computeSectionBounds } from "./useLrcSync";
import type { LrcSyncData } from "./useLrcSync";
import { type EQBand } from "./audioEQ";
import { ShaderVisualizer } from "./ShaderVisualizer";
import { ACESFilmicToneMapping } from "three";
import {
  useWebGPUDector,
  createVisualizerRenderer,
  isWebGPUOptIn,
} from "./webgpu/WebGPURendererDetector";
import { SpectrumBar } from "./components/SpectrumBar";
import { StemMixerPanel, type StemName } from "./components/StemMixer";
import { RemixPanel } from "./components/RemixPanel";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { ProfessionalMixer } from "./professionalMixer/ProfessionalMixer";
import type { ChannelMeters } from "./professionalMixer/types";
import { StylePicker } from "./components/StylePicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { UploadPrompt } from "./components/UploadPrompt";
import { PresetFileUpload } from "./components/PresetFileUpload";
import { AIVisualizerPrompt } from "./components/AIVisualizerPrompt";
import type { LyricLine } from "./components/LyricOverlay";
import { KineticLyricOverlay } from "./components/KineticLyricOverlay";
import { parseLrcContent } from "./lyricsParser";
import { AnimationDemo } from "./components/AnimationDemo";
import { TheatreStudioPanel } from "./components/TheatreStudioPanel";
import type { VisualPreset } from "./visualPreset";
import { showToast } from "../../utils/toast";
import { consumePendingTrack } from "../../utils/pendingTrack";
import { visualPresets, selectVisualPreset } from "./visualPresets";
import { resolveTrackVisualProfile, buildTunedPreset } from "./trackVisualProfiles";
import { selectPresetForTrack } from "./components/KineticPresets";
import { buildStoryboard, getStoryState, EMPTY_STORYBOARD } from "./storyboard";
import { BuilderFigure } from "./components/BuilderFigure";
import { useMCPContextSync } from "./useMCPContextSync";
import { useVisualizerRecording } from "./useVisualizerRecording";
import { useAudioGraph } from "./useAudioGraph";
import { RenderStatsProbe, RenderStatsBadge } from "./components/RenderStats";
import {
  CANVAS_2D_MODES,
  CANVAS_2D_MODE_LABELS,
  shortModeLabel,
  VIZ_MODE_ORDER,
  BEAT_LATCH_MS,
  audioRefForFile,
  optionLabelForFile,
  cleanTrackName,
  encodeAudioRef,
  clampNum,
  visualizationStyleToPresetId,
  toAnalysisData,
  toVisualPreset,
  type Canvas2DMode,
  type LibraryFile,
} from "./visualizerHelpers";

export function Visualizer() {
  const [bgColor, setBgColor] = useState("#050505");
  const [meshColor, setMeshColor] = useState("#6366f1");
  const demoBpm = 120;
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Explicit selection state — previously reverse-derived from audioUrl, which broke
  // for uploaded (blob:) URLs and any URL with query params.
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shared media-library source. `LibraryFile` consumers still work because the
  // store entries are a superset (they add `displayName`, `optionLabel`, `ref`).
  const { entries: sharedLibraryEntries } = useAudioLibrary();
  const libraryFiles = useMemo<LibraryFile[]>(
    () => sharedLibraryEntries.map((f) => ({ ...f })),
    [sharedLibraryEntries],
  );
  const [liveAudioData, setLiveAudioData] = useState<AudioData>({
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
  const [visualizationStyle, setVisualizationStyle] = useState<VisualizationStyle>("geometric");
  const [csvContent, setCsvContent] = useState<string>("");
  const [vizParams, setVizParams] = useState<VizParams>(DEFAULT_VIZ_PARAMS);
  const [trackMetadata, setTrackMetadata] = useState<
    Record<string, { bpm?: number; duration?: number }>
  >({});
  const [analysisData, setAnalysisData] = useState<Record<string, AudioAnalysisData>>({});
  const [stemsData, setStemsData] = useState<Record<string, StemAnalysisData>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [sceneFrozen, setSceneFrozen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererBackend, setRendererBackend] = useState("");
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsVisible, setLyricsVisible] = useState(true);
  const [visualsVisible, setVisualsVisible] = useState(true);
  const [characterVisible, setCharacterVisible] = useState(false);
  const [kineticPreset, setKineticPreset] = useState("cinematic");
  const [showAnimDemo, setShowAnimDemo] = useState(false);
  const [showTheatreStudio, setShowTheatreStudio] = useState(false);
  const [loadedPreset, setLoadedPreset] = useState<VisualPreset | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [vizMode, setVizMode] = useState<"3d" | "shader" | "2d">("shader"); // 2d = Canvas2D (2026 visual-flux/Waviz)
  const [modeFade, setModeFade] = useState(0);
  const prevModeRef = useRef(vizMode);
  // One definition of the mode list, in visualizerHelpers.ts. This used to be an
  // inline 12-member union that had already drifted from the picker's list (it
  // was missing `aurora`), which is how an implemented, budgeted mode ended up
  // unreachable from the UI.
  const [canvas2DMode, setCanvas2DMode] = useState<Canvas2DMode>("bars");
  const [perceptualScale, setPerceptualScale] = useState<PerceptualScale>("mel");
  // Adaptive pixel ratio (2026 perf best practice): PerformanceMonitor steps
  // down to 1x when fps regresses and restores the [1, 1.5] band on recovery.
  const [adaptiveDpr, setAdaptiveDpr] = useState<[number, number]>([1, 1.5]);
  const [renderStats, setRenderStats] = useState<{
    fps: number;
    calls: number;
    triangles: number;
  } | null>(null);
  const [aiEnhancing, setAiEnhancing] = useState(false);
  // Plan 1.3 — one floating overlay at a time. The shortcuts popover, the
  // More-controls menu and the FX panel are mutually exclusive: opening one
  // closes the others, a scrim dims the canvas, and Esc dismisses. The 3D
  // preset column hides while an overlay is open (Visualizer.tsx render).
  const [openOverlay, setOpenOverlay] = useState<"shortcuts" | "more" | "fx" | null>(
    null,
  );
  const showShortcuts = openOverlay === "shortcuts";
  const showMoreMenu = openOverlay === "more";
  const toggleOverlay = useCallback((id: "shortcuts" | "more" | "fx") => {
    setOpenOverlay((o) => (o === id ? null : id));
  }, []);
  // Single source of truth for which visual preset is currently active (fixes
  // "multiple presets appear selected" when they share visualizationStyle).
  const [activeVisualPresetId, setActiveVisualPresetId] = useState<string | null>(null);
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
  const [stemsMixerState, setStemsMixerState] = useState<{
    muted: Record<StemName, boolean>;
    volumes: Record<StemName, number>;
  } | null>(null);

  // Professional mixer state — per-stem meter data for visualization
  const [proMixerMeters, _setProMixerMeters] = useState<Record<StemName, ChannelMeters> | null>(
    null,
  );

  // Toggle between simple stem mixer and professional mixer
  const [useProMixer, setUseProMixer] = useState(false);

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
  const [elapsed, setElapsed] = useState(0);
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
    if ((gl as any)?.isWebGPURenderer) {
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
  const {
    isRecording,
    recordingTime,
    recordedBlob,
    startRecording,
    stopRecording,
    downloadRecording,
  } = useVisualizerRecording(containerRef, setError);
  // Monotonic id guarding async track-select flows against out-of-order resolves.
  const trackRequestRef = useRef(0);
  // Latest vizParams for callbacks that must not re-subscribe on every slider tick.
  const vizParamsRef = useRef(vizParams);
  vizParamsRef.current = vizParams;
  // Latest perceptual scale for the shader/2D rAF loop (which only re-subscribes
  // on mode/playback changes, not on scale changes).
  const perceptualScaleRef = useRef(perceptualScale);
  perceptualScaleRef.current = perceptualScale;
  // Throttle for the 3D scene's per-frame audio callback (mirrors the shader loop).
  const last3DUiUpdateRef = useRef(0);
  // Latest snapshot for the __VIZ_TEST__ harness without re-registering per frame.
  const testStateRef = useRef({
    vizMode,
    canvas2DMode,
    currentFilename,
    isPlaying,
    liveAudioData,
    visualizationStyle,
    kineticPreset,
    loadedPresetName: null as string | null,
    storyboard: EMPTY_STORYBOARD,
    activeVisualPresetId: null as string | null,
    visualsVisible: true,
    lyricsVisible: true,
    characterVisible: true,
  });
  const prevTestState = useRef(testStateRef.current);
  if (
    prevTestState.current.vizMode !== vizMode ||
    prevTestState.current.canvas2DMode !== canvas2DMode ||
    prevTestState.current.currentFilename !== currentFilename ||
    prevTestState.current.isPlaying !== isPlaying ||
    prevTestState.current.liveAudioData !== liveAudioData ||
    prevTestState.current.visualizationStyle !== visualizationStyle ||
    prevTestState.current.kineticPreset !== kineticPreset ||
    prevTestState.current.loadedPresetName !== (loadedPreset?.name ?? null) ||
    prevTestState.current.storyboard !== storyboard ||
    prevTestState.current.activeVisualPresetId !== activeVisualPresetId ||
    prevTestState.current.visualsVisible !== visualsVisible ||
    prevTestState.current.lyricsVisible !== lyricsVisible ||
    prevTestState.current.characterVisible !== characterVisible
  ) {
    testStateRef.current = {
      vizMode,
      canvas2DMode,
      currentFilename,
      isPlaying,
      liveAudioData,
      visualizationStyle,
      kineticPreset,
      loadedPresetName: loadedPreset?.name ?? null,
      storyboard,
      activeVisualPresetId,
      visualsVisible,
      lyricsVisible,
      characterVisible,
    };
    prevTestState.current = testStateRef.current;
  }

  // Smoothing + beat-detection state for shader-mode analyser (mirrors useRealAudio)
  const lastBeatIdxRef = useRef(-1);
  const lastBeatAtRef = useRef(0);
  // Wall-clock of the last beat frame — latches `beat: true` for throttled
  // state consumers (see BEAT_LATCH_MS). Reset per track with the other detectors.

  // Load CSV and library
  useEffect(() => {
    fetch("/track-prompts-lyrics.csv")
      .then((r) => r.text())
      .then(setCsvContent)
      .catch(() => {});
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
              [currentFilename]: data.stems as StemAnalysisData,
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

  // Parse lyrics — LRC files ONLY. No LRC means no words on the canvas:
  // the old CSV fallback painted synthetic, mistimed lines (e.g. prompt-theme
  // excerpts) over tracks that simply have no lyrics.
  // trackName is the bare base name; folder scopes the lookup to the track's
  // subfolder first (most library tracks live beside their .lrc, if any).
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
      const styleMap: Record<string, VisualizationStyle> = {
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
        setVisualizationStyle(styleMap[incoming.visualizer.style]);
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

  // Audio elapsed tracking — rAF updates ref + throttled React state for LRC sync.
  // Runs only while playing; on pause it syncs one final value and stops (was: always-on loop re-rendering ~12fps when idle).
  // Re-resolves the <audio> element on every start since key={audioUrl} remounts the node on track change.
  // Timing uses the interpolated, latency-compensated clock (see audioTiming.ts):
  // raw currentTime ticks coarsely (50–250 ms steps) and ignores output latency,
  // which is why beats and LRC pulses used to land late relative to the heard music.
  useEffect(() => {
    if (!audioUrl || !isPlaying) return;
    const el = audioElRef.current;
    if (!el) return;
    let rafId: number;
    let lastUpdate = 0;
    const track = () => {
      // Hidden tabs: rAF usually pauses, but detached/PiP windows keep
      // firing — skip sampling and re-check at low frequency.
      if (typeof document !== "undefined" && document.hidden) {
        rafId = requestAnimationFrame(track);
        return;
      }
      const heard = audioClockRef.current.sample(el, latencyRef.current);
      audioElapsedRef.current = heard;
      // Full-rate LRC state for frame-critical visuals (phrase pulses are 150 ms —
      // invisible to the ~20 fps React-state path if sampled there).
      const { lyrics: liveLyrics, sectionBounds: liveBounds } = liveTimingRefs.current;
      lrcSyncLiveRef.current = liveLyrics.length
        ? computeLrcSync(liveLyrics, heard, liveBounds)
        : null;
      const now = performance.now();
      if (now - lastUpdate > 50) {
        // ~20fps React update for lyric DOM + slow consumers
        lastUpdate = now;
        setElapsed(heard);
      }
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [audioUrl, isPlaying]);

  // Sync one final elapsed value on pause so lyrics don't freeze up to a throttle-window stale.
  // Uses the same latency-compensated clock as the playing loop — raw currentTime
  // would jump the lyrics/beat state forward by the output latency on every pause.
  useEffect(() => {
    if (!isPlaying && audioElRef.current) {
      const heard = audioClockRef.current.sample(audioElRef.current, latencyRef.current);
      audioElapsedRef.current = heard;
      setElapsed(heard);
    }
  }, [isPlaying]);

  // Revoke blob: object URLs once playback moves away from them (upload → library
  // switches previously leaked the blob until the next upload or unmount).
  const prevAudioUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevAudioUrlRef.current;
    if (prev && prev.startsWith("blob:") && prev !== audioUrl) {
      URL.revokeObjectURL(prev);
      if (objectUrlRef.current === prev) objectUrlRef.current = null;
    }
    prevAudioUrlRef.current = audioUrl;
  }, [audioUrl]);

  // Cleanup the audio object URL on unmount. AudioContext teardown is owned by
  // useAudioGraph and recorder teardown by useVisualizerRecording.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
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
      const trackFolder = fileRef.includes("/") ? fileRef.slice(0, fileRef.lastIndexOf("/")) : "";
      const cleanName = cleanTrackName(fileRef);
      let analysis: AudioAnalysisData | null = analysisData[fileRef] ?? null;
      let realBpm = trackMetadata[fileRef]?.bpm;
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
      const energy = analysis?.energy_curve?.length
        ? analysis.energy_curve.reduce((a, b) => a + b, 0) / analysis.energy_curve.length
        : 0.5;
      let kineticPresetId = selectPresetForTrack(cleanName, energy);
      // Backend decision-model fallback: if the genre heuristic fell back to the
      // generic "cinematic" default and the analysis carries a confident kinetic
      // suggestion, prefer the data-driven pick.
      if (
        kineticPresetId === "cinematic" &&
        analysis?.suggested_kinetic_preset &&
        (analysis.suggested_kinetic_preset_confidence ?? 0) > 0.6
      ) {
        kineticPresetId = analysis.suggested_kinetic_preset;
      }
      if (isStale()) return;
      setKineticPreset(kineticPresetId);

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
        analysis?.suggested_visualization &&
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

      // Store analysis for manual AI enrichment — user explicitly clicks "Enhance with AI"
      // (previous fire-and-forget auto-generation removed: it overwrote the visible preset silently)
      (window as any).__pendingAIAnalysis = analysis;
      (window as any).__pendingAICleanName = cleanName;
      (window as any).__pendingAIRealBpm = realBpm;
    },
    [analysisData, trackMetadata, parseLyricsForTrack, resetAudioDerivedState],
  );

  /** Extract track metadata for AI prompt context */
  const deriveTrackMeta = useCallback((analysis: AudioAnalysisData | null) => {
    if (!analysis) return null;
    const energyAvg = analysis.energy_curve?.length
      ? analysis.energy_curve.reduce((a, b) => a + b, 0) / analysis.energy_curve.length
      : undefined;
    return {
      bpm: analysis.tempo_bpm ? Math.round(analysis.tempo_bpm) : undefined,
      energy: energyAvg,
      duration_seconds: analysis.duration_seconds || undefined,
    };
  }, []);

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
  }, [currentAnalysisData, currentFilename, csvContent, aiEnhancing, applyPreset]);

  const [showTestPanel, setShowTestPanel] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // DEV-ONLY: the test panel dumps live state to the screen and exposes the
      // harness. It is a development affordance, so it is not reachable in a
      // production build — see the DEV guard on the harness registration below.
      if (!import.meta.env.DEV) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setShowTestPanel((v) => !v);
      }
      // Ctrl+Shift+A triggers analyze when a track is selected (mirrors the 2D canvas shortcut)
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "a" &&
        currentFilename
      ) {
        e.preventDefault();
        handleAnalyzeTrack(currentFilename);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFilename, handleAnalyzeTrack]);

  // Stage keyboard map — "instruments are played, not clicked".
  // Kept in a separate listener so the Ctrl+Shift+T / Ctrl+Shift+A shortcuts
  // above are untouched.
  const togglePlayPause = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    // onPlay/onPause on the <audio> element sync isPlaying/isPaused state.
    if (el.paused)
      void el.play().catch(() => {
        /* autoplay blocked: user gesture required */
      });
    else el.pause();
  }, []);

  const cycleVizMode = useCallback((dir: 1 | -1) => {
    setVizMode((m) => {
      const i = VIZ_MODE_ORDER.indexOf(m);
      return VIZ_MODE_ORDER[(i + dir + VIZ_MODE_ORDER.length) % VIZ_MODE_ORDER.length];
    });
  }, []);

  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el || typeof el.tagName !== "string") return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "select" || tag === "textarea" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // Leave modified shortcuts (Ctrl+Shift+T test panel, Ctrl+Shift+A analyze) alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Never hijack typing.
      if (isTypingTarget(e.target)) return;
      const k = e.key;
      if (k === " ") {
        // preventDefault stops page scroll and cancels focused-button activation.
        e.preventDefault();
        togglePlayPause();
      } else if (k === "ArrowRight") {
        e.preventDefault();
        cycleVizMode(1);
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        cycleVizMode(-1);
      } else if (k >= "1" && k <= "9") {
        // Jump to a 2D mode and switch to 2D so the keypress visibly does something.
        setVizMode("2d");
        setCanvas2DMode(CANVAS_2D_MODES[Number(k) - 1]);
      } else if (k === "f" || k === "F") {
        toggleFocusMode();
      } else if (k === "h" || k === "H" || k === "?") {
        toggleOverlay("shortcuts");
      } else if (k === "Escape") {
        setOpenOverlay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlayPause, cycleVizMode, toggleFocusMode, toggleOverlay]);

  // Plan 1.3 — a single outside-click dismisser replaces the two per-menu
  // listeners (shortcuts / more). Clicks on the toggles themselves, on the
  // open menu, or inside the shader HUD (FX panel + preset dropdown) are
  // allowed through; anything else — including the scrim — closes the overlay.
  useEffect(() => {
    if (openOverlay === null) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          ".viz-shortcuts-menu, .viz-more-menu, .viz-shader-hud, [data-viz-overlay-toggle]",
        )
      ) {
        return;
      }
      setOpenOverlay(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openOverlay]);

  // Mode crossfade: brief black fade when switching visualization modes
  useEffect(() => {
    if (prevModeRef.current !== vizMode) {
      prevModeRef.current = vizMode;
      // Fade to black
      setModeFade(1);
      // At peak opacity, start fading back in (content swaps naturally mid-fade)
      const t = setTimeout(() => setModeFade(0), 180);
      return () => clearTimeout(t);
    }
  }, [vizMode]);

  // Respect OS reduced-motion preference and allow manual toggle
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setPrefersReducedMotion(e.matches);
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    // Registered once: getState reads from a ref so per-frame audio updates don't
    // re-register the harness 10–60×/sec (was in deps via liveAudioData).
    //
    // DEV-ONLY. This harness was unguarded and shipped in the production
    // bundle, where `window.__VIZ_TEST__` let anyone with a devtools console
    // load an arbitrary library track and drive every render mode and layer.
    // Playwright runs against the Vite dev server, so `import.meta.env.DEV` is
    // true there and every spec keeps working. `import.meta.env` is statically
    // replaced at build time, so the whole block is dropped from the production
    // bundle rather than merely skipped at runtime.
    if (!import.meta.env.DEV) return;
    (window as any).__VIZ_TEST__ = {
      selectTrack: (filename: string) => handleSelectLibraryTrack(filename),
      setMode: (mode: "3d" | "shader" | "2d") => setVizMode(mode),
      set2DMode: (mode: Canvas2DMode) => setCanvas2DMode(mode),
      getState: () => ({ ...testStateRef.current }),
      toggleTestPanel: () => setShowTestPanel((v) => !v),
      setLayerVisible: (layer: "visuals" | "lyrics" | "character", v: boolean) => {
        if (layer === "visuals") setVisualsVisible(v);
        if (layer === "lyrics") setLyricsVisible(v);
        if (layer === "character") setCharacterVisible(v);
      },
      toggleLayer: (layer: "visuals" | "lyrics" | "character") => {
        if (layer === "visuals") setVisualsVisible((x) => !x);
        if (layer === "lyrics") setLyricsVisible((x) => !x);
        if (layer === "character") setCharacterVisible((x) => !x);
      },
    };
    return () => {
      delete (window as any).__VIZ_TEST__;
    };
  }, [handleSelectLibraryTrack]);

  // Media Library handoff: auto-select a pending track exactly once. The handoff
  // may carry a bare filename while the library entry lives in a subfolder, so
  // resolve against the loaded library (by ref or bare name) before selecting.
  const [pendingTrack, setPendingTrack] = useState<string | null>(null);
  useEffect(() => {
    const pending = consumePendingTrack();
    if (pending) setPendingTrack(pending);
  }, []);
  useEffect(() => {
    if (!pendingTrack || libraryFiles.length === 0) return;
    const match = libraryFiles.find(
      (f) => audioRefForFile(f) === pendingTrack || f.filename === pendingTrack,
    );
    handleSelectLibraryTrack(match ? audioRefForFile(match) : pendingTrack);
    setPendingTrack(null);
  }, [pendingTrack, libraryFiles, handleSelectLibraryTrack]);

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
                onChange={(e) => handleSelectLibraryTrack(e.target.value)}
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
              <select value={vizMode} onChange={(e) => setVizMode(e.target.value as any)}>
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
            onChange={(e) => handleSelectLibraryTrack(e.target.value)}
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
              onClick={() => handleAnalyzeTrack(currentFilename)}
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
              onClick={() =>
                setVizMode(vizMode === "3d" ? "shader" : vizMode === "shader" ? "2d" : "3d")
              }
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
                  onClick={() => setShowAIPanel(!showAIPanel)}
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
                    onClick={() => document.getElementById("viz-file-input")?.click()}
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
                  fxOpen={openOverlay === "fx"}
                  onFxOpenChange={(open) => setOpenOverlay(open ? "fx" : null)}
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
                  bgColor={bgColor}
                  prefersReducedMotion={prefersReducedMotion}
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
                eqRef as React.MutableRefObject<{
                  setBands: (bands: EQBand[]) => void;
                  applyPreset: (name: string) => void;
                } | null>
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
