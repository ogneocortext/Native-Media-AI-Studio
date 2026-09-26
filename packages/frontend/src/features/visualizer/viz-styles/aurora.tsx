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
// AURORA — Flowing ribbon/curtain (dreamy)
// =============================================================================
export function AuroraRibbon({ audioData, vizParams, sceneFrozen, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  // 2026: aurora as a shader curtain — soft volumetric falloff, no hard plane edges
  const mat = useMemo(
    () =>
      isWebGPU
        ? makeTerrainMaterialTSL({
            colorA: "#052e1f",
            colorB: "#34d399",
            rim: "#c084fc",
            opacity: 0.72,
            displace: 0.9,
            freq1: 0.4,
            freq2: 2.6,
            speed: 0.5,
            ripple: 0.2,
          })
        : makeTerrainMaterial({
            colorA: "#052e1f",
            colorB: "#34d399",
            rim: "#c084fc",
            opacity: 0.72,
            displace: 0.9,
            freq1: 0.4,
            freq2: 2.6,
            speed: 0.5,
            ripple: 0.2,
          }),
    [isWebGPU],
  );
  useDisposeOnUnmount(mat);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
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

    if (isWebGPU) {
      updateTerrainMaterialTSL(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.8);
    } else {
      updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.8);
    }
    meshRef.current.rotation.x = -Math.PI / 3 + stemEnergyRef.current.drums * 0.05;
    if (!sceneFrozen)
      meshRef.current.rotation.z = t * 0.01 * vizParams.rotationSpeed * speedMul + stemEnergyRef.current.bass * 0.03;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[8, 5, 96, 64]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
