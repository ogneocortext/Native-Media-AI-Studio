import { useRef, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Upload, Music, AlertCircle, Pause, FolderOpen, Waves, Palette, Sparkles } from "lucide-react";
import { listAudioFiles } from "../../services/api";
import {
  getVisualizationForTrack,
  VISUALIZATION_OPTIONS,
  VisualizationStyle,
  TrackConcept,
} from "./trackConceptAnalyzer";
import { VisualizerScene } from "./VisualizerScene";
import type { VizParams, AudioData } from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";

function SpectrumBar({ label, value, color, intensity }: { label: string; value: number; color: string; intensity: number }) {
  const scaledValue = Math.min(value * intensity, 1);
  return (
    <div className="spec-bar-row">
      <span className="spec-bar-label">{label}</span>
      <div className="spec-bar-track">
        <div
          className="spec-bar-fill"
          style={{
            width: `${scaledValue * 100}%`,
            background: `linear-gradient(90deg, ${color}, ${color}dd, ${color}88)`,
            boxShadow: scaledValue > 0.7 ? `0 0 12px ${color}, 0 0 24px ${color}66` : `0 0 6px ${color}66`,
            transition: "width 0.05s ease-out, box-shadow 0.1s ease-out",
          }}
        />
        {scaledValue > 0.8 && (
          <div
            className="spec-bar-glow"
            style={{
              background: `radial-gradient(circle, ${color}88 0%, transparent 70%)`,
            }}
          />
        )}
      </div>
      <span className="spec-bar-value" style={{ color: scaledValue > 0.8 ? color : "#6b7280" }}>
        {Math.round(scaledValue * 100)}
      </span>
    </div>
  );
}

