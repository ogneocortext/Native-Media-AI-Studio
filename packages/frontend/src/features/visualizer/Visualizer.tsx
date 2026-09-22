import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { Music, AlertCircle, Maximize2, Minimize2, Video, Square, Download, Settings, Snowflake, MessageSquare, Sparkles, Play, Wand2, Accessibility, EyeOff, User, Layers, MoreHorizontal } from "lucide-react";
import { listAudioFiles, ensureAnalysis } from "../../services/api";
import type { AudioAnalysisData, AudioData, VizParams, PerceptualScale } from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";
import { useUIStore } from "../../state/uiStore";
import { getVisualizationForTrack, VisualizationStyle } from "./trackConceptAnalyzer";
import { Canvas2DVisualizer } from "./Canvas2DVisualizer";
import { VisualizerScene } from "./VisualizerScene";
import { useLrcSync, computeLrcSync, computeSectionBounds } from "./useLrcSync";
import type { LrcSyncData } from "./useLrcSync";
import { ANALYSER_SMOOTHING, createAudioClock, estimateOutputLatency } from "./audioTiming";
import { ShaderVisualizer } from "./ShaderVisualizer";
import { ACESFilmicToneMapping } from "three";
import { useWebGPUDector, createVisualizerRenderer, isWebGPUOptIn } from "./webgpu/WebGPURendererDetector";
import { SpectrumBar } from "./components/SpectrumBar";
import { StemMixerPanel } from "./components/StemMixer";
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
import { selectPresetForTrack } from "./components/KineticPresets";
import { buildStoryboard, getStoryState, EMPTY_STORYBOARD } from "./storyboard";
import { BuilderFigure } from "./components/BuilderFigure";
import { useMCPContextSync } from "./useMCPContextSync";
import { canRecordMp4, createMp4Recorder } from "./mp4Recording";

/** A library entry — `filename` is the bare name; the playable/analyzable
 *  reference is `relative_path` (subfolder-aware). Most of the library lives
 *  in subfolders, so bare names 404 on /api/audio/file/*. */
interface LibraryFile {
  filename: string;
  path?: string;
  relative_path?: string;
  folder?: string;
}

/** Canonical backend reference for a library file (POSIX, subfolder-aware). */
function audioRefForFile(f: LibraryFile): string {
  return (f.relative_path || f.path || f.filename).replace(/\\/g, "/");
}

/** Strip any folder prefix: "Suno-V6-Mini/track.m4a" → "track.m4a". */
function baseNameOfRef(ref: string): string {
  const base = ref.split("/").pop() ?? ref;
  return base || ref;
}

/** Human display name: no folders, hash prefixes, or extension. */
function displayNameForFile(f: LibraryFile): string {
  return baseNameOfRef(audioRefForFile(f)).replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "");
}

/** Encode a backend file reference segment-wise (keeps folder slashes intact). */
function encodeAudioRef(ref: string): string {
  return ref.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

/** How long a beat stays lit for throttled (React-state) consumers.
 *  Per-frame producers raise `beat` for a single 16 ms frame (shader/2D loop)
 *  while state mirrors update at ~10 Hz — without latching, the footer beat
 *  dot and lyric beat pulses miss most beats and fire up to 100 ms late.
 *  Kept at 80 ms (not longer): measured beat grids run dense double-time
 *  (~190–270 ms spacing), so a longer latch saturates the dot instead of
 *  flashing per beat. */
const BEAT_LATCH_MS = 80;

/** Clamp a number into [min, max]; falls back to `fallback` when not finite. */
function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Narrow an unknown backend payload to AudioAnalysisData; null when unusable. */
function toAnalysisData(raw: unknown): AudioAnalysisData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tempo_bpm !== "number" || typeof r.duration_seconds !== "number") return null;
  if (!Array.isArray(r.beat_times) || !Array.isArray(r.energy_curve)) return null;

  const spectralCentroid = Array.isArray(r.spectral_centroid)
    ? r.spectral_centroid.filter((v): v is number => typeof v === "number")
    : undefined;
  const spectralRolloff = Array.isArray(r.spectral_rolloff)
    ? r.spectral_rolloff.filter((v): v is number => typeof v === "number")
    : undefined;
  const spectralBandwidth = Array.isArray(r.spectral_bandwidth)
    ? r.spectral_bandwidth.filter((v): v is number => typeof v === "number")
    : undefined;
  const zeroCrossingRate = Array.isArray(r.zero_crossing_rate)
    ? r.zero_crossing_rate.filter((v): v is number => typeof v === "number")
    : undefined;

  return {
    tempo_bpm: r.tempo_bpm,
    beat_count: typeof r.beat_count === "number" ? r.beat_count : r.beat_times.length,
    beat_times: r.beat_times,
    onset_times: Array.isArray(r.onset_times) ? r.onset_times : [],
    energy_curve: r.energy_curve,
    amplitude_envelope: Array.isArray(r.amplitude_envelope) ? r.amplitude_envelope : [],
    sections: Array.isArray(r.sections)
      ? r.sections
      : [],
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
    duration_seconds: r.duration_seconds,
    spectral_centroid: spectralCentroid,
    spectral_rolloff: spectralRolloff,
    spectral_bandwidth: spectralBandwidth,
    zero_crossing_rate: zeroCrossingRate,
    timing_contract: r.timing_contract as AudioAnalysisData["timing_contract"],
    suggested_visualization: typeof r.suggested_visualization === "string" ? r.suggested_visualization : undefined,
    suggested_kinetic_preset: typeof r.suggested_kinetic_preset === "string" ? r.suggested_kinetic_preset : undefined,
    suggested_theme_seed: typeof r.suggested_theme_seed === "string" ? r.suggested_theme_seed : undefined,
  };
}

