import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import { InstancedParticles } from "./instancedParticles";
import { getStemEnergy } from "./helpers";
import { attackRelease, beatSnap, energyHue, rolloff } from "./vizMotion";

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
  useFrame((_s, delta) => {
    const { bass } = audioData.current;
    const features = getTrackFeatures();
    const dt60 = Math.min(delta, 0.1) * 60;

    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    const beatTarget =
      audioData.current.beat || features.onset > 0.5 || stemEnergyRef.current.drums > 0.5 ? 1.0 : 0.0;
    beatPulse.current = attackRelease(beatPulse.current, beatTarget, 0.35, 0.88, dt60);
    const snap =
      audioData.current.beatPhase != null
        ? beatSnap(audioData.current.beatPhase)
        : beatPulse.current;
    if (!sceneFrozen)
      rotRef.current +=
        0.004 *
        vizParams.rotationSpeed *
        (1 +
          bass * 2.5 +
          features.energy * 2 +
          stemEnergyRef.current.bass * 0.3 +
          stemEnergyRef.current.vocals * 0.2);

    if (shockRef.current) {
      const sScale = 0.5 + beatPulse.current * 6 + snap * 2 + stemEnergyRef.current.bass * 0.4;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - beatPulse.current) * 0.35 + stemEnergyRef.current.drums * 0.15;
      sm.emissiveIntensity = rolloff((1 - beatPulse.current) * 4 + stemEnergyRef.current.drums * 1.2, 1.0);
      sm.color.setHSL(
        energyHue(features.energy) - features.brightness * 0.2 + stemEnergyRef.current.vocals * 0.1,
        0.9,
        0.5,
      );
      sm.emissive.setHSL(
        energyHue(features.energy) + 0.05 - features.brightness * 0.2 + stemEnergyRef.current.vocals * 0.08,
        1.0,
        0.4,
      );
    }
  });

  return (
    <group>
      {/* 2026 declutter: 3000 → 2000. The spiral plus the
          shockwave read as a soft wash in a single frame;
          trimming keeps the galaxy structure legible. */}
      <InstancedParticles
        audioData={audioData}
        vizParams={vizParams}
        sceneFrozen={sceneFrozen}
        prefersReducedMotion={prefersReducedMotion}
        count={2000}
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
export function EnergyWaves({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const drainRef = useRef<THREE.Mesh>(null);
  const funnelRef = useRef<THREE.Mesh>(null);
  const jetRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const rotRef = useRef(0);
  const suckRef = useRef(0);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  // TODO: add isWebGPU detection when TSL material path is needed
  useFrame((_s, delta) => {
    const { bass, peak, beat, energy } = audioData.current;
    const dt60 = Math.min(delta, 0.1) * 60;

    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    const suckTarget = beat || stemEnergyRef.current.drums > 0.5 ? 1.0 : 0.0;
    suckRef.current = attackRelease(suckRef.current, suckTarget, 0.4, 0.95, dt60);
    const snap =
      audioData.current.beatPhase != null
        ? beatSnap(audioData.current.beatPhase)
        : suckRef.current;
    const eHue = energyHue(energy);

    if (!sceneFrozen)
      rotRef.current +=
        0.005 * vizParams.rotationSpeed * (1 + energy * 2 + stemEnergyRef.current.bass * 0.4);

    if (drainRef.current) {
      const ds = 0.3 + bass * 0.4 + snap * 0.5 + stemEnergyRef.current.other * 0.2;
      drainRef.current.scale.setScalar(ds);
      const dm = drainRef.current.material as THREE.MeshStandardMaterial;
      dm.emissiveIntensity = rolloff(2 + bass * 4 + peak * 3 + stemEnergyRef.current.drums * 1.5, 1.0);
    }

    if (funnelRef.current) {
      funnelRef.current.rotation.y = rotRef.current * 0.2;
      const fm = funnelRef.current.material as THREE.MeshStandardMaterial;
      fm.opacity = 0.15 + bass * 0.15 + stemEnergyRef.current.vocals * 0.1;
      fm.emissiveIntensity = 0.3 + rolloff(bass + stemEnergyRef.current.other * 0.2, 0.8);
      fm.color.setHSL(eHue, 0.8, 0.5);
    }

    if (jetRef.current) {
      const jLen = 2 + bass * 5 + snap * 3 + stemEnergyRef.current.bass * 0.4;
      jetRef.current.scale.set(
        0.8 + bass + stemEnergyRef.current.drums * 0.2,
        jLen,
        0.8 + bass + stemEnergyRef.current.drums * 0.2,
      );
      jetRef.current.position.y = -2 - jLen * 0.3;
      const jm = jetRef.current.material as THREE.MeshStandardMaterial;
      jm.opacity = 0.2 + bass * 0.4 + stemEnergyRef.current.drums * 0.15;
      jm.emissiveIntensity = rolloff(1 + bass * 3 + stemEnergyRef.current.other * 0.3, 1.0);
      jm.color.setHSL(eHue + 0.1, 0.85, 0.55);
    }

    if (glowRef.current) {
      const gs = 0.5 + bass * 0.6 + peak * 0.4 + snap * 0.3 + stemEnergyRef.current.vocals * 0.2;
      glowRef.current.scale.setScalar(gs);
      const gm = glowRef.current.material as THREE.MeshStandardMaterial;
      gm.emissiveIntensity = rolloff(1 + bass * 3 + peak * 2 + stemEnergyRef.current.drums * 1, 1.0);
      gm.color.setHSL(eHue + 0.05, 0.9, 0.5);
    }
  });

  return (
    <group>
      {/* 2026 declutter: 3500 → 2400 for the vortex funnel */}
      <InstancedParticles
        audioData={audioData}
        vizParams={vizParams}
        sceneFrozen={sceneFrozen}
        prefersReducedMotion={prefersReducedMotion}
        count={2400}
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
