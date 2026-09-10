/**
 * WebGPUPostFX — TSL-based post-processing for the 3D visualizer.
 *
 * Effects (Three.js r185 TSL):
 *  1. Bloom (luminance-based multi-tap blur on bright regions)
 *  2. Chromatic aberration (radial RGB offset)
 *  3. Vignette (smooth radial darkening)
 *  4. Film grain (interleaved gradient noise + time)
 *
 * Falls back gracefully: if the renderer is not a WebGPURenderer (i.e. WebGL
 * fallback), this component renders nothing and the legacy PostFX (EffectComposer)
 * continues to handle post-processing.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useEffect } from "react";
import {
  Fn,
  float,
  uniform,
  vec2,
  vec3,
  pass,
  renderOutput,
  screenUV,
  texture,
} from "three/tsl";

// ---------------------------------------------------------------------------
// TSL effect functions
// ---------------------------------------------------------------------------

const bloomEffect = Fn(([input, strength, radius]: [any, any, any]) => {
  const uv = screenUV;
  const lumR = float(0.2126).mul(input.r) as any;
  const lumG = float(0.7152).mul(input.g) as any;
  const lumB = float(0.0722).mul(input.b) as any;
  const lum = lumR.add(lumG).add(lumB) as any;
  const bright = float(1).sub(float(1).div(float(1).add(lum.mul(float(20))))) as any;
  
  const o00 = texture(input, uv.add(vec2(-1, -1).mul(radius))).mul(bright) as any;
  const o01 = texture(input, uv.add(vec2( 0, -1).mul(radius))).mul(bright) as any;
  const o02 = texture(input, uv.add(vec2( 1, -1).mul(radius))).mul(bright) as any;
  const o03 = texture(input, uv.add(vec2(-1,  0).mul(radius))).mul(bright) as any;
  const o04 = texture(input, uv.add(vec2( 1,  0).mul(radius))).mul(bright) as any;
  const o05 = texture(input, uv.add(vec2(-1,  1).mul(radius))).mul(bright) as any;
  const o06 = texture(input, uv.add(vec2( 0,  1).mul(radius))).mul(bright) as any;
  const o07 = texture(input, uv.add(vec2( 1,  1).mul(radius))).mul(bright) as any;
  
  const blurred = o00.add(o01).add(o02).add(o03).add(o04).add(o05).add(o06).add(o07).mul(float(0.125)) as any;
  return input.add(blurred.mul(strength)) as any;
});

const chromaticAberrationEffect = Fn(([input, strength]: [any, any]) => {
  const uv = screenUV;
  const center = vec2(0.5, 0.5);
  const dir = uv.sub(center);
  const dist = dir.length();
  const offset = dir.mul(dist).mul(strength);

  const r = texture(input, uv.add(offset)).r;
  const g = texture(input, uv).g;
  const b = texture(input, uv.sub(offset)).b;

  return vec3(r, g, b);
});

const vignetteEffect = Fn(([input, strength, smoothness]: [any, any, any]) => {
  const uv = screenUV.sub(vec2(0.5, 0.5));
  const dist = uv.length();
  const vig = float(1).sub(dist.mul(strength)).smoothstep(float(0), smoothness);
  return input.mul(vig);
});

const grainEffect = Fn(([input, amount, time]: [any, any, any]) => {
  const noise = float(
    Math.sin((screenUV.x.mul(127.1).add(screenUV.y.mul(311.7)).add(time.mod(float(100)) as any)) as any),
  ).fract().sub(0.5);
  return input.add(noise.mul(amount));
});

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface WebGPUPostFXProps {
  audioData: { current: { bass: number; mid: number; treble: number; energy: number; beat: boolean } };
  lrcSync?: { isPhraseStart: boolean } | null;
}

export function WebGPUPostFX({ audioData, lrcSync }: WebGPUPostFXProps) {
  const { gl, scene, camera } = useThree();
  const beatPulse = useRef(0);
  const phrasePulse = useRef(0);

  // Build the TSL post-FX graph once.
  const postFXGraph = useMemo(() => {
    try {
      const scenePass = pass(scene, camera);

      const bloomStrength = uniform(0.35);
      const bloomRadius = uniform(0.4);
      const chromaticStrength = uniform(0.0015);
      const vignetteStrength = uniform(0.4);
      const vignetteSmoothness = uniform(0.65);
      const grainAmount = uniform(0.04);
      const timeUniform = uniform(0);

      let color: any = scenePass;
      color = bloomEffect(color, bloomStrength, bloomRadius);
      color = chromaticAberrationEffect(color, chromaticStrength);
      color = vignetteEffect(color, vignetteStrength, vignetteSmoothness);
      color = grainEffect(color, grainAmount, timeUniform);

      const output = renderOutput(color) as any;

      return {
        output: output as any,
        uniforms: {
          bloomStrength,
          bloomRadius,
          chromaticStrength,
          vignetteStrength,
          vignetteSmoothness,
          grainAmount,
          timeUniform,
        },
      };
    } catch (err) {
      console.error("[WebGPUPostFX] Failed to build TSL graph:", err);
      return null;
    }
  }, [scene, camera]);

  // Apply the output node to the renderer once.
  useEffect(() => {
    const renderer = gl as any;
    if (!renderer || !postFXGraph) return;

    if (renderer.isWebGPURenderer) {
      renderer.outputNode = postFXGraph.output;
    }
  }, [gl, postFXGraph]);

  // Beat-reactive uniform updates
  useFrame((state) => {
    if (!postFXGraph) return;
    const u = postFXGraph.uniforms;
    const { bass, beat, energy } = audioData.current;

    if (beat) beatPulse.current = 1;
    beatPulse.current *= 0.88;

    if (lrcSync?.isPhraseStart) phrasePulse.current = 1;
    phrasePulse.current *= 0.85;

    const bp = beatPulse.current;
    const pp = phrasePulse.current;

    u.bloomStrength.value = Math.min(
      0.9,
      0.2 + bass * 0.5 + bp * 0.3 + energy * 0.1 + pp * 0.2,
    );
    u.bloomRadius.value = 0.3 + bp * 0.3;
    u.chromaticStrength.value = 0.001 + bp * 0.003 + pp * 0.002;
    u.vignetteStrength.value = 0.35 + pp * 0.15;
    u.grainAmount.value = 0.03 + bp * 0.02;
    u.timeUniform.value = state.clock.elapsedTime;
  });

  return null;
}
