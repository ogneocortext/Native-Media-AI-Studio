import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getNoiseTex } from "./textures";
import { makeAudioReactiveMaterialTSL, updateAudioReactiveMaterialTSL } from "../VisualizationFX";
import { useDisposeOnUnmount, getStemEnergy } from "./helpers";
import { attackRelease, beatSnap, energyHue, rolloff } from "./vizMotion";

// =============================================================================
// VINYL — Rotating disc with grooves
// =============================================================================
export function VinylDisc({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const discRef = useRef<THREE.Mesh>(null);
  const groovesRef = useRef<THREE.Group>(null);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });
  const beatPulseRef = useRef(0);

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

  useFrame((_s, delta) => {
    const t = _s.clock.elapsedTime;
    const { bass, treble, peak, beat } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    const dt60 = Math.min(delta, 0.1) * 60;

    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    // Beat-synced rotation kick (2026): the disc's spin
    // accelerates on the beat, then releases — a record
    // being struck, not a metronome.
    const beatTarget = beat ? 1.0 : 0.0;
    beatPulseRef.current = attackRelease(beatPulseRef.current, beatTarget, 0.3, 0.9, dt60);
    const snap =
      audioData.current.beatPhase != null
        ? beatSnap(audioData.current.beatPhase)
        : beatPulseRef.current;
    // Energy-driven hue: cool indigo at rest → warm amber when loud
    const eHue = energyHue(peak * 0.6 + stemEnergyRef.current.other * 0.3);

    const stemScale = 1 + stemEnergyRef.current.drums * 0.15 + stemEnergyRef.current.bass * 0.1;

    if (discRef.current) {
      if (!sceneFrozen)
        discRef.current.rotation.y =
          t * 0.5 * vizParams.rotationSpeed * speedMul * (1 + bass + snap * 0.8);
      discRef.current.scale.setScalar(vizParams.scale * stemScale * (1 + snap * 0.05));
      if (isWebGPU && discMat) {
        updateAudioReactiveMaterialTSL(discMat, { bass, mid: 0, treble }, vizParams.glowIntensity);
      } else {
        const m = discRef.current.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity =
          0.1 + rolloff(treble * vizParams.glowIntensity * 0.8 + stemEnergyRef.current.vocals * 0.3 + stemEnergyRef.current.other * 0.2, 0.8);
        m.roughness = 0.2 - peak * 0.1;
        m.metalness = 0.85;
        m.color.setHSL(eHue, 0.6, 0.08);
      }
    }
    if (groovesRef.current && !sceneFrozen)
      groovesRef.current.rotation.y =
        t * 0.5 * vizParams.rotationSpeed * speedMul * (1 + bass + snap * 0.8);
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
