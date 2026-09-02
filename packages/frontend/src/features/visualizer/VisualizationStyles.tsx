import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AudioData, VizParams, AudioAnalysisData } from "./types";
import type { LyricLine } from "./components/LyricOverlay";
import { getTrackFeatures } from "./trackFeatures";
import { makeTerrainMaterial, updateTerrainMaterial, makeStreakMaterial, applyStreakVelocity } from "./VisualizationFX";

interface VizProps {
  audioData: React.MutableRefObject<AudioData>;
  vizParams: VizParams;
  analysisData?: AudioAnalysisData | null;
  audioElapsedRef?: React.MutableRefObject<number>;
  sceneFrozen?: boolean;
  /** LRC lyric data for phrase-synchronized visuals */
  lyrics?: LyricLine[];
  /** Current LRC sync state */
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
  } | null;
}

// =============================================================================
// LRC-driven visual helpers
// =============================================================================

/** Get color based on current LRC section */
function getSectionColor(section: string, meshColor: string): THREE.Color {
  const sectionColors: Record<string, string> = {
    INTRO: "#818cf8",
    VERSE: "#60a5fa",
    "PRE-CHORUS": "#c084fc",
    CHORUS: "#f472b6",
    BRIDGE: "#f59e0b",
    BREAKDOWN: "#34d399",
    "BUILD-UP": "#fb923c",
    DROP: "#ef4444",
    "FINAL CHORUS": "#e879f9",
    "FINAL DROP": "#f43f5e",
    OUTRO: "#94a3b8",
  };
  return new THREE.Color(sectionColors[section] || meshColor);
}

/** Get intensity multiplier based on section */
function getSectionIntensity(section: string): number {
  const intensityMap: Record<string, number> = {
    INTRO: 0.4,
    VERSE: 0.6,
    "PRE-CHORUS": 0.7,
    CHORUS: 1.0,
    BRIDGE: 0.7,
    BREAKDOWN: 0.5,
    "BUILD-UP": 0.8,
    DROP: 1.3,
    "FINAL CHORUS": 1.1,
    "FINAL DROP": 1.4,
    OUTRO: 0.4,
  };
  return intensityMap[section] ?? 0.6;
}

/** Smooth interpolation helper */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

// =============================================================================
// Procedural texture generators (lazy, browser-only)
// =============================================================================

let _particleTex: THREE.Texture | null = null;
let _noiseTex: THREE.Texture | null = null;

function getParticleTex(): THREE.Texture {
  if (_particleTex) return _particleTex;
  console.log("[VizStyles] Creating particle texture");
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = s; cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _particleTex = new THREE.CanvasTexture(cv);
  return _particleTex;
}

function getNoiseTex(): THREE.Texture {
  if (_noiseTex) return _noiseTex;
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = s; cv.height = s;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _noiseTex = new THREE.CanvasTexture(cv);
  _noiseTex.wrapS = _noiseTex.wrapT = THREE.RepeatWrapping;
  return _noiseTex;
}

