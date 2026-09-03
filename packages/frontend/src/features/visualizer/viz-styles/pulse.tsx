import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";

// =============================================================================
// PULSE — Concentric rings emitting from center on beats
// =============================================================================
export function PulseRings({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringCount = 12;

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, beat, peak: beatPeak } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    ringRefs.current.forEach((ring, i) => {
      if (!ring) return;
      const speed = 0.3 + i * 0.05;
      const offset = i * 0.08;
      const phase = (t * speed * speedMul + offset) % 1;
      ring.scale.setScalar(Math.max(0.1, phase * 8));
      const m = ring.material as THREE.MeshStandardMaterial;
      m.opacity = (1 - phase) * (0.5 + bass * 0.4);
      m.emissiveIntensity = (1 - phase) * vizParams.glowIntensity * 2;
      m.color.setHSL(0.5 + bass * 0.3, 0.8, 0.6);
      if (beat && i === 0) {
        m.opacity = 0.9;
        m.emissiveIntensity = 2 + beatPeak * 3;
      }
    });
    if (!sceneFrozen)
      groupRef.current.rotation.y = t * 0.02 * vizParams.rotationSpeed * speedMul;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: ringCount }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            ringRefs.current[i] = el;
          }}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.98, 1.0, 128]} />
          <meshStandardMaterial
            color={`hsl(${200 + i * 12},85%,60%)`}
            emissive={`hsl(${200 + i * 12},95%,50%)`}
            emissiveIntensity={0.5}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
            roughness={0.2}
            metalness={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================================
// SPECTRUM — Circular frequency bars with HSL mapping
// =============================================================================
export function SpectrumBars({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const barCount = 48;
  const rotRef = useRef(0);

  useFrame((_s) => {
    if (!groupRef.current) return;
    const { bass, mid, treble, peak } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    if (!sceneFrozen)
      rotRef.current += 0.004 * vizParams.rotationSpeed * speedMul * (1 + peak);

    barRefs.current.forEach((bar, i) => {
      if (!bar) return;
      const freq =
        i < barCount * 0.25 ? bass : i < barCount * 0.6 ? mid : treble;
      const h = 0.1 + freq * 4.5;
      bar.scale.set(1, Math.max(0.01, h), 1);
      bar.position.y = h / 2 - 1.5;
      const m = bar.material as THREE.MeshStandardMaterial;
      const hue = 0.55 + (i / barCount) * 0.4;
      m.color.setHSL(hue, 0.8, 0.5);
      m.emissive.setHSL(hue, 0.9, 0.2 + freq * 0.6);
      m.emissiveIntensity = 0.2 + freq * vizParams.glowIntensity * 1.5;
      m.roughness = 0.3;
      m.metalness = 0.7;
    });
    groupRef.current.rotation.y = rotRef.current;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: barCount }).map((_, i) => {
        const a = (i / barCount) * Math.PI * 2;
        return (
          <mesh
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            position={[Math.cos(a) * 2, -1.5, Math.sin(a) * 2]}
            rotation={[0, -a, 0]}
          >
            <capsuleGeometry args={[0.045, 1, 4, 12]} />
            <meshPhysicalMaterial
              color={`hsl(${220 + i * 3},80%,55%)`}
              emissive={`hsl(${220 + i * 3},90%,45%)`}
              emissiveIntensity={0.3}
              roughness={0.18}
              metalness={0.85}
              clearcoat={1}
              clearcoatRoughness={0.15}
            />
          </mesh>
        );
      })}
    </group>
  );
}
