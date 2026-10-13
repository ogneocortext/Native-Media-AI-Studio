import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import { makeAudioReactiveMaterialTSL, updateAudioReactiveMaterialTSL } from "../VisualizationFX";
import { useDisposeOnUnmount, getStemEnergy } from "./helpers";
import { attackRelease, beatSnap, energyHue, gammaDrive, rolloff } from "./vizMotion";

// =============================================================================
// STORM — Lightning bolts and energy discharges
// =============================================================================
export function StormViz({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const boltRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  const rotRef = useRef(0);
  const boltFlash = useRef(0);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const boltMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#38bdf8",
            emissive: "#0ea5e9",
            opacity: 0.7,
            roughness: 0.2,
            metalness: 0.1,
          })
        : null,
    [isWebGPU],
  );

  const glowMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#818cf8",
            emissive: "#6366f1",
            opacity: 0.5,
            roughness: 0.2,
            metalness: 0.1,
          })
        : null,
    [isWebGPU],
  );
  useDisposeOnUnmount(boltMat, glowMat);

  useFrame((_s, delta) => {
    if (!groupRef.current) return;
    const { bass, treble, beat } = audioData.current;
    const features = getTrackFeatures();
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    const dt60 = Math.min(delta, 0.1) * 60;

    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    const flashTarget =
      beat || features.onset > 0.6 || stemEnergyRef.current.drums > 0.5 ? 1.0 : 0.0;
    boltFlash.current = attackRelease(boltFlash.current, flashTarget, 0.25, 0.85, dt60);
    // Beat-quantized flash: lightning strikes ON the grid
    const snap =
      audioData.current.beatPhase != null
        ? beatSnap(audioData.current.beatPhase, 8)
        : boltFlash.current;
    // Energy-driven hue: cool at rest → warm when loud
    const eHue = energyHue(features.energy);
    // Idle baseline (2026): the scene never goes dead — a slow
    // breathing rotation continues even in quiet passages.
    const idleDrift = 0.15 + features.energy * 0.5;
    if (!sceneFrozen)
      rotRef.current +=
        0.006 *
        vizParams.rotationSpeed *
        speedMul *
        (idleDrift + treble * 3 + stemEnergyRef.current.bass * 0.3);

    boltRefs.current.forEach((bolt, i) => {
      if (!bolt) return;
      const freq = i % 2 === 0 ? bass : treble;
      const angle = (i / 10) * Math.PI * 2 + rotRef.current;
      const length = 2 + freq * 3 + snap * 2.5 + stemEnergyRef.current.drums * 0.5;
      bolt.position.set(Math.cos(angle) * 0.5, length / 2 - 1, Math.sin(angle) * 0.5);
      bolt.rotation.set(0, 0, angle + Math.PI / 2);
      bolt.scale.set(1 + snap * 0.5, length, 1 + snap * 0.5);
      if (isWebGPU && boltMat) {
        updateAudioReactiveMaterialTSL(
          boltMat,
          { bass, mid: 0, treble, energy: 0.5 },
          vizParams.glowIntensity,
        );
      } else {
        const m = bolt.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity =
          0.5 + rolloff(snap * 4 + freq * 2 + stemEnergyRef.current.drums * 1.5, 1.0);
        m.opacity = 0.3 + snap * 0.7 + stemEnergyRef.current.other * 0.2;
        m.color.setHSL(
          eHue + snap * 0.1 + stemEnergyRef.current.vocals * 0.1,
          0.9,
          0.5 + snap * 0.3 + gammaDrive(stemEnergyRef.current.bass) * 0.1,
        );
      }
    });

    if (glowRef.current) {
      const glowScale =
        0.3 + bass * 0.5 + snap * 0.8 + stemEnergyRef.current.bass * 0.3;
      glowRef.current.scale.setScalar(glowScale);
      if (isWebGPU && glowMat) {
        updateAudioReactiveMaterialTSL(
          glowMat,
          { bass, mid: 0, treble, energy: 0.5 },
          vizParams.glowIntensity + stemEnergyRef.current.other * 0.5,
        );
      } else {
        const gm = glowRef.current.material as THREE.MeshStandardMaterial;
        gm.emissiveIntensity =
          1 + rolloff(bass * 3 + snap * 5 + stemEnergyRef.current.drums * 1.5, 1.0);
        gm.opacity = 0.3 + snap * 0.4 + stemEnergyRef.current.other * 0.2;
        gm.color.setHSL(eHue, 0.85, 0.55);
      }
    }

    groupRef.current.rotation.y = rotRef.current * 0.5;
  });

  return (
    <group ref={groupRef}>
      {/* 2026: 6 → 10 bolts. Six thin boxes read as a sparse
          skeletal frame in a single frame; ten gives the
          discharge enough density to read as a storm. */}
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            boltRefs.current[i] = el;
          }}
        >
          <boxGeometry args={[0.05, 1, 0.05]} />
          {isWebGPU && boltMat ? (
            <primitive object={boltMat} attach="material" />
          ) : (
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#0ea5e9"
              emissiveIntensity={1}
              transparent
              opacity={0.5}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          )}
        </mesh>
      ))}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.3, 16, 16]} />
        {isWebGPU && glowMat ? (
          <primitive object={glowMat} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#818cf8"
            emissive="#6366f1"
            emissiveIntensity={2}
            transparent
            opacity={0.4}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        )}
      </mesh>
    </group>
  );
}
