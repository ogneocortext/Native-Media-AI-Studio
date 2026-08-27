import { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, OrbitControls, MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import { WaveformViz, ParticleStormViz, NeuralViz, CosmicViz, PulseViz, StormViz, FractalViz } from "./VisualizationStyles";
import { useRealAudio, useDemoAudio } from "./audioHooks";
import type { VisualizerSceneProps, AudioData, VizParams } from "./types";

interface AudioReactiveShapeProps {
  audioData: React.MutableRefObject<AudioData>;
  vizParams: VizParams;
  meshColor?: string;
}

// Convert a hex color string into its hue value (0..1). Falls back to indigo.
function hexToHue(hex: string): number {
  try {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    return hsl.h;
  } catch {
    return 0.62;
  }
}

// Global motion wrapper — applies Scale/Boost/Rotation/Response params to every
// non-geometric style so the real-time sliders work no matter which style is active.
function GlobalMotion({
  audioData,
  vizParams,
  children,
}: {
  audioData: React.MutableRefObject<AudioData>;
  vizParams: VizParams;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const curScale = useRef(1);
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const target = vizParams.scale * (1 + audioData.current.bass * vizParams.scaleBoost * 0.3);
    curScale.current = THREE.MathUtils.lerp(curScale.current, target, vizParams.lerpSpeed);
    groupRef.current.scale.setScalar(curScale.current);
    groupRef.current.rotation.y += delta * 0.15 * vizParams.rotationSpeed;
    groupRef.current.position.y = Math.sin(Date.now() * 0.0018) * audioData.current.overall * 0.25;
  });
  return <group ref={groupRef}>{children}</group>;
}

// Audio-reactive orbiting shapes (toggled by "Floating" in the Scene panel)
function FloatingShapes({ audioData, vizParams }: AudioReactiveShapeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shapes = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        angle: (i / 8) * Math.PI * 2,
        radius: 2.2 + (i % 3) * 0.6,
        height: -1 + (i % 4) * 0.7,
        kind: i % 3,
      })),
    []
  );
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const s = shapes[i];
      const wobble = Math.sin(t + s.angle) * 0.3 + audioData.current.mid * 0.6;
      child.position.set(
        Math.cos(t * vizParams.rotationSpeed * 0.3 + s.angle) * s.radius,
        s.height + wobble,
        Math.sin(t * vizParams.rotationSpeed * 0.3 + s.angle) * s.radius
      );
      child.rotation.x = t * (0.5 + i * 0.05);
      child.rotation.y = t * 0.7;
      child.scale.setScalar(1 + audioData.current.treble * 0.5);
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = vizParams.glowIntensity * (0.4 + audioData.current.overall * 1.5);
    });
  });
  return (
    <group ref={groupRef}>
      {shapes.map((s, i) => (
        <mesh key={i}>
          {s.kind === 0 ? <torusGeometry args={[0.22, 0.07, 12, 32]} />
            : s.kind === 1 ? <octahedronGeometry args={[0.25, 0]} />
            : <icosahedronGeometry args={[0.22, 0]} />}
          <meshStandardMaterial color="#a78bfa" emissive="#818cf8" emissiveIntensity={0.4} transparent opacity={0.85} wireframe={vizParams.wireframe} />
        </mesh>
      ))}
    </group>
  );
}

