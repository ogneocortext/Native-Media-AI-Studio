import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import {
  makeAudioReactiveMaterialTSL,
  updateAudioReactiveMaterialTSL,
} from "../VisualizationFX";
import { useDisposeOnUnmount } from "./helpers";

// =============================================================================
// FRACTAL — Self-similar recursive patterns that evolve with music
// =============================================================================
export function FractalViz({ audioData, vizParams, sceneFrozen, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const ringCount = 7;
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const ringMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#a855f7",
            emissive: "#7c3aed",
            opacity: 0.6,
            roughness: 0.25,
            metalness: 0.5,
          })
        : null,
    [isWebGPU],
  );
  useDisposeOnUnmount(ringMat);

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;
    const features = getTrackFeatures();
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    if (stems) {
      const el = (audioElapsedRef?.current ?? 0);
      const dur = stems.drums.duration || 1;
      const idx = Math.min(stems.drums.energy_curve.length - 1, Math.max(0, Math.floor((el / dur) * stems.drums.energy_curve.length)));
      stemEnergyRef.current = {
        vocals: stems.vocals.energy_curve[idx] ?? 0,
        drums: stems.drums.energy_curve[idx] ?? 0,
        bass: stems.bass.energy_curve[idx] ?? 0,
        other: stems.other.energy_curve[idx] ?? 0,
      };
    }

    if (beat || features.onset > 0.5 || stemEnergyRef.current.drums > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.9;
    if (!sceneFrozen)
      rotRef.current += 0.005 * vizParams.rotationSpeed * speedMul * (1 + bass * 2 + stemEnergyRef.current.bass * 0.4 + stemEnergyRef.current.vocals * 0.2);

    ringRefs.current.forEach((ring, i) => {
      if (!ring) return;
      const freq = i % 3 === 0 ? bass : i % 3 === 1 ? mid : treble;
      const scale = 0.5 + i * 0.7 + freq * 0.5 + beatPulse.current * 0.3 + stemEnergyRef.current.bass * 0.25;
      ring.scale.setScalar(scale);
      ring.rotation.x = rotRef.current * (i + 1) * 0.3 + Math.sin(t * speedMul + i) * 0.2 + stemEnergyRef.current.other * 0.1;
      ring.rotation.y =
        rotRef.current * (i + 1) * 0.2 + Math.cos(t * 0.7 * speedMul + i) * mid * 0.5 + stemEnergyRef.current.vocals * 0.08;
      ring.rotation.z = Math.sin(t * 0.5 * speedMul + i * 0.5) * treble * 0.8 + stemEnergyRef.current.drums * 0.12;
      if (isWebGPU && ringMat) {
        updateAudioReactiveMaterialTSL(ringMat, { bass, mid, treble, energy: 0.5 }, vizParams.glowIntensity + stemEnergyRef.current.other * 0.5);
      } else {
        const m = ring.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity =
          0.3 + freq * vizParams.glowIntensity * 2 + beatPulse.current * 1.5 + stemEnergyRef.current.drums * 0.8;
        m.color.setHSL(0.7 + i * 0.05 + features.brightness * 0.2 + stemEnergyRef.current.vocals * 0.08, 0.8, 0.5);
        m.emissive.setHSL(0.75 + i * 0.04 + stemEnergyRef.current.bass * 0.06, 0.9, 0.4 + beatPulse.current * 0.3);
        m.opacity = 0.4 + freq * 0.3 + stemEnergyRef.current.other * 0.15;
      }
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
          {isWebGPU && ringMat ? (
            <primitive object={ringMat} attach="material" />
          ) : (
            <meshStandardMaterial
              color="#a855f7"
              emissive="#7c3aed"
              emissiveIntensity={0.5}
              transparent
              opacity={0.5}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          )}
        </mesh>
      ))}
    </group>
  );
}
