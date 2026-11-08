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
import { Fn, float, uniform, vec2, vec3, pass, renderOutput, screenUV, texture } from "three/tsl";
import type { Node, PassNode, TextureNode } from "three/webgpu";

/**
 * The post-FX chain passes `vec4` color nodes between stages. `texture()`'s
 * typings only accept `Texture | TextureNode`, but at runtime any node in the
 * chain is a valid sample source — narrow once at the boundary.
 */
type EffectColorNode = Node<"vec4">;

function sampleNode(input: Node, uvNode: Node): TextureNode {
  return texture(input as unknown as TextureNode, uvNode);
}

// ---------------------------------------------------------------------------
// TSL effect functions
// ---------------------------------------------------------------------------

const bloomEffect = Fn(([input, strength, radius]: [EffectColorNode, Node<"float">, Node<"float">]) => {
  const uv = screenUV;
  const lumR = float(0.2126).mul(input.r);
  const lumG = float(0.7152).mul(input.g);
  const lumB = float(0.0722).mul(input.b);
  const lum = lumR.add(lumG).add(lumB);
  const bright = float(1).sub(float(1).div(float(1).add(lum.mul(float(20)))));

  const o00 = sampleNode(input, uv.add(vec2(-1, -1).mul(radius))).mul(bright);
  const o01 = sampleNode(input, uv.add(vec2(0, -1).mul(radius))).mul(bright);
  const o02 = sampleNode(input, uv.add(vec2(1, -1).mul(radius))).mul(bright);
  const o03 = sampleNode(input, uv.add(vec2(-1, 0).mul(radius))).mul(bright);
  const o04 = sampleNode(input, uv.add(vec2(1, 0).mul(radius))).mul(bright);
  const o05 = sampleNode(input, uv.add(vec2(-1, 1).mul(radius))).mul(bright);
  const o06 = sampleNode(input, uv.add(vec2(0, 1).mul(radius))).mul(bright);
  const o07 = sampleNode(input, uv.add(vec2(1, 1).mul(radius))).mul(bright);

  const blurred = o00
    .add(o01)
    .add(o02)
    .add(o03)
    .add(o04)
    .add(o05)
    .add(o06)
    .add(o07)
    .mul(float(0.125));
  return input.add(blurred.mul(strength));
});

const chromaticAberrationEffect = Fn(([input, strength]: [EffectColorNode, Node<"float">]) => {
  const uv = screenUV;
  const center = vec2(0.5, 0.5);
  const dir = uv.sub(center);
  const dist = dir.length();
  const offset = dir.mul(dist).mul(strength);

  const r = sampleNode(input, uv.add(offset)).r;
  const g = sampleNode(input, uv).g;
  const b = sampleNode(input, uv.sub(offset)).b;

  // The chain consumes this as a vec4 color node; vec3 is the honest node
  // type here, so widen once at the boundary (same runtime node).
  return vec3(r, g, b) as unknown as EffectColorNode;
});

const vignetteEffect = Fn(
  ([input, strength, smoothness]: [EffectColorNode, Node<"float">, Node<"float">]) => {
    const uv = screenUV.sub(vec2(0.5, 0.5));
    const dist = uv.length();
    const vig = float(1).sub(dist.mul(strength)).smoothstep(float(0), smoothness);
    return input.mul(vig);
  },
);

const grainEffect = Fn(([input, amount, time]: [EffectColorNode, Node<"float">, Node<"float">]) => {
  // `Math.sin` runs at graph-build time on the node (pre-existing behavior —
  // preserved verbatim); the cast only satisfies the `number` signature.
  const noise = float(
    Math.sin(
      (screenUV.x
        .mul(127.1)
        .add(screenUV.y.mul(311.7))
        .add(time.mod(float(100)))) as unknown as number,
    ),
  )
    .fract()
    .sub(0.5);
  return input.add(noise.mul(amount));
});

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface WebGPUPostFXProps {
  audioData: {
    current: { bass: number; mid: number; treble: number; energy: number; beat: boolean };
  };
  lrcSync?: { isPhraseStart: boolean } | null;
  /**
   * Per-frame live LRC sync (written by the parent each frame from the
   * compensated audio clock). Preferred over the ~20 fps React-state snapshot
   * so the 150 ms phrase pulse is not missed — same contract as the WebGL PostFX.
   */
  lrcSyncRef?: { current: { isPhraseStart: boolean } | null };
  postfx?: {
    bloom?: number;
    vignette?: number;
    glitch?: number;
    kaleido?: { fold?: number; intensity?: number };
  } | null;
}

