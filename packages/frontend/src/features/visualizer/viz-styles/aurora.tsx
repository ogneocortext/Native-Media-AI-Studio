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
import { useDisposeOnUnmount, getStemEnergy } from "./helpers";
import { beatSnap, energyHue } from "./vizMotion";

// =============================================================================
// AURORA — Flowing ribbon/curtain (dreamy)
// =============================================================================
export function AuroraRibbon({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ribbon2Ref = useRef<THREE.Mesh>(null);
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
  // Secondary curtain (2026): a second, slower,
  // warmer ribbon behind the main one gives the
  // aurora depth — a single flat plane read as
  // shallow in a single frame.
  const mat2 = useMemo(
    () =>
      isWebGPU
        ? makeTerrainMaterialTSL({
            colorA: "#1a0530",
            colorB: "#a855f7",
            rim: "#f0abfc",
            opacity: 0.5,
            displace: 0.6,
            freq1: 0.25,
            freq2: 1.8,
            speed: 0.3,
            ripple: 0.15,
          })
        : makeTerrainMaterial({
            colorA: "#1a0530",
            colorB: "#a855f7",
            rim: "#f0abfc",
            opacity: 0.5,
            displace: 0.6,
            freq1: 0.25,
            freq2: 1.8,
            speed: 0.3,
            ripple: 0.15,
          }),
    [isWebGPU],
  );
  useDisposeOnUnmount(mat, mat2);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy, beatPhase } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    // Beat-quantized displacement (2026): the curtain
    // ripples on the grid, not as a smooth tide.
    const snap = beatPhase != null ? beatSnap(beatPhase) : 0;
    // Energy-driven palette: the curtain warms with the
    // track instead of staying a fixed green.
    const eHue = energyHue(energy);

    if (isWebGPU) {
      updateTerrainMaterialTSL(
        mat,
        t,
        { bass, mid, treble, energy },
        vizParams.glowIntensity * 0.8 * (1 + snap * 0.4),
      );
    } else {
      updateTerrainMaterial(
        mat,
        t,
        { bass, mid, treble, energy },
        vizParams.glowIntensity * 0.8 * (1 + snap * 0.4),
      );
    }
    meshRef.current.rotation.x = -Math.PI / 3 + stemEnergyRef.current.drums * 0.05 + snap * 0.03;
    if (!sceneFrozen)
      meshRef.current.rotation.z =
        t * 0.01 * vizParams.rotationSpeed * speedMul + stemEnergyRef.current.bass * 0.03;

    // Secondary curtain lags the main one — parallax depth
    if (ribbon2Ref.current) {
      if (isWebGPU) {
        updateTerrainMaterialTSL(
          mat2,
          t * 0.7,
          { bass, mid, treble, energy },
          vizParams.glowIntensity * 0.5 * (1 + snap * 0.3),
        );
      } else {
        updateTerrainMaterial(
          mat2,
          t * 0.7,
          { bass, mid, treble, energy },
          vizParams.glowIntensity * 0.5 * (1 + snap * 0.3),
        );
      }
      ribbon2Ref.current.rotation.x = -Math.PI / 2.6 + stemEnergyRef.current.drums * 0.03;
      ribbon2Ref.current.rotation.z =
        t * 0.006 * vizParams.rotationSpeed * speedMul + stemEnergyRef.current.bass * 0.02;
      ribbon2Ref.current.position.z = -1.5;
      // Tint the secondary curtain toward the energy hue
      const m2 = ribbon2Ref.current.material as THREE.MeshStandardMaterial;
      if (m2 && m2.color) m2.color.setHSL(eHue + 0.2, 0.7, 0.5);
    }
  });

  return (
    <group>
      <mesh ref={meshRef}>
        <planeGeometry args={[8, 5, 96, 64]} />
        <primitive object={mat} attach="material" />
      </mesh>
      {/* Secondary curtain behind the main aurora */}
      <mesh ref={ribbon2Ref}>
        <planeGeometry args={[10, 6, 64, 48]} />
        <primitive object={mat2} attach="material" />
      </mesh>
    </group>
  );
}
