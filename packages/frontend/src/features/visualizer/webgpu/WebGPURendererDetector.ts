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

export interface WebGPUDetectResult {
  supported: boolean;
  backend: "webgpu" | "webgl" | "checking";
  ready: boolean;
  error?: string;
}

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
        let hasWebGPU = false;
        const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<any> } };
        if (nav.gpu) {
          try {
            const adapter = await nav.gpu.requestAdapter();
            hasWebGPU = !!adapter;
          } catch {
            hasWebGPU = false;
          }
        }

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
 * Factory function for R3F's `gl` prop.
 * Receives defaultProps (including canvas) from R3F, creates a WebGPURenderer,
 * initializes it, and returns it.
 */
export async function createWebGPURenderer(
  defaultProps: { canvas: HTMLCanvasElement; antialias?: boolean; alpha?: boolean; powerPreference?: string }
): Promise<any> {
  const mod = await import("three/webgpu");
  const WebGPURenderer = mod.WebGPURenderer as new (params: any) => any;

  const renderer = new WebGPURenderer({
    canvas: defaultProps.canvas,
    antialias: defaultProps.antialias ?? true,
    alpha: defaultProps.alpha ?? true,
    powerPreference: defaultProps.powerPreference ?? "high-performance",
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
 * Synchronous WebGPU capability check (safe to call outside React).
 */
export async function detectWebGPUSupport(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<any> } };
    if (!nav.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}
