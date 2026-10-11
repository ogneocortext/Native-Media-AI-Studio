import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { InstancedParticles } from "./instancedParticles";
import { DEFAULT_VIZ_PARAMS } from "../types";
import { makeAudioReactiveMaterialTSL, updateAudioReactiveMaterialTSL } from "../VisualizationFX";
import { useDisposeOnUnmount, getStemEnergy } from "./helpers";
import { attackRelease, beatSnap, rolloff } from "./vizMotion";

// =============================================================================
// INFERNO — Rising fire and ember particles
// =============================================================================
export function InfernoViz({
  audioData,
  vizParams,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });
  const emberPulseRef = useRef(0);

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

  useFrame((_s, delta) => {
    if (!coreRef.current) return;
    const t = _s.clock.elapsedTime;
    const { bass, beat } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    const dt60 = Math.min(delta, 0.1) * 60;

    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    // Beat-quantized ember burst (2026): embers
    // eject on the grid, then fall — a fire
    // stoked on each beat, not a constant glow.
    const emberTarget = beat ? 1.0 : 0.0;
    emberPulseRef.current = attackRelease(emberPulseRef.current, emberTarget, 0.3, 0.9, dt60);
    const snap =
      audioData.current.beatPhase != null
        ? beatSnap(audioData.current.beatPhase)
        : emberPulseRef.current;

    const coreScale =
      0.3 +
      bass * 0.6 +
      snap * 0.4 +
      stemEnergyRef.current.drums * 0.4 +
      stemEnergyRef.current.other * 0.2;
    coreRef.current.scale.setScalar(coreScale);
    if (isWebGPU && coreMat) {
      updateAudioReactiveMaterialTSL(
        coreMat,
        { bass, mid: 0, treble: 0, energy: 0.5 },
        vizParams.glowIntensity * (1 + snap * 0.5),
      );
      coreRef.current.rotation.y = t * 0.5 * vizParams.rotationSpeed * speedMul;
    } else {
      const cm = coreRef.current.material as THREE.MeshStandardMaterial;
      // Rolloff-capped so the fire core keeps
      // detail instead of clipping to white.
      cm.emissiveIntensity = 1 + rolloff(bass * 4 + snap * 2, 1.0);
    }
  });

  return (
    <group>
      {/* 2026 declutter: 2000 → 1400 embers. The
          dense warm field read as chaotic clutter;
          fewer embers keep the rising motion legible. */}
      <InstancedParticles
        audioData={audioData}
        vizParams={{ ...DEFAULT_VIZ_PARAMS, glowIntensity: 1, rotationSpeed: 1 }}
        sceneFrozen={false}
        prefersReducedMotion={prefersReducedMotion}
        count={1400}
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