// =============================================================================
// GEOMETRIC — Deep vortex with 7 distinct depth layers
// =============================================================================
export function GeometricViz({ audioData, vizParams, sceneFrozen }: VizProps) {
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
      pos[i*3] = r * Math.sin(ph) * Math.cos(t);
      pos[i*3+1] = r * Math.sin(ph) * Math.sin(t);
      pos[i*3+2] = r * Math.cos(ph);
      const c = new THREE.Color().setHSL(0.6 + Math.random() * 0.2, 0.9, 0.5 + Math.random() * 0.2);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
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
      pos[i*3] = Math.cos(angle) * radius;
      pos[i*3+1] = height;
      pos[i*3+2] = Math.sin(angle) * radius;
      const c = new THREE.Color().setHSL(0.5 + Math.random() * 0.3, 1.0, 0.6 + Math.random() * 0.3);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return { g, pos, n };
  }, []);

  useFrame((s) => {
    frameCount.current++;
    if (frameCount.current === 1) console.log("[GeometricViz] useFrame running, frame:", frameCount.current);
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, peak, beat } = audioData.current;

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
    hueRef.current += (features.energy * 0.002 + 0.0005);
    if (hueRef.current > 1.0) hueRef.current -= 1.0;

    if (!sceneFrozen) rotRef.current += 0.003 * vizParams.rotationSpeed * (1 + bass * 2 + features.energy * 1.5);

    // Layer 0: Core (radius ~0.6)
    if (coreRef.current) {
      const s = vizParams.scale * 0.6 * (1 + bass * vizParams.scaleBoost * 0.4) * pulseScale;
      coreRef.current.scale.setScalar(s);
      coreRef.current.rotation.y = rotRef.current;
      coreRef.current.rotation.x = Math.sin(t * 0.3) * 0.2;
      const m = coreRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.6 + bass * vizParams.glowIntensity * 3 + beatPulse.current * 2 + features.onset * 3;
      // Color shifts with spectral brightness from analysis
      m.color.setHSL(hueRef.current + features.brightness * 0.2, 0.9, 0.55 + bass * 0.15);
      m.emissive.setHSL(hueRef.current + 0.1 + features.brightness * 0.15, 1.0, 0.5 + bass * 0.3);
    }
    // Layer 1: Glow (radius ~1.2)
    if (glowRef.current) {
      const s = vizParams.scale * 1.2 * (1 + bass * 0.5 + beatPulse.current * 0.3);
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
      orbitRef.current.rotation.y = rotRef.current * 1.5 * (1 + features.energy * 2);
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
        base[i*3] = pp[i*3] * d;
        base[i*3+1] = pp[i*3+1] * d;
        base[i*3+2] = pp[i*3+2] * d;
      }
      geom.g.attributes.position.needsUpdate = true;
      pointsRef.current.rotation.y = rotRef.current * 0.2;
      pointsRef.current.rotation.x = Math.sin(t * 0.1) * 0.05;
      (pointsRef.current.material as THREE.PointsMaterial).size = 0.06 + treble * 0.06;
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
      <mesh ref={coreRef}><icosahedronGeometry args={[1, 4]} /><meshStandardMaterial color="#6366f1" emissive="#4338ca" emissiveIntensity={0.7} roughness={0.05} metalness={0.98} flatShading /></mesh>
      {/* Layer 1: Glow shell */}
      <mesh ref={glowRef}><icosahedronGeometry args={[1.0, 2]} /><meshStandardMaterial color="#818cf8" emissive="#6366f1" emissiveIntensity={0.5} transparent opacity={0.1} roughness={1} metalness={0} /></mesh>
      {/* Layer 2: Wireframe shell */}
      <mesh ref={wireRef}><icosahedronGeometry args={[1, 2]} /><meshStandardMaterial color="#06b6d4" emissive="#0891b2" emissiveIntensity={0.5} wireframe transparent opacity={0.3} /></mesh>
      {/* Layer 3: Shockwave ring */}
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[0.98, 1.0, 64]} /><meshStandardMaterial color="#f97316" emissive="#f59e0b" emissiveIntensity={2} transparent opacity={0.25} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      {/* Layer 4: Orbital spiral */}
      <points ref={orbitRef} geometry={orbitGeom.g}><pointsMaterial map={getParticleTex()} size={0.05} vertexColors transparent opacity={0.6} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} /></points>
      {/* Layer 5: Outer particle sphere */}
      <points ref={pointsRef} geometry={geom.g}><pointsMaterial map={getParticleTex()} size={0.08} vertexColors transparent opacity={0.8} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} /></points>
      {/* Layer 6: Outer ring */}
      <mesh ref={ringRef}><torusGeometry args={[10, 0.02, 16, 128]} /><meshStandardMaterial color="#a855f7" emissive="#7c3aed" emissiveIntensity={1} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  );
}

