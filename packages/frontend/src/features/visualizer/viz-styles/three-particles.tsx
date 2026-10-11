import { useFrame } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { createParticleSystem, type ParticleSystem } from "@newkrok/three-particles";
import { getStemEnergy } from "./helpers";
import { attackRelease, beatSnap, energyHue } from "./vizMotion";

// =============================================================================
// THREE.PARTICLES DEMO — GPU-accelerated particles with trail renderer
// Integrates @newkrok/three-particles into the 3D visualizer scene.
// =============================================================================
export function ThreeParticlesDemo({ audioData, sceneFrozen, stems, audioElapsedRef }: VizProps) {
  const systemRef = useRef<ParticleSystem | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });
  const burstRef = useRef(0);

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
    const dt60 = Math.min(delta, 0.1) * 60;

    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    // Beat-reactive emission burst (2026): the emitter
    // rate spikes on the beat, so particles are born in
    // bursts synced to the grid — not a flat stream.
    const burstTarget = d.beat ? 1.0 : 0.0;
    burstRef.current = attackRelease(burstRef.current, burstTarget, 0.3, 0.9, dt60);
    const snap =
      d.beatPhase != null ? beatSnap(d.beatPhase) : burstRef.current;
    // Energy-driven palette: cool white-gold at rest →
    // warm amber when loud.
    const eHue = energyHue(d.energy);

    const speed =
      1 +
      d.energy * 3 +
      d.bass * 2 +
      snap * 1.5 +
      stemEnergyRef.current.drums * 0.5 +
      stemEnergyRef.current.other * 0.3;
    systemRef.current.update({
      now: performance.now(),
      delta: Math.min(delta, 0.1) * speed,
      elapsed: performance.now() * 0.001,
    });
    // Drive the emitter rate with the beat burst
    const emission = (systemRef.current as any).emission;
    if (emission) {
      emission.rateOverTime = 100 + snap * 400;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.2 * (1 + d.bass + snap * 0.5 + stemEnergyRef.current.bass * 0.3);
      groupRef.current.rotation.x += delta * 0.1 * d.mid + stemEnergyRef.current.vocals * 0.05;
    }
    // Central sphere pulses on the beat (2026): the
    // single static glow read as dead in a single frame.
    if (coreRef.current) {
      coreRef.current.scale.setScalar(1 + snap * 0.6 + d.bass * 0.3);
    }
    if (coreMatRef.current) {
      coreMatRef.current.color.setHSL(eHue, 0.95, 0.55 + snap * 0.2);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial ref={coreMatRef} color="#ffff00" />
      </mesh>
    </group>
  );
}
