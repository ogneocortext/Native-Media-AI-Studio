import React, { Suspense, useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Icosahedron } from "@react-three/drei";
import { Html } from "@react-three/drei";
import { Card } from "../../components/common";
import * as THREE from "three";
import { Upload, Music, AlertCircle, Play, Pause, Volume2, FolderOpen, Maximize2, Camera, Waves, Palette, Sparkles } from "lucide-react";
import { listAudioFiles } from "../../services/api";
import { 
  parseTrackCSV, 
  getVisualizationForTrack, 
  VISUALIZATION_OPTIONS, 
  VisualizationStyle, 
  TrackConcept 
} from "./trackConceptAnalyzer";
import { WaveformViz, ParticleStormViz, NeuralViz, CosmicViz, PulseViz } from "./VisualizationStyles";

interface AudioData { bass: number; mid: number; treble: number; overall: number; beat: boolean; }

interface SpectrumBarProps {
  label: string;
  value: number;
  color: string;
  intensity: number;
}

function SpectrumBar({ label, value, color, intensity }: SpectrumBarProps) {
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
  const targetHue = useRef(0.6);
  const velocity = useRef({ x: 0, y: 0, z: 0 });
  
  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;
    
    // More responsive scaling with higher boost
    const baseScale = 1.2;
    const scaleBoost = audioData.current.bass * 1.5; // Increased from 0.7 to 1.5
    targetScale.current = baseScale + scaleBoost;
    
    // Faster lerp for more responsive movement (0.18 -> 0.35)
    const cur = meshRef.current.scale.x;
    const next = THREE.MathUtils.lerp(cur, targetScale.current, 0.35);
    meshRef.current.scale.set(next, next, next);
    
    // More dynamic color shifts based on frequency intensity
    const intensity = (audioData.current.bass + audioData.current.mid + audioData.current.treble) / 3;
    targetHue.current = (audioData.current.mid * 0.4 + 0.55) % 1;
    materialRef.current.color.setHSL(targetHue.current, 0.9, 0.5 + intensity * 0.2);
    
    // Emissive glow on beats
    if (audioData.current.beat) {
      materialRef.current.emissive.setHSL(targetHue.current, 1, 0.4);
    } else {
      materialRef.current.emissive.lerp(new THREE.Color(0x000000), 0.1);
    }
    
    // More dynamic rotation based on treble and mid
    meshRef.current.rotation.y += delta * (0.2 + audioData.current.treble * 4.0);
    meshRef.current.rotation.x += delta * (0.1 + audioData.current.mid * 2.0);
    meshRef.current.rotation.z += delta * audioData.current.bass * 0.5;
    
    // Add subtle floating motion based on overall energy
    meshRef.current.position.y = Math.sin(Date.now() * 0.002) * audioData.current.overall * 0.3;
    meshRef.current.position.x = Math.cos(Date.now() * 0.0015) * audioData.current.mid * 0.2;
  });
  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 2]} />
      <meshStandardMaterial 
        ref={materialRef} 
        color="#6366f1" 
        metalness={0.5} 
        roughness={0.2} 
        wireframe={false}
        emissive="#000000"
        emissiveIntensity={0}
      />
    </mesh>
  );
}

