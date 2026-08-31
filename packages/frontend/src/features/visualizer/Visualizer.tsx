import { useRef, useState, useEffect, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { Music, AlertCircle, Maximize2, Minimize2, Video, Square, Download, Settings, Snowflake, MessageSquare, Sparkles, Play, Wand2 } from "lucide-react";
import { listAudioFiles, ensureAnalysis } from "../../services/api";
import type { AudioAnalysisData, AudioData, VizParams } from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";
import { useUIStore } from "../../state/uiStore";
import { getVisualizationForTrack, VisualizationStyle } from "./trackConceptAnalyzer";
import { VisualizerScene } from "./VisualizerScene";
import { ShaderVisualizer } from "./ShaderVisualizer";
import { WebGLRenderer } from "three";
import { SpectrumBar } from "./components/SpectrumBar";
import { StylePicker } from "./components/StylePicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { UploadPrompt } from "./components/UploadPrompt";
import { PresetFileUpload } from "./components/PresetFileUpload";
import { AIVisualizerPrompt } from "./components/AIVisualizerPrompt";
import type { LyricLine } from "./components/LyricOverlay";
import { KineticLyricOverlay } from "./components/KineticLyricOverlay";
import { selectPresetForTrack } from "./components/KineticPresets";
import { AnimationDemo } from "./components/AnimationDemo";
import { parseLyricsFromCsv } from "./lyricsParser";
import type { VisualPreset } from "./visualPreset";
import { showToast } from "../../utils/toast";
console.log("[Visualizer] imported showToast:", typeof showToast);

const _originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? "");
  if (msg.includes("THREE.Clock") || msg.includes("PCFSoftShadowMap")) return;
  _originalWarn(...args);
};

