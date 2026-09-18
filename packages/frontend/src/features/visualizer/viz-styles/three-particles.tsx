import { useFrame } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { createParticleSystem, type ParticleSystem } from "@newkrok/three-particles";

// =============================================================================
// THREE.PARTICLES DEMO — GPU-accelerated particles with trail renderer
// Integrates @newkrok/three-particles into the 3D visualizer scene.
// =============================================================================
export function ThreeParticlesDemo({ audioData, sceneFrozen }: VizProps) {
  const systemRef = useRef<ParticleSystem | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (systemRef.current) return;
    const system = createParticleSystem({
      maxParticles: 800,
      duration: 3,
      looping: true,
      startLifetime: 2,
      startSpeed: 4,
      startSize: 0.6,
      startColor: {
        min: { r: 1, g: 1, b: 0.8 },
        max: { r: 1, g: 0.9, b: 0.2 },
      },
      emission: { rateOverTime: 100 },
      shape: { shape: "SPHERE", sphere: { radius: 2 } },
      renderer: {
        rendererType: "POINTS",
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      } as any,
    } as any);
    systemRef.current = system;
    if (groupRef.current) {
      groupRef.current.add(system.instance);
      // Disable frustum culling so the particle system is never culled
      if (system.instance.frustumCulled !== undefined) {
        system.instance.frustumCulled = false;
      }
    }

    return () => {
      // dispose() releases the emitter's geometry/material/state — removing the
      // instance from the group alone leaked all of it on every style switch.
      systemRef.current = null;
      if (groupRef.current) {
        groupRef.current.remove(system.instance);
      }
      try {
        system.dispose();
      } catch {
        /* already disposed */
      }
    };
  }, []);

  useFrame((_, delta) => {
    if (sceneFrozen || !systemRef.current) return;
    const d = audioData.current;
    const speed = 1 + d.energy * 3 + d.bass * 2;
    systemRef.current.update({
      now: performance.now(),
      delta: Math.min(delta, 0.1) * speed,
      elapsed: performance.now() * 0.001,
    });
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.2 * (1 + d.bass);
      groupRef.current.rotation.x += delta * 0.1 * d.mid;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color="#ffff00" />
      </mesh>
    </group>
  );
}
