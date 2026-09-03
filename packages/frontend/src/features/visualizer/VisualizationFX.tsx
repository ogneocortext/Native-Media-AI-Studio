/**
 * VisualizationFX — 2026-quality rendering infrastructure for the 3D visualizer.
 *
 * Implements the current three.js "professional look" stack (WebGL path, r185):
 *  1. PostFX           — EffectComposer pipeline: UnrealBloomPass (beat-reactive
 *                        strength) → final grade pass (vignette + film grain +
 *                        edge chromatic aberration) → OutputPass (tone mapping).
 *  2. Terrain material — GPU vertex-shader simplex-noise displacement with
 *                        finite-difference normals + fresnel rim (replaces CPU
 *                        per-vertex displacement for waveform/ocean/aurora).
 *  3. Streak material  — velocity-stretched soft particles (the 2026 "particle
 *                        streaks" look) for galaxy/ember/cosmic dust systems.
 *
 * All effects are additive-blend friendly and react to the shared AudioData ref.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { AudioData } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared GLSL: Ashima simplex noise (used by terrain vertex shader)
// ─────────────────────────────────────────────────────────────────────────────
export const SIMPLEX_NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// PostFX — bloom + grain/vignette/aberration grade, beat-reactive
// ─────────────────────────────────────────────────────────────────────────────

const FinalGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.05 },
    uAberration: { value: 0.0014 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uGrain, uAberration, uTime;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + mod(uTime, 10.0)) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * uAberration * (0.4 + d * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= 1.0 - uVignette * smoothstep(0.35, 0.95, d);
      col += (hash(vUv * vec2(1917.0, 1031.0)) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function PostFX({ audioData, lrcSync, lrcSyncRef }: { audioData: React.MutableRefObject<AudioData>; lrcSync?: { isPhraseStart: boolean; currentSection: string } | null; lrcSyncRef?: { current: { isPhraseStart: boolean; currentSection: string } | null } }) {
  const { gl, scene, camera, size } = useThree();
  const beatPulse = useRef(0);

  const fx = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    const b = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.7, 0.55, 0.72);
    c.addPass(b);
    const g = new ShaderPass(FinalGradeShader);
    c.addPass(g);
    c.addPass(new OutputPass());
    return { composer: c, bloom: b, grade: g, lastW: 0, lastH: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  useEffect(() => () => fx.composer.dispose(), [fx]);

  // Diagnostic handle (temporary)
  (window as unknown as { __postfx?: unknown }).__postfx = fx;

  const phrasePulse = useRef(0);
  useFrame((state) => {
    const el = gl.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (fx.lastW !== w || fx.lastH !== h) {
      gl.setSize(w, h, false);
      fx.composer.setSize(w, h);
      fx.lastW = w;
      fx.lastH = h;
    }
    const { bass, beat, energy } = audioData.current;
    if (beat) beatPulse.current = 1;
    beatPulse.current *= 0.9;
    // Prefer the per-frame live sync; fall back to the React-state snapshot.
    if ((lrcSyncRef?.current ?? lrcSync)?.isPhraseStart) phrasePulse.current = 1;
    phrasePulse.current *= 0.88;
    fx.bloom.strength = Math.min(
      0.9,
      0.22 + bass * 0.6 + beatPulse.current * 0.35 + energy * 0.15 + phrasePulse.current * 0.25,
    );
    fx.grade.uniforms.uTime.value = state.clock.elapsedTime;
    // Phrase-driven vignette pulse via uniform (subtle)
    fx.grade.uniforms.uVignette.value = phrasePulse.current > 0.1 ? 0.35 + phrasePulse.current * 0.2 : 0.35;
    fx.composer.render();
  }, 1);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain material — GPU noise displacement + fresnel rim
// ─────────────────────────────────────────────────────────────────────────────

export interface TerrainMaterialOpts {
  colorA?: string;      // valley color
  colorB?: string;      // peak color
  rim?: string;         // fresnel rim color
  opacity?: number;
  displace?: number;    // base displacement amplitude
  freq1?: number;       // large noise frequency
  freq2?: number;       // detail noise frequency
  speed?: number;       // noise evolution speed
  ripple?: number;      // radial ripple strength
}

export function makeTerrainMaterial(opts: TerrainMaterialOpts = {}): THREE.ShaderMaterial {
  const o = {
    colorA: "#0b1530",
    colorB: "#7dd3fc",
    rim: "#c4b5fd",
    opacity: 1,
    displace: 1.1,
    freq1: 0.55,
    freq2: 1.8,
    speed: 0.6,
    ripple: 0.35,
    ...opts,
  };
  return new THREE.ShaderMaterial({
    transparent: o.opacity < 1,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uEnergy: { value: 0.5 },
      uGlow: { value: 0.5 },
      uColorA: { value: new THREE.Color(o.colorA) },
      uColorB: { value: new THREE.Color(o.colorB) },
      uRim: { value: new THREE.Color(o.rim) },
      uOpacity: { value: o.opacity },
      uDisplace: { value: o.displace },
      uFreq1: { value: o.freq1 },
      uFreq2: { value: o.freq2 },
      uSpeed: { value: o.speed },
      uRipple: { value: o.ripple },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uBass, uMid, uTreble, uEnergy, uDisplace, uFreq1, uFreq2, uSpeed, uRipple;
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      ${SIMPLEX_NOISE_GLSL}
      float height(vec2 p, float t){
        float n1 = snoise(vec3(p * uFreq1, t * uSpeed));
        float n2 = snoise(vec3(p * uFreq2 + 13.7, t * uSpeed * 1.6));
        float ripple = sin(length(p) * 2.2 - t * 2.4) * uRipple;
        return n1 * (0.35 + uBass * uDisplace * 0.8) + n2 * (0.12 + uMid * 0.5) * 0.5 + ripple * (0.15 + uTreble * 0.6);
      }
      void main(){
        vec3 p = position;
        float t = uTime + uEnergy * 2.0;
        float h = height(p.xy, t);
        float e = 0.12;
        float hx = height(p.xy + vec2(e, 0.0), t);
        float hy = height(p.xy + vec2(0.0, e), t);
        p.z += h;
        vH = h;
        vec3 n = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.0));
        vN = normalize(normalMatrix * n);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA, uColorB, uRim;
      uniform float uOpacity, uGlow, uBass;
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main(){
        float m = smoothstep(-1.2, 1.4, vH);
        vec3 col = mix(uColorA, uColorB, m);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.4);
        col += uRim * fres * (0.35 + uGlow * 0.7 + uBass * 0.35);
        col *= 0.8 + uGlow * 0.35;
        // Filmic soft rolloff — keeps peaks inside bloom's sweet spot
        col = col / (1.0 + 0.28 * col);
        gl_FragColor = vec4(col, uOpacity);
      }
    `,
  });
}

/** Per-frame uniform update helper for terrain materials. */
export function updateTerrainMaterial(
  mat: THREE.ShaderMaterial,
  t: number,
  audio: { bass: number; mid: number; treble: number; energy?: number },
  glow: number,
) {
  const u = mat.uniforms;
  u.uTime.value = t;
  u.uBass.value = audio.bass;
  u.uMid.value = audio.mid;
  u.uTreble.value = audio.treble;
  u.uEnergy.value = audio.energy ?? 0.5;
  u.uGlow.value = glow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streak material — velocity-stretched additive particles
// ─────────────────────────────────────────────────────────────────────────────

/** Adds an `aVel` (vec3) attribute used by makeStreakMaterial for motion stretch. */
export function applyStreakVelocity(
  geom: THREE.BufferGeometry,
  getVel: (i: number, x: number, y: number, z: number) => [number, number, number],
  n: number,
) {
  if (!geom.getAttribute("aVel")) {
    const pos = geom.getAttribute("position").array as Float32Array;
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [vx, vy, vz] = getVel(i, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    }
    geom.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
  }
}

export interface StreakMaterialOpts {
  size?: number;
  stretch?: number;
  opacity?: number;
}

export function makeStreakMaterial(opts: StreakMaterialOpts = {}): THREE.ShaderMaterial {
  const { size = 42, stretch = 2.6, opacity = 0.85 } = opts;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uSize: { value: size },
      uStretch: { value: stretch },
      uOpacity: { value: opacity },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      uniform float uSize, uBass, uPixelRatio;
      varying vec3 vColor;
      varying vec2 vDir;
      varying float vSpeed;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * mv;
        vec4 clipPrev = projectionMatrix * (modelViewMatrix * vec4(position - aVel * 0.08, 1.0));
        vec2 ndc = clip.xy / max(0.0001, clip.w);
        vec2 ndcPrev = clipPrev.xy / max(0.0001, clipPrev.w);
        vec2 delta = ndc - ndcPrev;
        delta.x *= 1.7777;
        vSpeed = clamp(length(delta) * 24.0, 0.0, 1.0);
        vDir = length(delta) > 0.00001 ? normalize(delta) : vec2(1.0, 0.0);
        float ps = uSize * uPixelRatio * (1.0 + uBass * 1.2) / max(0.5, -mv.z);
        // Clamp so particles passing near the camera don't blow up into
        // huge blurry quads (the classic gl_PointSize failure mode).
        gl_PointSize = min(ps, uPixelRatio * 80.0);
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStretch, uOpacity, uTreble;
      varying vec3 vColor;
      varying vec2 vDir;
      varying float vSpeed;
      void main(){
        vec2 pc = gl_PointCoord * 2.0 - 1.0;
        vec2 d = vDir;
        mat2 R = mat2(d.x, d.y, -d.y, d.x);
        vec2 q = R * pc;
        q.x /= (1.0 + vSpeed * uStretch);
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 3.2) * uOpacity * (0.65 + vSpeed * 0.6 + uTreble * 0.25);
        gl_FragColor = vec4(vColor * (0.75 + vSpeed * 0.8), a);
      }
    `,
  });
}
