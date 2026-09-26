import { useFrame } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { createParticleSystem, type ParticleSystem } from "@newkrok/three-particles";

// =============================================================================
// THREE.PARTICLES DEMO — GPU-accelerated particles with trail renderer
// Integrates @newkrok/three-particles into the 3D visualizer scene.
// =============================================================================
export function ThreeParticlesDemo({ audioData, sceneFrozen, stems, audioElapsedRef }: VizProps) {
  const systemRef = useRef<ParticleSystem | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

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

    const speed = 1 + d.energy * 3 + d.bass * 2 + stemEnergyRef.current.drums * 0.5 + stemEnergyRef.current.other * 0.3;
    systemRef.current.update({
      now: performance.now(),
      delta: Math.min(delta, 0.1) * speed,
      elapsed: performance.now() * 0.001,
    });
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.2 * (1 + d.bass + stemEnergyRef.current.bass * 0.3);
      groupRef.current.rotation.x += delta * 0.1 * d.mid + stemEnergyRef.current.vocals * 0.05;
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
