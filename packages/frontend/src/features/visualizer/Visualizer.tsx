import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Music, AlertCircle, Maximize2, Minimize2, Video, Square, Download, Settings, Snowflake, MessageSquare, Sparkles, Play, Wand2, Accessibility } from "lucide-react";
import { listAudioFiles, ensureAnalysis } from "../../services/api";
import type { AudioAnalysisData, AudioData, VizParams } from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";
import { useUIStore } from "../../state/uiStore";
import { getVisualizationForTrack, VisualizationStyle } from "./trackConceptAnalyzer";
import { Canvas2DVisualizer } from "./Canvas2DVisualizer";
import { VisualizerScene } from "./VisualizerScene";
import { useLrcSync, computeLrcSync, computeSectionBounds } from "./useLrcSync";
import type { LrcSyncData } from "./useLrcSync";
import { ANALYSER_SMOOTHING, ATTACK, RELEASE, createAudioClock, estimateOutputLatency } from "./audioTiming";
import { ShaderVisualizer } from "./ShaderVisualizer";
import { ACESFilmicToneMapping } from "three";
import { SpectrumBar } from "./components/SpectrumBar";
import { StylePicker } from "./components/StylePicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { UploadPrompt } from "./components/UploadPrompt";
import { PresetFileUpload } from "./components/PresetFileUpload";
import { AIVisualizerPrompt } from "./components/AIVisualizerPrompt";
import type { LyricLine } from "./components/LyricOverlay";
import { KineticLyricOverlay } from "./components/KineticLyricOverlay";
import { parseLyricsFromCsv, parseLrcContent } from "./lyricsParser";
import { AnimationDemo } from "./components/AnimationDemo";
import { TheatreStudioPanel } from "./components/TheatreStudioPanel";
import type { VisualPreset } from "./visualPreset";
import { showToast } from "../../utils/toast";
import { visualPresets, selectVisualPreset } from "./visualPresets";
import { selectPresetForTrack } from "./components/KineticPresets";
import { buildStoryboard, getStoryState, EMPTY_STORYBOARD } from "./storyboard";
import { StoryActCard } from "./components/StoryActCard";
import { BuilderFigure } from "./components/BuilderFigure";
import { useMCPContextSync } from "./useMCPContextSync";

/** Clamp a number into [min, max]; falls back to `fallback` when not finite. */
function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Select visualization style based on audio analysis data (pure — safe outside render). */
function selectVisualizationForTrack(analysis: AudioAnalysisData): VisualizationStyle | null {
  const bpm = analysis.tempo_bpm;
  const energyAvg = analysis.energy_curve?.length
    ? analysis.energy_curve.reduce((a, b) => a + b, 0) / analysis.energy_curve.length
    : 0.5;
  const sectionCount = analysis.sections?.length || 0;
  const hasChorus = analysis.sections?.some(s => s.type === "chorus") || false;

  // High energy + fast tempo → Geometric (vortex) or Pulse
  if (energyAvg > 0.6 && bpm > 130) return "geometric";
  // High energy + slower → Storm (reuse geometric)
  if (energyAvg > 0.6 && bpm <= 130) return "pulse";
  // Medium energy + fast → Particles (galaxy)
  if (energyAvg > 0.4 && bpm > 120) return "particles";
  // Low energy + slow → Aurora (dreamy) or Ocean (deterministic by energy value)
  if (energyAvg < 0.4 && bpm < 100) {
    return Math.floor(energyAvg * 100) % 2 === 0 ? "aurora" : "ocean";
  }
  // Many sections → Neural (network)
  if (sectionCount > 6) return "neural";
  // Has chorus with high energy → Synthwave (spectrum)
  if (hasChorus && energyAvg > 0.5) return "synthwave";
  // Low energy → Cosmic (nebula)
  if (energyAvg < 0.35) return "cosmic";
  // Default based on tempo
  if (bpm > 140) return "pulse";
  if (bpm < 90) return "aurora";
  return "geometric";
}

