import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import {
  makeTerrainMaterial,
  updateTerrainMaterial,
  makeTerrainMaterialTSL,
  updateTerrainMaterialTSL,
  type TerrainTSLMaterial,
} from "../VisualizationFX";
import { useDisposeOnUnmount, getStemEnergy, isWebGPURendererInstance } from "./helpers";
import { beatSnap, energyHue } from "./vizMotion";

// Scratch tint color — written per frame, passed to the terrain uniforms.
// (The old code called material.color.setHSL on a ShaderMaterial, which has
// no .color: TypeError every frame on WebGL, silent no-op on WebGPU.)
const tintScratch = new THREE.Color();
// Stable wrapper — the update helpers only read .color/.mix.
const tint = { color: tintScratch, mix: 0.4 };

// =============================================================================
// OCEAN — Wave simulation with peaks and valleys
// =============================================================================
export function OceanWaves({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const isWebGPU = isWebGPURendererInstance(gl);
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
    const { bass, mid, treble, energy, beatPhase } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    // Map stems to visual channels: vocals → wave motion intensity,
    // other → palette modulation, drums → peak sharpness / rotation jitter.
    getStemEnergy(stems, audioElapsedRef?.current ?? 0, stemEnergyRef.current);

    const stemLift = 1 + stemEnergyRef.current.vocals * 0.6 + stemEnergyRef.current.bass * 0.2;
    // Beat-quantized swell (2026): waves crest on the grid
    const snap = beatPhase != null ? beatSnap(beatPhase) : 0;
    // Energy-driven palette: teal at rest → warm when loud. Delivered
    // through the terrain material's uTint uniform — the material is a
    // ShaderMaterial (WebGL) / node material (WebGPU) with no .color to
    // setHSL on.
    const eHue = energyHue(energy);
    tintScratch.setHSL(eHue, 0.75, 0.5);
    if (isWebGPU) {
      updateTerrainMaterialTSL(
        mat as TerrainTSLMaterial,
        t,
        { bass, mid, treble, energy },
        vizParams.glowIntensity * 0.5 * stemLift * (1 + snap * 0.4),
        tint,
      );
    } else {
      updateTerrainMaterial(
        mat as THREE.ShaderMaterial,
        t,
        { bass, mid, treble, energy },
        vizParams.glowIntensity * 0.5 * stemLift * (1 + snap * 0.4),
        tint,
      );
    }
    meshRef.current.rotation.x = -Math.PI / 2.2 + snap * 0.02;
    if (!sceneFrozen)
      meshRef.current.rotation.z =
        t * 0.005 * vizParams.rotationSpeed * speedMul +
        stemEnergyRef.current.bass * 0.02 +
        snap * 0.01;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[8, 8, 128, 128]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
