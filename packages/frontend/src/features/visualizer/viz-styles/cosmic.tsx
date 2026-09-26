import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import { InstancedParticles } from "./instancedParticles";

// =============================================================================
// COSMIC DUST — Galaxy spiral with differential rotation
// =============================================================================
export function OrbitalParticles({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const shockRef = useRef<THREE.Mesh>(null);
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  // TODO: add isWebGPU detection when TSL particle material is wired in
  useFrame((_s) => {
    const { bass } = audioData.current;
    const features = getTrackFeatures();

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

    if (audioData.current.beat || features.onset > 0.5 || stemEnergyRef.current.drums > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.9;
    if (!sceneFrozen)
      rotRef.current += 0.004 * vizParams.rotationSpeed * (1 + bass * 2.5 + features.energy * 2 + stemEnergyRef.current.bass * 0.3 + stemEnergyRef.current.vocals * 0.2);

    if (shockRef.current) {
      const sScale = 0.5 + beatPulse.current * 6 + stemEnergyRef.current.bass * 0.4;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - beatPulse.current) * 0.35 + stemEnergyRef.current.drums * 0.15;
      sm.emissiveIntensity = (1 - beatPulse.current) * 4 + stemEnergyRef.current.drums * 1.2;
      sm.color.setHSL(0.55 - features.brightness * 0.2 + stemEnergyRef.current.vocals * 0.1, 0.9, 0.5);
      sm.emissive.setHSL(0.6 - features.brightness * 0.2 + stemEnergyRef.current.vocals * 0.08, 1.0, 0.4);
    }
  });

  return (
    <group>
      <InstancedParticles
        audioData={audioData}
        vizParams={vizParams}
        sceneFrozen={sceneFrozen}
        prefersReducedMotion={prefersReducedMotion}
        count={3000}
        baseSize={0.1}
        spread={5}
        hueBase={0.55}
        hueRange={0.25}
        stretch={3.2}
      />
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.98, 1.0, 64]} />
        <meshStandardMaterial
          color="#06b6d4"
          emissive="#0891b2"
          emissiveIntensity={4}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// =============================================================================
// COSMIC DUST — Vortex funnel draining into a black hole
// Wide top → narrow drain, particles spiral down like water
// =============================================================================
export function EnergyWaves({ audioData, vizParams, sceneFrozen, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const drainRef = useRef<THREE.Mesh>(null);
  const funnelRef = useRef<THREE.Mesh>(null);
  const jetRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const rotRef = useRef(0);
  const suckRef = useRef(0);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  // TODO: add isWebGPU detection when TSL material path is needed
  useFrame((_s) => {
    const { bass, peak, beat, energy } = audioData.current;

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

    if (beat || stemEnergyRef.current.drums > 0.5) suckRef.current = Math.min(suckRef.current + 0.8, 4);
    suckRef.current *= 0.95;

    if (!sceneFrozen)
      rotRef.current += 0.005 * vizParams.rotationSpeed * (1 + energy * 2 + stemEnergyRef.current.bass * 0.4);

    if (drainRef.current) {
      const ds = 0.3 + bass * 0.4 + suckRef.current * 0.3 + stemEnergyRef.current.other * 0.2;
      drainRef.current.scale.setScalar(ds);
      const dm = drainRef.current.material as THREE.MeshStandardMaterial;
      dm.emissiveIntensity = 2 + bass * 4 + peak * 3 + stemEnergyRef.current.drums * 1.5;
    }

    if (funnelRef.current) {
      funnelRef.current.rotation.y = rotRef.current * 0.2;
      const fm = funnelRef.current.material as THREE.MeshStandardMaterial;
      fm.opacity = 0.15 + bass * 0.15 + stemEnergyRef.current.vocals * 0.1;
      fm.emissiveIntensity = 0.3 + bass + stemEnergyRef.current.other * 0.2;
    }

    if (jetRef.current) {
      const jLen = 2 + bass * 5 + suckRef.current * 3 + stemEnergyRef.current.bass * 0.4;
      jetRef.current.scale.set(0.8 + bass + stemEnergyRef.current.drums * 0.2, jLen, 0.8 + bass + stemEnergyRef.current.drums * 0.2);
      jetRef.current.position.y = -2 - jLen * 0.3;
      const jm = jetRef.current.material as THREE.MeshStandardMaterial;
      jm.opacity = 0.2 + bass * 0.4 + stemEnergyRef.current.drums * 0.15;
      jm.emissiveIntensity = 1 + bass * 3 + stemEnergyRef.current.other * 0.3;
    }

    if (glowRef.current) {
      const gs = 0.5 + bass * 0.6 + peak * 0.4 + stemEnergyRef.current.vocals * 0.2;
      glowRef.current.scale.setScalar(gs);
      const gm = glowRef.current.material as THREE.MeshStandardMaterial;
      gm.emissiveIntensity = 1 + bass * 3 + peak * 2 + stemEnergyRef.current.drums * 1;
    }
  });

  return (
    <group>
      <InstancedParticles
        audioData={audioData}
        vizParams={vizParams}
        sceneFrozen={sceneFrozen}
        prefersReducedMotion={prefersReducedMotion}
        count={3500}
        baseSize={0.09}
        spread={5}
        hueBase={0.6}
        hueRange={0.15}
        stretch={2.8}
      />
      <mesh ref={funnelRef}>
        <coneGeometry args={[4, 6, 32, 1, true]} />
        <meshStandardMaterial
          color="#6366f1"
          emissive="#4338ca"
          emissiveIntensity={0.5}
          transparent
          opacity={0.15}
          wireframe
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={glowRef} position={[0, -3, 0]}>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshStandardMaterial
          color="#f97316"
          emissive="#ea580c"
          emissiveIntensity={2}
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={drainRef} position={[0, -3, 0]}>
        <sphereGeometry args={[0.3, 24, 24]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh ref={jetRef} position={[0, -4, 0]}>
        <coneGeometry args={[0.4, 5, 16, 1, true]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#0ea5e9"
          emissiveIntensity={2}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