export function Visualizer() {
  const [bgColor, setBgColor] = useState("#050505");
  const [meshColor, setMeshColor] = useState("#6366f1");
  const [demoBpm] = useState(120);
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<Array<{ filename: string; path: string }>>([]);
  const [liveAudioData, setLiveAudioData] = useState<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0 });
  const liveAudioDataRef = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0 });
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
  const [loadedPreset, setLoadedPreset] = useState<VisualPreset | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [vizMode, setVizMode] = useState<"3d" | "shader">("shader"); // Default to shader mode

  const { focusMode, toggleFocusMode } = useUIStore();

  const currentFilename = libraryFiles.find(f => `/api/audio/file/${encodeURIComponent(f.filename)}` === audioUrl)?.filename;
  const currentAnalysisData = currentFilename ? analysisData[currentFilename] ?? null : null;

  const audioElapsedRef = useRef(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const connectedElements = useRef<WeakSet<HTMLMediaElement>>(new WeakSet());

  // Load CSV and library
  useEffect(() => { fetch("/track-prompts-lyrics.csv").then(r => r.text()).then(setCsvContent).catch(() => {}); }, []);
  useEffect(() => { listAudioFiles().then(files => { if (Array.isArray(files) && files.length > 0) setLibraryFiles(files); }).catch(() => {}); }, []);

  // Parse lyrics from CSV into timed lines (uses shared parser)
  const parseLyricsForTrack = useCallback((trackName: string, duration: number): LyricLine[] => {
    return parseLyricsFromCsv(csvContent, trackName, duration);
  }, [csvContent]);

  // Audio elapsed tracking — use rAF for precise timing (timeupdate only fires every 250ms)
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    let rafId: number;
    const track = () => {
      audioElapsedRef.current = el.currentTime;
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [audioUrl]);

  const setupAudio = useCallback(async (el: HTMLMediaElement) => {
    try {
      // Skip if this element was already connected (prevents "already connected" error)
      if (connectedElements.current.has(el)) return;
      connectedElements.current.add(el);

      // Close previous context if switching elements
      if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch {} sourceRef.current = null; }
      if (audioCtxRef.current) { try { await audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      const source = ctx.createMediaElementSource(el);
      sourceRef.current = source;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      if (ctx.state === "suspended") await ctx.resume();
    } catch (e) { setError(e instanceof Error ? e.message : "Web Audio setup failed"); }
  }, []);

  const handleFile = useCallback((file: File) => {
    setError(null);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setAudioUrl(url);
    setDemoEnabled(false);
    setIsPaused(false);
  }, []);

  const handleSelectLibraryTrack = useCallback(async (filename: string) => {
    if (!filename) return;
    setError(null);
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
        const ensuredAnalysis = result?.analysis;
        if (ensuredAnalysis) {
          analysis = ensuredAnalysis;
          setAnalysisData(prev => ({ ...prev, [filename]: ensuredAnalysis }));
          realBpm = ensuredAnalysis.tempo_bpm ? Math.round(ensuredAnalysis.tempo_bpm) : undefined;
          if (realBpm) setTrackMetadata(prev => ({ ...prev, [filename]: { bpm: realBpm } }));
        }
      } catch { /* fallback */ }
    }
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

    // Load lyrics for this track
    const duration = analysis?.duration_seconds || 240;
    const trackLyrics = parseLyricsForTrack(cleanName, duration);
    setLyrics(trackLyrics);
    setLyricsVisible(trackLyrics.length > 0);

    // Auto-select kinetic preset based on track genre
    const energy = analysis?.energy_curve?.length
      ? analysis.energy_curve.reduce((a, b) => a + b, 0) / analysis.energy_curve.length
      : 0.5;
    const preset = selectPresetForTrack(cleanName, energy);
    setKineticPreset(preset);
  }, [csvContent, analysisData, trackMetadata, parseLyricsForTrack]);

  /** Select visualization style based on audio analysis data */
  const selectVisualizationForTrack = (analysis: AudioAnalysisData): VisualizationStyle | null => {
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
    // Low energy + slow → Aurora (dreamy) or Ocean
    if (energyAvg < 0.4 && bpm < 100) return Math.random() > 0.5 ? "aurora" : "ocean";
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
  };

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

  // Audio analysis loop for shader mode (VisualizerScene only runs in 3D mode)
  useEffect(() => {
    if (vizMode !== "shader") return;
    if (!isPlaying) return;

    let raf: number;
    const analyse = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const freqArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqArray);
        const arr = freqArray;

        const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
        const binSize = sampleRate / (arr.length * 2);
        const bassBins = Math.max(1, Math.floor(250 / binSize));
        const midBins = Math.max(bassBins + 1, Math.floor(4000 / binSize));

        const rawBass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
        const rawMid = arr.slice(bassBins, midBins).reduce((a, b) => a + b, 0) / ((midBins - bassBins) * 255 || 1);
        const rawTreble = arr.slice(midBins).reduce((a, b) => a + b, 0) / ((arr.length - midBins) * 255 || 1);

        const bass = rawBass;
        const mid = rawMid;
        const treble = rawTreble;
        const overall = bass * 0.4 + mid * 0.35 + treble * 0.25;
        const peak = Math.max(bass, mid, treble);
        const energy = (bass + mid + treble) / 3;

        const newData: AudioData = { bass, mid, treble, overall, beat: false, peak, energy };
        liveAudioDataRef.current = newData;
        setLiveAudioData(newData);
      }
      raf = requestAnimationFrame(analyse);
    };
    raf = requestAnimationFrame(analyse);
    return () => cancelAnimationFrame(raf);
  }, [vizMode, isPlaying]);
  const applyPreset = useCallback((preset: VisualPreset, trackAnalysis?: AudioAnalysisData | null) => {
    setLoadedPreset(preset);

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
    if (preset.visualizer?.style && styleMap[preset.visualizer.style]) {
      setVisualizationStyle(styleMap[preset.visualizer.style]);
    }

    // Apply theme colors
    if (preset.theme?.background) setBgColor(preset.theme.background);
    if (preset.theme?.primary) setMeshColor(preset.theme.primary);

    // Compute track-aware multipliers
    const bpm = trackAnalysis?.tempo_bpm ?? 120;
    const energyAvg = trackAnalysis?.energy_curve?.length
      ? trackAnalysis.energy_curve.reduce((a, b) => a + b, 0) / trackAnalysis.energy_curve.length
      : 0.5;
    const duration = trackAnalysis?.duration_seconds ?? 240;
    const bpmFactor = bpm / 120;
    const energyFactor = 0.5 + energyAvg;

    // Apply postfx simulation via fog and light intensity
    const postfx = (preset as any).postfx || {};
    const bloomIntensity = postfx.bloom ?? 0;
    const vignetteStrength = postfx.vignetteStrength ?? 0;
    const glitchAmount = postfx.glitch ?? 0;

    // Apply visualizer params with track alignment + postfx
    setVizParams(prev => ({
      ...prev,
      particleCount: Math.round((preset.visualizer?.particleCount ?? prev.particleCount) * energyFactor),
      scale: preset.visualizer?.scale ?? prev.scale,
      glowIntensity: preset.visualizer?.glow ? Math.min(1.0, 0.8 * energyFactor + bloomIntensity * 0.2) : 0.2,
      rotationSpeed: (preset.visualizer?.rotation ? 1.0 : 0.0) * bpmFactor,
      colorShift: preset.visualizer?.intensity ?? prev.colorShift,
      lerpSpeed: Math.max(0.1, 0.35 / bpmFactor),
      matchTrack: !!trackAnalysis,
      // Postfx-driven params
      lightIntensity: 0.8 + bloomIntensity * 0.4 - vignetteStrength * 0.2,
      fogDensity: vignetteStrength * 0.02,
      fogEnabled: vignetteStrength > 0.3,
      // Store postfx for scene to consume
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
    if (preset.lyrics?.style && kineticMap[preset.lyrics.style]) {
      setKineticPreset(kineticMap[preset.lyrics.style]);
    }

    // Store full preset data on the preset for the scene to consume
    (preset as any)._trackAlignment = {
      bpm,
      energyAvg,
      duration,
      beatTimes: trackAnalysis?.beat_times,
      onsetTimes: trackAnalysis?.onset_times,
      sections: trackAnalysis?.sections,
      postfx: (preset as any).postfx,
      audioReactivity: (preset as any).audioReactivity,
      camera: (preset as any).camera,
    };
  }, []);

  const handlePresetLoaded = useCallback((preset: VisualPreset) => {
    console.log("[Visualizer] handlePresetLoaded called");
    // Pass current track analysis so preset aligns to loaded track
    applyPreset(preset, currentAnalysisData);
    // Show notification with preset details
    const presetName = (preset as any)?.name || "AI Preset";
    const style = (preset as any)?.visualizer?.style || "custom";
    const mode = vizMode === "shader" ? "shader" : "3D";
    console.log("[Visualizer] Calling showToast for:", presetName);
    showToast(`Applied "${presetName}" → ${mode} (${style})`);
  }, [applyPreset, currentAnalysisData, vizMode]);

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
      setAnalysisData(prev => ({ ...prev, [filename]: result.analysis }));
      setTrackMetadata(prev => ({ ...prev, [filename]: { bpm: Math.round(result.analysis.tempo_bpm), duration: Math.round(result.analysis.duration_seconds) } }));
    } catch { /* ignore */ }
    setAnalyzing(false);
  }, [analyzing]);

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    a.href = URL.createObjectURL(recordedBlob);
    a.download = `visualizer_${Date.now()}.webm`;
    a.click();
  }, [recordedBlob]);

  return (
    <div className={`viz-page ${focusMode ? "viz-focus-mode" : ""}`}>
      <header className="viz-topbar">
        <div className="viz-brand"><Music size={20} /><span>Visualizer</span></div>
        <div className="viz-track-selector">
          <select onChange={(e) => handleSelectLibraryTrack(e.target.value)} value={currentFilename || ""} className="viz-track-select">
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
        </div>
        <div className="viz-actions">
          <PresetFileUpload
            onPresetLoaded={handlePresetLoaded}
            loadedPresetName={loadedPreset?.name ?? null}
            onClearPreset={handleClearPreset}
          />
          {isRecording && <span className="viz-rec"><span className="viz-rec-dot" /> {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, "0")}</span>}
          <button onClick={isRecording ? stopRecording : startRecording} className={`viz-icon-btn ${isRecording ? "rec" : ""}`} aria-label={isRecording ? "Stop recording" : "Start recording"} title={isRecording ? "Stop recording" : "Start recording"}>{isRecording ? <Square size={14} /> : <Video size={14} />}</button>
          {recordedBlob && !isRecording && <button onClick={downloadRecording} className="viz-icon-btn" aria-label="Download recording" title="Download recording"><Download size={14} /></button>}
          <button onClick={() => setSceneFrozen(!sceneFrozen)} className={`viz-icon-btn ${sceneFrozen ? "active" : ""}`} aria-label={sceneFrozen ? "Unfreeze scene" : "Freeze scene"} title={sceneFrozen ? "Unfreeze scene" : "Freeze scene"}>
            <Snowflake size={14} />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className={`viz-icon-btn ${showSettings ? "active" : ""}`} aria-label={showSettings ? "Close settings" : "Open settings"} title={showSettings ? "Close settings" : "Open settings"}><Settings size={14} /></button>
          <button onClick={() => setShowAnimDemo(!showAnimDemo)} className={`viz-icon-btn ${showAnimDemo ? "active" : ""}`} aria-label="Animation demo" title="Animation demo">
            <Play size={14} />
          </button>
          <button onClick={() => setShowAIPanel(!showAIPanel)} className={`viz-icon-btn viz-ai-toggle ${showAIPanel ? "active" : ""}`} aria-label="AI generate preset" title="AI generate preset"><Sparkles size={14} /></button>
          <button onClick={() => setVizMode(vizMode === "3d" ? "shader" : "3d")} className={`viz-icon-btn ${vizMode === "shader" ? "active" : ""}`} title={`Mode: ${vizMode === "3d" ? "3D Scene" : "Shader"}`}>{vizMode === "3d" ? <span style={{ fontSize: 11 }}>3D</span> : <span style={{ fontSize: 11 }}>FX</span>}</button>
          {lyrics.length > 0 && (
            <button onClick={() => setLyricsVisible(!lyricsVisible)} className={`viz-icon-btn viz-lyrics-btn ${lyricsVisible ? "active" : ""}`} aria-label={lyricsVisible ? "Hide lyrics" : "Show lyrics"} title={lyricsVisible ? "Hide lyrics" : "Show lyrics"}>
              <MessageSquare size={14} />
            </button>
          )}
          <button onClick={toggleFocusMode} className="viz-icon-btn" aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"} title={focusMode ? "Exit focus mode" : "Enter focus mode"}>{focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        </div>
      </header>

      <AnimationDemo visible={showAnimDemo} onClose={() => setShowAnimDemo(false)} />

      <div className="viz-content">
        <div className="viz-canvas-wrap" ref={containerRef}>
          {vizMode === "shader" ? (
            <ShaderVisualizer
              audioData={liveAudioDataRef}
              trackName={currentFilename?.replace(/^([0-9a-f]{8}_)+/i, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "") ?? ""}
              isPlaying={isPlaying}
              className="absolute inset-0"
            />
          ) : (
            <>
              <Canvas camera={{ position: [0, 0, 7], fov: 55 }} dpr={[1, 1.5]} frameloop={rendererReady ? "always" : "never"}
                gl={async (props) => {
                  // Force WebGL2 — WebGPU doesn't support CanvasTexture which visualizations need
                  const r = new WebGLRenderer({ ...props, antialias: true });
                  setRendererBackend("WebGL2");
                  setRendererReady(true);
                  return r;
                }}
              >
                <color attach="background" args={[bgColor]} />
                <VisualizerScene
                  analyserRef={analyserRef}
                  isPlaying={isPlaying}
                  isPaused={isPaused}
                  demoEnabled={demoEnabled}
                  demoBpm={demoBpm}
                  onAudioData={(data) => { liveAudioDataRef.current = data; setLiveAudioData(data); }}
                  visualizationStyle={visualizationStyle}
                  vizParams={vizParams}
                  bgColor={bgColor}
                  meshColor={meshColor}
                  analysisData={currentAnalysisData}
                  audioElapsedRef={audioElapsedRef}
                  sceneFrozen={sceneFrozen}
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
          <KineticLyricOverlay lyrics={lyrics} elapsed={audioElapsedRef.current} visible={lyricsVisible} presetId={kineticPreset} beat={liveAudioData.beat} />
        </div>
        {showSettings && <SettingsPanel params={vizParams} onChange={setVizParams} bgColor={bgColor} meshColor={meshColor} onBgChange={setBgColor} onMeshChange={setMeshColor} demoEnabled={demoEnabled} onDemoToggle={setDemoEnabled} kineticPreset={kineticPreset} onKineticPresetChange={setKineticPreset} />}
        {showAIPanel && <AIVisualizerPrompt onApplyPreset={handlePresetLoaded} trackMeta={deriveTrackMeta(currentAnalysisData)} trackName={currentFilename} />}
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
          <audio key={audioUrl} ref={audioElRef} controls src={audioUrl} className="viz-audio" crossOrigin="anonymous"
            onPlay={() => { setIsPlaying(true); setIsPaused(false); setupAudio(audioElRef.current!); }}
            onPause={() => { setIsPlaying(false); setIsPaused(true); }}
          />
        </div>
      )}

      {!demoEnabled && <UploadPrompt hasAudio={!!audioUrl} onFile={handleFile} />}
      {error && <div className="viz-error-bar"><AlertCircle size={14} /><span>{error}</span></div>}
    </div>
  );
}
