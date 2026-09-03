import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";

// =============================================================================
// FRACTAL — Self-similar recursive patterns that evolve with music
// =============================================================================
export function FractalViz({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const ringCount = 7;

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;
    const features = getTrackFeatures();
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    if (beat || features.onset > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.9;
    if (!sceneFrozen)
      rotRef.current += 0.005 * vizParams.rotationSpeed * speedMul * (1 + bass * 2);

    ringRefs.current.forEach((ring, i) => {
      if (!ring) return;
      const freq = i % 3 === 0 ? bass : i % 3 === 1 ? mid : treble;
      const scale = 0.5 + i * 0.7 + freq * 0.5 + beatPulse.current * 0.3;
      ring.scale.setScalar(scale);
      ring.rotation.x = rotRef.current * (i + 1) * 0.3 + Math.sin(t * speedMul + i) * 0.2;
      ring.rotation.y =
        rotRef.current * (i + 1) * 0.2 + Math.cos(t * 0.7 * speedMul + i) * mid * 0.5;
      ring.rotation.z = Math.sin(t * 0.5 * speedMul + i * 0.5) * treble * 0.8;
      const m = ring.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity =
        0.3 + freq * vizParams.glowIntensity * 2 + beatPulse.current * 1.5;
      m.color.setHSL(0.7 + i * 0.05 + features.brightness * 0.2, 0.8, 0.5);
      m.emissive.setHSL(0.75 + i * 0.04, 0.9, 0.4 + beatPulse.current * 0.3);
      m.opacity = 0.4 + freq * 0.3;
    });
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: ringCount }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            ringRefs.current[i] = el;
          }}
        >
          <torusGeometry args={[1, 0.03 + i * 0.01, 16, 64]} />
          <meshStandardMaterial
            color="#a855f7"
            emissive="#7c3aed"
            emissiveIntensity={0.5}
            transparent
            opacity={0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
