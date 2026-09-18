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
export function AuroraRibbon({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

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
    if (isWebGPU) {
      updateTerrainMaterialTSL(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.8);
    } else {
      updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.8);
    }
    meshRef.current.rotation.x = -Math.PI / 3;
    if (!sceneFrozen)
      meshRef.current.rotation.z = t * 0.01 * vizParams.rotationSpeed * speedMul;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[8, 5, 96, 64]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