/** Narrow an unknown backend payload to a VisualPreset; null when unusable. */
function toVisualPreset(raw: unknown): VisualPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string") return null;
  return raw as VisualPreset;
}


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
  const [libraryFiles, setLibraryFiles] = useState<LibraryFile[]>([]);
  const [liveAudioData, setLiveAudioData] = useState<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0, drumType: null, nextBeatIn: 0 });
  const liveAudioDataRef = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0, drumType: null, nextBeatIn: 0 });
  const [visualizationStyle, setVisualizationStyle] = useState<VisualizationStyle>("geometric");
  const [csvContent, setCsvContent] = useState<string>("");
  const [vizParams, setVizParams] = useState<VizParams>(DEFAULT_VIZ_PARAMS);
  const [trackMetadata, setTrackMetadata] = useState<Record<string, { bpm?: number; duration?: number }>>({});
  const [analysisData, setAnalysisData] = useState<Record<string, AudioAnalysisData>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [sceneFrozen, setSceneFrozen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererBackend, setRendererBackend] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
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
  const [canvas2DMode, setCanvas2DMode] = useState<"bars" | "mirrored-bars" | "segmented-led-bars" | "stereo-split-bars" | "stacked-frequency-bands" | "dot-peak-matrix" | "waveform" | "radial" | "spectrogram" | "lissajous" | "constellation" | "particles">("bars");
  const [perceptualScale, setPerceptualScale] = useState<PerceptualScale>("mel");
  // Adaptive pixel ratio (2026 perf best practice): PerformanceMonitor steps
  // down to 1x when fps regresses and restores the [1, 1.5] band on recovery.
  const [adaptiveDpr, setAdaptiveDpr] = useState<[number, number]>([1, 1.5]);
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
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

  const currentAnalysisData = currentFilename ? analysisData[currentFilename] ?? null : null;
  const currentAnalysisDataRef = useRef(currentAnalysisData);
  currentAnalysisDataRef.current = currentAnalysisData;

  const audioElapsedRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // LRC sync for precise phrase-synchronized visuals — now reactive via elapsed state
  const lrcSync = useLrcSync(lyrics, elapsed);
  // Storyboard: LRC sections + analysis energy → narrative beats (acts).
  // Rebuilds per track/lyrics/analysis; state lookup below runs at lyric-DOM rate.
  const storyboard = useMemo(() => buildStoryboard(
    baseNameOfRef(currentFilename ?? "").replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a|lrc)$/i, "") || "untitled",
    lyrics,
    currentAnalysisData,
  ), [currentFilename, lyrics, currentAnalysisData]);
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
      energy: currentAnalysisData?.energy_curve?.length ? currentAnalysisData.energy_curve.reduce((a, b) => a + b, 0) / currentAnalysisData.energy_curve.length : undefined,
      beat: false,
    },
  });
  // Handle Canvas onCreated
  const handleCanvasCreated = useCallback(({ gl }: { gl: any }) => {
    if ((gl as any)?.isWebGPURenderer) {
      setRendererBackend("WebGPU");
    } else {
      gl.toneMapping = ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.05;
      setRendererBackend("WebGL2");
    }
    setRendererReady(true);
  }, []);
  // Interpolated, latency-compensated audio clock (see audioTiming.ts).
  const audioClockRef = useRef(createAudioClock());
  const latencyRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mp4RecorderRef = useRef<ReturnType<typeof createMp4Recorder> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const recordingFormatRef = useRef<"webm" | "mp4">("webm");
  const freqArrayRef = useRef<Uint8Array | null>(null);
  const connectedElements = useRef<WeakSet<HTMLMediaElement>>(new WeakSet());
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
  const testStateRef = useRef({ vizMode, canvas2DMode, currentFilename, isPlaying, liveAudioData, visualizationStyle, kineticPreset, loadedPresetName: null as string | null, storyboard: EMPTY_STORYBOARD, activeVisualPresetId: null as string | null, visualsVisible: true, lyricsVisible: true, characterVisible: true });
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
    testStateRef.current = { vizMode, canvas2DMode, currentFilename, isPlaying, liveAudioData, visualizationStyle, kineticPreset, loadedPresetName: loadedPreset?.name ?? null, storyboard, activeVisualPresetId, visualsVisible, lyricsVisible, characterVisible };
    prevTestState.current = testStateRef.current;
  }

  // Smoothing + beat-detection state for shader-mode analyser (mirrors useRealAudio)
  const lastBeatIdxRef = useRef(-1);
  const lastBeatAtRef = useRef(0);
  // Wall-clock of the last beat frame — latches `beat: true` for throttled
  // state consumers (see BEAT_LATCH_MS). Reset per track with the other detectors.

  // Load CSV and library
  useEffect(() => { fetch("/track-prompts-lyrics.csv").then(r => r.text()).then(setCsvContent).catch(() => {}); }, []);
  useEffect(() => { listAudioFiles().then(files => { if (Array.isArray(files) && files.length > 0) setLibraryFiles(files); }).catch(() => {}); }, []);

  // Auto-play when a track is selected, if the setting is enabled.
  // Uses a small delay so the <audio key={audioUrl}> remount completes
  // and the browser sees the play() as part of the active user gesture chain.
  useEffect(() => {
    if (!audioUrl || !autoPlay) return;
    const timer = setTimeout(() => {
      const el = audioElRef.current;
      if (el) {
        el.play().then(() => {
          // onPlay will fire and run setupAudio()
        }).catch(() => {
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
  const parseLyricsForTrack = useCallback(async (trackName: string, folder?: string): Promise<LyricLine[]> => {
    if (!trackName) return [];

    // Ensure the filename has .lrc extension
    const lrcBase = trackName.endsWith(".lrc") ? trackName :
      trackName.replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") + ".lrc";
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
  }, []);

  // Apply preset callback - defined early because handlePresetLoaded depends on it.
  // Never mutates the input preset: shared catalog entries (visualPresets) and
  // state-held objects must not absorb per-track alignment data.
  const applyPreset = useCallback((preset: VisualPreset, trackAnalysis?: AudioAnalysisData | null) => {
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
    const vignetteStrength = clampNum(postfx.vignetteStrength, 0, 1, 0);
    const glitchAmount = clampNum(postfx.glitch, 0, 1, 0);

    // Apply visualizer params with track alignment + postfx (all numerics clamped —
    // AI-generated presets are unvalidated backend output and previously could yield
    // NaN particle counts or scene-killing extremes).
    setVizParams(prev => ({
      ...prev,
      particleCount: Math.round(clampNum(incoming.visualizer?.particleCount ?? prev.particleCount, 50, 2000, prev.particleCount) * clampNum(energyFactor, 0.5, 1.5, 1)),
      scale: clampNum(incoming.visualizer?.scale ?? prev.scale, 0.1, 5, prev.scale),
      glowIntensity: incoming.visualizer?.glow ? Math.min(1.0, 0.8 * energyFactor + bloomIntensity * 0.2) : 0.2,
      rotationSpeed: clampNum((incoming.visualizer?.rotation ? 1.0 : 0.0) * bpmFactor, -5, 5, 0),
      colorShift: clampNum(incoming.visualizer?.intensity ?? prev.colorShift, 0, 3, prev.colorShift),
      lerpSpeed: clampNum(0.35 / bpmFactor, 0.05, 2, prev.lerpSpeed),
      matchTrack: !!trackAnalysis,
      lightIntensity: clampNum(0.8 + bloomIntensity * 0.4 - vignetteStrength * 0.2, 0.2, 3, prev.lightIntensity),
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
  }, []);

  const handleVisualPresetSelect = useCallback((presetId: string) => {
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
  }, [vizMode]);

  /** Reset per-track derived audio state so a new track never inherits stale beats/peaks/lyrics timing. */
  const resetAudioDerivedState = useCallback(() => {
    audioElapsedRef.current = 0;
    setElapsed(0);
    audioClockRef.current.reset();
    lrcSyncLiveRef.current = null;
    // Lyrics are strictly LRC-derived: a new track starts wordless so stale
    // lines can never linger on the canvas when the next track has no LRC.
    setLyrics([]);
    setLyricsVisible(false);
    lastBeatIdxRef.current = -1;
    lastBeatAtRef.current = 0;
    last3DUiUpdateRef.current = 0;
    const idle: AudioData = { bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0, drumType: null, nextBeatIn: 0 };
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
      lrcSyncLiveRef.current = liveLyrics.length ? computeLrcSync(liveLyrics, heard, liveBounds) : null;
      const now = performance.now();
      if (now - lastUpdate > 50) { // ~20fps React update for lyric DOM + slow consumers
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

  // Cleanup object URL, AudioContext, and recording on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mp4RecorderRef.current) {
        // Flush + mux is async now; fire-and-forget on unmount (the buffer is
        // unusable once the page is going away anyway).
        void mp4RecorderRef.current.stop().catch(() => undefined);
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const setupAudio = useCallback(async (el: HTMLMediaElement | null) => {
    if (!el) return;
    // Element already wired: just ensure the context is running (autoplay-policy
    // suspensions need resume(), not a rebuild — rebuilding throws "already connected").
    if (connectedElements.current.has(el)) {
      latencyRef.current = estimateOutputLatency(audioCtxRef.current);
      if (audioCtxRef.current?.state === "suspended") {
        try { await audioCtxRef.current.resume(); } catch { /* ignore */ }
      }
      return;
    }
    try {
      connectedElements.current.add(el);

      // Close previous context if switching elements
      if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch { /* already disconnected */ } sourceRef.current = null; }
      if (audioCtxRef.current) { try { await audioCtxRef.current.close(); } catch { /* already closed */ } audioCtxRef.current = null; }

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      latencyRef.current = estimateOutputLatency(ctx);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      // Light analyser smoothing (was 0.8, which trailed onsets ~100 ms+);
      // punch/decay shaping lives in our own attack/release stage instead.
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      analyserRef.current = analyser;
      freqArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      const source = ctx.createMediaElementSource(el);
      sourceRef.current = source;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      if (ctx.state === "suspended") await ctx.resume();
    } catch (e) { setError(e instanceof Error ? e.message : "Web Audio setup failed"); }
  }, []);

  const handleFile = useCallback((file: File) => {
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
  }, [resetAudioDerivedState]);

  const handleSelectLibraryTrack = useCallback(async (fileRef: string) => {
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
    // New track: clear manual preset lock so auto-apply is allowed to run.
    setActiveVisualPresetId(null);
    const trackFolder = fileRef.includes("/") ? fileRef.slice(0, fileRef.lastIndexOf("/")) : "";
    const cleanName = baseNameOfRef(fileRef).replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "");
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
          setAnalysisData(prev => ({ ...prev, [fileRef]: ensuredAnalysis }));
          realBpm = ensuredAnalysis.tempo_bpm ? Math.round(ensuredAnalysis.tempo_bpm) : undefined;
          if (realBpm) setTrackMetadata(prev => ({ ...prev, [fileRef]: { bpm: realBpm } }));
        } else if (result && !result.analysis) {
          showToast("Analysis came back empty — visuals use live audio only", "warning");
        }
      } catch {
        // Never fail silently: without analysis there is no beat sync.
        showToast("Track analysis failed — visuals use live audio only", "warning");
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
    const preset = selectPresetForTrack(cleanName, energy);
    if (isStale()) return;
    setKineticPreset(preset);

    // Auto-apply optimized visual preset based on track characteristics.
    // Guard: if the user manually picked a preset while we were awaiting
    // ensureAnalysis()/parseLyrics, do not clobber that choice.
    const visualPresetId = selectVisualPreset(cleanName, undefined, energy, realBpm);
    const visualPreset = visualPresets[visualPresetId];
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
        showToast(`Applied "${visualPreset.name}" preset — ${visualPreset.description}`, "info");
      }
    }

    // Store analysis for manual AI enrichment — user explicitly clicks "Enhance with AI"
    // (previous fire-and-forget auto-generation removed: it overwrote the visible preset silently)
    (window as any).__pendingAIAnalysis = analysis;
    (window as any).__pendingAICleanName = cleanName;
    (window as any).__pendingAIRealBpm = realBpm;
  }, [analysisData, trackMetadata, parseLyricsForTrack, resetAudioDerivedState]);

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

  const handlePresetLoaded = useCallback((preset: VisualPreset) => {
    // Pass current track analysis so preset aligns to loaded track
    applyPreset(preset, currentAnalysisData);
  }, [applyPreset, currentAnalysisData]);

  const handleClearPreset = useCallback(() => {
    setLoadedPreset(null);
    setVizParams(DEFAULT_VIZ_PARAMS);
    setBgColor("#050505");
    setMeshColor("#6366f1");
    setKineticPreset("cinematic");
  }, []);

  const handleAnalyzeTrack = useCallback(async (filename: string) => {
    if (!filename || analyzing) return;
    setAnalyzing(true);
    try {
      const result = await ensureAnalysis(filename);
      const analysis = toAnalysisData(result?.analysis);
      if (!analysis) {
        setError("Analysis returned an unusable payload — try again");
        return;
      }
      setAnalysisData(prev => ({ ...prev, [filename]: analysis }));
      setTrackMetadata(prev => ({ ...prev, [filename]: { bpm: Math.round(analysis.tempo_bpm), duration: Math.round(analysis.duration_seconds) } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing]);

  const handleEnhanceWithAI = useCallback(async () => {
    if (!currentAnalysisData || aiEnhancing) return;
    setAiEnhancing(true);
    setError(null);
    try {
      const cleanName = baseNameOfRef(currentFilename ?? "").replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") || "track";
      const concept = csvContent ? getVisualizationForTrack(cleanName, csvContent) : null;
      const desc = (concept as any)?.prompt || (concept as any)?.visualConcept || cleanName;
      const genre = (concept as any)?.genre?.join(", ") || "";
      const energy = currentAnalysisData.energy_curve?.length
        ? currentAnalysisData.energy_curve.reduce((a,b)=>a+b,0)/currentAnalysisData.energy_curve.length
        : 0.5;
      const { generateVisualizerPreset } = await import("../../services/api");
      const res = await generateVisualizerPreset(
        `${desc} — ${genre} — mood: ${(concept as any)?.mood?.join(", ") || "auto"}`.trim(),
        undefined, 0.7,
        { bpm: currentAnalysisData.tempo_bpm ? Math.round(currentAnalysisData.tempo_bpm) : undefined, energy, duration_seconds: currentAnalysisData.duration_seconds, genre }
      );
      const preset = toVisualPreset(res?.preset);
      if (preset) {
        const beforeCount = vizParamsRef.current.particleCount;
        applyPreset(preset, currentAnalysisData);
        showToast(`AI applied: "${preset.name}" (was ${beforeCount} particles → ${preset.visualizer?.particleCount ?? "?"})`, "success");
      } else {
        setError("AI returned an unusable preset — try again");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enrichment failed — check Ollama is running");
    } finally {
      setAiEnhancing(false);
    }
  }, [currentAnalysisData, currentFilename, csvContent, aiEnhancing, applyPreset]);

  const startRecording = useCallback(async () => {
    const canvas = containerRef.current?.querySelector("canvas") ?? null;
    if (!canvas) {
      setError("Recording failed — no visualizer canvas found");
      return;
    }
    try {
      // Prefer MP4 via WebCodecs when available; fall back to MediaRecorder/WebM.
      // `canRecordMp4` actually probes the H.264 config — WebCodecs existing does
      // not mean this profile is encodable.
      const useMp4 = await canRecordMp4(canvas.width, canvas.height);
      recordingFormatRef.current = useMp4 ? "mp4" : "webm";

      if (useMp4) {
        const recorder = createMp4Recorder({ bitrate: 8_000_000, fps: 60 });
        recorder.start(canvas);
        mp4RecorderRef.current = recorder;
        setRecordedBlob(null);
        setIsRecording(true);
        recordingTimerRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const mediaRecorder = new MediaRecorder(canvas.captureStream(60), { mimeType, videoBitsPerSecond: 8000000 });
      recordedChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => { setRecordedBlob(new Blob(recordedChunksRef.current, { type: "video/webm" })); };
      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch (e) {
      setError(e instanceof Error ? `Recording failed — ${e.message}` : "Recording failed");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const fmt = recordingFormatRef.current;

    if (fmt === "mp4") {
      const recorder = mp4RecorderRef.current;
      mp4RecorderRef.current = null;
      setIsRecording(false);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      if (recorder) {
        // Await the encoder flush: the tail frames only reach the muxer after the
        // flush resolves (see mp4Recording.ts).
        try {
          const buffer = await recorder.stop();
          if (buffer) setRecordedBlob(new Blob([buffer], { type: "video/mp4" }));
          else setError("MP4 export produced no data — try WebM (see console)");
        } catch (e) {
          setError(e instanceof Error ? `MP4 export failed — ${e.message}` : "MP4 export failed");
        }
      }
      return;
    }

    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  }, []);

  const downloadRecording = useCallback(() => {
    if (!recordedBlob) return;
    const ext = recordingFormatRef.current;
    const a = document.createElement("a");
    const url = URL.createObjectURL(recordedBlob);
    a.href = url;
    a.download = `visualizer_${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [recordedBlob]);

  const [showTestPanel, setShowTestPanel] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setShowTestPanel(v => !v);
      }
      // Ctrl+Shift+A triggers analyze when a track is selected (mirrors the 2D canvas shortcut)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a" && currentFilename) {
        e.preventDefault();
        handleAnalyzeTrack(currentFilename);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFilename, handleAnalyzeTrack]);

  useEffect(() => {
    if (!showMoreMenu) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.viz-more-menu') && !target.closest('.viz-more-menu-toggle')) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [showMoreMenu]);

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
    (window as any).__VIZ_TEST__ = {
      selectTrack: (filename: string) => handleSelectLibraryTrack(filename),
      setMode: (mode: "3d" | "shader" | "2d") => setVizMode(mode),
      set2DMode: (mode: any) => setCanvas2DMode(mode),
      getState: () => ({ ...testStateRef.current }),
      toggleTestPanel: () => setShowTestPanel(v => !v),
      setLayerVisible: (layer: "visuals" | "lyrics" | "character", v: boolean) => {
        if (layer === "visuals") setVisualsVisible(v);
        if (layer === "lyrics") setLyricsVisible(v);
        if (layer === "character") setCharacterVisible(v);
      },
      toggleLayer: (layer: "visuals" | "lyrics" | "character") => {
        if (layer === "visuals") setVisualsVisible(x => !x);
        if (layer === "lyrics") setLyricsVisible(x => !x);
        if (layer === "character") setCharacterVisible(x => !x);
      },
    };
    return () => { delete (window as any).__VIZ_TEST__; };
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
      (f) => audioRefForFile(f) === pendingTrack || f.filename === pendingTrack
    );
    handleSelectLibraryTrack(match ? audioRefForFile(match) : pendingTrack);
    setPendingTrack(null);
  }, [pendingTrack, libraryFiles, handleSelectLibraryTrack]);

  return (
    <div className={`viz-page ${focusMode ? "viz-focus-mode" : ""}`}>
      {showTestPanel && (
        <div className="viz-test-panel">
          <div className="viz-test-panel-row">
            <label>Track
              <select onChange={(e) => handleSelectLibraryTrack(e.target.value)} value={currentFilename || ""}>
                <option value="" disabled>Select a track...</option>
                {libraryFiles.map((f) => {
                  const ref = audioRefForFile(f);
                  return <option key={ref} value={ref}>{displayNameForFile(f)}{trackMetadata[ref]?.bpm ? ` (${trackMetadata[ref]?.bpm} BPM)` : ""}{analysisData[ref] ? " ✓" : ""}</option>;
                })}
              </select>
            </label>
            <label>Mode
              <select value={vizMode} onChange={(e) => setVizMode(e.target.value as any)}>
                <option value="shader">FX</option>
                <option value="2d">2D</option>
                <option value="3d">3D</option>
              </select>
            </label>
            {vizMode === "2d" && (
              <label>2D Mode
                <select value={canvas2DMode} onChange={(e) => setCanvas2DMode(e.target.value as any)}>
                  <option value="bars">Bars</option>
                  <option value="mirrored-bars">Mirrored Bars</option>
                  <option value="segmented-led-bars">Segmented LED Bars</option>
                  <option value="stereo-split-bands">Stereo Split Bands</option>
                  <option value="stacked-frequency-bands">Stacked Frequency Bands</option>
                  <option value="dot-peak-matrix">Dot Peak Matrix</option>
                  <option value="waveform">Wave</option>
                  <option value="radial">Radial</option>
                  <option value="spectrogram">Spectrogram</option>
                  <option value="lissajous">Lissajous</option>
                  <option value="constellation">Constellation</option>
                  <option value="particles">Particles</option>
                </select>
              </label>
            )}
            <button onClick={() => setShowTestPanel(false)}>Close</button>
          </div>
          <pre className="viz-test-state">{JSON.stringify({
            vizMode,
            canvas2DMode,
            currentFilename,
            isPlaying,
            liveAudioData,
            visualizationStyle,
            kineticPreset,
            loadedPreset: loadedPreset?.name ?? null,
          }, null, 2)}</pre>
        </div>
      )}
      <header className="viz-topbar">
        <div className="viz-brand"><Music size={20} /><span>Visualizer</span></div>
        <div className="viz-track-selector">
          <select data-testid="viz-track-select" id="viz-track-select" aria-label="Select a track" onChange={(e) => handleSelectLibraryTrack(e.target.value)} value={currentFilename || ""} className="viz-track-select">
            <option value="" disabled>Select a track...</option>
            {libraryFiles.map((f) => {
              const ref = audioRefForFile(f);
              const name = displayNameForFile(f);
              const meta = trackMetadata[ref];
              const badge = analysisData[ref] ? " ✓" : "";
              const metaStr = meta?.bpm ? ` (${meta.bpm} BPM)` : "";
              return <option key={ref} value={ref}>{name}{metaStr}{badge}</option>;
            })}
          </select>
          <button onClick={toggleAutoPlay} className={`viz-icon-btn ${autoPlay ? "active" : ""}`} aria-label={autoPlay ? "Auto-play ON" : "Auto-play OFF"} aria-pressed={autoPlay} title={autoPlay ? "Auto-play ON — tracks start automatically" : "Auto-play OFF — pick a track then press Play"}>
            <Play size={14} />
          </button>
          {currentFilename && !currentAnalysisData && (
            <button className="viz-analyze-btn" onClick={() => handleAnalyzeTrack(currentFilename)} disabled={analyzing} aria-describedby="viz-analyze-status">
              {analyzing ? "Analyzing..." : "Analyze"}
            </button>
          )}
          <span id="viz-analyze-status" className="sr-only" aria-live="polite">
            {analyzing ? "Analyzing track..." : currentAnalysisData ? "Analysis complete" : ""}
          </span>
          {currentFilename && activeVisualPresetId && visualPresets[activeVisualPresetId] && (
            <span className="viz-preset-badge" title={`Active preset: ${visualPresets[activeVisualPresetId].name}\n${visualPresets[activeVisualPresetId].description}`}>
              {visualPresets[activeVisualPresetId].name}
            </span>
          )}
          {currentAnalysisData && !loadedPreset && (
            <button className="viz-enhance-btn" onClick={handleEnhanceWithAI} disabled={aiEnhancing} title="Generate AI preset tuned to this track (manual, visible)">
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
            <button onClick={() => setVizMode(vizMode === "3d" ? "shader" : vizMode === "shader" ? "2d" : "3d")} className={`viz-icon-btn ${vizMode !== "3d" ? "active" : ""}`} title={`Mode: ${vizMode}`} aria-label={`Visualization mode: ${vizMode}. Activate to switch mode.`} aria-pressed={vizMode !== "3d"}>{vizMode === "3d" ? <span style={{ fontSize: 11 }}>3D</span> : vizMode === "shader" ? <span style={{ fontSize: 11 }}>FX</span> : <span style={{ fontSize: 11 }}>2D</span>}</button>
          </div>
          <div className="viz-btn-group viz-layers-group" title="Layers">
            <button onClick={() => setVisualsVisible(v => !v)} className={`viz-icon-btn ${visualsVisible ? "active" : ""}`} aria-label={visualsVisible ? "Hide visuals" : "Show visuals"} aria-pressed={visualsVisible} title={`Visuals: ${visualsVisible ? "on" : "off"} — 3D/shader/2D`}>
              {visualsVisible ? <Layers size={14} /> : <EyeOff size={14} />}
            </button>
            <button onClick={() => setLyricsVisible(v => !v)} className={`viz-icon-btn viz-lyrics-btn ${lyricsVisible ? "active" : ""}`} aria-label={lyricsVisible ? "Hide lyrics" : "Show lyrics"} aria-pressed={lyricsVisible} title={`Lyrics: ${lyricsVisible ? "on" : "off"}${lyrics.length === 0 ? " — no lyrics loaded" : ""}`}>
              <MessageSquare size={14} />
            </button>
            <button onClick={() => setCharacterVisible(v => !v)} className={`viz-icon-btn ${characterVisible ? "active" : ""}`} aria-label={characterVisible ? "Hide character" : "Show character"} aria-pressed={characterVisible} title={`Character: ${characterVisible ? "on" : "off"}`}>
              <User size={14} />
            </button>
          </div>
          <div className="viz-btn-group">
            <button onClick={() => setShowMoreMenu((v) => !v)} className={`viz-icon-btn viz-more-menu-toggle ${showMoreMenu ? "active" : ""}`} aria-label="More controls" aria-expanded={showMoreMenu} aria-pressed={showMoreMenu} title="More controls">
              <MoreHorizontal size={14} />
            </button>
            {showMoreMenu && (
              <div className="viz-more-menu">
                {vizMode === "2d" && (
                  <select value={canvas2DMode} onChange={e => setCanvas2DMode(e.target.value as any)} className="viz-2d-mode-select viz-more-item" title="2D mode">
                    <option value="bars">Bars</option>
                    <option value="mirrored-bars">Mirrored Bars</option>
                    <option value="segmented-led-bars">LED Bars</option>
                    <option value="stereo-split-bars">Stereo Split</option>
                    <option value="stacked-frequency-bands">Stacked Bands</option>
                    <option value="dot-peak-matrix">Dot Matrix</option>
                    <option value="waveform">Wave</option>
                    <option value="radial">Radial</option>
                    <option value="spectrogram">Spectrogram</option>
                    <option value="lissajous">Lissajous</option>
                    <option value="constellation">Constellation</option>
                    <option value="particles">Particles</option>
                  </select>
                )}
                 {isRecording && <span className="viz-rec viz-more-item" aria-live="polite"><span className="viz-rec-dot" /> {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, "0")}</span>}
                <button onClick={isRecording ? stopRecording : startRecording} className={`viz-icon-btn viz-more-item ${isRecording ? "rec" : ""}`} aria-label={isRecording ? "Stop recording" : "Start recording"} aria-pressed={isRecording} title={isRecording ? "Stop recording" : "Start recording"}>
                  {isRecording ? <Square size={14} /> : <Video size={14} />}
                </button>
                {recordedBlob && !isRecording && (
                  <button onClick={downloadRecording} className="viz-icon-btn viz-more-item" aria-label="Download recording" title="Download recording">
                    <Download size={14} />
                  </button>
                )}
                <button onClick={() => setSceneFrozen(!sceneFrozen)} className={`viz-icon-btn viz-more-item ${sceneFrozen ? "active" : ""}`} aria-label={sceneFrozen ? "Unfreeze scene" : "Freeze scene"} aria-pressed={sceneFrozen} title={sceneFrozen ? "Unfreeze scene" : "Freeze scene"}>
                  <Snowflake size={14} />
                </button>
                <button onClick={toggleFocusMode} className={`viz-icon-btn viz-more-item`} aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"} aria-pressed={focusMode} title={focusMode ? "Exit focus mode" : "Enter focus mode"}>{focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
                <button onClick={() => setShowSettings(!showSettings)} className={`viz-icon-btn viz-more-item ${showSettings ? "active" : ""}`} aria-label={showSettings ? "Close settings" : "Open settings"} aria-pressed={showSettings} title={showSettings ? "Close settings" : "Open settings"}><Settings size={14} /></button>
                <button onClick={() => setShowAnimDemo(!showAnimDemo)} className={`viz-icon-btn viz-more-item ${showAnimDemo ? "active" : ""}`} aria-label="Animation demo" aria-pressed={showAnimDemo} title="Animation demo">
                  <Play size={14} />
                </button>
                <button onClick={() => setShowTheatreStudio(!showTheatreStudio)} className={`viz-icon-btn viz-more-item ${showTheatreStudio ? "active" : ""}`} aria-label="Theatre.js Studio" aria-pressed={showTheatreStudio} title="Theatre.js Studio — Visual animation editor">
                  <Wand2 size={14} />
                </button>
                <button onClick={() => setShowAIPanel(!showAIPanel)} className={`viz-icon-btn viz-more-item viz-ai-toggle ${showAIPanel ? "active" : ""}`} aria-label="AI generate preset" aria-pressed={showAIPanel} title="AI generate preset"><Sparkles size={14} /></button>
                <button onClick={() => setPrefersReducedMotion(p => !p)} className={`viz-icon-btn viz-more-item ${prefersReducedMotion ? "active" : ""}`} aria-label={prefersReducedMotion ? "Motion on" : "Motion off"} aria-pressed={prefersReducedMotion} title={prefersReducedMotion ? "Reduced motion: ON (click to disable)" : "Reduced motion: OFF (click to enable)"}>
                  <Accessibility size={14} />
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
            <div className="viz-empty-hero" role="status" aria-label="Get started with the visualizer">
              <div className="viz-empty-card">
                <div className="viz-empty-icon"><Music size={28} /></div>
                <h3>Drop a song to see it</h3>
                <p className="viz-empty-sub">Three steps — no setup. Pick a track, pick a vibe, hit play. Beat-synced shader + 3D + lyrics.</p>
                <ol className="viz-empty-steps">
                  <li><span className="viz-empty-n">1</span> <b>Pick a track</b> → choose from the library above{libraryFiles.length > 0 ? ` (${libraryFiles.length} tracks ready)` : ", or upload an MP3/WAV"}</li>
                  <li><span className="viz-empty-n">2</span> <b>Pick a vibe</b> → shader, 3D, or 2D from the toolbar</li>
                  <li><span className="viz-empty-n">3</span> Press <b>Play</b> — cuts land on beats, chorus = maximal</li>
                </ol>
                <div className="viz-empty-actions">
                  <button className="viz-empty-cta" onClick={() => document.getElementById("viz-track-select")?.focus()}>Choose a track…</button>
                  <button className="viz-empty-secondary" onClick={() => document.getElementById("viz-file-input")?.click()}>Browse files…</button>
                  <a href="/audio-analysis" className="viz-empty-link">Open Audio Analysis →</a>
                </div>
                <p className="viz-empty-tip">Tip: first 3s are the hook — start on the chorus for Shorts.</p>
              </div>
            </div>
          )}
          <UploadPrompt hasAudio={!!audioUrl} quiet={!audioUrl && !currentFilename} onFile={handleFile} />
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
                    setLiveAudioData({ ...data, beat: data.beat || (now - lastBeatAtRef.current < BEAT_LATCH_MS) });
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
                sampleAudio={
                  audioElRef.current
                    ? () => audioClockRef.current.sample(audioElRef.current, latencyRef.current)
                    : undefined
                }
              />
           </Canvas>
           {visualsVisible ? (
             <>
               {vizMode === "shader" && (
                 <ShaderVisualizer
                   audioData={liveAudioDataRef}
                   trackName={baseNameOfRef(currentFilename ?? "").replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") ?? ""}
                   isPlaying={isPlaying}
                   lrcSync={lrcSync}
                   lrcSyncLive={lrcSyncLiveRef}
                   lyrics={lyrics}
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
                {vizMode === "3d" && !rendererReady && <div className="viz-loading-overlay"><div className="viz-loading-spinner" /><span>Initializing {rendererBackend || (gpuResult.supported && isWebGPUOptIn() ? "WebGPU" : "WebGL")}...</span></div>}
               {vizMode === "3d" && rendererReady && <div className="viz-backend-badge">{rendererBackend}</div>}
               {vizMode === "3d" && rendererReady && <StylePicker active={visualizationStyle} onChange={setVisualizationStyle} />}
             </>
           ) : (
             <div className="viz-layer-hidden" style={{ background: bgColor, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
               <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, letterSpacing: 1 }}>Visuals hidden</span>
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
              {visualsVisible && <div className={`viz-letterbox top ${storyState.beat?.cinematic ? "on" : ""}`} />}
              {visualsVisible && <div className={`viz-letterbox bottom ${storyState.beat?.cinematic ? "on" : ""}`} />}
              {/* Builder silhouette — separate layer, independent of lyrics (user-toggleable) */}
              <BuilderFigure audioData={liveAudioDataRef} storyBeat={storyState.beat} visible={characterVisible} calm={prefersReducedMotion} />
        </div>
        {showSettings && <SettingsPanel params={vizParams} onChange={setVizParams} bgColor={bgColor} meshColor={meshColor} onBgChange={setBgColor} onMeshChange={setMeshColor} demoEnabled={demoEnabled} onDemoToggle={setDemoEnabled} kineticPreset={kineticPreset} onKineticPresetChange={setKineticPreset} visualizationStyle={visualizationStyle} onVisualizationStyleChange={setVisualizationStyle} vizMode={vizMode} onVizModeChange={setVizMode} activeVisualPresetId={activeVisualPresetId} onVisualPresetSelect={handleVisualPresetSelect} perceptualScale={perceptualScale} onPerceptualScaleChange={setPerceptualScale} />}
        {showAIPanel && <AIVisualizerPrompt onApplyPreset={handlePresetLoaded} trackMeta={deriveTrackMeta(currentAnalysisData)} trackName={currentFilename ?? undefined} />}
      </div>

      <footer className="viz-bottombar">
        <div className="viz-spectrum">
          <SpectrumBar label="Bass" value={liveAudioData.bass} color="#6366f1" />
          <SpectrumBar label="Mid" value={liveAudioData.mid} color="#a855f7" />
          <SpectrumBar label="Treble" value={liveAudioData.treble} color="#ec4899" />
        </div>
        <div className="viz-beat"><div className={`viz-beat-dot ${liveAudioData.beat ? "active" : ""}`} /></div>
      </footer>

      {audioUrl && (
        <div className="viz-audio-player">
          <audio key={audioUrl} ref={audioElRef} controls src={audioUrl} data-main-player className="viz-audio" crossOrigin={audioUrl?.startsWith('http://') || audioUrl?.startsWith('https://') ? "anonymous" : undefined}
            onPlay={() => { setIsPlaying(true); setIsPaused(false); if (audioElRef.current) void setupAudio(audioElRef.current); }}
            onPause={() => { setIsPlaying(false); setIsPaused(true); }}
            onEnded={() => { setIsPlaying(false); setIsPaused(false); resetAudioDerivedState(); }}
            onError={() => { setIsPlaying(false); setError(`Couldn't load audio — the file may have moved. Pick another track or re-upload.`); }}
          />
          {/* Per-stem mixing (Trend 2: drums→pulse, bass→camera shake, vocals→lyric, other→palette) */}
          <StemMixerPanel audioFilename={currentFilename} compact />
        </div>
      )}

      {error && <div className="viz-error-bar" role="alert"><AlertCircle size={14} /><span>{error}</span></div>}
    </div>
  );
}
