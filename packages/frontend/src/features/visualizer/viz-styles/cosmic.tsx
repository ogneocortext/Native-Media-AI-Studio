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
}: VizProps) {
  const shockRef = useRef<THREE.Mesh>(null);
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const featuresRef = useRef({
    energy: 0.5,
    onset: 0,
    brightness: 0.5,
    noisiness: 0.5,
    sectionProgress: 0,
  });

  useFrame((_s) => {
    const { bass } = audioData.current;
    const features = getTrackFeatures();
    featuresRef.current = features;

    if (audioData.current.beat || features.onset > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.9;
    if (!sceneFrozen)
      rotRef.current += 0.004 * vizParams.rotationSpeed * (1 + bass * 2.5 + features.energy * 2);

    if (shockRef.current) {
      const sScale = 0.5 + beatPulse.current * 6;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - beatPulse.current) * 0.35;
      sm.emissiveIntensity = (1 - beatPulse.current) * 4;
      sm.color.setHSL(0.55 - features.brightness * 0.2, 0.9, 0.5);
      sm.emissive.setHSL(0.6 - features.brightness * 0.2, 1.0, 0.4);
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
export function EnergyWaves({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const drainRef = useRef<THREE.Mesh>(null);
  const funnelRef = useRef<THREE.Mesh>(null);
  const jetRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const rotRef = useRef(0);
  const suckRef = useRef(0);

  useFrame((_s) => {
    const { bass, peak, beat, energy } = audioData.current;

    if (beat) suckRef.current = Math.min(suckRef.current + 0.8, 4);
    suckRef.current *= 0.95;

    if (!sceneFrozen)
      rotRef.current += 0.005 * vizParams.rotationSpeed * (1 + energy * 2);

    if (drainRef.current) {
      const ds = 0.3 + bass * 0.4 + suckRef.current * 0.3;
      drainRef.current.scale.setScalar(ds);
      const dm = drainRef.current.material as THREE.MeshStandardMaterial;
      dm.emissiveIntensity = 2 + bass * 4 + peak * 3;
    }

    if (funnelRef.current) {
      funnelRef.current.rotation.y = rotRef.current * 0.2;
      const fm = funnelRef.current.material as THREE.MeshStandardMaterial;
      fm.opacity = 0.15 + bass * 0.15;
      fm.emissiveIntensity = 0.3 + bass;
    }

    if (jetRef.current) {
      const jLen = 2 + bass * 5 + suckRef.current * 3;
      jetRef.current.scale.set(0.8 + bass, jLen, 0.8 + bass);
      jetRef.current.position.y = -2 - jLen * 0.3;
      const jm = jetRef.current.material as THREE.MeshStandardMaterial;
      jm.opacity = 0.2 + bass * 0.4;
      jm.emissiveIntensity = 1 + bass * 3;
    }

    if (glowRef.current) {
      const gs = 0.5 + bass * 0.6 + peak * 0.4;
      glowRef.current.scale.setScalar(gs);
      const gm = glowRef.current.material as THREE.MeshStandardMaterial;
      gm.emissiveIntensity = 1 + bass * 3 + peak * 2;
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
