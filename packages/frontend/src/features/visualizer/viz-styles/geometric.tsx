import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import { getParticleTex } from "./textures";
import {
  makeTerrainMaterial,
  updateTerrainMaterial,
  makeTerrainMaterialTSL,
  updateTerrainMaterialTSL,
} from "../VisualizationFX";
import { InstancedParticles } from "./instancedParticles";
import { useDisposeOnUnmount } from "./helpers";

export function GeometricViz({ audioData, vizParams, sceneFrozen, prefersReducedMotion, stems, audioElapsedRef }: VizProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const orbitRef = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const shockScale = useRef(0);
  const hueRef = useRef(0.6);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  // TSL audio-reactive core material for WebGPU
  const coreMat = useMemo(() => {
    if (!isWebGPU) return null;
    return makeTerrainMaterialTSL({
      colorA: "#0b1530",
      colorB: "#6366f1",
      rim: "#c4b5fd",
      displace: 0.9,
      freq1: 0.6,
      freq2: 2.0,
      speed: 0.7,
      ripple: 0.2,
    });
  }, [isWebGPU]);
  // GPU programs are not freed when the memo'd material is garbage collected —
  // style switches unmount the whole subtree, so dispose explicitly.
  useDisposeOnUnmount(coreMat);

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

  // Engagement backdrop (vision analysis 2026-09-16: the flat black void was the
  // top dead-space complaint). One BackSide dome with an audio-reactive vertical
  // gradient — cheap (1 draw call), no fog, depthWrite off so it never occludes.
  const backdropMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTint: { value: new THREE.Color("#1b1440") },
          uLift: { value: 0.3 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){
            vDir = normalize(position);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTint;
          uniform float uLift;
          varying vec3 vDir;
          void main(){
            float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = mix(vec3(0.004, 0.004, 0.010), uTint, pow(h, 1.6) * uLift);
            // Faint horizon glow band so the lower frame never goes pure black
            col += uTint * exp(-pow((vDir.y + 0.08) * 6.0, 2.0)) * 0.35 * uLift;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );
  useEffect(() => () => { backdropMat.dispose(); }, [backdropMat]);

  // Dispose the memoised BufferGeometry on unmount (R3F does not auto-dispose
  // useMemo'd geometries; style switches mount/unmount whole scenes).
  useEffect(() => () => { orbitGeom.g.dispose(); }, [orbitGeom]);

  useFrame((s, delta) => {
    // Frame-rate-independent motion: normalize legacy per-frame constants to
    // 60 fps (delta is seconds since last frame).
    const dt60 = Math.min(delta, 0.1) * 60;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat, energy } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    const features = getTrackFeatures();

    // Map stems to visual channels:
    //   drums → scale/pulse, bass → camera shake/rotation, vocals → hue shift,
    //   other  → palette/color modulation.
    if (stems) {
      const el = audioElapsedRef?.current ?? 0;
      const dur = stems.drums.duration || 1;
      const idx = Math.min(stems.drums.energy_curve.length - 1, Math.max(0, Math.floor((el / dur) * stems.drums.energy_curve.length)));
      stemEnergyRef.current = {
        vocals: stems.vocals.energy_curve[idx] ?? 0,
        drums: stems.drums.energy_curve[idx] ?? 0,
        bass: stems.bass.energy_curve[idx] ?? 0,
        other: stems.other.energy_curve[idx] ?? 0,
      };
    }

    if (beat || features.onset > 0.5 || stemEnergyRef.current.drums > 0.6) {
      beatPulse.current = 1.0;
      shockScale.current = 1.0;
    }
    // Frame-rate-normalized decay (0.9 @ 60fps) and drift so 120 Hz / 30 Hz
    // displays pulse and shift hue at the same wall-clock rate.
    beatPulse.current *= Math.pow(0.9, dt60);
    shockScale.current *= Math.pow(0.92, dt60);
    const pulseScale = 1 + beatPulse.current * 0.5;

    hueRef.current += (features.energy * 0.002 + 0.0005) * dt60;
    // Stem-driven hue drift: vocals shift hue, other shifts saturation
    if (stems) {
      hueRef.current += stemEnergyRef.current.vocals * 0.003 * dt60;
    }
    if (hueRef.current > 1.0) hueRef.current -= 1.0;

    // Backdrop follows the same hue field so the void breathes with the music.
    // Reduced-motion freezes the lift (static gradient, no pulsing).
    // Lift is deliberately capped: over-lifting washes the frame gray (seen in
    // the 0:07–0:12 captures) and buries the additive particle colors.
    {
      const u = backdropMat.uniforms;
      const stemBoost = stems ? stemEnergyRef.current.other * 0.1 : 0;
      (u.uTint.value as THREE.Color).setHSL(hueRef.current + 0.55, 0.7, 0.08);
      u.uLift.value = prefersReducedMotion
        ? 0.18
        : Math.min(0.45, 0.22 + features.energy * 0.15 + bass * 0.12 + stemBoost);
    }
    // Chromatic beat kick: every layer's hue thumps with the beat so the hit
    // reads in color, not just scale (vision fix: "monochrome, beat unreadable").
    const beatHue = prefersReducedMotion ? 0 : beatPulse.current * 0.07;

    if (!sceneFrozen)
      rotRef.current +=
        0.003 *
        dt60 *
        vizParams.rotationSpeed *
        speedMul *
        (1 + bass * 2 + features.energy * 1.5 + (stems ? stemEnergyRef.current.bass * 0.5 : 0));

    // Cinematic drift floor: slow whole-scene yaw independent of the preset's
    // rotationSpeed, so low-speed presets (e.g. ambient 0.3) never read as a
    // still image. ~1.7°/s; damped (not zeroed) under reduced-motion like the
    // rest of the motion system.
    if (!sceneFrozen && groupRef.current)
      groupRef.current.rotation.y += 0.03 * (dt60 / 60) * speedMul;

    // Layer 0: Core (radius ~0.6) — TSL audio-reactive on WebGPU, JS-driven on WebGL
    if (coreRef.current) {
      const s =
        vizParams.scale *
        0.6 *
        (1 + bass * vizParams.scaleBoost * 0.4) *
        pulseScale;
      coreRef.current.scale.setScalar(s);
      coreRef.current.rotation.y = rotRef.current;
      coreRef.current.rotation.x = Math.sin(t * 0.3) * 0.2;
      if (isWebGPU && coreMat) {
        updateTerrainMaterialTSL(coreMat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.6);
      } else if (coreRef.current.material) {
        const m = coreRef.current.material as THREE.MeshStandardMaterial;
        // Exposure-capped: the pre-2026-09-16 gains clipped the core to a
        // featureless white disc under bloom (see 0:07–0:12 captures).
        m.emissiveIntensity =
          0.6 +
          bass * vizParams.glowIntensity * 2 +
          beatPulse.current * 1.4 +
          features.onset * 2;
        m.color.setHSL(
          hueRef.current + features.brightness * 0.2,
          0.9,
          0.55 + bass * 0.15,
        );
        m.emissive.setHSL(
          hueRef.current + 0.1 + features.brightness * 0.15 + beatHue,
          1.0,
          0.5 + bass * 0.3 + beatPulse.current * 0.15,
        );
      }
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
      m.color.setHSL(hueRef.current + 0.15 + beatHue, 0.8, 0.6);
    }
    // Layer 3: Shockwave (expands from 2.5 to 12)
    if (shockRef.current) {
      const sScale = 2.5 + shockScale.current * 10;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - shockScale.current) * 0.35;
      sm.emissiveIntensity = (1 - shockScale.current) * 3;
      sm.color.setHSL(hueRef.current + beatHue, 0.9, 0.6 + beatPulse.current * 0.15);
    }
    // Layer 4: Orbital spiral (radius 3.5-5)
    if (orbitRef.current) {
      orbitRef.current.rotation.y =
        rotRef.current * 1.5 * (1 + features.energy * 2);
      orbitRef.current.rotation.x = Math.sin(t * 0.15) * 0.4 * mid;
      const om = orbitRef.current.material as THREE.PointsMaterial;
      om.size = 0.05 + treble * 0.06 + beatPulse.current * 0.04;
      om.opacity = 0.55 + features.energy * 0.4;
    }
    // Layer 5: Outer particles (radius 5-9) — now handled by InstancedParticles
    // Layer 6: Outer ring (radius 10)
    if (ringRef.current) {
      // Tilted ~26° off edge-on: a flat-on torus reads as a stiff line
      // artifact across the frame (see 0:07–0:12 captures); an ellipse reads
      // as design.
      ringRef.current.rotation.x = Math.PI / 2 - 0.45 + Math.sin(t * 0.1) * 0.1;
      ringRef.current.rotation.z = -rotRef.current * 0.8;
      const rm = ringRef.current.material as THREE.MeshStandardMaterial;
      rm.emissiveIntensity = 0.6 + mid * 2;
      rm.opacity = 0.15 + mid * 0.25;
      rm.color.setHSL(hueRef.current + 0.3 + beatHue, 0.8, 0.5);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Engagement backdrop dome — audio-reactive gradient void-filler */}
      <mesh material={backdropMat} renderOrder={-10}>
        <sphereGeometry args={[40, 32, 24]} />
      </mesh>
      {/* Layer 0: Core */}
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[1, 4]} />
        {isWebGPU && coreMat ? (
          <primitive object={coreMat} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#6366f1"
            emissive="#4338ca"
            emissiveIntensity={0.7}
            roughness={0.05}
            metalness={0.98}
            flatShading
          />
        )}
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
          fog={false}
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
          fog={false}
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
          fog={false}
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
          fog={false}
        />
      </points>
      {/* Layer 5: Outer particle sphere — instanced quads */}
      <InstancedParticles
        audioData={audioData}
        vizParams={vizParams}
        sceneFrozen={sceneFrozen}
        prefersReducedMotion={prefersReducedMotion}
        count={1500}
        baseSize={0.08}
        spread={4}
        hueBase={0.6}
        hueRange={0.2}
        stretch={1.5}
      />
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
          fog={false}
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
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const mat = useMemo(
    () =>
      isWebGPU
        ? makeTerrainMaterialTSL({
            colorA: "#0e1a3f",
            colorB: "#67e8f9",
            rim: "#f0abfc",
            displace: 1.3,
            freq1: 0.6,
            freq2: 2.2,
            speed: 0.7,
            ripple: 0.3,
          })
        : makeTerrainMaterial({
            colorA: "#0e1a3f",
            colorB: "#67e8f9",
            rim: "#f0abfc",
            displace: 1.3,
            freq1: 0.6,
            freq2: 2.2,
            speed: 0.7,
            ripple: 0.3,
          }),
    [isWebGPU],
  );
  useDisposeOnUnmount(mat);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    if (isWebGPU) {
      updateTerrainMaterialTSL(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.6);
    } else {
      updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.6);
    }
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