// =============================================================================
// WAVEFORM — 3D terrain from frequency bins
// =============================================================================
export function AudioReactiveCore({ audioData, vizParams, sceneFrozen }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // 2026: GPU simplex-noise terrain with finite-difference normals + fresnel rim
  const mat = useMemo(() => makeTerrainMaterial({ colorA: "#0e1a3f", colorB: "#67e8f9", rim: "#f0abfc", displace: 1.3, freq1: 0.6, freq2: 2.2, speed: 0.7, ripple: 0.3 }), []);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.6);
    meshRef.current.rotation.x = -Math.PI / 2.5;
    if (!sceneFrozen) meshRef.current.rotation.z = t * 0.02 * vizParams.rotationSpeed;
    meshRef.current.scale.setScalar(vizParams.scale * (1 + bass * 0.15));
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[6, 6, 128, 128]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// =============================================================================
// PARTICLES — Galaxy spiral with differential rotation
// =============================================================================
export function OrbitalParticles({ audioData, vizParams, sceneFrozen }: VizProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const count = 3000;
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const featuresRef = useRef({ energy: 0.5, onset: 0, brightness: 0.5, noisiness: 0.5, sectionProgress: 0 });

  const { g: geom, radii, angles } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const r = new Float32Array(count);
    const a = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const arm = i % 5;
      const t = Math.random();
      const radius = 0.2 + t * 5;
      const angle = t * Math.PI * 8 + (arm * Math.PI * 2 / 5) + (Math.random() - 0.5) * 0.5;
      pos[i*3] = Math.cos(angle) * radius;
      pos[i*3+1] = (Math.random() - 0.5) * 0.4 * (1 - t);
      pos[i*3+2] = Math.sin(angle) * radius;
      const hue = 0.55 + t * 0.25 + arm * 0.04;
      const c = new THREE.Color().setHSL(hue, 0.9, 0.4 + t * 0.3);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      r[i] = radius;
      a[i] = angle;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // 2026: per-particle velocity drives screen-space motion stretch
    applyStreakVelocity(g, (_i, x, _y, z) => {
      const r = Math.hypot(x, z) || 0.001;
      const s = 1.4 / (0.4 + r); // differential rotation — inner stars move faster
      return [(-z / r) * s, 0, (x / r) * s];
    }, count);
    return { g, pos, radii: r, angles: a };
  }, []);

  const streakMat = useMemo(() => makeStreakMaterial({ size: 30, stretch: 3.2, opacity: 0.8 }), []);

  useFrame((s) => {
    if (!pointsRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;

    // Get track features (computed once per frame, shared across all visualizations)
    const features = getTrackFeatures();
    featuresRef.current = features;

    if (beat || features.onset > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.9;
    if (!sceneFrozen) rotRef.current += 0.004 * vizParams.rotationSpeed * (1 + bass * 2.5 + features.energy * 2);

    const arr = geom.attributes.position.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const rad = radii[i];
      const angle = angles[i] + rotRef.current * (1 + 1.5 / (rad + 0.3));
      // Pulse driven by bass + track energy + onset spikes
      const pulse = 1 + bass * 0.3 + features.energy * 0.5 + beatPulse.current * 0.6 * (1 / (rad + 0.2)) + features.onset * 0.8;
      // Vertical: treble + mid + brightness (spectral centroid)
      const vertical = Math.sin(t * 2 + i * 0.15) * treble * 0.6 + Math.cos(t + i * 0.08) * mid * 0.3 + Math.sin(t * 3 + i * 0.2) * features.brightness * 0.5;
      arr[idx] = Math.cos(angle) * rad * pulse;
      arr[idx+1] = vertical * (1 + features.energy);
      arr[idx+2] = Math.sin(angle) * rad * pulse;
    }
    geom.attributes.position.needsUpdate = true;

    const su = streakMat.uniforms;
    su.uBass.value = bass;
    su.uTreble.value = treble * 0.5 + features.brightness * 0.5;
    su.uOpacity.value = 0.45 + treble * 0.25 + features.brightness * 0.25 + beatPulse.current * 0.15;

    // Shockwave ring on beat or onset
    if (shockRef.current) {
      const sScale = 0.5 + beatPulse.current * 6;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - beatPulse.current) * 0.35;
      sm.emissiveIntensity = (1 - beatPulse.current) * 4;
      // Color shifts with brightness
      sm.color.setHSL(0.55 - features.brightness * 0.2, 0.9, 0.5);
      sm.emissive.setHSL(0.6 - features.brightness * 0.2, 1.0, 0.4);
    }
  });

  return (
    <group>
      <points ref={pointsRef} geometry={geom}><primitive object={streakMat} attach="material" /></points>
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[0.98, 1.0, 64]} /><meshStandardMaterial color="#06b6d4" emissive="#0891b2" emissiveIntensity={3} transparent opacity={0.25} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  );
}