export function WebGPUPostFX({ audioData, lrcSync, lrcSyncRef, postfx }: WebGPUPostFXProps) {
  const { gl, scene, camera } = useThree();
  const beatPulse = useRef(0);
  const phrasePulse = useRef(0);

  // Build the TSL post-FX graph once.
  const postFXGraph = useMemo(() => {
    try {
      const scenePass: PassNode = pass(scene, camera);

      const bloomStrength = uniform(0.35);
      const bloomRadius = uniform(0.4);
      const chromaticStrength = uniform(0.0015);
      const vignetteStrength = uniform(0.4);
      const vignetteSmoothness = uniform(0.65);
      const grainAmount = uniform(0.04);
      const timeUniform = uniform(0);

      let color: EffectColorNode = scenePass;
      color = bloomEffect(color, bloomStrength, bloomRadius);
      color = chromaticAberrationEffect(color, chromaticStrength);
      color = vignetteEffect(color, vignetteStrength, vignetteSmoothness);
      color = grainEffect(color, grainAmount, timeUniform);

      const output = renderOutput(color);

      return {
        output: output,
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

  // Apply the output node to the renderer once, and restore the renderer's
  // previous output on unmount/rebuild. Without the cleanup a rebuilt graph
  // (scene/camera change) left the renderer pointing at a disposed pass node —
  // the canvas then renders through a dead pipeline.
  useEffect(() => {
    // R3F types `gl` as WebGLRenderer, but the opt-in factory can hand us a
    // WebGPURenderer — probe the two WebGPU-only members through a narrow
    // local shape instead of `any`.
    const renderer = gl as typeof gl & {
      isWebGPURenderer?: boolean;
      outputNode?: Node | null;
    };
    if (!postFXGraph) return;

    if (renderer.isWebGPURenderer) {
      renderer.outputNode = postFXGraph.output;
      return () => {
        if (renderer.outputNode === postFXGraph.output) renderer.outputNode = null;
        try {
          postFXGraph.output.dispose();
        } catch {
          /* node already released with the renderer */
        }
      };
    }
  }, [gl, postFXGraph]);

  // Beat-reactive uniform updates
  useFrame((state) => {
    if (!postFXGraph) return;
    const u = postFXGraph.uniforms;
    const { bass, beat, energy } = audioData.current;

    if (beat) beatPulse.current = 1;
    beatPulse.current *= 0.88;

    if ((lrcSyncRef?.current ?? lrcSync)?.isPhraseStart) phrasePulse.current = 1;
    phrasePulse.current *= 0.85;

    const bp = beatPulse.current;
    const pp = phrasePulse.current;
    const baseBloom = postfx?.bloom ?? 0.35;
    const baseVignette = postfx?.vignette ?? 0.4;

    u.bloomStrength.value = Math.min(
      0.9,
      0.02 + baseBloom * (bass * 0.5 + bp * 0.3 + energy * 0.1 + pp * 0.2),
    );
    u.bloomRadius.value = 0.3 + bp * 0.3;
    u.chromaticStrength.value = 0.001 + bp * 0.003 + pp * 0.002;
    u.vignetteStrength.value = baseVignette + pp * 0.15;
    u.grainAmount.value = 0.03 + bp * 0.02;
    u.timeUniform.value = state.clock.elapsedTime;
  });

  return null;
}
