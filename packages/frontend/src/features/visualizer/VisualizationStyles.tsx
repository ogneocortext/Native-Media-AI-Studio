import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AudioData } from "./Visualizer";

// Waveform Visualization
export function WaveformViz({ audioData }: { audioData: React.MutableRefObject<AudioData> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  
  useFrame((state) => {
    if (!meshRef.current || !materialRef.current) return;
    const time = state.clock.elapsedTime;
    const geo = meshRef.current.geometry as THREE.PlaneGeometry;
    const positions = geo.attributes.position.array as Float32Array;
    
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const wave1 = Math.sin(x * 2 + time * 2) * audioData.current.bass * 0.5;
      const wave2 = Math.sin(x * 4 + time * 3) * audioData.current.mid * 0.3;
      const wave3 = Math.sin(x * 8 + time * 5) * audioData.current.treble * 0.2;
      positions[i + 1] = wave1 + wave2 + wave3;
    }
    geo.attributes.position.needsUpdate = true;
    
    const hue = (audioData.current.mid * 0.3 + 0.5) % 1;
    materialRef.current.color.setHSL(hue, 0.8, 0.5);
  });
  
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 4, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[8, 8, 64, 64]} />
      <meshStandardMaterial ref={materialRef} color="#6366f1" side={THREE.DoubleSide} wireframe />
    </mesh>
  );
}

// Particle Storm Visualization
export function ParticleStormViz({ audioData }: { audioData: React.MutableRefObject<AudioData> }) {
  const particlesRef = useRef<THREE.Points>(null);
  const count = 500;
  
  const { positions, velocities, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
      vel[i * 3] = (Math.random() - 0.5) * 0.1;
      vel[i * 3 + 1] = Math.random() * 0.2;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
      col[i * 3] = Math.random();
      col[i * 3 + 1] = Math.random();
      col[i * 3 + 2] = 1;
    }
    return { positions: pos, velocities: vel, colors: col };
  }, []);
  
  useFrame((state) => {
    if (!particlesRef.current) return;
    const pos = particlesRef.current.geometry.attributes.position.array as Float32Array;
    const dt = 0.016;
    
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      // Explosive outward motion on bass
      const bassBoost = audioData.current.bass * 0.3;
      pos[idx] += velocities[idx] * (1 + bassBoost * 5);
      pos[idx + 1] += velocities[idx + 1] * (1 + audioData.current.mid * 3);
      pos[idx + 2] += velocities[idx + 2] * (1 + bassBoost * 5);
      
      // Reset particles that go too far
      const dist = Math.sqrt(pos[idx] ** 2 + pos[idx + 1] ** 2 + pos[idx + 2] ** 2);
      if (dist > 8) {
        pos[idx] = (Math.random() - 0.5) * 2;
        pos[idx + 1] = (Math.random() - 0.5) * 2;
        pos[idx + 2] = (Math.random() - 0.5) * 2;
      }
    }
    particlesRef.current.geometry.attributes.position.needsUpdate = true;
    particlesRef.current.rotation.y = state.clock.elapsedTime * 0.1;
  });
  
  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.08} vertexColors transparent opacity={0.8} sizeAttenuation />
    </points>
  );
}

// Neural Network Visualization
export function NeuralViz({ audioData }: { audioData: React.MutableRefObject<AudioData> }) {
  const groupRef = useRef<THREE.Group>(null);
  const nodeCount = 50;
  
  const { nodes, connections } = useMemo(() => {
    const n: { pos: THREE.Vector3; connections: number[] }[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const connections: number[] = [];
      const numConnections = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < numConnections; j++) {
        connections.push(Math.floor(Math.random() * nodeCount));
      }
      n.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8
        ),
        connections,
      });
    }
    return { nodes: n, connections: [] };
  }, []);
  
  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.2;
    
    groupRef.current.children.forEach((child, i) => {
      if (child instanceof THREE.Mesh) {
        const scale = 0.5 + audioData.current.overall * 1.5;
        child.scale.setScalar(scale);
        const material = child.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = audioData.current.bass * 2;
      }
    });
  });
  
  return (
    <group ref={groupRef}>
      {nodes.map((node, i) => (
        <mesh key={i} position={node.pos}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// Cosmic Dust Visualization
export function CosmicViz({ audioData }: { audioData: React.MutableRefObject<AudioData> }) {
  const particlesRef = useRef<THREE.Points>(null);
  const count = 1000;
  
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const radius = Math.random() * 10 + 2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = radius * Math.cos(phi);
    }
    return pos;
  }, []);
  
  useFrame((state) => {
    if (!particlesRef.current) return;
    particlesRef.current.rotation.y = state.clock.elapsedTime * 0.02;
    particlesRef.current.rotation.z = state.clock.elapsedTime * 0.01;
    
    const material = particlesRef.current.material as THREE.PointsMaterial;
    material.size = 0.03 + audioData.current.overall * 0.05;
    material.opacity = 0.4 + audioData.current.mid * 0.4;
  });
  
  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.04} color="#a78bfa" transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

// Pulse Visualization
export function PulseViz({ audioData }: { audioData: React.MutableRefObject<AudioData> }) {
  const ringsRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (!ringsRef.current) return;
    ringsRef.current.children.forEach((ring, i) => {
      const mesh = ring as THREE.Mesh;
      const baseScale = 1 + i * 0.5;
      const pulse = audioData.current.beat ? 1.5 : 1;
      const scale = baseScale * pulse * (1 + audioData.current.bass * 0.3);
      mesh.scale.setScalar(scale);
      
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 0.3 + audioData.current.overall * 0.4;
    });
    ringsRef.current.rotation.z = state.clock.elapsedTime * 0.2;
  });
  
  return (
    <group ref={ringsRef}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1 + i * 0.8, 0.02, 16, 100]} />
          <meshStandardMaterial 
            color={`hsl(${260 + i * 20}, 80%, 60%)`} 
            transparent 
            opacity={0.5}
            emissive={`hsl(${260 + i * 20}, 80%, 40%)`}
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}
    </group>
  );
}