// =============================================================================
// NEURAL — Network nodes with connection lines, dramatic audio reactivity
// =============================================================================
export function FrequencyRings({ audioData, vizParams, sceneFrozen }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const nodeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lineRef = useRef<THREE.LineSegments>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const nodeCount = 48;
  const rotRef = useRef(0);
  const beatPulse = useRef(0);

  const nodePos = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const r = 1.2 + Math.random() * 2;
      arr.push(new THREE.Vector3(r*Math.sin(ph)*Math.cos(th), r*Math.sin(ph)*Math.sin(th), r*Math.cos(ph)));
    }
    return arr;
  }, []);

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;

    // Get track features (computed once per frame, shared across all visualizations)
    const features = getTrackFeatures();

    if (beat || features.onset > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.88;
    if (!sceneFrozen) rotRef.current += 0.004 * vizParams.rotationSpeed * (1 + features.energy * 2);

    nodeRefs.current.forEach((node, i) => {
      if (!node) return;
      const b = nodePos[i];
      // Dramatic position oscillation driven by frequency bands + track energy
      const freq = i % 3 === 0 ? bass : i % 3 === 1 ? mid : treble;
      const oscillation = 0.3 + freq * 1.2 + beatPulse.current * 0.5 + features.energy * 0.4;
      node.position.set(
        b.x + Math.sin(t * 3 + i * 0.7) * oscillation,
        b.y + Math.cos(t * 2.5 + i * 0.5) * oscillation,
        b.z + Math.sin(t * 2 + i * 0.3) * oscillation
      );
      // Scale pulses dramatically on beats + onset
      const baseScale = 0.06 + freq * 0.15;
      const beatScale = beatPulse.current * 0.4 + features.onset * 0.3;
      node.scale.setScalar(baseScale + beatScale);
      const m = node.material as THREE.MeshStandardMaterial;
      // Emissive flashes on beat + onset
      m.emissiveIntensity = 0.3 + freq * vizParams.glowIntensity * 3 + beatPulse.current * 2 + features.onset * 2.5;
      // Color shifts with spectral brightness from analysis
      m.color.setHSL(0.55 + freq * 0.3 + beatPulse.current * 0.1 + features.brightness * 0.2, 0.9, 0.5 + features.brightness * 0.2);
      m.emissive.setHSL(0.6 + freq * 0.2 + features.brightness * 0.15, 1.0, 0.4 + beatPulse.current * 0.4);
    });

    // Connection lines with dynamic opacity
    if (lineRef.current) {
      const pos: number[] = [];
      for (let i = 0; i < nodeCount; i++) {
        for (let j = i+1; j < nodeCount; j++) {
          if (nodePos[i].distanceTo(nodePos[j]) < 2.8) {
            const ni = nodeRefs.current[i], nj = nodeRefs.current[j];
            if (ni && nj) {
              pos.push(ni.position.x, ni.position.y, ni.position.z, nj.position.x, nj.position.y, nj.position.z);
            }
          }
        }
      }
      const geo = lineRef.current.geometry;
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.attributes.position.needsUpdate = true;
      (lineRef.current.material as THREE.LineBasicMaterial).opacity = 0.1 + features.brightness * 0.5 + beatPulse.current * 0.3;
    }

    // Shockwave ring expands from center on beat
    if (shockRef.current) {
      const sScale = 0.3 + beatPulse.current * 4;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - beatPulse.current) * 0.4;
      sm.emissiveIntensity = (1 - beatPulse.current) * 3;
    }

    groupRef.current.rotation.y = rotRef.current;
    groupRef.current.rotation.x = Math.sin(t * 0.2) * 0.1 * mid;
  });

  return (
    <group ref={groupRef}>
      <lineSegments ref={lineRef}><bufferGeometry /><lineBasicMaterial color="#818cf8" transparent opacity={0.25} /></lineSegments>
      {nodePos.map((_, i) => <mesh key={i} ref={(el) => { nodeRefs.current[i] = el; }}><sphereGeometry args={[0.1, 16, 16]} /><meshStandardMaterial color="#06b6d4" emissive="#6366f1" emissiveIntensity={0.6} roughness={0.1} metalness={0.95} /></mesh>)}
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[0.98, 1.0, 64]} /><meshStandardMaterial color="#a855f7" emissive="#7c3aed" emissiveIntensity={2} transparent opacity={0.3} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
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
      // Funnel: wide at top (y=3), narrow at bottom (y=-3)
      const heightT = Math.random(); // 0=top, 1=bottom
      const y = 3 - heightT * 6; // from +3 to -3
      // Radius shrinks as y decreases (funnel shape)
      const maxRadius = 0.5 + heightT * 3.5; // 0.5 at bottom, 4 at top
      const radius = Math.random() * maxRadius;
      const angle = Math.random() * Math.PI * 2;
      pos[i*3] = Math.cos(angle) * radius;
      pos[i*3+1] = y;
      pos[i*3+2] = Math.sin(angle) * radius;
      // Faster rotation closer to drain
      vel[i] = 0.5 + heightT * 1.5 + Math.random() * 0.2;
      // Color: hot near drain, cool at top
      const heat = heightT;
      if (heat > 0.7) {
        // Hot = orange/white near drain
        const c = new THREE.Color().setHSL(0.05 + Math.random() * 0.05, 1.0, 0.6 + Math.random() * 0.3);
        col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      } else if (heat > 0.3) {
        // Mid = amber/yellow
        const c = new THREE.Color().setHSL(0.1 + Math.random() * 0.05, 0.9, 0.5 + Math.random() * 0.2);
        col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      } else {
        // Cool = blue/purple at top
        const c = new THREE.Color().setHSL(0.6 + Math.random() * 0.15, 0.8, 0.4 + Math.random() * 0.2);
        col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // 2026: dust streaks spiral toward the drain
    applyStreakVelocity(g, (_i, x, _y, z) => {
      const r = Math.hypot(x, z) || 0.001;
      const s = 1.2 / (0.3 + r);
      return [(-z / r) * s, -0.35 - Math.random() * 0.3, (x / r) * s];
    }, count);
    return { g, pos, vel };
  }, []);

  const streakMat = useMemo(() => makeStreakMaterial({ size: 24, stretch: 2.8, opacity: 0.85 }), []);

  useFrame((s) => {
    if (!pointsRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, peak, beat, energy } = audioData.current;

    if (beat) suckRef.current = Math.min(suckRef.current + 0.8, 4);
    suckRef.current *= 0.95;
    const suck = 1 + bass * 4 + suckRef.current;

    if (!sceneFrozen) rotRef.current += 0.005 * vizParams.rotationSpeed * (1 + energy * 2);

    const arr = geom.attributes.position.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      let x = arr[idx], y = arr[idx+1], z = arr[idx+2];
      const radius = Math.sqrt(x * x + z * z) + 0.01;
      const angle = Math.atan2(z, x);

      // Height factor: 0=top, 1=bottom (drain)
      const heightT = Math.max(0, Math.min(1, (3 - y) / 6));

      // Angular speed increases dramatically near drain
      const angularSpeed = baseVel[i] * suck * (1 + heightT * 4) * (1 + mid * 2);
      const newAngle = angle + angularSpeed * 0.025;

      // Pull toward center + downward
      const pullInward = suck * 0.02 * (0.3 + heightT * 2);
      const pullDown = suck * 0.015 * (0.2 + heightT * 3);

      const newRadius = radius - pullInward;
      const newY = y - pullDown;

      // Respawn at top when reaching drain
      if (newRadius < 0.15 || newY < -3.2) {
        const spawnT = Math.random() * 0.3; // top 30% of funnel
        const spawnY = 3 - spawnT * 3;
        const spawnR = Math.random() * (0.5 + spawnT * 3);
        const spawnA = Math.random() * Math.PI * 2;
        arr[idx] = Math.cos(spawnA) * spawnR;
        arr[idx+1] = spawnY;
        arr[idx+2] = Math.sin(spawnA) * spawnR;
      } else {
        arr[idx] = Math.cos(newAngle) * newRadius;
        arr[idx+1] = newY + Math.sin(t * 3 + i * 0.01) * 0.01 * mid;
        arr[idx+2] = Math.sin(newAngle) * newRadius;
      }
    }
    geom.attributes.position.needsUpdate = true;

    const su = streakMat.uniforms;
    su.uBass.value = bass;
    su.uTreble.value = peak * 0.6 + mid * 0.4;
    su.uOpacity.value = 0.55 + mid * 0.25;

    // Drain glow at bottom
    if (drainRef.current) {
      const ds = 0.3 + bass * 0.4 + suckRef.current * 0.3;
      drainRef.current.scale.setScalar(ds);
      const dm = drainRef.current.material as THREE.MeshStandardMaterial;
      dm.emissiveIntensity = 2 + bass * 4 + peak * 3;
    }

    // Funnel mesh rotation
    if (funnelRef.current) {
      funnelRef.current.rotation.y = rotRef.current * 0.2;
      const fm = funnelRef.current.material as THREE.MeshStandardMaterial;
      fm.opacity = 0.15 + bass * 0.15;
      fm.emissiveIntensity = 0.3 + bass;
    }

    // Downward jet from drain
    if (jetRef.current) {
      const jLen = 2 + bass * 5 + suckRef.current * 3;
      jetRef.current.scale.set(0.8 + bass, jLen, 0.8 + bass);
      jetRef.current.position.y = -2 - jLen * 0.3;
      const jm = jetRef.current.material as THREE.MeshStandardMaterial;
      jm.opacity = 0.2 + bass * 0.4;
      jm.emissiveIntensity = 1 + bass * 3;
    }

    // Glow sphere at drain
    if (glowRef.current) {
      const gs = 0.5 + bass * 0.6 + peak * 0.4;
      glowRef.current.scale.setScalar(gs);
      const gm = glowRef.current.material as THREE.MeshStandardMaterial;
      gm.emissiveIntensity = 1 + bass * 3 + peak * 2;
    }
  });

  return (
    <group>
      {/* Cosmic dust particles */}
      <points ref={pointsRef} geometry={geom}>
        <primitive object={streakMat} attach="material" />
      </points>

      {/* Funnel wireframe shell */}
      <mesh ref={funnelRef}>
        <coneGeometry args={[4, 6, 32, 1, true]} />
        <meshStandardMaterial color="#6366f1" emissive="#4338ca" emissiveIntensity={0.5} transparent opacity={0.15} wireframe side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Drain glow */}
      <mesh ref={glowRef} position={[0, -3, 0]}>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={2} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Black hole drain */}
      <mesh ref={drainRef} position={[0, -3, 0]}>
        <sphereGeometry args={[0.3, 24, 24]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      {/* Downward energy jet */}
      <mesh ref={jetRef} position={[0, -4, 0]}>
        <coneGeometry args={[0.4, 5, 16, 1, true]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={2} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// =============================================================================
// PULSE — Concentric rings emitting from center on beats
// =============================================================================
export function PulseRings({ audioData, vizParams, sceneFrozen }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringCount = 12;

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, beat, peak: beatPeak } = audioData.current;

    ringRefs.current.forEach((ring, i) => {
      if (!ring) return;
      const speed = 0.3 + i * 0.05;
      const offset = i * 0.08;
      const phase = (t * speed + offset) % 1;
      ring.scale.setScalar(Math.max(0.1, phase * 8));
      const m = ring.material as THREE.MeshStandardMaterial;
      m.opacity = (1 - phase) * (0.5 + bass * 0.4);
      m.emissiveIntensity = (1 - phase) * vizParams.glowIntensity * 2;
      m.color.setHSL(0.5 + bass * 0.3, 0.8, 0.6);
      if (beat && i === 0) { m.opacity = 0.9; m.emissiveIntensity = 2 + beatPeak * 3; }
    });
    if (!sceneFrozen) groupRef.current.rotation.y = t * 0.02 * vizParams.rotationSpeed;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: ringCount }).map((_, i) => (
        <mesh key={i} ref={(el) => { ringRefs.current[i] = el; }} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.98, 1.0, 128]} />
          <meshStandardMaterial color={`hsl(${200+i*12},85%,60%)`} emissive={`hsl(${200+i*12},95%,50%)`} emissiveIntensity={0.5} transparent opacity={0.5} side={THREE.DoubleSide} roughness={0.2} metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================================
