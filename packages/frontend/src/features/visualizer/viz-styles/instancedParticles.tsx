import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getParticleTex } from "./textures";

// =============================================================================
// Instanced quad particle system — replaces THREE.Points with real quads.
//
// Uses InstancedBufferGeometry + ShaderMaterial so particles:
//  - Are actual triangles (not gl_PointSize sprites)
//  - Billboard toward the camera each frame (in vertex shader)
//  - Support per-instance color, size, phase, and velocity stretch
//  - Work under both WebGL and WebGPU renderers
// =============================================================================

const QUAD_VERTS = new Float32Array([
  -0.5, -0.5, 0,
  0.5, -0.5, 0,
  -0.5, 0.5, 0,
  0.5, 0.5, 0,
]);
const QUAD_INDEX = new Uint16Array([0, 1, 2, 2, 1, 3]);

interface ParticleState {
  positions: Float32Array;
  baseSizes: Float32Array;
  phases: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
}

export interface InstancedParticlesOpts {
  count?: number;
  baseSize?: number;
  spread?: number;
  /** base color hue (0-1) for random variation */
  hueBase?: number;
  hueRange?: number;
  /** velocity stretch factor */
  stretch?: number;
}

export function InstancedParticles({
  audioData,
  sceneFrozen,
  prefersReducedMotion,
  count = 2000,
  spread = 5,
  hueBase = 0.6,
  hueRange = 0.25,
  stretch = 2.5,
}: VizProps & InstancedParticlesOpts) {
  const meshRef = useRef<THREE.Mesh>(null);

  const state = useMemo<ParticleState>(() => {
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const vels = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 0.5 + Math.random() * spread;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      sizes[i] = 0.4 + Math.random() * 1.0;
      phases[i] = Math.random() * Math.PI * 2;
      vels[i * 3] = (Math.random() - 0.5) * 0.02;
      vels[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      vels[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
      const c = new THREE.Color().setHSL(
        hueBase + Math.random() * hueRange,
        0.8 + Math.random() * 0.2,
        0.4 + Math.random() * 0.3,
      );
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    return { positions: pos, baseSizes: sizes, phases, velocities: vels, colors: cols };
  }, [count, spread, hueBase, hueRange]);

  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(QUAD_VERTS, 3));
    geo.setIndex(new THREE.BufferAttribute(QUAD_INDEX, 1));
    geo.setAttribute(
      "instancePosition",
      new THREE.InstancedBufferAttribute(state.positions, 3),
    );
    geo.setAttribute(
      "instanceSize",
      new THREE.InstancedBufferAttribute(state.baseSizes, 1),
    );
    geo.setAttribute(
      "instanceColor",
      new THREE.InstancedBufferAttribute(state.colors, 3),
    );
    geo.setAttribute(
      "instancePhase",
      new THREE.InstancedBufferAttribute(state.phases, 1),
    );
    geo.setAttribute(
      "instanceVelocity",
      new THREE.InstancedBufferAttribute(state.velocities, 3),
    );
    geo.instanceCount = count;
    return geo;
  }, [state, count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTexture: { value: getParticleTex() },
          uTime: { value: 0 },
          uBass: { value: 0 },
          uTreble: { value: 0 },
          uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
          uStretch: { value: stretch },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec3 instancePosition;
          attribute float instanceSize;
          attribute vec3 instanceColor;
          attribute float instancePhase;
          attribute vec3 instanceVelocity;

          uniform mat4 viewMatrix;
          uniform float uTime;
          uniform float uBass;
          uniform float uPixelRatio;
          uniform float uStretch;

          varying vec3 vColor;
          varying vec2 vUv;
          varying float vAlpha;

          void main() {
            vColor = instanceColor;
            vUv = position.xy + 0.5;

            // Billboard orientation from view matrix
            vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 cameraUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

            // Audio-reactive size
            float s = instanceSize * (1.0 + uBass * 1.2);

            // Velocity stretch along motion direction
            float speed = length(instanceVelocity);
            vec3 velDir = normalize(instanceVelocity + vec3(0.0001));
            vec3 stretchDir = normalize(mix(cameraRight, velDir, 0.5));
            float stretchAmt = 1.0 + speed * uStretch;

            // Quad corner offset with stretch
            vec2 corner = position.xy;
            float alongStretch = dot(corner, stretchDir.xy) * stretchAmt;
            vec2 perp = corner - alongStretch * stretchDir.xy;
            vec2 finalOffset = alongStretch * stretchDir.xy + perp;

            vec3 worldPos = instancePosition
              + cameraRight * finalOffset.x * s
              + cameraUp    * finalOffset.y * s;

            vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // Distance attenuation
            float dist = length(mvPosition.xyz);
            vAlpha = smoothstep(14.0, 2.0, dist);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTexture;
          uniform float uTime;
          varying vec3 vColor;
          varying vec2 vUv;
          varying float vAlpha;

          void main() {
            vec4 tex = texture2D(uTexture, vUv);
            float a = tex.a * vAlpha;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor * tex.rgb, a);
          }
        `,
      }),
    [stretch],
  );

  useFrame((state3f) => {
    if (!meshRef.current || sceneFrozen) return;
    const t = state3f.clock.elapsedTime;
    const { bass, mid, treble, energy } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    const posAttr = geometry.getAttribute("instancePosition") as THREE.InstancedBufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const phaseArr = state.phases;
    const velArr = state.velocities;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const phase = phaseArr[i];

      const drift =
        Math.sin(t * 2 + phase) * treble * 0.3 +
        Math.cos(t * 1.5 + phase) * mid * 0.2 +
        Math.sin(t * 3 + phase) * bass * 0.15;
      posArr[idx] += velArr[idx] * (1 + energy * 2) * speedMul + drift * 0.02;
      posArr[idx + 1] += velArr[idx + 1] * (1 + energy * 2) * speedMul + drift * 0.03;
      posArr[idx + 2] += velArr[idx + 2] * (1 + energy * 2) * speedMul + drift * 0.02;

      const dist = Math.sqrt(posArr[idx] ** 2 + posArr[idx + 1] ** 2 + posArr[idx + 2] ** 2);
      if (dist > spread * 1.2) {
        const r = 0.5 + Math.random() * spread * 0.5;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        posArr[idx] = r * Math.sin(phi) * Math.cos(theta);
        posArr[idx + 1] = r * Math.sin(phi) * Math.sin(theta);
        posArr[idx + 2] = r * Math.cos(phi);
      }

      // Audio size is applied in shader via instanceSize * (1 + uBass * 1.2)
      // No JS-side size update needed
    }

    posAttr.needsUpdate = true;
  });

  return (
    <mesh geometry={geometry} material={material} frustumCulled={false} />
  );
}
