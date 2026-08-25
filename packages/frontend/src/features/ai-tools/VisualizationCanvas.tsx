/**
 * Visualization Canvas for AI Tools
 * Renders dynamic visuals based on tool output from Ollama
 */

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface VisualizationConfig {
  type: string;
  style: string;
  colorScheme: string;
  intensity: number;
  bpm: number;
  colors: { primary: string; secondary: string; accent: string };
  params: {
    particleCount: number;
    speed: number;
    scale: number;
    glow: boolean;
    rotation: boolean;
  };
}

interface VisualizationCanvasProps {
  config: VisualizationConfig | null;
  width?: number;
  height?: number;
}

// Particle system visualization
function ParticleVisualization({ config }: { config: VisualizationConfig }) {
  const particlesRef = useRef<THREE.Points>(null);
  const { particleCount, speed } = config.params;
  const { primary, secondary, accent } = config.colors;

  const { positions, colors, velocities } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    const vel = new Float32Array(particleCount * 3);
    const c1 = new THREE.Color(primary);
    const c2 = new THREE.Color(secondary);
    const c3 = new THREE.Color(accent);

    for (let i = 0; i < particleCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;

      const color = Math.random() < 0.33 ? c1 : Math.random() < 0.66 ? c2 : c3;
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;

      vel[i * 3] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 1] = Math.random() * 0.03;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
    return { positions: pos, colors: col, velocities: vel };
  }, [particleCount, primary, secondary, accent]);

  useFrame((state) => {
    if (!particlesRef.current) return;
    const pos = particlesRef.current.geometry.attributes.position.array as Float32Array;
    const time = state.clock.elapsedTime;
    const beat = Math.sin(time * speed * 2) * 0.5 + 0.5;

    for (let i = 0; i < particleCount; i++) {
      const idx = i * 3;
      const beatBoost = beat * config.intensity * 0.1;
      pos[idx] += velocities[idx] * (1 + beatBoost * 5);
      pos[idx + 1] += velocities[idx + 1] * (1 + config.intensity * 3);
      pos[idx + 2] += velocities[idx + 2] * (1 + beatBoost * 5);

      const dist = Math.sqrt(pos[idx] ** 2 + pos[idx + 1] ** 2 + pos[idx + 2] ** 2);
      if (dist > 6) {
        pos[idx] = (Math.random() - 0.5) * 2;
        pos[idx + 1] = (Math.random() - 0.5) * 2;
        pos[idx + 2] = (Math.random() - 0.5) * 2;
      }
    }
    particlesRef.current.geometry.attributes.position.needsUpdate = true;
    if (config.params.rotation) {
      particlesRef.current.rotation.y = time * 0.1 * speed;
    }
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.08 * config.params.scale}
        vertexColors
        transparent
        opacity={0.8}
        sizeAttenuation
      />
    </points>
  );
}

// Waveform visualization
function WaveformVisualization({ config }: { config: VisualizationConfig }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const { primary, secondary } = config.colors;

  useFrame((state) => {
    if (!meshRef.current || !materialRef.current) return;
    const time = state.clock.elapsedTime;
    const geo = meshRef.current.geometry as THREE.PlaneGeometry;
    const positions = geo.attributes.position.array as Float32Array;
    const speed = config.params.speed;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const wave1 = Math.sin(x * 2 + time * speed * 2) * config.intensity * 0.5;
      const wave2 = Math.sin(x * 4 + time * speed * 3) * config.intensity * 0.3;
      const wave3 = Math.sin(x * 8 + time * speed * 5) * config.intensity * 0.2;
      positions[i + 1] = wave1 + wave2 + wave3;
    }
    geo.attributes.position.needsUpdate = true;

    const hue = (Math.sin(time * 0.5) * 0.5 + 0.5);
    materialRef.current.color.setHSL(hue, 0.8, 0.5);
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 4, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[8, 8, 64, 64]} />
      <meshStandardMaterial
        ref={materialRef}
        color={primary}
        side={THREE.DoubleSide}
        wireframe
      />
    </mesh>
  );
}

// Pulse visualization
function PulseVisualization({ config }: { config: VisualizationConfig }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const { primary, secondary, accent } = config.colors;

  useFrame((state) => {
    if (!meshRef.current || !materialRef.current) return;
    const time = state.clock.elapsedTime;
    const beat = Math.sin(time * config.params.speed * 2) * 0.5 + 0.5;
    const scale = 1 + beat * config.intensity * 0.5;
    meshRef.current.scale.set(scale, scale, scale);

    const colors = [primary, secondary, accent];
    const colorIndex = Math.floor(time * config.params.speed) % 3;
    materialRef.current.color.set(colors[colorIndex]);
    materialRef.current.emissive.set(colors[colorIndex]);
    materialRef.current.emissiveIntensity = beat * 0.5;
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1.5, 2]} />
      <meshStandardMaterial
        ref={materialRef}
        color={primary}
        emissive={primary}
        emissiveIntensity={0.3}
        wireframe={!config.params.glow}
      />
    </mesh>
  );
}

export function VisualizationCanvas({ config, width = 400, height = 300 }: VisualizationCanvasProps) {
  if (!config) {
    return (
      <div className="viz-canvas-placeholder" style={{ width, height }}>
        <p>Generate a visualization to see it here</p>
      </div>
    );
  }

  return (
    <div className="viz-canvas" style={{ width, height }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 60 }} dpr={[1, 2]}>
        <color attach="background" args={["#0a0a0f"] as any} />
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1} color={config.colors.primary} />
        <pointLight position={[-5, -5, 5]} intensity={0.6} color={config.colors.secondary} />

        {config.style === "particles" && <ParticleVisualization config={config} />}
        {config.style === "waveform" && <WaveformVisualization config={config} />}
        {config.style === "pulse" && <PulseVisualization config={config} />}
        {!["particles", "waveform", "pulse"].includes(config.style) && (
          <ParticleVisualization config={config} />
        )}
      </Canvas>
    </div>
  );
}
