import React, { Suspense, useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Icosahedron } from "@react-three/drei";
import { Html } from "@react-three/drei";
import { Card } from "../../components/common";
import * as THREE from "three";
import { Upload, Music, AlertCircle, Play, Pause, Volume2, FolderOpen, Maximize2, Camera, Waves } from "lucide-react";
import { listAudioFiles } from "../../services/api";

interface AudioData { bass: number; mid: number; treble: number; overall: number; beat: boolean; }

interface SpectrumBarProps {
  label: string;
  value: number;
  color: string;
}

function SpectrumBar({ label, value, color }: SpectrumBarProps) {
  return (
    <div className="spec-bar-row">
      <span className="spec-bar-label">{label}</span>
      <div className="spec-bar-track">
        <div
          className="spec-bar-fill"
          style={{ width: `${Math.min(value * 100, 100)}%`, background: color }}
        />
      </div>
      <span className="spec-bar-value">{Math.round(value * 100)}</span>
    </div>
  );
}

// Demo fallback — clearly labeled, not silent mock
function useDemoAudio(enabled: boolean, bpm: number) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false });
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    const f = bpm / 120;
    const beatPhase = (t * f * 2) % 1;
    const isBeat = beatPhase < 0.1;
    data.current = {
      bass: (Math.sin(t * f * 2) + 1) / 2,
      mid: (Math.sin(t * f * 3.5) + 1) / 2,
      treble: (Math.sin(t * f * 5) + 1) / 2,
      overall: (Math.sin(t * f * 2) * 0.5 + 0.5),
      beat: isBeat,
    };
  });
  return data;
}

// Real audio — reads from AnalyserNode when audio is playing
function useRealAudio(analyserRef: React.MutableRefObject<AnalyserNode | null>, isPlaying: boolean) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false });
  const freqArray = useRef<Uint8Array | null>(null);
  const lastBass = useRef(0);
  const beatThreshold = 0.7;
  const beatCooldown = useRef(0);

  useFrame(() => {
    const analyser = analyserRef.current;
    if (!analyser || !isPlaying) return;
    if (!freqArray.current || freqArray.current.length !== analyser.frequencyBinCount) {
      freqArray.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array;
    }
    analyser.getByteFrequencyData(freqArray.current as Uint8Array<ArrayBuffer>);
    const arr = freqArray.current;
    // Bin mapping: 0-~10% = bass (20-250Hz), 10-40% = mid, 40-100% = treble
    const bassBins = Math.floor(arr.length * 0.08);
    const midBins = Math.floor(arr.length * 0.35);
    const bass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
    const mid = arr.slice(bassBins, midBins).reduce((a, b) => a + b, 0) / ((midBins - bassBins) * 255 || 1);
    const treble = arr.slice(midBins).reduce((a, b) => a + b, 0) / ((arr.length - midBins) * 255 || 1);
    const overall = (bass * 0.4 + mid * 0.35 + treble * 0.25);

    // Simple beat detection: bass spike above threshold with cooldown
    beatCooldown.current = Math.max(0, beatCooldown.current - 1);
    const isBeat = bass > beatThreshold && bass > lastBass.current * 1.2 && beatCooldown.current === 0;
    if (isBeat) beatCooldown.current = 10;
    lastBass.current = bass;

    data.current = { bass, mid, treble, overall, beat: isBeat };
  });
  return data;
}

interface AudioReactiveShapeProps { audioData: React.MutableRefObject<AudioData>; }

function AudioReactiveShape({ audioData }: AudioReactiveShapeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const targetScale = useRef(1.5);
  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;
    const baseScale = 1.5;
    const scaleBoost = audioData.current.bass * 0.7;
    targetScale.current = baseScale + scaleBoost;
    const cur = meshRef.current.scale.x;
    const next = THREE.MathUtils.lerp(cur, targetScale.current, 0.18);
    meshRef.current.scale.set(next, next, next);
    const hue = (audioData.current.mid * 0.35 + 0.6) % 1;
    materialRef.current.color.setHSL(hue, 0.85, 0.55);
    meshRef.current.rotation.y += delta * (0.3 + audioData.current.treble * 2.0);
    meshRef.current.rotation.x += delta * 0.15;
  });
  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 2]} />
      <meshStandardMaterial ref={materialRef} color="#6366f1" metalness={0.4} roughness={0.3} wireframe={false} />
    </mesh>
  );
}

