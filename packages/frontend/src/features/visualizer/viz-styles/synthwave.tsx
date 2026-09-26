import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getNoiseTex } from "./textures";
import {
  makeAudioReactiveMaterialTSL,
  updateAudioReactiveMaterialTSL,
} from "../VisualizationFX";
import { useDisposeOnUnmount } from "./helpers";

// =============================================================================
// VINYL — Rotating disc with grooves
// =============================================================================
export function VinylDisc({ audioData, vizParams, sceneFrozen, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const discRef = useRef<THREE.Mesh>(null);
  const groovesRef = useRef<THREE.Group>(null);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const discMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#0b0b12",
            emissive: "#1a1a2e",
            opacity: 1,
            roughness: 0.12,
            metalness: 0.85,
          })
        : null,
    [isWebGPU],
  );

  const grooveMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#333",
            emissive: "#222",
            opacity: 0.2,
            roughness: 0.4,
            metalness: 0.5,
          })
        : null,
    [isWebGPU],
  );

  const labelMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#6366f1",
            emissive: "#4338ca",
            opacity: 1,
            roughness: 0.3,
            metalness: 0.6,
          })
        : null,
    [isWebGPU],
  );

  const ringMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#818cf8",
            emissive: "#6366f1",
            opacity: 0.6,
            roughness: 0.3,
            metalness: 0.6,
          })
        : null,
    [isWebGPU],
  );
  useDisposeOnUnmount(discMat, grooveMat, labelMat, ringMat);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const { bass, treble, peak } = audioData.current;
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

    const stemScale = 1 + stemEnergyRef.current.drums * 0.15 + stemEnergyRef.current.bass * 0.1;

    if (discRef.current) {
      if (!sceneFrozen)
        discRef.current.rotation.y =
          t * 0.5 * vizParams.rotationSpeed * speedMul * (1 + bass);
      discRef.current.scale.setScalar(vizParams.scale * stemScale);
      if (isWebGPU && discMat) {
        updateAudioReactiveMaterialTSL(discMat, { bass, mid: 0, treble }, vizParams.glowIntensity);
      } else {
        const m = discRef.current.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 0.1 + treble * vizParams.glowIntensity * 0.8 + stemEnergyRef.current.vocals * 0.3 + stemEnergyRef.current.other * 0.2;
        m.roughness = 0.2 - peak * 0.1;
        m.metalness = 0.85;
      }
    }
    if (groovesRef.current && !sceneFrozen)
      groovesRef.current.rotation.y =
        t * 0.5 * vizParams.rotationSpeed * speedMul * (1 + bass);
  });

  return (
    <group>
      <mesh ref={discRef}>
        <cylinderGeometry args={[2.5, 2.5, 0.05, 96]} />
        {isWebGPU && discMat ? (
          <primitive object={discMat} attach="material" />
        ) : (
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
        )}
      </mesh>
      <group ref={groovesRef}>
        {Array.from({ length: 20 }).map((_, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <torusGeometry args={[0.5 + i * 0.12, 0.003, 4, 128]} />
            {isWebGPU && grooveMat ? (
              <primitive object={grooveMat} attach="material" />
            ) : (
              <meshStandardMaterial
                color="#333"
                emissive="#222"
                emissiveIntensity={0.1}
                transparent
                opacity={0.2}
              />
            )}
          </mesh>
        ))}
      </group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.02, 32]} />
        {isWebGPU && labelMat ? (
          <primitive object={labelMat} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#6366f1"
            emissive="#4338ca"
            emissiveIntensity={0.3}
            roughness={0.3}
            metalness={0.6}
          />
        )}
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.55, 0.6, 32]} />
        {isWebGPU && ringMat ? (
          <primitive object={ringMat} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#818cf8"
            emissive="#6366f1"
            emissiveIntensity={0.5}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>
    </group>
  );
}
