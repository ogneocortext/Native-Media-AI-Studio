import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getNoiseTex } from "./textures";

// =============================================================================
// VINYL — Rotating disc with grooves
// =============================================================================
export function VinylDisc({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const discRef = useRef<THREE.Mesh>(null);
  const groovesRef = useRef<THREE.Group>(null);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const { bass, treble, peak } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    if (discRef.current) {
      if (!sceneFrozen)
        discRef.current.rotation.y =
          t * 0.5 * vizParams.rotationSpeed * speedMul * (1 + bass);
      discRef.current.scale.setScalar(vizParams.scale * (1 + bass * 0.08));
      const m = discRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.1 + treble * vizParams.glowIntensity * 0.8;
      m.roughness = 0.2 - peak * 0.1;
      m.metalness = 0.85;
    }
    if (groovesRef.current && !sceneFrozen)
      groovesRef.current.rotation.y =
        t * 0.5 * vizParams.rotationSpeed * speedMul * (1 + bass);
  });

  return (
    <group>
      <mesh ref={discRef}>
        <cylinderGeometry args={[2.5, 2.5, 0.05, 96]} />
        <meshPhysicalMaterial
          color="#0b0b12"
          emissive="#1a1a2e"
          emissiveIntensity={0.1}
          roughness={0.12}
          metalness={0.85}
          clearcoat={1}
          clearcoatRoughness={0.06}
          map={getNoiseTex()}
        />
      </mesh>
      <group ref={groovesRef}>
        {Array.from({ length: 20 }).map((_, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <torusGeometry args={[0.5 + i * 0.12, 0.003, 4, 128]} />
            <meshStandardMaterial
              color="#333"
              emissive="#222"
              emissiveIntensity={0.1}
              transparent
              opacity={0.2}
            />
          </mesh>
        ))}
      </group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.02, 32]} />
        <meshStandardMaterial
          color="#6366f1"
          emissive="#4338ca"
          emissiveIntensity={0.3}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.55, 0.6, 32]} />
        <meshStandardMaterial
          color="#818cf8"
          emissive="#6366f1"
          emissiveIntensity={0.5}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