export function Visualizer() {
  const [bgColor, setBgColor] = useState("#050505");
  const [meshColor, setMeshColor] = useState("#6366f1");
  const [demoBpm, _setDemoBpm] = useState(120);
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<Array<{ filename: string; path: string }>>([]);
  const [liveAudioData, setLiveAudioData] = useState<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false });
  const [spectrumIntensity] = useState(1);
  const [visualizationStyle, setVisualizationStyle] = useState<VisualizationStyle>("geometric");
  const [trackConcept, setTrackConcept] = useState<TrackConcept | null>(null);
  const [csvContent, setCsvContent] = useState<string>("");
  const [vizParams, setVizParams] = useState<VizParams>(DEFAULT_VIZ_PARAMS);
  const [useOllamaMatch, setUseOllamaMatch] = useState(false);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load CSV content on mount
  useEffect(() => {
    fetch("/track-prompts-lyrics.csv")
      .then((r) => r.text())
      .then((content) => setCsvContent(content))
      .catch(() => console.log("CSV not found"));
  }, []);

  // Load available tracks from API on mount
  useEffect(() => {
    listAudioFiles()
      .then((files) => {
        if (Array.isArray(files) && files.length > 0) {
          setLibraryFiles(files);
        }
      })
      .catch(() => {
        // Preset tracks remain available
      });
  }, []);

  // Setup Web Audio graph when audioUrl changes
  useEffect(() => {
    if (!audioUrl) return;
    const el = audioElRef.current;
    if (!el) return;

    const setup = async () => {
      try {
        // Disconnect previous source if exists to avoid "already connected" error
        if (sourceRef.current) {
          try { sourceRef.current.disconnect(); } catch { /* ignore */ }
          sourceRef.current = null;
        }
        // Close previous context if exists
        if (audioCtxRef.current) {
          try { await audioCtxRef.current.close(); } catch { /* ignore */ }
          audioCtxRef.current = null;
        }

        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.4;
        analyserRef.current = analyser;
        const source = ctx.createMediaElementSource(el);
        sourceRef.current = source;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        if (ctx.state === "suspended") await ctx.resume();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Web Audio setup failed");
      }
    };
    setup();
    return () => {
      try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
      try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
      try { audioCtxRef.current?.close(); } catch { /* ignore */ }
      analyserRef.current = null;
      audioCtxRef.current = null;
      sourceRef.current = null;
    };
  }, [audioUrl]);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("audio/") && !f.name.match(/\.(mp3|wav|flac|ogg|m4a)$/i)) {
      setError("Please upload MP3/WAV/FLAC/OGG/M4A");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(f);
    setAudioUrl(url);
    setDemoEnabled(false);
    setIsPaused(false);
  };

  const handleSelectLibraryTrack = (filename: string) => {
    if (!filename) return;
    setError(null);
    const encodedFilename = encodeURIComponent(filename);
    setAudioUrl(`/api/audio/file/${encodedFilename}`);
    setDemoEnabled(false);
    setIsPaused(false);

    // Analyze track concept and recommend visualization
    if (csvContent) {
      const cleanName = filename.replace(/^\w{8}_/, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "");
      const concept = getVisualizationForTrack(cleanName, csvContent);
      if (concept) {
        setTrackConcept(concept);
        setVisualizationStyle(concept.recommendedViz);
        if (vizParams.matchTrack) {
          applyTrackMatchParams(concept, useOllamaMatch);
        }
      }
    }
  };

  const applyTrackMatchParams = async (concept: TrackConcept, useOllama: boolean = false) => {
    // Try Ollama-powered analysis if selected and available
    if (useOllama && ollamaAvailable) {
      try {
        setOllamaStreaming(true);
        setOllamaProgress("Connecting to Ollama...");
        setGeneratedHtml("");

        const res = await fetch("/api/integrations/analyze-track-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            track_name: concept.trackName,
            prompt: concept.prompt,
            lyrics: concept.lyrics,
            bpm: concept.bpm,
          }),
        });

        if (res.ok) {
          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let fullHtml = "";

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split("\n").filter(line => line.trim());

              for (const line of lines) {
                try {
                  const data = JSON.parse(line);
                  if (data.type === "streaming") {
                    setOllamaProgress(`Generating: ${data.chunk.substring(0, 50)}...`);
                    fullHtml += data.chunk;
                  } else if (data.type === "complete") {
                    setOllamaProgress("Complete!");
                    setGeneratedHtml(data.html);
                  } else if (data.type === "cached") {
                    setOllamaProgress("Using cached result");
                    if (data.html) setGeneratedHtml(data.html);
                  } else if (data.type === "error") {
                    setOllamaProgress(`Error: ${data.message}`);
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }

          setOllamaStreaming(false);
          return;
        }
      } catch (e) {
        console.log("Ollama analysis failed, using fallback");
        setOllamaStreaming(false);
      }
    }

    // Rule-based fallback (no VRAM usage)
    const params = { ...vizParams };
    params.rotationSpeed = Math.max(0.5, Math.min(3.0, concept.bpm / 60));
    if (concept.energy === "high") {
      params.glowIntensity = 1.0;
      params.scaleBoost = 2.0;
      params.lerpSpeed = 0.5;
    } else if (concept.energy === "low") {
      params.glowIntensity = 0.3;
      params.scaleBoost = 1.0;
      params.lerpSpeed = 0.2;
    }
    if (concept.mood.includes("aggressive") || concept.mood.includes("intense")) {
      params.materialType = "neon";
    } else if (concept.mood.includes("dreamy") || concept.mood.includes("ethereal")) {
      params.materialType = "glass";
      params.fogEnabled = true;
    } else if (concept.mood.includes("melancholic") || concept.mood.includes("introspective")) {
      params.materialType = "matte";
      params.lightIntensity = 0.8;
    } else if (concept.mood.includes("euphoric") || concept.mood.includes("energetic")) {
      params.materialType = "metallic";
      params.reflectionEnabled = true;
    }
    setVizParams(params);
  };

  const handleMatchTrackToggle = (enabled: boolean) => {
    setVizParams({ ...vizParams, matchTrack: enabled });
    if (enabled && trackConcept) {
      applyTrackMatchParams(trackConcept, useOllamaMatch);
    }
  };

  useEffect(() => {
    if (vizParams.matchTrack && trackConcept) {
      applyTrackMatchParams(trackConcept, useOllamaMatch);
    }
  }, [trackConcept]);

  useEffect(() => {
    const checkOllama = async () => {
      try {
        const res = await fetch("http://127.0.0.1:11434/api/tags");
        if (res.ok) {
          setOllamaAvailable(true);
        }
      } catch {
        setOllamaAvailable(false);
      }
    };
    checkOllama();
  }, []);

  const [ollamaStreaming, setOllamaStreaming] = useState(false);
  const [ollamaProgress, setOllamaProgress] = useState("");
  const [generatedHtml, setGeneratedHtml] = useState<string>("");
  const [showPreview, setShowPreview] = useState(false);
  const [activePanel, setActivePanel] = useState<string>("source");

  const togglePanel = (panel: string) => {
    setActivePanel(activePanel === panel ? "" : panel);
  };

  return (
    <div className="viz-page">
      <div className="viz-header">
        <div className="viz-title-row">
          <Music size={22} className="viz-icon" />
          <h1 className="viz-title">3D Audio Visualizer</h1>
        </div>
        <p className="viz-subtitle">
          Select a track → 3D mesh reacts to <b>bass</b>, <b>mids</b>, <b>treble</b>
        </p>
      </div>

      <div className="viz-layout">
        {/* Left: Canvas + Spectrum */}
        <div className="viz-main">
          <div className="viz-canvas-container">
            <Canvas camera={{ position: [0, 0, 7], fov: 55 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }} frameloop="always" shadows>
              <color attach="background" args={[bgColor]} />
              <VisualizerScene
                analyserRef={analyserRef}
                isPlaying={isPlaying}
                isPaused={isPaused}
                demoEnabled={demoEnabled}
                demoBpm={demoBpm}
                onAudioData={setLiveAudioData}
                visualizationStyle={visualizationStyle}
                vizParams={vizParams}
                bgColor={bgColor}
                meshColor={meshColor}
              />
            </Canvas>
            {isPaused && (
              <div className="viz-paused-overlay">
                <Pause size={48} />
                <span>Paused</span>
              </div>
            )}
            {liveAudioData.beat && <div className="viz-beat-flash" />}
          </div>

          {/* Spectrum */}
          <div className="viz-spectrum-card">
            <div className="viz-spectrum-bars">
              <SpectrumBar label="Bass" value={liveAudioData.bass} color="#6366f1" intensity={spectrumIntensity} />
              <SpectrumBar label="Mid" value={liveAudioData.mid} color="#a855f7" intensity={spectrumIntensity} />
              <SpectrumBar label="Treble" value={liveAudioData.treble} color="#ec4899" intensity={spectrumIntensity} />
            </div>
            <div className={`viz-beat-dot ${liveAudioData.beat ? "active" : ""}`} />
          </div>

          {/* Persistent Audio Player */}
          {audioUrl && (
            <div className="viz-audio-bar">
              {/* key forces a fresh <audio> element per track: a media element can only be
                  connected to ONE MediaElementSourceNode ever, so reusing the node across
                  tracks would throw "already connected" on createMediaElementSource */}
              <audio key={audioUrl} ref={audioElRef} controls src={audioUrl} className="viz-audio" crossOrigin="anonymous"
                onPlay={() => { setIsPlaying(true); setIsPaused(false); audioCtxRef.current?.resume(); }}
                onPause={() => { setIsPlaying(false); setIsPaused(true); }}
                onEnded={() => { setIsPlaying(false); setIsPaused(false); }}
              />
            </div>
          )}
        </div>

        {/* Right: Controls - Accordion Style */}
        <div className="viz-controls">
          {/* Panel: Source */}
          <div className={`viz-panel ${activePanel === "source" ? "open" : ""}`}>
            <button className="viz-panel-header" onClick={() => togglePanel("source")}>
              <FolderOpen size={14} />
              <span>Audio Source</span>
              <span className="viz-panel-chevron">{activePanel === "source" ? "−" : "+"}</span>
            </button>
            {activePanel === "source" && (
              <div className="viz-panel-content">
                <select onChange={(e) => handleSelectLibraryTrack(e.target.value)} className="viz-select" defaultValue="">
                  <option value="" disabled>Select track...</option>
                  {libraryFiles.map((f) => (
                    <option key={f.filename} value={f.filename}>{f.filename.replace(/^\w{8}_/, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "")}</option>
                  ))}
                </select>
                <div className="viz-dropzone" onClick={() => fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                  <Upload size={16} />
                  <span>Drop or click to upload</span>
                </div>
                {error && <div className="viz-error"><AlertCircle size={14} /><span>{error}</span></div>}
              </div>
            )}
          </div>

          {/* Panel: Visualization */}
          <div className={`viz-panel ${activePanel === "viz" ? "open" : ""}`}>
            <button className="viz-panel-header" onClick={() => togglePanel("viz")}>
              <Sparkles size={14} />
              <span>Visualization</span>
              <span className="viz-panel-chevron">{activePanel === "viz" ? "−" : "+"}</span>
            </button>
            {activePanel === "viz" && (
              <div className="viz-panel-content">
                <div className="viz-style-grid">
                  {VISUALIZATION_OPTIONS.map((viz) => (
                    <button key={viz.id} className={`viz-style-btn ${visualizationStyle === viz.id ? "active" : ""}`} onClick={() => setVisualizationStyle(viz.id)}>
                      {viz.name}
                    </button>
                  ))}
                </div>
                {trackConcept && (
                  <div className="viz-concept-info">
                    <span>{trackConcept.mood.join(", ")}</span>
                    <span>{trackConcept.bpm} BPM</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Panel: Match Track */}
          <div className={`viz-panel ${activePanel === "match" ? "open" : ""}`}>
            <button className="viz-panel-header" onClick={() => togglePanel("match")}>
              <Waves size={14} />
              <span>Match Track</span>
              <span className="viz-panel-chevron">{activePanel === "match" ? "−" : "+"}</span>
            </button>
            {activePanel === "match" && (
              <div className="viz-panel-content">
                <label className="viz-toggle-label">
                  <input type="checkbox" checked={vizParams.matchTrack} onChange={(e) => handleMatchTrackToggle(e.target.checked)} />
                  <span>Auto-adjust from analysis</span>
                </label>
                {vizParams.matchTrack && !trackConcept && (
                  <p className="viz-hint">Select a track to apply analysis</p>
                )}
                {vizParams.matchTrack && trackConcept && (
                  <div className="viz-match-info">
                    <span>{trackConcept.trackName}</span>
                    <span>{trackConcept.bpm} BPM • {trackConcept.mood.join(", ")}</span>
                  </div>
                )}
                {vizParams.matchTrack && (
                  <div className="viz-match-modes">
                    <label className={`viz-match-mode ${!useOllamaMatch ? "active" : ""}`}>
                      <input type="radio" name="matchMode" checked={!useOllamaMatch} onChange={() => setUseOllamaMatch(false)} />
                      <span>Quick</span>
                    </label>
                    <label className={`viz-match-mode ${useOllamaMatch ? "active" : ""}`}>
                      <input type="radio" name="matchMode" checked={useOllamaMatch} onChange={() => setUseOllamaMatch(true)} disabled={!ollamaAvailable} />
                      <span>AI</span>
                      {ollamaAvailable && <span className="viz-ollama-badge">AI</span>}
                    </label>
                  </div>
                )}
                {ollamaStreaming && (
                  <div className="viz-streaming">
                    <div className="viz-streaming-dot" />
                    <span>{ollamaProgress}</span>
                  </div>
                )}
                {generatedHtml && !ollamaStreaming && (
                  <div className="viz-preview">
                    <button className="viz-preview-btn" onClick={() => setShowPreview(!showPreview)}>
                      {showPreview ? "Hide Preview" : "Show Preview"}
                    </button>
                    {showPreview && (
                      <iframe
                        srcDoc={generatedHtml}
                        className="viz-preview-iframe"
                        title="Visualization Preview"
                        sandbox="allow-scripts"
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Panel: Parameters */}
          <div className={`viz-panel ${activePanel === "params" ? "open" : ""}`}>
            <button className="viz-panel-header" onClick={() => togglePanel("params")}>
              <Palette size={14} />
              <span>Parameters</span>
              <span className="viz-panel-chevron">{activePanel === "params" ? "−" : "+"}</span>
            </button>
            {activePanel === "params" && (
              <div className="viz-panel-content">
                <div className="viz-param-group">
                  <p className="viz-param-group-title">Motion</p>
                  <div className="viz-param-row"><label>Scale</label><input type="range" min="0.5" max="3" step="0.1" value={vizParams.scale} onChange={(e) => setVizParams({...vizParams, scale: parseFloat(e.target.value)})} /><span>{vizParams.scale.toFixed(1)}</span></div>
                  <div className="viz-param-row"><label>Boost</label><input type="range" min="0.5" max="3" step="0.1" value={vizParams.scaleBoost} onChange={(e) => setVizParams({...vizParams, scaleBoost: parseFloat(e.target.value)})} /><span>{vizParams.scaleBoost.toFixed(1)}</span></div>
                  <div className="viz-param-row"><label>Rotation</label><input type="range" min="0.1" max="5" step="0.1" value={vizParams.rotationSpeed} onChange={(e) => setVizParams({...vizParams, rotationSpeed: parseFloat(e.target.value)})} /><span>{vizParams.rotationSpeed.toFixed(1)}</span></div>
                  <div className="viz-param-row"><label>Response</label><input type="range" min="0.1" max="1" step="0.05" value={vizParams.lerpSpeed} onChange={(e) => setVizParams({...vizParams, lerpSpeed: parseFloat(e.target.value)})} /><span>{vizParams.lerpSpeed.toFixed(2)}</span></div>
                </div>
                <div className="viz-param-group">
                  <p className="viz-param-group-title">Appearance</p>
                  <div className="viz-param-row"><label>Glow</label><input type="range" min="0" max="1" step="0.05" value={vizParams.glowIntensity} onChange={(e) => setVizParams({...vizParams, glowIntensity: parseFloat(e.target.value)})} /><span>{vizParams.glowIntensity.toFixed(2)}</span></div>
                  <div className="viz-param-row"><label>Color Shift</label><input type="range" min="0" max="3" step="0.1" value={vizParams.colorShift} onChange={(e) => setVizParams({...vizParams, colorShift: parseFloat(e.target.value)})} /><span>{vizParams.colorShift.toFixed(1)}</span></div>
                  <div className="viz-param-row"><label>Opacity</label><input type="range" min="0.2" max="1" step="0.05" value={vizParams.opacity} onChange={(e) => setVizParams({...vizParams, opacity: parseFloat(e.target.value)})} /><span>{vizParams.opacity.toFixed(2)}</span></div>
                  <div className="viz-param-row"><label>P. Size</label><input type="range" min="0.01" max="0.2" step="0.01" value={vizParams.particleSize} onChange={(e) => setVizParams({...vizParams, particleSize: parseFloat(e.target.value)})} /><span>{vizParams.particleSize.toFixed(2)}</span></div>
                  <div className="viz-param-row"><label>Material</label>
                    <select value={vizParams.materialType} onChange={(e) => setVizParams({...vizParams, materialType: e.target.value as VizParams["materialType"]})}>
                      <option value="standard">Standard</option>
                      <option value="metallic">Metallic</option>
                      <option value="glass">Glass</option>
                      <option value="neon">Neon</option>
                      <option value="matte">Matte</option>
                    </select>
                  </div>
                  <div className="viz-param-row"><label>Wireframe</label><input type="checkbox" checked={vizParams.wireframe} onChange={(e) => setVizParams({...vizParams, wireframe: e.target.checked})} /></div>
                </div>
                <div className="viz-param-group">
                  <p className="viz-param-group-title">Scene</p>
                  <div className="viz-param-row"><label>Shadows</label><input type="checkbox" checked={vizParams.shadowEnabled} onChange={(e) => setVizParams({...vizParams, shadowEnabled: e.target.checked})} /></div>
                  <div className="viz-param-row"><label>Reflections</label><input type="checkbox" checked={vizParams.reflectionEnabled} onChange={(e) => setVizParams({...vizParams, reflectionEnabled: e.target.checked})} /></div>
                  <div className="viz-param-row"><label>Ground</label><input type="checkbox" checked={vizParams.showGround} onChange={(e) => setVizParams({...vizParams, showGround: e.target.checked})} /></div>
                  <div className="viz-param-row"><label>Particles</label><input type="range" min="0" max="1000" step="50" value={vizParams.particleCount} onChange={(e) => setVizParams({...vizParams, particleCount: parseInt(e.target.value)})} /><span>{vizParams.particleCount}</span></div>
                  <div className="viz-param-row"><label>Floating</label><input type="checkbox" checked={vizParams.showFloatingShapes} onChange={(e) => setVizParams({...vizParams, showFloatingShapes: e.target.checked})} /></div>
                  <div className="viz-param-row"><label>Light Rays</label><input type="checkbox" checked={vizParams.showLightRays} onChange={(e) => setVizParams({...vizParams, showLightRays: e.target.checked})} /></div>
                </div>
                <button className="viz-reset-btn" onClick={() => setVizParams(DEFAULT_VIZ_PARAMS)}>Reset All</button>
              </div>
            )}
          </div>

          {/* Panel: Theme */}
          <div className={`viz-panel ${activePanel === "theme" ? "open" : ""}`}>
            <button className="viz-panel-header" onClick={() => togglePanel("theme")}>
              <Palette size={14} />
              <span>Theme</span>
              <span className="viz-panel-chevron">{activePanel === "theme" ? "−" : "+"}</span>
            </button>
            {activePanel === "theme" && (
              <div className="viz-panel-content">
                <div className="viz-param-row"><label>Background</label><input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="viz-color-picker" /></div>
                <div className="viz-param-row"><label>Mesh</label><input type="color" value={meshColor} onChange={(e) => setMeshColor(e.target.value)} className="viz-color-picker" /></div>
                <div className="viz-param-row"><label>Ambient</label><input type="color" value={vizParams.ambientColor} onChange={(e) => setVizParams({...vizParams, ambientColor: e.target.value})} className="viz-color-picker" /></div>
                <div className="viz-param-row"><label>Light</label><input type="range" min="0.2" max="3" step="0.1" value={vizParams.lightIntensity} onChange={(e) => setVizParams({...vizParams, lightIntensity: parseFloat(e.target.value)})} /><span>{vizParams.lightIntensity.toFixed(1)}</span></div>
                <div className="viz-param-row"><label>Fog</label><input type="checkbox" checked={vizParams.fogEnabled} onChange={(e) => setVizParams({...vizParams, fogEnabled: e.target.checked})} /></div>
                <div className="viz-param-row"><label>Fog Dens.</label><input type="range" min="0" max="0.15" step="0.005" disabled={!vizParams.fogEnabled} value={vizParams.fogDensity} onChange={(e) => setVizParams({...vizParams, fogDensity: parseFloat(e.target.value)})} /><span>{vizParams.fogDensity.toFixed(3)}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
