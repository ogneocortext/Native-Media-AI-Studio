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
// COSMIC DUST — Galaxy spiral with differential rotation
// =============================================================================
export function OrbitalParticles({
  audioData,
  vizParams,
  sceneFrozen,
}: VizProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const count = 3000;
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const featuresRef = useRef({
    energy: 0.5,
    onset: 0,
    brightness: 0.5,
    noisiness: 0.5,
    sectionProgress: 0,
  });

  const {
    g: geom,
    radii,
    angles,
  } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const r = new Float32Array(count);
    const a = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const arm = i % 5;
      const t = Math.random();
      const radius = 0.2 + t * 5;
      const angle =
        t * Math.PI * 8 + (arm * Math.PI * 2) / 5 + (Math.random() - 0.5) * 0.5;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.4 * (1 - t);
      pos[i * 3 + 2] = Math.sin(angle) * radius;
      const hue = 0.55 + t * 0.25 + arm * 0.04;
      const c = new THREE.Color().setHSL(hue, 0.9, 0.4 + t * 0.3);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      r[i] = radius;
      a[i] = angle;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(pos), 3),
    );
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    applyStreakVelocity(
      g,
      (_i, x, _y, z) => {
        const r = Math.hypot(x, z) || 0.001;
        const s = 1.4 / (0.4 + r);
        return [(-z / r) * s, 0, (x / r) * s];
      },
      count,
    );
    return { g, pos, radii: r, angles: a };
  }, []);

  const streakMat = useMemo(
    () => makeStreakMaterial({ size: 30, stretch: 3.2, opacity: 0.8 }),
    [],
  );

  useFrame((s) => {
    if (!pointsRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;
    const features = getTrackFeatures();
    featuresRef.current = features;

    if (beat || features.onset > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.9;
    if (!sceneFrozen)
      rotRef.current +=
        0.004 *
        vizParams.rotationSpeed *
        (1 + bass * 2.5 + features.energy * 2);

    const arr = geom.attributes.position.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const rad = radii[i];
      const angle = angles[i] + rotRef.current * (1 + 1.5 / (rad + 0.3));
      const pulse =
        1 +
        bass * 0.3 +
        features.energy * 0.5 +
        beatPulse.current * 0.6 * (1 / (rad + 0.2)) +
        features.onset * 0.8;
      const vertical =
        Math.sin(t * 2 + i * 0.15) * treble * 0.6 +
        Math.cos(t + i * 0.08) * mid * 0.3 +
        Math.sin(t * 3 + i * 0.2) * features.brightness * 0.5;
      arr[idx] = Math.cos(angle) * rad * pulse;
      arr[idx + 1] = vertical * (1 + features.energy);
      arr[idx + 2] = Math.sin(angle) * rad * pulse;
    }
    geom.attributes.position.needsUpdate = true;

    const su = streakMat.uniforms;
    su.uBass.value = bass;
    su.uTreble.value = treble * 0.5 + features.brightness * 0.5;
    su.uOpacity.value =
      0.45 +
      treble * 0.25 +
      features.brightness * 0.25 +
      beatPulse.current * 0.15;

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
      <points ref={pointsRef} geometry={geom}>
        <primitive object={streakMat} attach="material" />
      </points>
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.98, 1.0, 64]} />
        <meshStandardMaterial
          color="#06b6d4"
          emissive="#0891b2"
          emissiveIntensity={3}
          transparent
          opacity={0.25}
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
export function EnergyWaves({ audioData, vizParams, sceneFrozen }: VizProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const drainRef = useRef<THREE.Mesh>(null);
  const funnelRef = useRef<THREE.Mesh>(null);
  const jetRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const count = 3500;
  const rotRef = useRef(0);
  const suckRef = useRef(0);

  const { g: geom, vel: baseVel } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const heightT = Math.random();
      const y = 3 - heightT * 6;
      const maxRadius = 0.5 + heightT * 3.5;
      const radius = Math.random() * maxRadius;
      const angle = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
      vel[i] = 0.5 + heightT * 1.5 + Math.random() * 0.2;
      const heat = heightT;
      if (heat > 0.7) {
        const c = new THREE.Color().setHSL(
          0.05 + Math.random() * 0.05,
          1.0,
          0.6 + Math.random() * 0.3,
        );
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      } else if (heat > 0.3) {
        const c = new THREE.Color().setHSL(
          0.1 + Math.random() * 0.05,
          0.9,
          0.5 + Math.random() * 0.2,
        );
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      } else {
        const c = new THREE.Color().setHSL(
          0.6 + Math.random() * 0.15,
          0.8,
          0.4 + Math.random() * 0.2,
        );
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(pos), 3),
    );
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    applyStreakVelocity(
      g,
      (_i, x, _y, z) => {
        const r = Math.hypot(x, z) || 0.001;
        const s = 1.2 / (0.3 + r);
        return [(-z / r) * s, -0.35 - Math.random() * 0.3, (x / r) * s];
      },
      count,
    );
    return { g, pos, vel };
  }, []);

  const streakMat = useMemo(
    () => makeStreakMaterial({ size: 24, stretch: 2.8, opacity: 0.85 }),
    [],
  );

  useFrame((s) => {
    if (!pointsRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, peak, beat, energy } = audioData.current;

    if (beat) suckRef.current = Math.min(suckRef.current + 0.8, 4);
    suckRef.current *= 0.95;
    const suck = 1 + bass * 4 + suckRef.current;

    if (!sceneFrozen)
      rotRef.current += 0.005 * vizParams.rotationSpeed * (1 + energy * 2);

    const arr = geom.attributes.position.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const x = arr[idx],
        y = arr[idx + 1],
        z = arr[idx + 2];
      const radius = Math.sqrt(x * x + z * z) + 0.01;
      const angle = Math.atan2(z, x);
      const heightT = Math.max(0, Math.min(1, (3 - y) / 6));
      const angularSpeed =
        baseVel[i] * suck * (1 + heightT * 4) * (1 + mid * 2);
      const newAngle = angle + angularSpeed * 0.025;
      const pullInward = suck * 0.02 * (0.3 + heightT * 2);
      const pullDown = suck * 0.015 * (0.2 + heightT * 3);
      const newRadius = radius - pullInward;
      const newY = y - pullDown;
      if (newRadius < 0.15 || newY < -3.2) {
        const spawnT = Math.random() * 0.3;
        const spawnY = 3 - spawnT * 3;
        const spawnR = Math.random() * (0.5 + spawnT * 3);
        const spawnA = Math.random() * Math.PI * 2;
        arr[idx] = Math.cos(spawnA) * spawnR;
        arr[idx + 1] = spawnY;
        arr[idx + 2] = Math.sin(spawnA) * spawnR;
      } else {
        arr[idx] = Math.cos(newAngle) * newRadius;
        arr[idx + 1] = newY + Math.sin(t * 3 + i * 0.01) * 0.01 * mid;
        arr[idx + 2] = Math.sin(newAngle) * newRadius;
      }
    }
    geom.attributes.position.needsUpdate = true;

    const su = streakMat.uniforms;
    su.uBass.value = bass;
    su.uTreble.value = peak * 0.6 + mid * 0.4;
    su.uOpacity.value = 0.55 + mid * 0.25;

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
      <points ref={pointsRef} geometry={geom}>
        <primitive object={streakMat} attach="material" />
      </points>
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
