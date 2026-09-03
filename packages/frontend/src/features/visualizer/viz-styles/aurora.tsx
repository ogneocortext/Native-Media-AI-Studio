import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import {
  makeTerrainMaterial,
  updateTerrainMaterial,
} from "../VisualizationFX";

// =============================================================================
// AURORA — Flowing ribbon/curtain (dreamy)
// =============================================================================
export function AuroraRibbon({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // 2026: aurora as a shader curtain — soft volumetric falloff, no hard plane edges
  const mat = useMemo(
    () =>
      makeTerrainMaterial({
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
    [],
  );

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    updateTerrainMaterial(
      mat,
      t,
      { bass, mid, treble, energy },
      vizParams.glowIntensity * 0.8,
    );
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

// =============================================================================
// OCEAN — Wave simulation with peaks and valleys
// =============================================================================
export function OceanWaves({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // 2026: GPU ocean — layered noise swells, luminous crests, fresnel sheen
  const mat = useMemo(
    () =>
      makeTerrainMaterial({
        colorA: "#031c33",
        colorB: "#2dd4bf",
        rim: "#a5f3fc",
        displace: 1.5,
        freq1: 0.35,
        freq2: 1.4,
        speed: 0.45,
        ripple: 0.45,
      }),
    [],
  );

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    updateTerrainMaterial(
      mat,
      t,
      { bass, mid, treble, energy },
      vizParams.glowIntensity * 0.5,
    );
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