// SPECTRUM — Circular frequency bars with HSL mapping
// =============================================================================
export function SpectrumBars({ audioData, vizParams, sceneFrozen }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const barCount = 48;
  const rotRef = useRef(0);

  useFrame((_s) => {
    if (!groupRef.current) return;
    const { bass, mid, treble, peak } = audioData.current;
    if (!sceneFrozen) rotRef.current += 0.004 * vizParams.rotationSpeed * (1 + peak);

    barRefs.current.forEach((bar, i) => {
      if (!bar) return;
      const freq = i < barCount * 0.25 ? bass : i < barCount * 0.6 ? mid : treble;
      const h = 0.1 + freq * 4.5;
      bar.scale.set(1, Math.max(0.01, h), 1);
      bar.position.y = h / 2 - 1.5;
      const m = bar.material as THREE.MeshStandardMaterial;
      const hue = 0.55 + (i / barCount) * 0.4;
      m.color.setHSL(hue, 0.8, 0.5);
      m.emissive.setHSL(hue, 0.9, 0.2 + freq * 0.6);
      m.emissiveIntensity = 0.2 + freq * vizParams.glowIntensity * 1.5;
      m.roughness = 0.3;
      m.metalness = 0.7;
    });
    groupRef.current.rotation.y = rotRef.current;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: barCount }).map((_, i) => {
        const a = (i / barCount) * Math.PI * 2;
        return <mesh key={i} ref={(el) => { barRefs.current[i] = el; }} position={[Math.cos(a)*2, -1.5, Math.sin(a)*2]} rotation={[0, -a, 0]}><capsuleGeometry args={[0.045, 1, 4, 12]} /><meshPhysicalMaterial color={`hsl(${220+i*3},80%,55%)`} emissive={`hsl(${220+i*3},90%,45%)`} emissiveIntensity={0.3} roughness={0.18} metalness={0.85} clearcoat={1} clearcoatRoughness={0.15} /></mesh>;
      })}
    </group>
  );
}

