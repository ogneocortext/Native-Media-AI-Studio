import { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { WaveformViz, ParticleStormViz, NeuralViz, CosmicViz, PulseViz, StormViz, FractalViz } from "./VisualizationStyles";
import { useRealAudio, useDemoAudio } from "./audioHooks";
import type { VisualizerSceneProps, AudioData, VizParams } from "./types";

interface AudioReactiveShapeProps {
  audioData: React.MutableRefObject<AudioData>;
  vizParams: VizParams;
}

export function AudioReactiveShape({ audioData, vizParams }: AudioReactiveShapeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const targetScale = useRef(1.5);
  const targetHue = useRef(0.6);

  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;

    // Use vizParams for real-time control
    const baseScale = vizParams.scale;
    const scaleBoost = audioData.current.bass * vizParams.scaleBoost;
    targetScale.current = baseScale + scaleBoost;

    // Use lerpSpeed from params for response speed
    const cur = meshRef.current.scale.x;
    const next = THREE.MathUtils.lerp(cur, targetScale.current, vizParams.lerpSpeed);
    meshRef.current.scale.set(next, next, next);

    // Color shift based on params
    const intensity = (audioData.current.bass + audioData.current.mid + audioData.current.treble) / 3;
    targetHue.current = (audioData.current.mid * vizParams.colorShift * 0.3 + 0.55) % 1;
    materialRef.current.color.setHSL(targetHue.current, 0.9, 0.5 + intensity * 0.2);

    // Glow intensity from params
    const glowLevel = vizParams.glowIntensity * (audioData.current.beat ? 1 : 0.2);
    materialRef.current.emissive.setHSL(targetHue.current, 1, glowLevel * 0.4);

    // Rotation speed from params
    meshRef.current.rotation.y += delta * (0.2 + audioData.current.treble * vizParams.rotationSpeed * 2.0);
    meshRef.current.rotation.x += delta * (0.1 + audioData.current.mid * vizParams.rotationSpeed);
    meshRef.current.rotation.z += delta * audioData.current.bass * 0.5 * vizParams.rotationSpeed;

    // Floating motion
    meshRef.current.position.y = Math.sin(Date.now() * 0.002) * audioData.current.overall * 0.3;
    meshRef.current.position.x = Math.cos(Date.now() * 0.0015) * audioData.current.mid * 0.2;

    // Apply material settings from params
    materialRef.current.wireframe = vizParams.wireframe;
    materialRef.current.opacity = vizParams.opacity;
    materialRef.current.transparent = vizParams.opacity < 1;

    // Apply material type
    switch (vizParams.materialType) {
      case "metallic":
        materialRef.current.metalness = 0.9;
        materialRef.current.roughness = 0.1;
        break;
      case "glass":
        materialRef.current.metalness = 0.1;
        materialRef.current.roughness = 0.05;
        materialRef.current.transparent = true;
        materialRef.current.opacity = Math.min(vizParams.opacity, 0.7);
        break;
      case "neon":
        materialRef.current.metalness = 0.0;
        materialRef.current.roughness = 1.0;
        materialRef.current.emissiveIntensity = glowLevel;
        break;
      case "matte":
        materialRef.current.metalness = 0.0;
        materialRef.current.roughness = 1.0;
        break;
      default:
        materialRef.current.metalness = 0.5;
        materialRef.current.roughness = 0.2;
    }
  });
  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 2]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#6366f1"
        metalness={0.5}
        roughness={0.2}
        wireframe={vizParams.wireframe}
        emissive="#000000"
        emissiveIntensity={0}
      />
    </mesh>
  );
}

export function ParticleField({ count = 200, audioData, vizParams }: { count?: number; audioData: React.MutableRefObject<AudioData>; vizParams: VizParams }) {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = vizParams.particleCount || count;

  const positions = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) { pos[i] = (Math.random() - 0.5) * 15; pos[i + 1] = (Math.random() - 0.5) * 15; pos[i + 2] = (Math.random() - 0.5) * 15; }
    return pos;
  }, [particleCount]);

  const initialPositions = useMemo(() => positions.slice(), [positions]);

  useFrame((state) => {
    if (!particlesRef.current) return;
    // Rotate particles based on audio energy
    const rotationSpeed = 0.02 + audioData.current.overall * 0.1 * vizParams.rotationSpeed;
    particlesRef.current.rotation.y = state.clock.elapsedTime * rotationSpeed;
    particlesRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;

    // Pulse particle size on beats - use vizParams
    const material = particlesRef.current.material as THREE.PointsMaterial;
    material.size = vizParams.particleSize + audioData.current.bass * vizParams.particleSize * 2;
    material.opacity = 0.4 + audioData.current.overall * 0.6;

    // Move particles outward on bass hits
    const pos = particlesRef.current.geometry.attributes.position.array as Float32Array;
    const bassBoost = audioData.current.bass * 0.5 * vizParams.scaleBoost;
    for (let i = 0; i < particleCount * 3; i += 3) {
      const x = initialPositions[i];
      const y = initialPositions[i + 1];
      const z = initialPositions[i + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);
      const scale = 1 + bassBoost / dist;
      pos[i] = x * scale;
      pos[i + 1] = y * scale;
      pos[i + 2] = z * scale;
    }
    particlesRef.current.geometry.attributes.position.needsUpdate = true;
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

export function VisualizerScene({
  analyserRef,
  isPlaying,
  isPaused,
  demoEnabled,
  demoBpm,
  onAudioData,
  visualizationStyle,
  vizParams,
}: VisualizerSceneProps) {
  const realData = useRealAudio(analyserRef, isPlaying, isPaused);
  const demoData = useDemoAudio(demoEnabled && !isPlaying && !isPaused, demoBpm);
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
    const props = { audioData, vizParams };
    switch (visualizationStyle) {
      case "waveform":
        return <WaveformViz {...props} />;
      case "particles":
        return <ParticleStormViz {...props} />;
      case "neural":
        return <NeuralViz {...props} />;
      case "cosmic":
        return <CosmicViz {...props} />;
      case "pulse":
        return <PulseViz {...props} />;
      case "storm":
        return <StormViz {...props} />;
      case "fractal":
        return <FractalViz {...props} />;
      case "geometric":
      default:
        return (
          <>
            <AudioReactiveShape {...props} />
            <ParticleField count={250} {...props} />
          </>
        );
    }
  };

  return (
    <>
      <ambientLight intensity={vizParams.lightIntensity * 0.4} />
      <pointLight position={[10, 10, 10]} intensity={vizParams.lightIntensity} color="#fff" castShadow={vizParams.shadowEnabled} />
      <pointLight position={[-5, -5, 5]} intensity={vizParams.lightIntensity * 0.6} color="#818cf8" />
      {vizParams.showGround && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} receiveShadow={vizParams.shadowEnabled}><planeGeometry args={[20, 20]} /><meshStandardMaterial color="#111827" metalness={0.8} roughness={0.2} /></mesh>}
      {renderVisualization()}
      <OrbitControls enableZoom enablePan enableRotate minDistance={2} maxDistance={10} autoRotate={!isPlaying && !demoEnabled} autoRotateSpeed={0.3} />
      <FPSCounter />
    </>
  );
}
