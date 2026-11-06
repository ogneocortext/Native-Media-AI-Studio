import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { useDisposeOnUnmount } from "./helpers";

// =============================================================================
// SPECTRAL TERRAIN FLYOVER (T-VIZ-23)
//
// An endless ridged terrain scrolling toward the camera. The ridgeline across
// the width is shaped by the spectrum (24 resampled perceptual bands, falling
// back to a bass/mid/treble split when band data is absent). Enveloped bass
// drives scroll speed and heave; treble adds crest sparkle. All detail noise
// is hash-based value noise in world space — continuous, never tiled, so 60 s
// of flight shows no repetition.
//
// Scroll phase is integrated from the AUDIO clock (audioElapsedRef deltas),
// not the wall clock: pause freezes the terrain, seeks don't teleport it, and
// virtual/export frames stay deterministic. uTime reuses the phase so every
// shader motion is audio-driven.
// =============================================================================

const BAND_COUNT = 24;
const TERRAIN_W = 64;
const TERRAIN_D = 260;

const VERT = /* glsl */ `
  uniform float uPhase;
  uniform float uHeave;
  uniform float uBands[${BAND_COUNT}];
  uniform float uWidth;
  varying float vHeight;
  varying float vBand;
  varying float vDist;
  varying vec3 vWorld;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main(){
    vec3 p = position;
    float x = p.x;
    float z = p.z - uPhase;

    // Ridgeline: band index across the width (left = low freq, right = high).
    float u = clamp(x / uWidth + 0.5, 0.0, 1.0);
    int bi = int(u * ${BAND_COUNT - 1}.999);
    float ridge = uBands[bi];
    vBand = ridge;

    // Ridge amplitude is broken up by noise so it reads as terrain, not stripes.
    float breakup = 0.55 + 0.45 * fbm(vec2(x * 0.07, z * 0.015 - uPhase * 0.004));
    float h = ridge * 5.5 * breakup;

    // Detail: two octaves of scrolling noise, stronger on energetic ridges.
    float detail = fbm(vec2(x * 0.22, z * 0.06 - uPhase * 0.05));
    h += (detail - 0.45) * (1.6 + ridge * 2.2);

    // Bass heave: slow swells riding the scroll.
    h += uHeave * sin(z * 0.045 + uPhase * 0.11) * 0.8;

    p.y += h;
    vHeight = clamp(h / 7.0, 0.0, 1.0);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vDist = -wp.z;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uCrest;
  uniform float uTreble;
  uniform float uEnergy;
  uniform float uPhase;
  varying float vHeight;
  varying float vBand;
  varying float vDist;
  varying vec3 vWorld;

  void main(){
    vec3 col = mix(uDeep, uMid, smoothstep(0.02, 0.42, vHeight));
    col = mix(col, uCrest, smoothstep(0.42, 0.95, vHeight));

    // Crest sparkle driven by treble — high-frequency glints along the ridges.
    float glint = sin(vWorld.x * 9.0 + vWorld.z * 7.0 + uPhase * 2.4);
    float sparkle = pow(vHeight, 7.0) * uTreble * (0.55 + 0.45 * glint);
    col += uCrest * sparkle * 1.6;

    // Emissive band tint so the spectrum itself reads in the color.
    col += uMid * vBand * 0.12;

    // Manual distance fog into the scene void.
    float fog = 1.0 - exp(-vDist * 0.016);
    col = mix(col, vec3(0.008, 0.006, 0.016), fog);

    // Subtle energy lift so quiet sections sit darker.
    col *= 0.75 + uEnergy * 0.45;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function TerrainFlyover({
  audioData,
  audioElapsedRef,
  sceneFrozen,
  prefersReducedMotion,
}: VizProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const phaseRef = useRef(0);
  const lastElapsedRef = useRef<number | null>(null);
  const bandsRef = useRef(new Float32Array(BAND_COUNT));

  const { geometry, material } = useMemo(() => {
    const g = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, 150, 240);
    g.rotateX(-Math.PI / 2);
    // Near edge starts just ahead of the camera; extends to the horizon.
    g.translate(0, 0, -TERRAIN_D / 2 + 8);
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPhase: { value: 0 },
        uHeave: { value: 0 },
        uBands: { value: bandsRef.current },
        uWidth: { value: TERRAIN_W },
        uDeep: { value: new THREE.Color("#05060f") },
        uMid: { value: new THREE.Color("#1e3a5f") },
        uCrest: { value: new THREE.Color("#67e8f9") },
        uTreble: { value: 0 },
        uEnergy: { value: 0 },
      },
    });
    return { geometry: g, material: m };
  }, []);

  useDisposeOnUnmount(geometry, material);

  useFrame((_, delta) => {
    const d = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    // ── Audio-clock scroll phase ──────────────────────────────────────────
    // Integrate elapsed-audio deltas so pause freezes flight and export
    // frames advance deterministically with the render timeline. When no
    // audio clock is wired (demo), fall back to frame delta.
    const elapsed = audioElapsedRef?.current;
    let dClock: number;
    if (elapsed != null) {
      const last = lastElapsedRef.current ?? elapsed;
      dClock = Math.min(Math.max(elapsed - last, 0), 0.1);
      lastElapsedRef.current = elapsed;
    } else {
      lastElapsedRef.current = null;
      dClock = Math.min(delta, 0.1);
    }
    if (!sceneFrozen) {
      const speed = (1.9 + d.bass * 3.4 + d.energy * 1.7 + (d.onset ?? 0) * 1.2) * speedMul;
      phaseRef.current += dClock * speed;
    }

    // ── Spectrum → 24 ridgeline bands ─────────────────────────────────────
    const bands = bandsRef.current;
    const percept = d.perceptualBands;
    if (percept && percept.length >= 8) {
      for (let i = 0; i < BAND_COUNT; i++) {
        const t = (i / (BAND_COUNT - 1)) * (percept.length - 1);
        const i0 = Math.floor(t);
        const i1 = Math.min(i0 + 1, percept.length - 1);
        const f = t - i0;
        bands[i] = percept[i0] * (1 - f) + percept[i1] * f;
      }
    } else {
      // Mixed-signal fallback: positional weighting across bass/mid/treble.
      for (let i = 0; i < BAND_COUNT; i++) {
        const t = i / (BAND_COUNT - 1);
        const low = Math.max(0, 1 - t * 1.7);
        const mid = Math.max(0, 1 - Math.abs(t - 0.45) * 2.4);
        const high = t < 0.55 ? 0 : (t - 0.55) / 0.45;
        bands[i] = Math.min(1, d.bass * low * 0.95 + d.mid * mid + d.treble * high * high * 0.95);
      }
    }

    const u = material.uniforms;
    u.uPhase.value = phaseRef.current;
    u.uHeave.value = prefersReducedMotion ? d.bass * 0.25 : d.bass * 0.85 + (d.onset ?? 0) * 0.25;
    u.uTreble.value = d.treble;
    u.uEnergy.value = d.energy;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[0, -3.4, 0]}
      frustumCulled={false}
    />
  );
}
