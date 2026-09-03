import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import { getParticleTex } from "./textures";
import {
  makeTerrainMaterial,
  updateTerrainMaterial,
} from "../VisualizationFX";

export function GeometricViz({ audioData, vizParams, sceneFrozen, prefersReducedMotion }: VizProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const orbitRef = useRef<THREE.Points>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const rotRef = useRef(0);
  const frameCount = useRef(0);
  const beatPulse = useRef(0);
  const shockScale = useRef(0);
  const hueRef = useRef(0.6);

  // Layer 5: Outer particle sphere (radius 5-9)
  const geom = useMemo(() => {
    const n = 1500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 5 + Math.random() * 4;
      const t = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(t);
      pos[i * 3 + 2] = r * Math.cos(ph);
      const c = new THREE.Color().setHSL(
        0.6 + Math.random() * 0.2,
        0.9,
        0.5 + Math.random() * 0.2,
      );
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return { g, pos, n };
  }, []);

  // Layer 4: Orbital particles (radius 3.5-5)
  const orbitGeom = useMemo(() => {
    const n = 600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 12;
      const radius = 3.5 + Math.random() * 1.5;
      const height = (Math.random() - 0.5) * 2.0;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = height;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
      const c = new THREE.Color().setHSL(
        0.5 + Math.random() * 0.3,
        1.0,
        0.6 + Math.random() * 0.3,
      );
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return { g, pos, n };
  }, []);

  useFrame((s) => {
    frameCount.current++;
    if (frameCount.current === 1)
      console.log(
        "[GeometricViz] useFrame running, frame:",
        frameCount.current,
      );
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, peak, beat } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    // Get track features (computed once per frame, shared across all visualizations)
    const features = getTrackFeatures();

    if (beat || features.onset > 0.5) {
      beatPulse.current = 1.0;
      shockScale.current = 1.0;
    }
    beatPulse.current *= 0.9;
    shockScale.current *= 0.92;
    const pulseScale = 1 + beatPulse.current * 0.5;

    // Hue cycles with energy + shifts with spectral brightness
    hueRef.current += features.energy * 0.002 + 0.0005;
    if (hueRef.current > 1.0) hueRef.current -= 1.0;

    if (!sceneFrozen)
      rotRef.current +=
        0.003 *
        vizParams.rotationSpeed *
        speedMul *
        (1 + bass * 2 + features.energy * 1.5);

    // Layer 0: Core (radius ~0.6)
    if (coreRef.current) {
      const s =
        vizParams.scale *
        0.6 *
        (1 + bass * vizParams.scaleBoost * 0.4) *
        pulseScale;
      coreRef.current.scale.setScalar(s);
      coreRef.current.rotation.y = rotRef.current;
      coreRef.current.rotation.x = Math.sin(t * 0.3) * 0.2;
      const m = coreRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity =
        0.6 +
        bass * vizParams.glowIntensity * 3 +
        beatPulse.current * 2 +
        features.onset * 3;
      // Color shifts with spectral brightness from analysis
      m.color.setHSL(
        hueRef.current + features.brightness * 0.2,
        0.9,
        0.55 + bass * 0.15,
      );
      m.emissive.setHSL(
        hueRef.current + 0.1 + features.brightness * 0.15,
        1.0,
        0.5 + bass * 0.3,
      );
    }
    // Layer 1: Glow (radius ~1.2)
    if (glowRef.current) {
      const s =
        vizParams.scale * 1.2 * (1 + bass * 0.5 + beatPulse.current * 0.3);
      glowRef.current.scale.setScalar(s);
      glowRef.current.rotation.y = rotRef.current * 0.5;
      const m = glowRef.current.material as THREE.MeshStandardMaterial;
      m.opacity = 0.08 + bass * 0.15 + beatPulse.current * 0.1;
      m.emissiveIntensity = 0.5 + bass * vizParams.glowIntensity * 2;
    }
    // Layer 2: Wireframe (radius ~2.5)
    if (wireRef.current) {
      const s = 2.5 + mid * 0.8 + beatPulse.current * 0.4;
      wireRef.current.scale.setScalar(s);
      wireRef.current.rotation.y = -rotRef.current * 0.6;
      wireRef.current.rotation.x = Math.sin(t * 0.25) * mid * 0.4;
      const m = wireRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.4 + mid * vizParams.glowIntensity * 1.5;
      m.opacity = 0.2 + mid * 0.4 + beatPulse.current * 0.15;
      m.color.setHSL(hueRef.current + 0.15, 0.8, 0.6);
    }
    // Layer 3: Shockwave (expands from 2.5 to 12)
    if (shockRef.current) {
      const sScale = 2.5 + shockScale.current * 10;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - shockScale.current) * 0.35;
      sm.emissiveIntensity = (1 - shockScale.current) * 3;
      sm.color.setHSL(hueRef.current, 0.9, 0.6);
    }
    // Layer 4: Orbital spiral (radius 3.5-5)
    if (orbitRef.current) {
      orbitRef.current.rotation.y =
        rotRef.current * 1.5 * (1 + features.energy * 2);
      orbitRef.current.rotation.x = Math.sin(t * 0.15) * 0.4 * mid;
      const om = orbitRef.current.material as THREE.PointsMaterial;
      om.size = 0.04 + treble * 0.05 + beatPulse.current * 0.03;
      om.opacity = 0.5 + features.energy * 0.4;
    }
    // Layer 5: Outer particles (radius 5-9)
    if (pointsRef.current) {
      const pp = geom.pos;
      const d = 1 + treble * 0.6 + (beat ? peak * 0.5 : 0);
      const base = geom.g.attributes.position.array as Float32Array;
      for (let i = 0; i < geom.n; i++) {
        base[i * 3] = pp[i * 3] * d;
        base[i * 3 + 1] = pp[i * 3 + 1] * d;
        base[i * 3 + 2] = pp[i * 3 + 2] * d;
      }
      geom.g.attributes.position.needsUpdate = true;
      pointsRef.current.rotation.y = rotRef.current * 0.2;
      pointsRef.current.rotation.x = Math.sin(t * 0.1 * speedMul) * 0.05;
      (pointsRef.current.material as THREE.PointsMaterial).size =
        0.06 + treble * 0.06;
    }
    // Layer 6: Outer ring (radius 10)
    if (ringRef.current) {
      ringRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.1) * 0.1;
      ringRef.current.rotation.z = -rotRef.current * 0.8;
      const rm = ringRef.current.material as THREE.MeshStandardMaterial;
      rm.emissiveIntensity = 0.6 + mid * 2;
      rm.opacity = 0.15 + mid * 0.25;
      rm.color.setHSL(hueRef.current + 0.3, 0.8, 0.5);
    }
  });

  return (
    <group>
      {/* Layer 0: Core */}
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[1, 4]} />
        <meshStandardMaterial
          color="#6366f1"
          emissive="#4338ca"
          emissiveIntensity={0.7}
          roughness={0.05}
          metalness={0.98}
          flatShading
        />
      </mesh>
      {/* Layer 1: Glow shell */}
      <mesh ref={glowRef}>
        <icosahedronGeometry args={[1.0, 2]} />
        <meshStandardMaterial
          color="#818cf8"
          emissive="#6366f1"
          emissiveIntensity={0.5}
          transparent
          opacity={0.1}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* Layer 2: Wireframe shell */}
      <mesh ref={wireRef}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial
          color="#06b6d4"
          emissive="#0891b2"
          emissiveIntensity={0.5}
          wireframe
          transparent
          opacity={0.3}
        />
      </mesh>
      {/* Layer 3: Shockwave ring */}
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.98, 1.0, 64]} />
        <meshStandardMaterial
          color="#f97316"
          emissive="#f59e0b"
          emissiveIntensity={2}
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Layer 4: Orbital spiral */}
      <points ref={orbitRef} geometry={orbitGeom.g}>
        <pointsMaterial
          map={getParticleTex()}
          size={0.05}
          vertexColors
          transparent
          opacity={0.6}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      {/* Layer 5: Outer particle sphere */}
      <points ref={pointsRef} geometry={geom.g}>
        <pointsMaterial
          map={getParticleTex()}
          size={0.08}
          vertexColors
          transparent
          opacity={0.8}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      {/* Layer 6: Outer ring */}
      <mesh ref={ringRef}>
        <torusGeometry args={[10, 0.02, 16, 128]} />
        <meshStandardMaterial
          color="#a855f7"
          emissive="#7c3aed"
          emissiveIntensity={1}
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// =============================================================================
// WAVEFORM — 3D terrain from frequency bins
// =============================================================================
export function AudioReactiveCore({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
}: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // 2026: GPU simplex-noise terrain with finite-difference normals + fresnel rim
  const mat = useMemo(
    () =>
      makeTerrainMaterial({
        colorA: "#0e1a3f",
        colorB: "#67e8f9",
        rim: "#f0abfc",
        displace: 1.3,
        freq1: 0.6,
        freq2: 2.2,
        speed: 0.7,
        ripple: 0.3,
      }),
    [],
  );

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    updateTerrainMaterial(
      mat,
      t,
      { bass, mid, treble, energy },
      vizParams.glowIntensity * 0.6,
    );
    meshRef.current.rotation.x = -Math.PI / 2.5;
    if (!sceneFrozen)
      meshRef.current.rotation.z = t * 0.02 * vizParams.rotationSpeed * speedMul;
    meshRef.current.scale.setScalar(vizParams.scale * (1 + bass * 0.15));
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[6, 6, 128, 128]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
