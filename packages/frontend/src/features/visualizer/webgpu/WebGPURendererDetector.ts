/**
 * WebGPU Renderer Detection & Setup for the 3D Visualizer.
 *
 * Detects WebGPU support at runtime. The actual renderer creation is delegated
 * to R3F's `gl` prop (as an async factory), which receives the Canvas's own
 * canvas element so the renderer and the DOM stay in sync.
 *
 * Usage:
 *   const { supported, backend, ready } = useWebGPUDector();
 *   // Then in Canvas:
 *   <Canvas gl={supported ? createWebGPURenderer : { antialias: true }} ... />
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export interface WebGPUDetectResult {
  supported: boolean;
  backend: "webgpu" | "webgl" | "checking";
  ready: boolean;
  error?: string;
}

/** localStorage key for the WebGPU opt-in (also settable with `?webgpu=1`). */
export const WEBGPU_OPT_IN_STORAGE_KEY = "nma.visualizer.webgpu";

/**
 * R3F calls the `gl` factory with these (its own WebGLRenderer defaults).
 * Mirrored exactly so the WebGL fallback behaves identically to passing
 * `{ antialias: true }` directly.
 */
export interface RendererInitProps {
  canvas: HTMLCanvasElement;
  powerPreference?: WebGLPowerPreference;
  antialias?: boolean;
  alpha?: boolean;
}

/**
 * Should the visualizer try the WebGPU renderer?
 *
 * Opt-in by design (default stays WebGL): the scene uses GLSL `ShaderMaterial`s
 * for the particle system and the backdrop dome, and three r185's
 * WebGPURenderer has no GLSL path (NodeMaterial/TSL only) — forcing WebGPU
 * would black-screen those layers on WebGPU-capable Chrome.
 *
 * Enable with `?webgpu=1` on the URL, or `localStorage["nma.visualizer.webgpu"] = "1"`.
 */
export function isWebGPUOptIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("webgpu");
    if (param === "1" || param === "true") return true;
    if (param === "0" || param === "false") return false;
    return window.localStorage.getItem(WEBGPU_OPT_IN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Adapter probing is not free and is needed by both the detector hook and the
// renderer factory — request it once and share the answer.
let adapterProbe: Promise<boolean> | null = null;

/**
 * Hook: detect WebGPU capability without creating a renderer.
 * The renderer itself is created by R3F's `gl` prop factory.
 */
export function useWebGPUDector(): WebGPUDetectResult {
  const [result, setResult] = useState<WebGPUDetectResult>({
    supported: false,
    backend: "checking",
    ready: false,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const hasWebGPU = await detectWebGPUSupport();

        if (mountedRef.current) {
          const next: WebGPUDetectResult = {
            supported: hasWebGPU,
            backend: hasWebGPU ? "webgpu" : "webgl",
            ready: true,
          };
          setResult(next);
        }
      } catch (err) {
        console.error("[WebGPU] detection failed:", err);
        if (mountedRef.current) {
          const next: WebGPUDetectResult = {
            supported: false,
            backend: "webgl",
            ready: true,
            error: err instanceof Error ? err.message : "Unknown error",
          };
          setResult(next);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return result;
}

/**
 * Single stable renderer factory for R3F's `gl` prop.
 *
 * Why a factory instead of `gl={supported ? factory : { antialias: true }}`:
 * R3F creates the renderer exactly once, when the canvas root is configured
 * ("Set up renderer (one time only!)"), and ignores later `gl` prop changes.
 * Capability detection resolves asynchronously, so a `gl` value derived from it
 * was always the WebGL object at first configure → the WebGPU branch was
 * unreachable dead code.
 *
 * This function keeps a stable identity, reads the decision at configure time,
 * and falls back to WebGL if WebGPU is opted-in but fails to initialize.
 */
export async function createVisualizerRenderer(
  defaultProps: RendererInitProps,
): Promise<any> {
  if (isWebGPUOptIn() && (await detectWebGPUSupport())) {
    try {
      const renderer = await createWebGPURenderer(defaultProps);
      if (renderer) return renderer;
    } catch (err) {
      console.warn("[WebGPU] renderer init failed — falling back to WebGL:", err);
    }
  }
  return new THREE.WebGLRenderer({
    canvas: defaultProps.canvas,
    powerPreference: defaultProps.powerPreference ?? "high-performance",
    antialias: defaultProps.antialias ?? true,
    alpha: defaultProps.alpha ?? true,
  });
}

/**
 * Factory function for R3F's `gl` prop.
 * R3F calls it as `gl(canvas, options)` — accepts either shape.
 */
export async function createWebGPURenderer(
  canvasOrOptions: HTMLCanvasElement | { canvas: HTMLCanvasElement; antialias?: boolean; alpha?: boolean; powerPreference?: string },
  maybeOptions: { antialias?: boolean; alpha?: boolean; powerPreference?: string } = {}
): Promise<any> {
  let canvas: HTMLCanvasElement;
  let options: { antialias?: boolean; alpha?: boolean; powerPreference?: string };
  if (canvasOrOptions instanceof HTMLCanvasElement) {
    canvas = canvasOrOptions;
    options = maybeOptions;
  } else {
    canvas = canvasOrOptions.canvas;
    options = canvasOrOptions;
  }

  const mod = await import("three/webgpu");
  const WebGPURenderer = mod.WebGPURenderer as new (params: any) => any;

  const renderer = new WebGPURenderer({
    canvas,
    antialias: options.antialias ?? true,
    alpha: options.alpha ?? true,
    powerPreference: options.powerPreference ?? "high-performance",
  });

  try {
    await renderer.init();
  } catch (err) {
    console.warn("[WebGPU] init failed, WebGPURenderer returned without init:", err);
    // Return the renderer anyway — it may fall back internally
  }

  return renderer;
}

/**
 * WebGPU capability check (safe to call outside React).
 * Cached: `requestAdapter()` is not free, and both the detector hook and the
 * renderer factory need the same answer.
 */
export function detectWebGPUSupport(): Promise<boolean> {
  if (adapterProbe) return adapterProbe;
  adapterProbe = (async () => {
    try {
      const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<any> } };
      if (!nav.gpu) return false;
      const adapter = await nav.gpu.requestAdapter();
      return !!adapter;
    } catch {
      return false;
    }
  })();
  return adapterProbe;
}
