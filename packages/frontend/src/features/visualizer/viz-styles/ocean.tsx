import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import {
  makeTerrainMaterial,
  updateTerrainMaterial,
  makeTerrainMaterialTSL,
  updateTerrainMaterialTSL,
} from "../VisualizationFX";
import { useDisposeOnUnmount } from "./helpers";

// =============================================================================
// OCEAN — Wave simulation with peaks and valleys
// =============================================================================
export function OceanWaves({ audioData, vizParams, sceneFrozen, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  // 2026: GPU ocean — layered noise swells, luminous crests, fresnel sheen
  const mat = useMemo(
    () =>
      isWebGPU
        ? makeTerrainMaterialTSL({
            colorA: "#031c33",
            colorB: "#2dd4bf",
            rim: "#a5f3fc",
            displace: 1.5,
            freq1: 0.35,
            freq2: 1.4,
            speed: 0.45,
            ripple: 0.45,
          })
        : makeTerrainMaterial({
            colorA: "#031c33",
            colorB: "#2dd4bf",
            rim: "#a5f3fc",
            displace: 1.5,
            freq1: 0.35,
            freq2: 1.4,
            speed: 0.45,
            ripple: 0.45,
          }),
    [isWebGPU],
  );
  useDisposeOnUnmount(mat);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    // Map stems to visual channels: vocals → wave motion intensity,
    // other → palette modulation, drums → peak sharpness / rotation jitter.
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

    const stemLift = 1 + stemEnergyRef.current.vocals * 0.6 + stemEnergyRef.current.bass * 0.2;
    if (isWebGPU) {
      updateTerrainMaterialTSL(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.5 * stemLift);
    } else {
      updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.5 * stemLift);
    }
    meshRef.current.rotation.x = -Math.PI / 2.2;
    if (!sceneFrozen)
      meshRef.current.rotation.z = t * 0.005 * vizParams.rotationSpeed * speedMul + stemEnergyRef.current.bass * 0.02;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[8, 8, 128, 128]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
