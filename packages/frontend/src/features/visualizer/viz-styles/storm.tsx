import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";

// =============================================================================
// STORM — Lightning bolts and energy discharges
// =============================================================================
export function StormViz({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const boltRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  const rotRef = useRef(0);
  const boltFlash = useRef(0);

  useFrame(() => {
    if (!groupRef.current) return;
    const { bass, treble, beat } = audioData.current;
    const features = getTrackFeatures();
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    if (beat || features.onset > 0.6) boltFlash.current = 1.0;
    boltFlash.current *= 0.85;
    if (!sceneFrozen)
      rotRef.current += 0.006 * vizParams.rotationSpeed * speedMul * (1 + treble * 3);

    boltRefs.current.forEach((bolt, i) => {
      if (!bolt) return;
      const freq = i % 2 === 0 ? bass : treble;
      const angle = (i / 6) * Math.PI * 2 + rotRef.current;
      const length = 2 + freq * 3 + boltFlash.current * 2;
      bolt.position.set(
        Math.cos(angle) * 0.5,
        length / 2 - 1,
        Math.sin(angle) * 0.5,
      );
      bolt.rotation.set(0, 0, angle + Math.PI / 2);
      bolt.scale.set(
        1 + boltFlash.current * 0.5,
        length,
        1 + boltFlash.current * 0.5,
      );
      const m = bolt.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.5 + boltFlash.current * 4 + freq * 2;
      m.opacity = 0.3 + boltFlash.current * 0.7;
      m.color.setHSL(
        0.6 + boltFlash.current * 0.1,
        0.9,
        0.5 + boltFlash.current * 0.3,
      );
    });

    if (glowRef.current) {
      const glowScale = 0.3 + bass * 0.5 + boltFlash.current * 0.8;
      glowRef.current.scale.setScalar(glowScale);
      const gm = glowRef.current.material as THREE.MeshStandardMaterial;
      gm.emissiveIntensity = 1 + bass * 3 + boltFlash.current * 5;
      gm.opacity = 0.3 + boltFlash.current * 0.4;
    }

    groupRef.current.rotation.y = rotRef.current * 0.5;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            boltRefs.current[i] = el;
          }}
        >
          <boxGeometry args={[0.05, 1, 0.05]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0ea5e9"
            emissiveIntensity={1}
            transparent
            opacity={0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial
          color="#818cf8"
          emissive="#6366f1"
          emissiveIntensity={2}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
