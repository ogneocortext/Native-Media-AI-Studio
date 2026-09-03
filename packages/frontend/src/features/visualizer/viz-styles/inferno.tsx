import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import {
  applyStreakVelocity,
  makeStreakMaterial,
} from "../VisualizationFX";

// =============================================================================
// INFERNO — Rising fire and ember particles
// =============================================================================
export function InfernoViz({ audioData, prefersReducedMotion }: VizProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const count = 2000;

  const { g: geom } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 2;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
      const heat = Math.random();
      const c = new THREE.Color().setHSL(
        0.02 + heat * 0.08,
        1.0,
        0.4 + heat * 0.3,
      );
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(pos), 3),
    );
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // 2026: embers stretch upward with the heat current
    applyStreakVelocity(
      g,
      (_i, x, _y, z) => {
        const r = Math.hypot(x, z) || 0.001;
        return [(-z / r) * 0.5, 1.1 + Math.random() * 0.9, (x / r) * 0.5];
      },
      count,
    );
    return { g, pos };
  }, []);

  const streakMat = useMemo(
    () => makeStreakMaterial({ size: 26, stretch: 2.2, opacity: 0.8 }),
    [],
  );

  useFrame(() => {
    if (!pointsRef.current) return;
    const { bass, treble, beat } = audioData.current;
    const features = getTrackFeatures();
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    const arr = geom.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      let y = arr[idx + 1] + (0.02 + features.energy * 0.05 + bass * 0.03) * speedMul;
      if (y > 3) y = -3;
      arr[idx + 1] = y;
      const angle = Math.atan2(arr[idx + 2], arr[idx]) + 0.02 * speedMul * (1 + treble);
      const radius = Math.sqrt(
        arr[idx] * arr[idx] + arr[idx + 2] * arr[idx + 2],
      );
      arr[idx] = Math.cos(angle) * radius;
      arr[idx + 2] = Math.sin(angle) * radius;
    }
    geom.attributes.position.needsUpdate = true;

    const su = streakMat.uniforms;
    su.uBass.value = bass;
    su.uTreble.value = treble;
    su.uOpacity.value = 0.55 + features.brightness * 0.3;

    if (coreRef.current) {
      const coreScale = 0.3 + bass * 0.6 + (beat ? 0.3 : 0);
      coreRef.current.scale.setScalar(coreScale);
      const cm = coreRef.current.material as THREE.MeshStandardMaterial;
      cm.emissiveIntensity = 1 + bass * 4;
    }
  });

  return (
    <group>
      <points ref={pointsRef} geometry={geom}>
        <primitive object={streakMat} attach="material" />
      </points>
      <mesh ref={coreRef} position={[0, -2, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
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
    </group>
  );
}
