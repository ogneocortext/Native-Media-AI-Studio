import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { InstancedParticles } from "./instancedParticles";
import { DEFAULT_VIZ_PARAMS } from "../types";

// =============================================================================
// INFERNO — Rising fire and ember particles
// =============================================================================
export function InfernoViz({ audioData, prefersReducedMotion }: VizProps) {
  const coreRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const { bass, beat } = audioData.current;

    if (coreRef.current) {
      const coreScale = 0.3 + bass * 0.6 + (beat ? 0.3 : 0);
      coreRef.current.scale.setScalar(coreScale);
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
        <meshStandardMaterial
          color="#f97316"
          emissive="#ea580c"
          emissiveIntensity={3}
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
