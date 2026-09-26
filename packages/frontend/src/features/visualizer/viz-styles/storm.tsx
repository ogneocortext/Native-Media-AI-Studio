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
// STORM — Lightning bolts and energy discharges
// =============================================================================
export function StormViz({ audioData, vizParams, sceneFrozen, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const boltRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  const rotRef = useRef(0);
  const boltFlash = useRef(0);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const boltMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#38bdf8",
            emissive: "#0ea5e9",
            opacity: 0.7,
            roughness: 0.2,
            metalness: 0.1,
          })
        : null,
    [isWebGPU],
  );

  const glowMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#818cf8",
            emissive: "#6366f1",
            opacity: 0.5,
            roughness: 0.2,
            metalness: 0.1,
          })
        : null,
    [isWebGPU],
  );
  useDisposeOnUnmount(boltMat, glowMat);

  useFrame(() => {
    if (!groupRef.current) return;
    const { bass, treble, beat } = audioData.current;
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

    if (beat || features.onset > 0.6 || stemEnergyRef.current.drums > 0.5) boltFlash.current = 1.0;
    boltFlash.current *= 0.85;
    if (!sceneFrozen)
      rotRef.current += 0.006 * vizParams.rotationSpeed * speedMul * (1 + treble * 3 + stemEnergyRef.current.bass * 0.3);

    boltRefs.current.forEach((bolt, i) => {
      if (!bolt) return;
      const freq = i % 2 === 0 ? bass : treble;
      const angle = (i / 6) * Math.PI * 2 + rotRef.current;
      const length = 2 + freq * 3 + boltFlash.current * 2 + stemEnergyRef.current.drums * 0.5;
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
      if (isWebGPU && boltMat) {
        updateAudioReactiveMaterialTSL(
          boltMat,
          { bass, mid: 0, treble, energy: 0.5 },
          vizParams.glowIntensity,
        );
      } else {
        const m = bolt.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 0.5 + boltFlash.current * 4 + freq * 2 + stemEnergyRef.current.drums * 1.5;
        m.opacity = 0.3 + boltFlash.current * 0.7 + stemEnergyRef.current.other * 0.2;
        m.color.setHSL(
          0.6 + boltFlash.current * 0.1 + stemEnergyRef.current.vocals * 0.1,
          0.9,
          0.5 + boltFlash.current * 0.3 + stemEnergyRef.current.bass * 0.1,
        );
      }
    });

    if (glowRef.current) {
      const glowScale = 0.3 + bass * 0.5 + boltFlash.current * 0.8 + stemEnergyRef.current.bass * 0.3;
      glowRef.current.scale.setScalar(glowScale);
      if (isWebGPU && glowMat) {
        updateAudioReactiveMaterialTSL(glowMat, { bass, mid: 0, treble, energy: 0.5 }, vizParams.glowIntensity + stemEnergyRef.current.other * 0.5);
      } else {
        const gm = glowRef.current.material as THREE.MeshStandardMaterial;
        gm.emissiveIntensity = 1 + bass * 3 + boltFlash.current * 5 + stemEnergyRef.current.drums * 1.5;
        gm.opacity = 0.3 + boltFlash.current * 0.4 + stemEnergyRef.current.other * 0.2;
      }
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
          {isWebGPU && boltMat ? (
            <primitive object={boltMat} attach="material" />
          ) : (
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#0ea5e9"
              emissiveIntensity={1}
              transparent
              opacity={0.5}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          )}
        </mesh>
      ))}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.3, 16, 16]} />
        {isWebGPU && glowMat ? (
          <primitive object={glowMat} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#818cf8"
            emissive="#6366f1"
            emissiveIntensity={2}
            transparent
            opacity={0.4}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        )}
      </mesh>
    </group>
  );
}