// Additive volumetric-style light beams (toggled by "Light Rays" in the Scene panel)
function LightRays({ audioData }: AudioReactiveShapeProps) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = (0.04 + audioData.current.overall * 0.16) * (0.6 + 0.4 * Math.sin(t * 0.7 + i));
    });
  });
  return (
    <group ref={groupRef}>
      {[...Array(6)].map((_, i) => (
        <mesh key={i} position={[(i - 2.5) * 1.1, 2.2, -1.5]} rotation={[0, 0, (i % 2 ? -1 : 1) * 0.08]}>
          <coneGeometry args={[0.35, 6, 16, 1, true]} />
          <meshBasicMaterial
            color="#818cf8"
            transparent
            opacity={0.06}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

export function AudioReactiveShape({ audioData, vizParams, meshColor }: AudioReactiveShapeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const targetScale = useRef(1.5);
  const targetHue = useRef(0.6);
  // Base hue comes from the Theme panel's Mesh color picker; updated without re-subscribing useFrame
  const baseHueRef = useRef(0.62);
  const lastMeshColor = useRef<string>("");
  if (meshColor && meshColor !== lastMeshColor.current) {
    lastMeshColor.current = meshColor;
    baseHueRef.current = hexToHue(meshColor);
  }

  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;

    // Use vizParams for real-time control (bass response halved so the mesh
    // stays framed even with hot demo/signal levels)
    const baseScale = vizParams.scale;
    const scaleBoost = audioData.current.bass * vizParams.scaleBoost * 0.5;
    targetScale.current = baseScale + scaleBoost;

    // Use lerpSpeed from params for response speed
    const cur = meshRef.current.scale.x;
    const next = THREE.MathUtils.lerp(cur, targetScale.current, vizParams.lerpSpeed);
    meshRef.current.scale.setScalar(Math.min(next, 2.6));

    // Color shift based on params — anchored to the user-selected Mesh color
    const intensity = (audioData.current.bass + audioData.current.mid + audioData.current.treble) / 3;
    targetHue.current = (baseHueRef.current + audioData.current.mid * vizParams.colorShift * 0.12 + 1) % 1;
    materialRef.current.color.setHSL(targetHue.current, 0.9, 0.5 + intensity * 0.15);

    // Glow intensity from params — emissive punch on beats, kept below blowout
    const glowLevel = vizParams.glowIntensity * (audioData.current.beat ? 1 : 0.2);
    materialRef.current.emissive.setHSL(targetHue.current, 1, 0.5);
    materialRef.current.emissiveIntensity = glowLevel * 1.2 + intensity * vizParams.glowIntensity;

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
  bgColor = "#050505",
  meshColor = "#6366f1",
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
    // Non-geometric styles get global Scale/Boost/Rotation/Response applied,
    // so the Parameters panel works in real time for every style.
    const withGlobalMotion = (node: React.ReactNode) => (
      <GlobalMotion audioData={audioData} vizParams={vizParams}>{node}</GlobalMotion>
    );
    switch (visualizationStyle) {
      case "waveform":
        return withGlobalMotion(<WaveformViz {...props} />);
      case "particles":
        return withGlobalMotion(<ParticleStormViz {...props} />);
      case "neural":
        return withGlobalMotion(<NeuralViz {...props} />);
      case "cosmic":
        return withGlobalMotion(<CosmicViz {...props} />);
      case "pulse":
        return withGlobalMotion(<PulseViz {...props} />);
      case "storm":
        return withGlobalMotion(<StormViz {...props} />);
      case "fractal":
        return withGlobalMotion(<FractalViz {...props} />);
      case "geometric":
      default:
        return (
          <>
            <AudioReactiveShape {...props} meshColor={meshColor} />
            <ParticleField count={250} {...props} />
          </>
        );
    }
  };

  return (
    <>
      {/* Fog depth — driven by the Theme panel (Fog toggle + density slider) */}
      {vizParams.fogEnabled && <fogExp2 attach="fog" args={[bgColor ?? "#050505", vizParams.fogDensity]} />}
      {/* three r185 uses physically-based light falloff — decay=0 restores
          predictable scene-wide lighting that scales with the Light slider. */}
      <ambientLight intensity={vizParams.lightIntensity * 0.55} color={vizParams.ambientColor} />
      <pointLight position={[6, 6, 6]} intensity={vizParams.lightIntensity * 1.2} decay={0} color="#fff" castShadow={vizParams.shadowEnabled} />
      <pointLight position={[-5, -3, 4]} intensity={vizParams.lightIntensity * 0.7} decay={0} color="#818cf8" />
      <pointLight position={[0, 4, -6]} intensity={vizParams.lightIntensity * 0.5} decay={0} color={meshColor} />
      {vizParams.showGround && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} receiveShadow={vizParams.shadowEnabled}>
          <planeGeometry args={[20, 20]} />
          {vizParams.reflectionEnabled ? (
            <MeshReflectorMaterial
              blur={[280, 60]}
              resolution={512}
              mixBlur={1}
              mixStrength={12}
              roughness={0.85}
              depthScale={1.1}
              minDepthThreshold={0.4}
              maxDepthThreshold={1.4}
              color="#111827"
              metalness={0.55}
              mirror={0.45}
            />
          ) : (
            <meshStandardMaterial color="#111827" metalness={0.8} roughness={0.2} />
          )}
        </mesh>
      )}
      {renderVisualization()}
      {vizParams.showFloatingShapes && <FloatingShapes audioData={audioData} vizParams={vizParams} />}
      {vizParams.showLightRays && <LightRays audioData={audioData} vizParams={vizParams} />}
      <OrbitControls enableZoom enablePan enableRotate minDistance={2} maxDistance={10} autoRotate={!isPlaying && !demoEnabled} autoRotateSpeed={0.3} />
      <FPSCounter />
    </>
  );
}