// =============================================================================
// VINYL — Rotating disc with grooves
// =============================================================================
export function VinylDisc({ audioData, vizParams, sceneFrozen }: VizProps) {
  const discRef = useRef<THREE.Mesh>(null);
  const groovesRef = useRef<THREE.Group>(null);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const { bass, treble, peak } = audioData.current;

    if (discRef.current) {
      if (!sceneFrozen) discRef.current.rotation.y = t * 0.5 * vizParams.rotationSpeed * (1 + bass);
      discRef.current.scale.setScalar(vizParams.scale * (1 + bass * 0.08));
      const m = discRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.1 + treble * vizParams.glowIntensity * 0.8;
      m.roughness = 0.2 - peak * 0.1;
      m.metalness = 0.85;
    }
    if (groovesRef.current && !sceneFrozen) groovesRef.current.rotation.y = t * 0.5 * vizParams.rotationSpeed * (1 + bass);
  });

  return (
    <group>
      <mesh ref={discRef}><cylinderGeometry args={[2.5, 2.5, 0.05, 96]} /><meshPhysicalMaterial color="#0b0b12" emissive="#1a1a2e" emissiveIntensity={0.1} roughness={0.12} metalness={0.85} clearcoat={1} clearcoatRoughness={0.06} map={getNoiseTex()} /></mesh>
      <group ref={groovesRef}>
        {Array.from({ length: 20 }).map((_, i) => (
          <mesh key={i} rotation={[Math.PI/2,0,0]} position={[0,0.03,0]}><torusGeometry args={[0.5+i*0.12, 0.003, 4, 128]} /><meshStandardMaterial color="#333" emissive="#222" emissiveIntensity={0.1} transparent opacity={0.2} /></mesh>
        ))}
      </group>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0.035,0]}><cylinderGeometry args={[0.6, 0.6, 0.02, 32]} /><meshStandardMaterial color="#6366f1" emissive="#4338ca" emissiveIntensity={0.3} roughness={0.3} metalness={0.6} /></mesh>
      <mesh rotation={[Math.PI/2,0,0]} position={[0,0.04,0]}><ringGeometry args={[0.55, 0.6, 32]} /><meshStandardMaterial color="#818cf8" emissive="#6366f1" emissiveIntensity={0.5} transparent opacity={0.6} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

