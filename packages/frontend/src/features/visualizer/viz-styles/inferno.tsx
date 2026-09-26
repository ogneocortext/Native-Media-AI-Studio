import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { InstancedParticles } from "./instancedParticles";
import { DEFAULT_VIZ_PARAMS } from "../types";
import {
  makeAudioReactiveMaterialTSL,
  updateAudioReactiveMaterialTSL,
} from "../VisualizationFX";
import { useDisposeOnUnmount } from "./helpers";

// =============================================================================
// INFERNO — Rising fire and ember particles
// =============================================================================
export function InfernoViz({ audioData, vizParams, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  const coreMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#f97316",
            emissive: "#ea580c",
            opacity: 0.75,
            roughness: 0.25,
            metalness: 0.1,
          })
        : null,
    [isWebGPU],
  );
  useDisposeOnUnmount(coreMat);

  useFrame((s) => {
    if (!coreRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, beat } = audioData.current;
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

    const coreScale = 0.3 + bass * 0.6 + (beat ? 0.3 : 0) + stemEnergyRef.current.drums * 0.4 + stemEnergyRef.current.other * 0.2;
    coreRef.current.scale.setScalar(coreScale);
    if (isWebGPU && coreMat) {
      updateAudioReactiveMaterialTSL(coreMat, { bass, mid: 0, treble: 0, energy: 0.5 }, vizParams.glowIntensity);
      coreRef.current.rotation.y = t * 0.5 * vizParams.rotationSpeed * speedMul;
    } else {
      const cm = coreRef.current.material as THREE.MeshStandardMaterial;
      cm.emissiveIntensity = 1 + bass * 4;
    }
  });

  return (
    <group>
      <InstancedParticles
        audioData={audioData}
        vizParams={{ ...DEFAULT_VIZ_PARAMS, glowIntensity: 1, rotationSpeed: 1 }}
        sceneFrozen={false}
        prefersReducedMotion={prefersReducedMotion}
        count={2000}
        baseSize={0.1}
        spread={5}
        hueBase={0.02}
        hueRange={0.08}
        stretch={2.2}
      />
      <mesh ref={coreRef} position={[0, -2, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        {isWebGPU && coreMat ? (
          <primitive object={coreMat} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#f97316"
            emissive="#ea580c"
            emissiveIntensity={3}
            transparent
            opacity={0.6}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        )}
      </mesh>
    </group>
  );
}
