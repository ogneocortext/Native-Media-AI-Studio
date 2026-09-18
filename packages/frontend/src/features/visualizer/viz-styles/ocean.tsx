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
export function OceanWaves({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

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
    if (isWebGPU) {
      updateTerrainMaterialTSL(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.5);
    } else {
      updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.5);
    }
    meshRef.current.rotation.x = -Math.PI / 2.2;
    if (!sceneFrozen)
      meshRef.current.rotation.z = t * 0.005 * vizParams.rotationSpeed * speedMul;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[8, 8, 128, 128]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