// =============================================================================
// AURORA — Flowing ribbon/curtain (dreamy)
// =============================================================================
export function AuroraRibbon({ audioData, vizParams, sceneFrozen }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // 2026: aurora as a shader curtain — soft volumetric falloff, no hard plane edges
  const mat = useMemo(() => makeTerrainMaterial({ colorA: "#052e1f", colorB: "#34d399", rim: "#c084fc", opacity: 0.72, displace: 0.9, freq1: 0.4, freq2: 2.6, speed: 0.5, ripple: 0.2 }), []);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.8);
    meshRef.current.rotation.x = -Math.PI / 3;
    if (!sceneFrozen) meshRef.current.rotation.z = t * 0.01 * vizParams.rotationSpeed;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[8, 5, 96, 64]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// =============================================================================
// OCEAN — Wave simulation with peaks and valleys
// =============================================================================
export function OceanWaves({ audioData, vizParams, sceneFrozen }: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // 2026: GPU ocean — layered noise swells, luminous crests, fresnel sheen
  const mat = useMemo(() => makeTerrainMaterial({ colorA: "#031c33", colorB: "#2dd4bf", rim: "#a5f3fc", displace: 1.5, freq1: 0.35, freq2: 1.4, speed: 0.45, ripple: 0.45 }), []);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    updateTerrainMaterial(mat, t, { bass, mid, treble, energy }, vizParams.glowIntensity * 0.5);
    meshRef.current.rotation.x = -Math.PI / 2.2;
    if (!sceneFrozen) meshRef.current.rotation.z = t * 0.005 * vizParams.rotationSpeed;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[8, 8, 128, 128]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// =============================================================================
// FRACTAL — Self-similar recursive patterns that evolve with music
// =============================================================================
export function FractalViz({ audioData, vizParams, sceneFrozen }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const ringCount = 7;

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;
    const features = getTrackFeatures();

    if (beat || features.onset > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.9;
    if (!sceneFrozen) rotRef.current += 0.005 * vizParams.rotationSpeed * (1 + bass * 2);

    ringRefs.current.forEach((ring, i) => {
      if (!ring) return;
      const freq = i % 3 === 0 ? bass : i % 3 === 1 ? mid : treble;
      const scale = 0.5 + i * 0.7 + freq * 0.5 + beatPulse.current * 0.3;
      ring.scale.setScalar(scale);
      ring.rotation.x = rotRef.current * (i + 1) * 0.3 + Math.sin(t + i) * 0.2;
      ring.rotation.y = rotRef.current * (i + 1) * 0.2 + Math.cos(t * 0.7 + i) * mid * 0.5;
      ring.rotation.z = Math.sin(t * 0.5 + i * 0.5) * treble * 0.8;
      const m = ring.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.3 + freq * vizParams.glowIntensity * 2 + beatPulse.current * 1.5;
      m.color.setHSL(0.7 + i * 0.05 + features.brightness * 0.2, 0.8, 0.5);
      m.emissive.setHSL(0.75 + i * 0.04, 0.9, 0.4 + beatPulse.current * 0.3);
      m.opacity = 0.4 + freq * 0.3;
    });
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: ringCount }).map((_, i) => (
        <mesh key={i} ref={(el) => { ringRefs.current[i] = el; }}>
          <torusGeometry args={[1, 0.03 + i * 0.01, 16, 64]} />
          <meshStandardMaterial color="#a855f7" emissive="#7c3aed" emissiveIntensity={0.5} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// =============================================================================
// STORM — Lightning bolts and energy discharges
// =============================================================================
export function StormViz({ audioData, vizParams, sceneFrozen }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const boltRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  const rotRef = useRef(0);
  const boltFlash = useRef(0);

  useFrame(() => {
    if (!groupRef.current) return;
    const { bass, treble, beat } = audioData.current;
    const features = getTrackFeatures();

    if (beat || features.onset > 0.6) boltFlash.current = 1.0;
    boltFlash.current *= 0.85;
    if (!sceneFrozen) rotRef.current += 0.006 * vizParams.rotationSpeed * (1 + treble * 3);

    boltRefs.current.forEach((bolt, i) => {
      if (!bolt) return;
      const freq = i % 2 === 0 ? bass : treble;
      const angle = (i / 6) * Math.PI * 2 + rotRef.current;
      const length = 2 + freq * 3 + boltFlash.current * 2;
      bolt.position.set(Math.cos(angle) * 0.5, length / 2 - 1, Math.sin(angle) * 0.5);
      bolt.rotation.set(0, 0, angle + Math.PI / 2);
      bolt.scale.set(1 + boltFlash.current * 0.5, length, 1 + boltFlash.current * 0.5);
      const m = bolt.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.5 + boltFlash.current * 4 + freq * 2;
      m.opacity = 0.3 + boltFlash.current * 0.7;
      m.color.setHSL(0.6 + boltFlash.current * 0.1, 0.9, 0.5 + boltFlash.current * 0.3);
    });

    if (glowRef.current) {
      const glowScale = 0.3 + bass * 0.5 + boltFlash.current * 0.8;
      glowRef.current.scale.setScalar(glowScale);
      const gm = glowRef.current.material as THREE.MeshStandardMaterial;
      gm.emissiveIntensity = 1 + bass * 3 + boltFlash.current * 5;
      gm.opacity = 0.3 + boltFlash.current * 0.4;
    }

    groupRef.current.rotation.y = rotRef.current * 0.5;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={i} ref={(el) => { boltRefs.current[i] = el; }}>
          <boxGeometry args={[0.05, 1, 0.05]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={1} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#818cf8" emissive="#6366f1" emissiveIntensity={2} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

// =============================================================================
// INFERNO — Rising fire and ember particles
// =============================================================================
export function InfernoViz({ audioData }: VizProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const count = 2000;

  const { g: geom } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 2;
      pos[i*3] = Math.cos(angle) * radius;
      pos[i*3+1] = (Math.random() - 0.5) * 0.5;
      pos[i*3+2] = Math.sin(angle) * radius;
      const heat = Math.random();
      const c = new THREE.Color().setHSL(0.02 + heat * 0.08, 1.0, 0.4 + heat * 0.3);
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // 2026: embers stretch upward with the heat current
    applyStreakVelocity(g, (_i, x, _y, z) => {
      const r = Math.hypot(x, z) || 0.001;
      return [(-z / r) * 0.5, 1.1 + Math.random() * 0.9, (x / r) * 0.5];
    }, count);
    return { g, pos };
  }, []);

  const streakMat = useMemo(() => makeStreakMaterial({ size: 26, stretch: 2.2, opacity: 0.8 }), []);

  useFrame(() => {
    if (!pointsRef.current) return;
    const { bass, treble, beat } = audioData.current;
    const features = getTrackFeatures();

    const arr = geom.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      let y = arr[idx+1] + 0.02 + features.energy * 0.05 + bass * 0.03;
      if (y > 3) y = -3;
      arr[idx+1] = y;
      const angle = Math.atan2(arr[idx+2], arr[idx]) + 0.02 * (1 + treble);
      const radius = Math.sqrt(arr[idx] * arr[idx] + arr[idx+2] * arr[idx+2]);
      arr[idx] = Math.cos(angle) * radius;
      arr[idx+2] = Math.sin(angle) * radius;
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
        <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={2} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