/** Narrow an unknown backend payload to AudioAnalysisData; null when unusable. */
function toAnalysisData(raw: unknown): AudioAnalysisData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tempo_bpm !== "number" || typeof r.duration_seconds !== "number") return null;
  if (!Array.isArray(r.beat_times) || !Array.isArray(r.energy_curve)) return null;
  return raw as AudioAnalysisData;
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
  const [libraryFiles, setLibraryFiles] = useState<Array<{ filename: string; path: string }>>([]);
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
  const [kineticPreset, setKineticPreset] = useState("cinematic");
  const [showAnimDemo, setShowAnimDemo] = useState(false);
  const [showTheatreStudio, setShowTheatreStudio] = useState(false);
  const [loadedPreset, setLoadedPreset] = useState<VisualPreset | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [vizMode, setVizMode] = useState<"3d" | "shader" | "2d">("shader"); // 2d = Canvas2D (2026 visual-flux/Waviz)
  const [canvas2DMode, setCanvas2DMode] = useState<"bars" | "waveform" | "radial" | "spectrogram" | "lissajous" | "constellation" | "particles">("bars");
  const [aiEnhancing, setAiEnhancing] = useState(false);

  const { focusMode, toggleFocusMode } = useUIStore();

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
    currentFilename?.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a|lrc)$/i, "") || "untitled",
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
  // Interpolated, latency-compensated audio clock (see audioTiming.ts).
  const audioClockRef = useRef(createAudioClock());
  const latencyRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const freqArrayRef = useRef<Uint8Array | null>(null);
  const connectedElements = useRef<WeakSet<HTMLMediaElement>>(new WeakSet());
  // Monotonic id guarding async track-select flows against out-of-order resolves.
  const trackRequestRef = useRef(0);
  // Latest vizParams for callbacks that must not re-subscribe on every slider tick.
  const vizParamsRef = useRef(vizParams);
  vizParamsRef.current = vizParams;
  // Throttle for the 3D scene's per-frame audio callback (mirrors the shader loop).
  const last3DUiUpdateRef = useRef(0);
  // Latest snapshot for the __VIZ_TEST__ harness without re-registering per frame.
  const testStateRef = useRef({ vizMode, canvas2DMode, currentFilename, isPlaying, liveAudioData, visualizationStyle, kineticPreset, loadedPresetName: null as string | null, storyboard: EMPTY_STORYBOARD });
  testStateRef.current = { vizMode, canvas2DMode, currentFilename, isPlaying, liveAudioData, visualizationStyle, kineticPreset, loadedPresetName: loadedPreset?.name ?? null, storyboard };

  // Smoothing + beat-detection state for shader-mode analyser (mirrors useRealAudio)
  const smoothedBassRef = useRef(0);
  const smoothedMidRef = useRef(0);
  const smoothedTrebleRef = useRef(0);
  const peakHoldRef = useRef(0);
  const peakDecayRef = useRef(0);
  const lastBassRef = useRef(0);
  const beatCooldownRef = useRef(0);
  const lastBeatIdxRef = useRef(-1);

  // Load CSV and library
  useEffect(() => { fetch("/track-prompts-lyrics.csv").then(r => r.text()).then(setCsvContent).catch(() => {}); }, []);
  useEffect(() => { listAudioFiles().then(files => { if (Array.isArray(files) && files.length > 0) setLibraryFiles(files); }).catch(() => {}); }, []);

  // Parse lyrics - tries LRC first (precise timing), then CSV fallback
  const parseLyricsForTrack = useCallback(async (trackName: string, duration: number): Promise<LyricLine[]> => {
    if (!trackName) return parseLyricsFromCsv(csvContent, trackName, duration);

    // Ensure the filename has .lrc extension
    const lrcFilename = trackName.endsWith(".lrc") ? trackName :
      trackName.replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") + ".lrc";

    // Try public directory first (fast, no backend needed)
    try {
      const publicLrc = await fetch(`/audio/${encodeURIComponent(lrcFilename)}`);
      if (publicLrc.ok) {
        const lrcContent = await publicLrc.text();
        const lrcLyrics = parseLrcContent(lrcContent);
        if (lrcLyrics.length > 0) return lrcLyrics;
      }
    } catch {
      // Fall through
    }

    // Try backend API
    try {
      const apiLrc = await fetch(`/api/audio/file/${encodeURIComponent(lrcFilename)}`);
      if (apiLrc.ok) {
        const lrcContent = await apiLrc.text();
        const lrcLyrics = parseLrcContent(lrcContent);
        if (lrcLyrics.length > 0) return lrcLyrics;
      }
    } catch {
      // Fall through
    }

    // Fall back to CSV parsing
    return parseLyricsFromCsv(csvContent, trackName, duration);
  }, [csvContent]);

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

  /** Reset per-track derived audio state so a new track never inherits stale beats/peaks/lyrics timing. */
  const resetAudioDerivedState = useCallback(() => {
    audioElapsedRef.current = 0;
    setElapsed(0);
    audioClockRef.current.reset();
    lrcSyncLiveRef.current = null;
    smoothedBassRef.current = 0;
    smoothedMidRef.current = 0;
    smoothedTrebleRef.current = 0;
    peakHoldRef.current = 0;
    peakDecayRef.current = 0;
    lastBassRef.current = 0;
    beatCooldownRef.current = 0;
    lastBeatIdxRef.current = -1;
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
  useEffect(() => {
    if (!isPlaying && audioElRef.current) {
      const t = audioElRef.current.currentTime;
      audioElapsedRef.current = t;
      setElapsed(t);
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

  const handleSelectLibraryTrack = useCallback(async (filename: string) => {
    if (!filename) return;
    const requestId = ++trackRequestRef.current;
    const isStale = () => requestId !== trackRequestRef.current;
    setError(null);
    resetAudioDerivedState();
    setCurrentFilename(filename);
    setAudioUrl(`/api/audio/file/${encodeURIComponent(filename)}`);
    setDemoEnabled(false);
    setIsPaused(false);
    const cleanName = filename.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "");
    let analysis: AudioAnalysisData | null = analysisData[filename] ?? null;
    let realBpm = trackMetadata[filename]?.bpm;
    if (!analysis) {
      try {
        // Try to get cached analysis first, then ensure analysis (runs if needed)
        const result = await ensureAnalysis(filename);
        if (isStale()) return;
        const ensuredAnalysis = toAnalysisData(result?.analysis);
        if (ensuredAnalysis) {
          analysis = ensuredAnalysis;
          setAnalysisData(prev => ({ ...prev, [filename]: ensuredAnalysis }));
          realBpm = ensuredAnalysis.tempo_bpm ? Math.round(ensuredAnalysis.tempo_bpm) : undefined;
          if (realBpm) setTrackMetadata(prev => ({ ...prev, [filename]: { bpm: realBpm } }));
        }
      } catch { /* fallback */ }
    }
    if (isStale()) return;
    if (csvContent) {
      const concept = getVisualizationForTrack(cleanName, csvContent);
      if (concept) {
        if (realBpm) concept.bpm = realBpm;
        setVisualizationStyle(concept.recommendedViz);
      }
    }

    // Auto-select visualization based on analysis data
    if (analysis) {
      const viz = selectVisualizationForTrack(analysis);
      if (viz) setVisualizationStyle(viz);
    }

    // Load lyrics for this track (LRC preferred, CSV fallback)
    const duration = analysis?.duration_seconds || 240;
    console.log('[LRC] Loading lyrics for:', cleanName, 'duration:', duration);
    const trackLyrics = await parseLyricsForTrack(cleanName, duration);
    if (isStale()) return;
    console.log('[LRC] Loaded', trackLyrics.length, 'lyric lines');
    setLyrics(trackLyrics);
    setLyricsVisible(trackLyrics.length > 0);

    // Auto-select kinetic preset based on track genre
    const energy = analysis?.energy_curve?.length
      ? analysis.energy_curve.reduce((a, b) => a + b, 0) / analysis.energy_curve.length
      : 0.5;
    const preset = selectPresetForTrack(cleanName, energy);
    if (isStale()) return;
    setKineticPreset(preset);

    // Auto-apply optimized visual preset based on track characteristics
    const visualPresetId = selectVisualPreset(cleanName, undefined, energy, realBpm);
    const visualPreset = visualPresets[visualPresetId];
    if (visualPreset) {
      setVizParams({ ...DEFAULT_VIZ_PARAMS, ...visualPreset.vizParams });
      setBgColor(visualPreset.bgColor);
      setMeshColor(visualPreset.meshColor);
      setVisualizationStyle(visualPreset.visualizationStyle);
      showToast(`Applied "${visualPreset.name}" preset`, "info");
    }

    // Store analysis for manual AI enrichment — user explicitly clicks "Enhance with AI"
    // (previous fire-and-forget auto-generation removed: it overwrote the visible preset silently)
    (window as any).__pendingAIAnalysis = analysis;
    (window as any).__pendingAICleanName = cleanName;
    (window as any).__pendingAIRealBpm = realBpm;
  }, [csvContent, analysisData, trackMetadata, parseLyricsForTrack, resetAudioDerivedState]);

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

  // Audio analysis loop for shader mode (mirrors useRealAudio: attack/release smoothing + beat detection)
  useEffect(() => {
    if (vizMode !== "shader") return;
    if (!isPlaying) return;

    let raf: number;
    let lastUiUpdate = 0;
    const analyse = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const freqArray = freqArrayRef.current ?? new Uint8Array(analyser.frequencyBinCount);
        freqArrayRef.current = freqArray;
        analyser.getByteFrequencyData(freqArray as unknown as Uint8Array<ArrayBuffer>);
        const arr = freqArray;

        const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
        const binSize = sampleRate / (arr.length * 2);
        const bassBins = Math.max(1, Math.floor(250 / binSize));
        const midBins = Math.max(bassBins + 1, Math.floor(4000 / binSize));

        const rawBass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
        const rawMid = arr.slice(bassBins, midBins).reduce((a, b) => a + b, 0) / ((midBins - bassBins) * 255 || 1);
        const rawTreble = arr.slice(midBins).reduce((a, b) => a + b, 0) / ((arr.length - midBins) * 255 || 1);

        // Attack/release smoothing from shared timing constants (kept in sync with
        // useRealAudio in audioHooks.ts — see audioTiming.ts).
        const bassDiff = rawBass - smoothedBassRef.current;
        smoothedBassRef.current += bassDiff * (bassDiff > 0 ? ATTACK : RELEASE);
        const midDiff = rawMid - smoothedMidRef.current;
        smoothedMidRef.current += midDiff * (midDiff > 0 ? ATTACK : RELEASE);
        const trebleDiff = rawTreble - smoothedTrebleRef.current;
        smoothedTrebleRef.current += trebleDiff * (trebleDiff > 0 ? ATTACK : RELEASE);

        const bass = smoothedBassRef.current;
        const mid = smoothedMidRef.current;
        const treble = smoothedTrebleRef.current;
        const overall = bass * 0.4 + mid * 0.35 + treble * 0.25;

        // Peak hold with decay
        const currentPeak = Math.max(bass, mid, treble);
        if (currentPeak > peakHoldRef.current) {
          peakHoldRef.current = currentPeak;
          peakDecayRef.current = 0;
        } else {
          peakDecayRef.current++;
          if (peakDecayRef.current > 30) {
            peakHoldRef.current *= 0.95;
          }
        }

        // Beat detection: use analyzed beat_times if available, else adaptive bass spike
        let isBeat = false;
        const elapsed = audioElapsedRef.current ?? 0;
        const analysis = currentAnalysisDataRef.current;
        if (analysis?.beat_times?.length) {
          const beats = analysis.beat_times;
          let lo = 0, hi = beats.length - 1;
          while (lo <= hi) {
            const midIdx = (lo + hi) >> 1;
            if (beats[midIdx] < elapsed) lo = midIdx + 1;
            else hi = midIdx - 1;
          }
          let closestIdx = -1;
          let closestDist = Infinity;
          for (let i = Math.max(0, hi); i <= Math.min(beats.length - 1, lo); i++) {
            const dist = Math.abs(beats[i] - elapsed);
            if (dist < closestDist) {
              closestDist = dist;
              closestIdx = i;
            }
          }
          if (closestIdx >= 0 && closestDist < 0.1 && closestIdx !== lastBeatIdxRef.current) {
            isBeat = true;
            lastBeatIdxRef.current = closestIdx;
          }
          if (beats.length > 0 && elapsed < beats[Math.max(0, lastBeatIdxRef.current)]) {
            lastBeatIdxRef.current = -1;
          }
        } else {
          beatCooldownRef.current = Math.max(0, beatCooldownRef.current - 1);
          const avgEnergy = (bass + mid + treble) / 3;
          const threshold = 0.4 + avgEnergy * 0.3;
          isBeat = bass > threshold && bass > lastBassRef.current * 1.1 && beatCooldownRef.current === 0;
          if (isBeat) beatCooldownRef.current = 6;
        }
        lastBassRef.current = bass;

        const newData: AudioData = {
          bass, mid, treble, overall,
          beat: isBeat,
          peak: peakHoldRef.current,
          energy: (bass + mid + treble) / 3,
          drumType: null,
          nextBeatIn: 0,
        };
        liveAudioDataRef.current = newData;
        const now = performance.now();
        if (now - lastUiUpdate > 100) {
          lastUiUpdate = now;
          setLiveAudioData(newData);
        }
      }
      raf = requestAnimationFrame(analyse);
    };
    raf = requestAnimationFrame(analyse);
    return () => cancelAnimationFrame(raf);
  }, [vizMode, isPlaying]);

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
      const cleanName = currentFilename?.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") || "track";
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

  const startRecording = useCallback(() => {
    // canvasRef was never attached to any element, so recording silently no-op'd.
    // Resolve the currently visible visualizer canvas at record time instead.
    const canvas = containerRef.current?.querySelector("canvas") ?? null;
    if (!canvas) {
      setError("Recording failed — no visualizer canvas found");
      return;
    }
    try {
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const mediaRecorder = new MediaRecorder(canvas.captureStream(60), { mimeType, videoBitsPerSecond: 8000000 });
      recordedChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => { setRecordedBlob(new Blob(recordedChunksRef.current, { type: "video/webm" })); };
      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch { setError("Recording failed"); }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  }, []);

  const downloadRecording = useCallback(() => {
    if (!recordedBlob) return;
    const a = document.createElement("a");
    const url = URL.createObjectURL(recordedBlob);
    a.href = url;
    a.download = `visualizer_${Date.now()}.webm`;
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    };
    return () => { delete (window as any).__VIZ_TEST__; };
  }, [handleSelectLibraryTrack]);

  return (
    <div className={`viz-page ${focusMode ? "viz-focus-mode" : ""}`}>
      {showTestPanel && (
        <div className="viz-test-panel">
          <div className="viz-test-panel-row">
            <label>Track
              <select onChange={(e) => handleSelectLibraryTrack(e.target.value)} value={currentFilename || ""}>
                <option value="" disabled>Select a track...</option>
                {libraryFiles.map((f) => (
                  <option key={f.filename} value={f.filename}>{f.filename.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "")}{trackMetadata[f.filename]?.bpm ? ` (${trackMetadata[f.filename]?.bpm} BPM)` : ""}{analysisData[f.filename] ? " ✓" : ""}</option>
                ))}
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
          <select data-testid="viz-track-select" onChange={(e) => handleSelectLibraryTrack(e.target.value)} value={currentFilename || ""} className="viz-track-select">
            <option value="" disabled>Select a track...</option>
            {libraryFiles.map((f) => {
              const name = f.filename.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "");
              const meta = trackMetadata[f.filename];
              const badge = analysisData[f.filename] ? " ✓" : "";
              const metaStr = meta?.bpm ? ` (${meta.bpm} BPM)` : "";
              return <option key={f.filename} value={f.filename}>{name}{metaStr}{badge}</option>;
            })}
          </select>
          {currentFilename && !currentAnalysisData && (
            <button className="viz-analyze-btn" onClick={() => handleAnalyzeTrack(currentFilename)} disabled={analyzing}>
              {analyzing ? "Analyzing..." : "Analyze"}
            </button>
          )}
          {currentFilename && visualPresets[kineticPreset] && (
            <span className="viz-preset-badge" title={`Active preset: ${visualPresets[kineticPreset]?.name || kineticPreset}`}>
              {visualPresets[kineticPreset]?.name || kineticPreset}
            </span>
          )}
          {currentAnalysisData && !loadedPreset && (
            <button className="viz-enhance-btn" onClick={handleEnhanceWithAI} disabled={aiEnhancing} title="Generate AI preset tuned to this track (manual, visible)">
              {aiEnhancing ? "Enhancing..." : "Enhance with AI"}
            </button>
          )}
        </div>
        <div className="viz-actions">
          <PresetFileUpload
            onPresetLoaded={handlePresetLoaded}
            loadedPresetName={loadedPreset?.name ?? null}
            onClearPreset={handleClearPreset}
          />
          {isRecording && <span className="viz-rec"><span className="viz-rec-dot" /> {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, "0")}</span>}
          <div className="viz-btn-group">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`viz-icon-btn ${isRecording ? "rec" : ""}`}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
              title={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? <Square size={14} /> : <Video size={14} />}
            </button>
            {recordedBlob && !isRecording && (
              <button onClick={downloadRecording} className="viz-icon-btn" aria-label="Download recording" title="Download recording">
                <Download size={14} />
              </button>
            )}
          </div>
          <div className="viz-btn-group">
            <button onClick={() => setSceneFrozen(!sceneFrozen)} className={`viz-icon-btn ${sceneFrozen ? "active" : ""}`} aria-label={sceneFrozen ? "Unfreeze scene" : "Freeze scene"} title={sceneFrozen ? "Unfreeze scene" : "Freeze scene"}>
              <Snowflake size={14} />
            </button>
            <button onClick={toggleFocusMode} className="viz-icon-btn" aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"} title={focusMode ? "Exit focus mode" : "Enter focus mode"}>{focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          </div>
          <div className="viz-btn-group">
            <button onClick={() => setVizMode(vizMode === "3d" ? "shader" : vizMode === "shader" ? "2d" : "3d")} className={`viz-icon-btn ${vizMode !== "3d" ? "active" : ""}`} title={`Mode: ${vizMode}`}>{vizMode === "3d" ? <span style={{ fontSize: 11 }}>3D</span> : vizMode === "shader" ? <span style={{ fontSize: 11 }}>FX</span> : <span style={{ fontSize: 11 }}>2D</span>}</button>
            {vizMode === "2d" && (
              <select value={canvas2DMode} onChange={e => setCanvas2DMode(e.target.value as any)} className="viz-2d-mode-select" title="2D mode (2026 visual-flux inspired)">
                <option value="bars">Bars</option>
                <option value="waveform">Wave</option>
                <option value="radial">Radial</option>
                <option value="spectrogram">Spectrogram</option>
                <option value="lissajous">Lissajous</option>
                <option value="constellation">Constellation</option>
                <option value="particles">Particles</option>
              </select>
            )}
            {lyrics.length > 0 && (
              <button onClick={() => setLyricsVisible(!lyricsVisible)} className={`viz-icon-btn viz-lyrics-btn ${lyricsVisible ? "active" : ""}`} aria-label={lyricsVisible ? "Hide lyrics" : "Show lyrics"} title={lyricsVisible ? "Hide lyrics" : "Show lyrics"}>
                <MessageSquare size={14} />
              </button>
            )}
          </div>
          <div className="viz-btn-group">
            <button onClick={() => setShowSettings(!showSettings)} className={`viz-icon-btn ${showSettings ? "active" : ""}`} aria-label={showSettings ? "Close settings" : "Open settings"} title={showSettings ? "Close settings" : "Open settings"}><Settings size={14} /></button>
            <button onClick={() => setShowAnimDemo(!showAnimDemo)} className={`viz-icon-btn ${showAnimDemo ? "active" : ""}`} aria-label="Animation demo" title="Animation demo">
              <Play size={14} />
            </button>
            <button onClick={() => setShowTheatreStudio(!showTheatreStudio)} className={`viz-icon-btn ${showTheatreStudio ? "active" : ""}`} aria-label="Theatre.js Studio" title="Theatre.js Studio — Visual animation editor">
              <Wand2 size={14} />
            </button>
            <button onClick={() => setShowAIPanel(!showAIPanel)} className={`viz-icon-btn viz-ai-toggle ${showAIPanel ? "active" : ""}`} aria-label="AI generate preset" title="AI generate preset"><Sparkles size={14} /></button>
            <button onClick={() => setPrefersReducedMotion(p => !p)} className={`viz-icon-btn ${prefersReducedMotion ? "active" : ""}`} aria-label={prefersReducedMotion ? "Motion on" : "Motion off"} title={prefersReducedMotion ? "Reduced motion: ON (click to disable)" : "Reduced motion: OFF (click to enable)"}>
              <Accessibility size={14} />
            </button>
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
        <div className="viz-canvas-wrap" ref={containerRef}>
          {vizMode === "shader" ? (
            <ShaderVisualizer
              audioData={liveAudioDataRef}
              trackName={currentFilename?.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") ?? ""}
              isPlaying={isPlaying}
              lrcSync={lrcSync}
              lrcSyncLive={lrcSyncLiveRef}
              lyrics={lyrics}
              className="absolute inset-0"
            />
          ) : vizMode === "2d" ? (
            <Canvas2DVisualizer
              audioData={liveAudioDataRef}
              analyserRef={analyserRef}
              isPlaying={isPlaying}
              mode={canvas2DMode}
              lrcSync={lrcSync}
              lrcSyncLive={lrcSyncLiveRef}
              lyrics={lyrics}
              bgColor={bgColor}
            />
          ) : (
            <>
              <Canvas camera={{ position: [0, 0, 7], fov: 55 }} dpr={[1, 1.5]} frameloop={rendererReady ? "always" : "never"}
                gl={{ antialias: true }}
                onCreated={({ gl }) => {
                  // ACES filmic tone mapping — the 2026 standard for cinematic color
                  gl.toneMapping = ACESFilmicToneMapping;
                  gl.toneMappingExposure = 1.05;
                  setRendererBackend("WebGL2");
                  setRendererReady(true);
                }}
              >
                <color attach="background" args={[bgColor]} />
                <VisualizerScene
                  analyserRef={analyserRef}
                  isPlaying={isPlaying}
                  isPaused={isPaused}
                  demoEnabled={demoEnabled}
                  demoBpm={demoBpm}
                  onAudioData={(data) => {
                    // Full-rate ref for visuals, throttled React state for UI chrome —
                    // the unthrottled setState re-rendered the whole page ~60fps.
                    liveAudioDataRef.current = data;
                    const now = performance.now();
                    if (now - last3DUiUpdateRef.current > 100) {
                      last3DUiUpdateRef.current = now;
                      setLiveAudioData(data);
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
                />
              </Canvas>
              {!rendererReady && <div className="viz-loading-overlay"><div className="viz-loading-spinner" /><span>Initializing {rendererBackend || "renderer"}...</span></div>}
              {rendererReady && <div className="viz-backend-badge">{rendererBackend}</div>}
              <StylePicker active={visualizationStyle} onChange={setVisualizationStyle} />
            </>
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
                visible={lyricsVisible}
                presetId={kineticPreset}
                beat={liveAudioData.beat}
                lrcSync={lrcSync}
              />
              {/* Storyboard grammar: letterbox bars on cinematic beats + act cards */}
              <div className={`viz-letterbox top ${storyState.beat?.cinematic ? "on" : ""}`} />
              <div className={`viz-letterbox bottom ${storyState.beat?.cinematic ? "on" : ""}`} />
              <StoryActCard beat={storyState.beat} elapsed={elapsed} />
              {/* Builder silhouette — story anchor, puppeteered by audio + acts */}
              <BuilderFigure audioData={liveAudioDataRef} storyBeat={storyState.beat} visible={lyrics.length > 0} />
        </div>
        {showSettings && <SettingsPanel params={vizParams} onChange={setVizParams} bgColor={bgColor} meshColor={meshColor} onBgChange={setBgColor} onMeshChange={setMeshColor} demoEnabled={demoEnabled} onDemoToggle={setDemoEnabled} kineticPreset={kineticPreset} onKineticPresetChange={setKineticPreset} />}
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
          <audio key={audioUrl} ref={audioElRef} controls src={audioUrl} className="viz-audio" crossOrigin={audioUrl?.startsWith('http://') || audioUrl?.startsWith('https://') ? "anonymous" : undefined}
            onPlay={() => { setIsPlaying(true); setIsPaused(false); if (audioElRef.current) void setupAudio(audioElRef.current); }}
            onPause={() => { setIsPlaying(false); setIsPaused(true); }}
          />
        </div>
      )}

      {!demoEnabled && <UploadPrompt hasAudio={!!audioUrl} onFile={handleFile} />}
      {error && <div className="viz-error-bar"><AlertCircle size={14} /><span>{error}</span></div>}
    </div>
  );
}