function ParticleField({ count = 200, audioData }: { count?: number; audioData: React.MutableRefObject<AudioData> }) {
  const particlesRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) { pos[i] = (Math.random() - 0.5) * 15; pos[i + 1] = (Math.random() - 0.5) * 15; pos[i + 2] = (Math.random() - 0.5) * 15; }
    return pos;
  }, [count]);
  
  const initialPositions = useMemo(() => positions.slice(), [positions]);
  
  useFrame((state) => {
    if (particlesRef.current) {
      // Rotate particles based on audio energy
      const rotationSpeed = 0.02 + audioData.current.overall * 0.1;
      particlesRef.current.rotation.y = state.clock.elapsedTime * rotationSpeed;
      particlesRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
      
      // Pulse particle size on beats
      const material = particlesRef.current.material as THREE.PointsMaterial;
      material.size = 0.04 + audioData.current.bass * 0.08;
      material.opacity = 0.4 + audioData.current.overall * 0.6;
      
      // Move particles outward on bass hits
      const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
      const bassBoost = audioData.current.bass * 0.5;
      for (let i = 0; i < count * 3; i += 3) {
        const x = initialPositions[i];
        const y = initialPositions[i + 1];
        const z = initialPositions[i + 2];
        const dist = Math.sqrt(x * x + y * y + z * z);
        const scale = 1 + bassBoost / dist;
        positions[i] = x * scale;
        positions[i + 1] = y * scale;
        positions[i + 2] = z * scale;
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });
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
  visualizationStyle,
}: {
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
  demoEnabled: boolean;
  demoBpm: number;
  onAudioData?: (data: AudioData) => void;
  visualizationStyle: VisualizationStyle;
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

  const renderVisualization = () => {
    switch (visualizationStyle) {
      case "waveform":
        return <WaveformViz audioData={audioData} />;
      case "particles":
        return <ParticleStormViz audioData={audioData} />;
      case "neural":
        return <NeuralViz audioData={audioData} />;
      case "cosmic":
        return <CosmicViz audioData={audioData} />;
      case "pulse":
        return <PulseViz audioData={audioData} />;
      case "geometric":
      default:
        return (
          <>
            <AudioReactiveShape audioData={audioData} />
            <ParticleField count={250} audioData={audioData} />
          </>
        );
    }
  };

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={1.2} color="#fff" />
      <pointLight position={[-5, -5, 5]} intensity={0.8} color="#818cf8" />
      {renderVisualization()}
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

export interface VizParams {
  // Model
  scale: number;
  scaleBoost: number;
  rotationSpeed: number;
  colorShift: number;
  glowIntensity: number;
  lerpSpeed: number;
  // Material
  materialType: "standard" | "metallic" | "glass" | "neon" | "matte";
  wireframe: boolean;
  opacity: number;
  // Scene
  shadowEnabled: boolean;
  reflectionEnabled: boolean;
  particleCount: number;
  particleSize: number;
  // Environment
  lightIntensity: number;
  ambientColor: string;
  fogEnabled: boolean;
  fogDensity: number;
  // Props
  showGround: boolean;
  showFloatingShapes: boolean;
  showLightRays: boolean;
  // Match Track
  matchTrack: boolean;
}

const DEFAULT_VIZ_PARAMS: VizParams = {
  scale: 1.2,
  scaleBoost: 1.5,
  rotationSpeed: 1.0,
  colorShift: 1.0,
  glowIntensity: 0.5,
  lerpSpeed: 0.35,
  materialType: "standard",
  wireframe: false,
  opacity: 1.0,
  shadowEnabled: true,
  reflectionEnabled: true,
  particleCount: 250,
  particleSize: 0.04,
  lightIntensity: 1.2,
  ambientColor: "#1a1a2e",
  fogEnabled: false,
  fogDensity: 0.02,
  showGround: true,
  showFloatingShapes: true,
  showLightRays: false,
  matchTrack: false,
};

export function Visualizer() {
  const [bgColor, setBgColor] = useState("#050505");
  const [meshColor, setMeshColor] = useState("#6366f1");
  const [demoBpm, setDemoBpm] = useState(120);
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [trackName, setTrackName] = useState<string>("");
  const [editableTrackName, setEditableTrackName] = useState<string>("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<Array<{ filename: string; stored_path: string }>>([]);
  const [liveAudioData, setLiveAudioData] = useState<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false });
  const [showSpectrum, setShowSpectrum] = useState(true);
  const [spectrumIntensity, setSpectrumIntensity] = useState(1);
  const [cudaEnabled, setCudaEnabled] = useState(false);
  const [cudaStatus, setCudaStatus] = useState<"unavailable" | "available" | "active">("unavailable");
  const [visualizationStyle, setVisualizationStyle] = useState<VisualizationStyle>("geometric");
  const [trackConcept, setTrackConcept] = useState<TrackConcept | null>(null);
  const [showVizSelector, setShowVizSelector] = useState(false);
  const [csvContent, setCsvContent] = useState<string>("");
  const [vizParams, setVizParams] = useState<VizParams>(DEFAULT_VIZ_PARAMS);
  const [showParams, setShowParams] = useState(true);
  const [useOllamaMatch, setUseOllamaMatch] = useState(false);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const trackNameInputRef = useRef<HTMLInputElement | null>(null);

  // Load CSV content on mount
  useEffect(() => {
    fetch("/-TrackName-Prompt-Lyricskeyexcerpttheme.csv")
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
        analyser.fftSize = 1024; // Increased from 512 for better frequency resolution
        analyser.smoothingTimeConstant = 0.4; // Reduced from 0.75 for more responsive animation
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
    setEditableTrackName(filename.replace(/^\w{8}_/, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, ""));
    setAudioFile(null);
    // Encode filename for URL (handles spaces, special chars)
    const encodedFilename = encodeURIComponent(filename);
    setAudioUrl(`/api/audio/file/${encodedFilename}`);
    setDemoEnabled(false);
    
    // Analyze track concept and recommend visualization
    if (csvContent) {
      const cleanName = filename.replace(/^\w{8}_/, "").replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "");
      const concept = getVisualizationForTrack(cleanName, csvContent);
      if (concept) {
        setTrackConcept(concept);
        setVisualizationStyle(concept.recommendedViz);
        // Apply match track parameters if enabled
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
        const res = await fetch("/api/integrations/analyze-track", {
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
          const data = await res.json();
          if (data.success && data.params) {
            const p = data.params;
            const params = { ...vizParams };
            
            // Apply Ollama-generated parameters
            if (p.visualization_style) {
              setVisualizationStyle(p.visualization_style);
            }
            if (p.scale) params.scale = Math.max(0.5, Math.min(3.0, p.scale));
            if (p.scale_boost) params.scaleBoost = Math.max(0.5, Math.min(3.0, p.scale_boost));
            if (p.rotation_speed) params.rotationSpeed = Math.max(0.1, Math.min(5.0, p.rotation_speed));
            if (p.color_shift) params.colorShift = Math.max(0, Math.min(2.0, p.color_shift));
            if (p.glow_intensity) params.glowIntensity = Math.max(0, Math.min(1.0, p.glow_intensity));
            if (p.lerp_speed) params.lerpSpeed = Math.max(0.1, Math.min(1.0, p.lerp_speed));
            if (p.material_type) params.materialType = p.material_type;
            if (p.wireframe !== undefined) params.wireframe = p.wireframe;
            if (p.opacity) params.opacity = Math.max(0.1, Math.min(1.0, p.opacity));
            if (p.shadow_enabled !== undefined) params.shadowEnabled = p.shadow_enabled;
            if (p.reflection_enabled !== undefined) params.reflectionEnabled = p.reflection_enabled;
            if (p.particle_count) params.particleCount = Math.max(0, Math.min(1000, p.particle_count));
            if (p.particle_size) params.particleSize = Math.max(0.01, Math.min(0.2, p.particle_size));
            if (p.light_intensity) params.lightIntensity = Math.max(0.2, Math.min(3.0, p.light_intensity));
            if (p.fog_enabled !== undefined) params.fogEnabled = p.fog_enabled;
            if (p.fog_density) params.fogDensity = Math.max(0.01, Math.min(0.1, p.fog_density));
            if (p.show_ground !== undefined) params.showGround = p.show_ground;
            if (p.show_floating_shapes !== undefined) params.showFloatingShapes = p.show_floating_shapes;
            if (p.show_light_rays !== undefined) params.showLightRays = p.show_light_rays;
            
            setVizParams(params);
            return;
          }
        }
      } catch (e) {
        console.log("Ollama analysis failed, using fallback");
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

  const handleSaveTrackName = () => {
    if (editableTrackName.trim()) {
      setTrackName(editableTrackName.trim());
      setIsEditingName(false);
    }
  };

  // Apply match track when toggled
  const handleMatchTrackToggle = (enabled: boolean) => {
    setVizParams({ ...vizParams, matchTrack: enabled });
    if (enabled && trackConcept) {
      applyTrackMatchParams(trackConcept, useOllamaMatch);
    }
  };

  // Check Ollama availability on mount
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
                    visualizationStyle={visualizationStyle}
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
                <div className="viz-spectrum-controls">
                  <input
                    type="range"
                    min="1"
                    max="2"
                    step="0.1"
                    value={spectrumIntensity}
                    onChange={(e) => setSpectrumIntensity(parseFloat(e.target.value))}
                    className="viz-intensity-slider"
                    title="Spectrum Sensitivity"
                  />
                  <button
                    className="viz-spectrum-toggle"
                    onClick={() => setShowSpectrum(false)}
                    title="Hide spectrum"
                  >
                    <Maximize2 size={12} />
                  </button>
                </div>
              </div>
              {/* Editable Track Name */}
              {trackName && (
                <div className="viz-track-name-section">
                  {isEditingName ? (
                    <div className="viz-track-name-edit">
                      <input
                        ref={trackNameInputRef}
                        type="text"
                        value={editableTrackName}
                        onChange={(e) => setEditableTrackName(e.target.value)}
                        onBlur={handleSaveTrackName}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveTrackName()}
                        className="viz-track-name-input"
                        autoFocus
                      />
                      <button onClick={handleSaveTrackName} className="viz-track-name-save">Save</button>
                    </div>
                  ) : (
                    <div className="viz-track-name-display" onClick={() => setIsEditingName(true)}>
                      <Music size={14} className="viz-track-name-icon" />
                      <span className="viz-track-name-text">{trackName}</span>
                      <span className="viz-track-hint">(click to edit)</span>
                    </div>
                  )}
                </div>
              )}
              <div className="viz-spectrum-bars">
                <SpectrumBar label="Bass" value={liveAudioData.bass} color="#6366f1" intensity={spectrumIntensity} />
                <SpectrumBar label="Mid" value={liveAudioData.mid} color="#a855f7" intensity={spectrumIntensity} />
                <SpectrumBar label="Treble" value={liveAudioData.treble} color="#ec4899" intensity={spectrumIntensity} />
                <SpectrumBar label="Overall" value={liveAudioData.overall} color="#06b6d4" intensity={spectrumIntensity} />
              </div>
              <div className="viz-beat-indicator">
                <div className={`viz-beat-dot ${liveAudioData.beat ? "active" : ""}`} />
                <span className="viz-beat-label">{liveAudioData.beat ? "BEAT" : "detecting..."}</span>
                {cudaEnabled && <span className="viz-cuda-badge">CUDA</span>}
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

          {/* Visualization Style Selector */}
          <Card title="Visualization Style" className="viz-controls-card">
            <div className="viz-controls-content">
              {trackConcept && (
                <div className="viz-concept-info">
                  <p className="viz-concept-label">Track Analysis:</p>
                  <p className="viz-concept-moods">
                    {trackConcept.mood.join(", ")} • {trackConcept.genre.join(", ")} • {trackConcept.bpm} BPM
                  </p>
                  <p className="viz-concept-recommended">
                    Recommended: <span className="viz-concept-recommended-style">
                      {VISUALIZATION_OPTIONS.find(v => v.id === trackConcept.recommendedViz)?.name}
                    </span>
                  </p>
                </div>
              )}
              <div className="viz-style-grid">
                {VISUALIZATION_OPTIONS.map((viz) => (
                  <button
                    key={viz.id}
                    className={`viz-style-btn ${visualizationStyle === viz.id ? "active" : ""}`}
                    onClick={() => setVisualizationStyle(viz.id)}
                    title={viz.description}
                  >
                    <span className="viz-style-name">{viz.name}</span>
                  </button>
                ))}
              </div>
              <p className="viz-style-description">
                {VISUALIZATION_OPTIONS.find(v => v.id === visualizationStyle)?.description}
              </p>
            </div>
          </Card>

          {/* Visualization Parameters */}
          <Card 
            title="Parameters" 
            className="viz-controls-card"
            headerAction={
              <button 
                className="viz-toggle-btn"
                onClick={() => setShowParams(!showParams)}
              >
                {showParams ? "−" : "+"}
              </button>
            }
          >
            {showParams && (
              <div className="viz-controls-content">
                {/* Match Track Toggle */}
                <div className="viz-match-track">
                  <label className="viz-match-track-label">
                    <input
                      type="checkbox"
                      checked={vizParams.matchTrack}
                      onChange={(e) => handleMatchTrackToggle(e.target.checked)}
                    />
                    <span>Match Track</span>
                  </label>
                  {vizParams.matchTrack && (
                    <div className="viz-match-options">
                      <label className="viz-match-option">
                        <input
                          type="radio"
                          name="matchMode"
                          checked={!useOllamaMatch}
                          onChange={() => setUseOllamaMatch(false)}
                        />
                        <span>Quick Match</span>
                      </label>
                      <label className="viz-match-option">
                        <input
                          type="radio"
                          name="matchMode"
                          checked={useOllamaMatch}
                          onChange={() => setUseOllamaMatch(true)}
                          disabled={!ollamaAvailable}
                        />
                        <span>AI Match</span>
                        {ollamaAvailable && <span className="viz-ollama-badge">OLLAMA</span>}
                      </label>
                    </div>
                  )}
                </div>
                  <div className="viz-param-row">
                    <label>Scale Boost</label>
                    <input type="range" min="0.5" max="3" step="0.1" value={vizParams.scaleBoost} onChange={(e) => setVizParams({...vizParams, scaleBoost: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.scaleBoost.toFixed(1)}</span>
                  </div>
                  <div className="viz-param-row">
                    <label>Rotation Speed</label>
                    <input type="range" min="0.1" max="5" step="0.1" value={vizParams.rotationSpeed} onChange={(e) => setVizParams({...vizParams, rotationSpeed: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.rotationSpeed.toFixed(1)}</span>
                  </div>
                  <div className="viz-param-row">
                    <label>Color Shift</label>
                    <input type="range" min="0" max="2" step="0.1" value={vizParams.colorShift} onChange={(e) => setVizParams({...vizParams, colorShift: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.colorShift.toFixed(1)}</span>
                  </div>
                  <div className="viz-param-row">
                    <label>Glow Intensity</label>
                    <input type="range" min="0" max="1" step="0.05" value={vizParams.glowIntensity} onChange={(e) => setVizParams({...vizParams, glowIntensity: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.glowIntensity.toFixed(2)}</span>
                  </div>
                  <div className="viz-param-row">
                    <label>Response Speed</label>
                    <input type="range" min="0.1" max="1" step="0.05" value={vizParams.lerpSpeed} onChange={(e) => setVizParams({...vizParams, lerpSpeed: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.lerpSpeed.toFixed(2)}</span>
                  </div>
                </div>

                {/* Material Section */}
                <div className="viz-param-section">
                  <p className="viz-param-section-title">Material</p>
                  <div className="viz-param-row">
                    <label>Type</label>
                    <select value={vizParams.materialType} onChange={(e) => setVizParams({...vizParams, materialType: e.target.value as any})}>
                      <option value="standard">Standard</option>
                      <option value="metallic">Metallic</option>
                      <option value="glass">Glass</option>
                      <option value="neon">Neon</option>
                      <option value="matte">Matte</option>
                    </select>
                  </div>
                  <div className="viz-param-row">
                    <label>Wireframe</label>
                    <input type="checkbox" checked={vizParams.wireframe} onChange={(e) => setVizParams({...vizParams, wireframe: e.target.checked})} />
                  </div>
                  <div className="viz-param-row">
                    <label>Opacity</label>
                    <input type="range" min="0.1" max="1" step="0.05" value={vizParams.opacity} onChange={(e) => setVizParams({...vizParams, opacity: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.opacity.toFixed(2)}</span>
                  </div>
                </div>

                {/* Scene Section */}
                <div className="viz-param-section">
                  <p className="viz-param-section-title">Scene</p>
                  <div className="viz-param-row">
                    <label>Shadows</label>
                    <input type="checkbox" checked={vizParams.shadowEnabled} onChange={(e) => setVizParams({...vizParams, shadowEnabled: e.target.checked})} />
                  </div>
                  <div className="viz-param-row">
                    <label>Reflections</label>
                    <input type="checkbox" checked={vizParams.reflectionEnabled} onChange={(e) => setVizParams({...vizParams, reflectionEnabled: e.target.checked})} />
                  </div>
                  <div className="viz-param-row">
                    <label>Particles</label>
                    <input type="range" min="0" max="1000" step="50" value={vizParams.particleCount} onChange={(e) => setVizParams({...vizParams, particleCount: parseInt(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.particleCount}</span>
                  </div>
                  <div className="viz-param-row">
                    <label>Particle Size</label>
                    <input type="range" min="0.01" max="0.2" step="0.01" value={vizParams.particleSize} onChange={(e) => setVizParams({...vizParams, particleSize: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.particleSize.toFixed(2)}</span>
                  </div>
                </div>

                {/* Environment Section */}
                <div className="viz-param-section">
                  <p className="viz-param-section-title">Environment</p>
                  <div className="viz-param-row">
                    <label>Light Intensity</label>
                    <input type="range" min="0.2" max="3" step="0.1" value={vizParams.lightIntensity} onChange={(e) => setVizParams({...vizParams, lightIntensity: parseFloat(e.target.value)})} />
                    <span className="viz-param-value">{vizParams.lightIntensity.toFixed(1)}</span>
                  </div>
                  <div className="viz-param-row">
                    <label>Fog</label>
                    <input type="checkbox" checked={vizParams.fogEnabled} onChange={(e) => setVizParams({...vizParams, fogEnabled: e.target.checked})} />
                  </div>
                  {vizParams.fogEnabled && (
                    <div className="viz-param-row">
                      <label>Fog Density</label>
                      <input type="range" min="0.01" max="0.1" step="0.01" value={vizParams.fogDensity} onChange={(e) => setVizParams({...vizParams, fogDensity: parseFloat(e.target.value)})} />
                      <span className="viz-param-value">{vizParams.fogDensity.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Props Section */}
                <div className="viz-param-section">
                  <p className="viz-param-section-title">Scene Props</p>
                  <div className="viz-param-row">
                    <label>Ground</label>
                    <input type="checkbox" checked={vizParams.showGround} onChange={(e) => setVizParams({...vizParams, showGround: e.target.checked})} />
                  </div>
                  <div className="viz-param-row">
                    <label>Floating Shapes</label>
                    <input type="checkbox" checked={vizParams.showFloatingShapes} onChange={(e) => setVizParams({...vizParams, showFloatingShapes: e.target.checked})} />
                  </div>
                  <div className="viz-param-row">
                    <label>Light Rays</label>
                    <input type="checkbox" checked={vizParams.showLightRays} onChange={(e) => setVizParams({...vizParams, showLightRays: e.target.checked})} />
                  </div>
                </div>

                {/* Reset Button */}
                <button className="viz-reset-btn" onClick={() => setVizParams(DEFAULT_VIZ_PARAMS)}>
                  Reset to Defaults
                </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
