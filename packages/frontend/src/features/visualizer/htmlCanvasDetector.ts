/**
 * HTML-in-Canvas detection for Chrome 157+.
 *
 * HTML-in-Canvas (Chrome 157+) allows drawing HTML/DOM content directly into
 * a <canvas> element via `ctx.drawHTML()` or `ctx.drawWindow()`. This is used
 * for rendering HTML-based overlays (lyrics, storyboards, brand assets) directly
 * into canvas frames — useful for music-video frame-accurate rendering.
 *
 * Chrome 156 and earlier do NOT support this — draw HTML/CSS overlays on top of
 * the canvas instead (standard DOM overlay pattern).
 *
 * Usage:
 *   const { supported, ready } = useHtmlInCanvas();
 *   if (supported) {
 *     // draw HTML into canvas
 *   } else {
 *     // render HTML overlay above canvas via DOM
 *   }
 */

import { useEffect, useRef, useState } from "react";

export interface HtmlInCanvasResult {
  supported: boolean;
  backend: "html-in-canvas" | "dom-overlay" | "checking";
  ready: boolean;
  error?: string;
}

/** LocalStorage key for forcing HTML-in-Canvas off/on (also settable via ?htmlInCanvas=1). */
export const HTML_IN_CANVAS_OPT_IN_STORAGE_KEY = "nma.visualizer.htmlInCanvas";

/**
 * Should HTML-in-Canvas be attempted?
 * Opt-in by design (default stays DOM overlay): the app renders HTML/CSS
 * overlays above the canvas which works in all Chrome versions. Opt-in to
 * HTML-in-Canvas only when you know the browser supports it (Chrome 157+).
 */
export function isHtmlInCanvasOptIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("htmlInCanvas");
    if (param === "1" || param === "true") return true;
    if (param === "0" || param === "false") return false;
    return window.localStorage.getItem(HTML_IN_CANVAS_OPT_IN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Cache detection probe so hook and renderer factory share one result.
let htmlInCanvasProbe: Promise<boolean> | null = null;

/**
 * Hook: detect HTML-in-Canvas capability without rendering anything.
 */
export function useHtmlInCanvas(): HtmlInCanvasResult {
  const [result, setResult] = useState<HtmlInCanvasResult>({
    supported: false,
    backend: "checking",
    ready: false,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const hasHtmlInCanvas = await detectHtmlInCanvasSupport();

        if (mountedRef.current) {
          const next: HtmlInCanvasResult = {
            supported: hasHtmlInCanvas,
            backend: hasHtmlInCanvas ? "html-in-canvas" : "dom-overlay",
            ready: true,
          };
          setResult(next);
        }
      } catch (err) {
        console.error("[HTML-in-Canvas] detection failed:", err);
        if (mountedRef.current) {
          const next: HtmlInCanvasResult = {
            supported: false,
            backend: "dom-overlay",
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
 * Check HTML-in-Canvas capability (safe to call outside React).
 * Cached: drawHTML() probe is not free, and both hook and renderer factory
 * share the same answer.
 */
export function detectHtmlInCanvasSupport(): Promise<boolean> {
  if (htmlInCanvasProbe) return htmlInCanvasProbe;

  htmlInCanvasProbe = (async () => {
    try {
      // Check for drawHTML method on CanvasRenderingContext2D
      if (
        typeof document === "undefined" ||
        !document.createElement("canvas").getContext
      ) {
        return false;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;

      // Chrome 157+ exposes drawHTML / drawWindow on CanvasRenderingContext2D
      if (typeof (ctx as any).drawHTML === "function") {
        return true;
      }

      // Alternative: check for drawWindow
      if (typeof (ctx as any).drawWindow === "function") {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  })();
  return htmlInCanvasProbe;
}

/**
 * Render HTML content into a canvas element using HTML-in-Canvas if supported,
 * falling back to returning null (caller should render HTML overlay instead).
 *
 * @param canvas - Target canvas element
 * @param htmlElement - HTML element to draw into canvas
 * @param x - X position
 * @param y - Y position
 * @param width - Width
 * @param height - Height
 * @returns True if HTML was drawn into canvas, false if fallback needed
 */
export async function drawHtmlIntoCanvas(
  canvas: HTMLCanvasElement,
  htmlElement: HTMLElement,
  x: number = 0,
  y: number = 0,
  width?: number,
  height?: number,
): Promise<boolean> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const w = width ?? htmlElement.offsetWidth;
  const h = height ?? htmlElement.offsetHeight;

  // Chrome 157+: drawHTML into canvas
  try {
    if (typeof (ctx as any).drawHTML === "function") {
      (ctx as any).drawHTML(htmlElement, x, y, w, h);
      return true;
    }
    if (typeof (ctx as any).drawWindow === "function") {
      (ctx as any).drawWindow(htmlElement, x, y, w, h);
      return true;
    }
  } catch {
    // Fall through to fallback
  }

  return false;
}