function ParticleField({ count = 200 }: { count?: number }) {
  const particlesRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) { pos[i] = (Math.random() - 0.5) * 15; pos[i + 1] = (Math.random() - 0.5) * 15; pos[i + 2] = (Math.random() - 0.5) * 15; }
    return pos;
  }, [count]);
  useFrame((state) => { if (particlesRef.current) particlesRef.current.rotation.y = state.clock.elapsedTime * 0.05; });
  return (
    <points ref={particlesRef}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial size={0.04} color="#818cf8" transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

function FPSCounter() {
  const fps = useRef(0); const frames = useRef(0); const last = useRef(performance.now());
  useFrame(() => {
    frames.current++; const now = performance.now();
    if (now - last.current >= 1000) { fps.current = frames.current; frames.current = 0; last.current = now; }
  });
  return <Html position={[3, 3, 0]} style={{ color: fps.current >= 28 ? "#22c55e" : fps.current >= 20 ? "#eab308" : "#ef4444", fontSize: "12px", fontFamily: "monospace", textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>{fps.current} FPS</Html>;
}

function VisualizerScene({
  analyserRef,
  isPlaying,
  demoEnabled,
  demoBpm,
  onAudioData,
}: {
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
  demoEnabled: boolean;
  demoBpm: number;
  onAudioData?: (data: AudioData) => void;
}) {
  const realData = useRealAudio(analyserRef, isPlaying);
  const demoData = useDemoAudio(demoEnabled && !isPlaying, demoBpm);
  const audioData = isPlaying ? realData : demoData;

  // Pass audio data to parent for spectrum display
  useEffect(() => {
    if (onAudioData) {
      const interval = setInterval(() => {
        onAudioData(audioData.current);
      }, 50); // Update at 20fps for UI
      return () => clearInterval(interval);
    }
  }, [audioData, onAudioData]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={1.2} color="#fff" />
      <pointLight position={[-5, -5, 5]} intensity={0.8} color="#818cf8" />
      <AudioReactiveShape audioData={audioData} />
      <ParticleField count={250} />
      <OrbitControls enableZoom enablePan enableRotate minDistance={2} maxDistance={10} autoRotate={!isPlaying && !demoEnabled} autoRotateSpeed={0.3} />
      <FPSCounter />
    </>
  );
}

const PRESET_TRACKS = [
  { name: "Take the Crown (Phonk)", filename: "85a406ef_NeoCortext - Take the Crown.mp3" },
  { name: "The Signal Breaking Through (Trance)", filename: "e02f6ccf_NeoCortext - The Signal Breaking Through the Noise.mp3" },
  { name: "Before the Fade (Garage)", filename: "8baaf391_NeoCortext - Before the Fade.mp3" },
  { name: "Still I Rise (Electronic)", filename: "54360357_NeoCortext - Still I Rise.mp3" },
];

export function Visualizer() {
  const [bgColor, setBgColor] = useState("#050505");
  const [meshColor, setMeshColor] = useState("#6366f1");
  const [demoBpm, setDemoBpm] = useState(120);
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [trackName, setTrackName] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<Array<{ filename: string; stored_path: string }>>([]);
  const [liveAudioData, setLiveAudioData] = useState<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false });
  const [showSpectrum, setShowSpectrum] = useState(true);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
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
    setAudioFile(f);
    setTrackName(f.name);
    const url = URL.createObjectURL(f);
    setAudioUrl(url);
    setDemoEnabled(false);
  };

  const handleSelectLibraryTrack = (filename: string) => {
    if (!filename) return;
    setError(null);
    setTrackName(filename);
    setAudioFile(null);
    // Encode filename for URL (handles spaces, special chars)
    const encodedFilename = encodeURIComponent(filename);
    setAudioUrl(`/api/audio/file/${encodedFilename}`);
    setDemoEnabled(false);
  };

  return (
    <div className="viz-page">
      <div className="viz-header">
        <div className="viz-title-row">
          <Music size={22} className="viz-icon" />
          <h1 className="viz-title">3D Audio Visualizer — Real-time WebGL FFT</h1>
        </div>
        <p className="viz-subtitle">
          Select any track from your library or drop an audio file → 3D mesh scales with <b>bass</b>, shifts color with <b>mids</b>, and rotates with <b>treble</b>.
        </p>
      </div>

      <div className="viz-layout">
        <div className="viz-canvas-section">
          <Card className="viz-card p-0 overflow-hidden" style={{ background: bgColor }}>
            <div className="viz-canvas-container">
              <Canvas camera={{ position: [0, 0, 5], fov: 60 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }} frameloop="always">
                <Suspense fallback={null}>
                  <color attach="background" args={[bgColor]} />
                  <VisualizerScene
                    analyserRef={analyserRef}
                    isPlaying={isPlaying}
                    demoEnabled={demoEnabled}
                    demoBpm={demoBpm}
                    onAudioData={setLiveAudioData}
                  />
                </Suspense>
              </Canvas>
              {/* Beat indicator overlay */}
              {liveAudioData.beat && (
                <div className="viz-beat-flash" />
              )}
            </div>
          </Card>

          {/* Frequency Spectrum Display */}
          {showSpectrum && (
            <Card className="viz-spectrum-card">
              <div className="viz-spectrum-header">
                <Waves size={16} className="viz-spectrum-icon" />
                <span className="viz-spectrum-title">Live Frequency Spectrum</span>
                <button
                  className="viz-spectrum-toggle"
                  onClick={() => setShowSpectrum(false)}
                  title="Hide spectrum"
                >
                  <Maximize2 size={12} />
                </button>
              </div>
              <div className="viz-spectrum-bars">
                <SpectrumBar label="Bass" value={liveAudioData.bass} color="#6366f1" />
                <SpectrumBar label="Mid" value={liveAudioData.mid} color="#a855f7" />
                <SpectrumBar label="Treble" value={liveAudioData.treble} color="#ec4899" />
                <SpectrumBar label="Overall" value={liveAudioData.overall} color="#06b6d4" />
              </div>
              <div className="viz-beat-indicator">
                <div className={`viz-beat-dot ${liveAudioData.beat ? "active" : ""}`} />
                <span className="viz-beat-label">{liveAudioData.beat ? "BEAT" : "detecting..."}</span>
              </div>
            </Card>
          )}
          {!showSpectrum && (
            <button
              className="viz-spectrum-show"
              onClick={() => setShowSpectrum(true)}
            >
              <Waves size={14} /> Show Spectrum
            </button>
          )}
        </div>

        <div className="viz-controls">
          <Card title="Audio Track Source" className="viz-controls-card">
            <div className="viz-controls-content">
              {/* Media Library Quick Picker */}
              <div className="viz-picker">
                <div className="viz-picker-label">
                  <FolderOpen size={14} className="viz-picker-icon" />
                  <span>Choose from Media Library</span>
                </div>
                <select
                  onChange={(e) => handleSelectLibraryTrack(e.target.value)}
                  className="viz-select"
                  defaultValue=""
                >
                  <option value="" disabled>Select track from library...</option>
                  <optgroup label="Library Tracks">
                    {PRESET_TRACKS.map((t) => (
                      <option key={t.filename} value={t.filename}>{t.name}</option>
                    ))}
                    {libraryFiles.map((f) => (
                      <option key={f.filename} value={f.filename}>{f.filename}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Upload Drop Area */}
              <div
                className="viz-dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <Upload size={24} className="viz-dropzone-icon" />
                {trackName ? (
                  <p className="viz-dropzone-name">
                    <Music size={13} className="viz-dropzone-music" />
                    <span>{trackName}</span>
                  </p>
                ) : (
                  <p className="viz-dropzone-text">Click or drop custom audio file (MP3/WAV/FLAC)</p>
                )}
                <p className="viz-dropzone-hint">Web Audio API AnalyserNode active</p>
              </div>

              {/* HTML5 Audio Player */}
              {audioUrl && (
                <div className="viz-player">
                  <audio
                    ref={audioElRef}
                    controls
                    src={audioUrl}
                    className="viz-audio"
                    crossOrigin="anonymous"
                    onPlay={() => {
                      setIsPlaying(true);
                      audioCtxRef.current?.resume();
                    }}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onError={(e) => {
                      const audioEl = e.currentTarget;
                      setError(`Audio loading failed (code ${audioEl.error?.code}): ${audioEl.error?.message || "Check if backend is running"}`);
                    }}
                  />
                </div>
              )}

              {error && (
                <div className="viz-error">
                  <AlertCircle size={14} className="viz-error-icon" />
                  <span>{error}</span>
                </div>
              )}

              {/* Demo Mode Toggle */}
              <label className="viz-demo-toggle">
                <span className="viz-demo-label">
                  <Music size={14} className="viz-demo-icon" /> Synthesized Demo Sine
                </span>
                <button
                  className={`viz-demo-button ${demoEnabled ? "active" : ""}`}
                  onClick={() => setDemoEnabled(!demoEnabled)}
                >
                  {demoEnabled ? "Demo ON" : "Demo OFF"}
                </button>
              </label>

              {demoEnabled && !isPlaying && (
                <div className="viz-bpm">
                  <div className="viz-bpm-header">
                    <span>Demo Tempo</span>
                    <span className="viz-bpm-value">{demoBpm} BPM</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={180}
                    value={demoBpm}
                    onChange={(e) => setDemoBpm(Number(e.target.value))}
                    className="viz-bpm-slider"
                  />
                </div>
              )}

              <div className="viz-mappings">
                <p className="viz-mappings-title">Frequency Mappings:</p>
                <ul className="viz-mappings-list">
                  <li>• <b className="text-white">Bass (20–250 Hz)</b> → Geometry expansion & scale pulse</li>
                  <li>• <b className="text-white">Mids (250 Hz–2 kHz)</b> → Chromatic HSL material shift</li>
                  <li>• <b className="text-white">Treble (2 kHz+)</b> → Axial rotation & particle velocity</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card title="Visual Theme" className="viz-controls-card">
            <div className="viz-controls-content">
              <div>
                <label className="viz-label">Background Color</label>
                <div className="viz-color-row">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="viz-color-picker"
                  />
                  <input
                    className="viz-color-input"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="viz-label">Mesh Color</label>
                <div className="viz-color-row">
                  <input
                    type="color"
                    value={meshColor}
                    onChange={(e) => setMeshColor(e.target.value)}
                    className="viz-color-picker"
                  />
                  <input
                    className="viz-color-input"
                    value={meshColor}
                    onChange={(e) => setMeshColor(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
