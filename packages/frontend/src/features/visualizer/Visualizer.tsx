import React, { Suspense, useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Icosahedron } from "@react-three/drei";
import { Html } from "@react-three/drei";
import { Card } from "../../components/common";
import * as THREE from "three";
import { Upload, Music, AlertCircle, Play, Pause, Volume2, FolderOpen } from "lucide-react";
import { listAudioFiles } from "../../services/api";

interface AudioData { bass: number; mid: number; treble: number; overall: number; }

// Demo fallback — clearly labeled, not silent mock
function useDemoAudio(enabled: boolean, bpm: number) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0 });
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    const f = bpm / 120;
    data.current = {
      bass: (Math.sin(t * f * 2) + 1) / 2,
      mid: (Math.sin(t * f * 3.5) + 1) / 2,
      treble: (Math.sin(t * f * 5) + 1) / 2,
      overall: (Math.sin(t * f * 2) * 0.5 + 0.5),
    };
  });
  return data;
}

// Real audio — reads from AnalyserNode when audio is playing
function useRealAudio(analyserRef: React.MutableRefObject<AnalyserNode | null>, isPlaying: boolean) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0 });
  const freqArray = useRef<Uint8Array | null>(null);

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
    data.current = { bass, mid, treble, overall };
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

function VisualizerScene({ analyserRef, isPlaying, demoEnabled, demoBpm }: { analyserRef: React.MutableRefObject<AnalyserNode | null>; isPlaying: boolean; demoEnabled: boolean; demoBpm: number }) {
  const realData = useRealAudio(analyserRef, isPlaying);
  const demoData = useDemoAudio(demoEnabled && !isPlaying, demoBpm);
  const audioData = isPlaying ? realData : demoData;

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

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
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
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    const el = audioElRef.current;
    if (!el) return;

    const setup = async () => {
      try {
        ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        audioCtxRef.current = ctx;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        analyserRef.current = analyser;
        source = ctx.createMediaElementSource(el);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        if (ctx.state === "suspended") await ctx.resume();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Web Audio setup failed");
      }
    };
    setup();
    return () => {
      try { source?.disconnect(); analyser?.disconnect(); ctx?.close(); } catch { /* ignore */ }
      analyserRef.current = null;
      audioCtxRef.current = null;
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
    setAudioUrl(`/api/audio/file/${filename}`);
    setDemoEnabled(false);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Music size={22} className="text-violet-400" /> 3D Audio Visualizer — Real-time WebGL FFT
        </h1>
        <p className="text-muted mt-1">
          Select any track from your library or drop an audio file → 3D mesh scales with <b>bass</b>, shifts color with <b>mids</b>, and rotates with <b>treble</b>.
        </p>
      </div>

      <div className="grid grid-2 gap-6">
        <Card className="p-0 overflow-hidden" style={{ background: bgColor }}>
          <div className="h-[460px]">
            <Canvas camera={{ position: [0, 0, 5], fov: 60 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }} frameloop="always">
              <Suspense fallback={null}>
                <color attach="background" args={[bgColor]} />
                <VisualizerScene analyserRef={analyserRef} isPlaying={isPlaying} demoEnabled={demoEnabled} demoBpm={demoBpm} />
              </Suspense>
            </Canvas>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Audio Track Source">
            <div className="space-y-3">
              {/* Media Library Quick Picker */}
              <div className="p-3 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
                  <FolderOpen size={14} className="text-violet-400" />
                  <span>Choose from Media Library</span>
                </div>
                <select
                  onChange={(e) => handleSelectLibraryTrack(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500"
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
                className="relative border-2 border-dashed border-gray-700 rounded-xl p-4 text-center hover:border-violet-500/50 hover:bg-violet-500/5 cursor-pointer transition-colors"
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
                <Upload size={24} className="mx-auto text-gray-400 mb-1.5" />
                {trackName ? (
                  <p className="text-xs font-medium text-white flex items-center justify-center gap-1.5 truncate">
                    <Music size={13} className="text-violet-400 shrink-0" />
                    <span className="truncate">{trackName}</span>
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Click or drop custom audio file (MP3/WAV/FLAC)</p>
                )}
                <p className="text-[11px] text-gray-500 mt-1">Web Audio API AnalyserNode active</p>
              </div>

              {/* HTML5 Audio Player */}
              {audioUrl && (
                <div className="bg-gray-900/80 p-2 rounded-lg border border-gray-800">
                  <audio
                    ref={audioElRef}
                    controls
                    src={audioUrl}
                    className="w-full h-8"
                    crossOrigin="anonymous"
                    onPlay={() => {
                      setIsPlaying(true);
                      audioCtxRef.current?.resume();
                    }}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                  />
                </div>
              )}

              {error && (
                <div className="flex gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Demo Mode Toggle */}
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-gray-900/60 border border-gray-800">
                <span className="text-xs flex items-center gap-2 text-gray-300">
                  <Music size={14} className="text-violet-400" /> Synthesized Demo Sine
                </span>
                <button
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    demoEnabled ? "bg-violet-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                  onClick={() => setDemoEnabled(!demoEnabled)}
                >
                  {demoEnabled ? "Demo ON" : "Demo OFF"}
                </button>
              </label>

              {demoEnabled && !isPlaying && (
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Demo Tempo</span>
                    <span className="font-mono text-violet-400">{demoBpm} BPM</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={180}
                    value={demoBpm}
                    onChange={(e) => setDemoBpm(Number(e.target.value))}
                    className="w-full accent-violet-500"
                  />
                </div>
              )}

              <div className="p-2.5 bg-gray-900/60 rounded-lg text-xs text-gray-400 leading-relaxed border border-gray-800">
                <p className="font-semibold text-gray-300 text-[11px] uppercase tracking-wider">Frequency Mappings:</p>
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  <li>• <b className="text-white">Bass (20–250 Hz)</b> → Geometry expansion & scale pulse</li>
                  <li>• <b className="text-white">Mids (250 Hz–2 kHz)</b> → Chromatic HSL material shift</li>
                  <li>• <b className="text-white">Treble (2 kHz+)</b> → Axial rotation & particle velocity</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card title="Visual Theme">
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Background Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent"
                  />
                  <input
                    className="bg-gray-800 border border-gray-700 rounded px-2 text-xs text-white flex-1 font-mono"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
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
