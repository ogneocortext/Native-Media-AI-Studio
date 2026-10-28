/**
 * HTMLCanvasRenderer — draws HTML content into a canvas when HTML-in-Canvas is
 * supported (Chrome 157+), falling back to a DOM overlay otherwise.
 *
 * Usage:
 *   <HtmlCanvasRenderer canvasRef={canvasRef} x={0} y={0}>
 *     <div className="text-white/80 text-[24px] font-semibold">
 *       {sync?.currentSection?.toUpperCase() || "—"}
 *     </div>
 *   </HtmlCanvasRenderer>
 *
 * When HTML-in-Canvas is supported (Chrome 157+), the HTML children are drawn
 * directly into the canvas context each frame.
 *
 * When not supported (Chrome 156 and earlier), the HTML children are shown as
 * a positioned overlay div above the canvas instead.
 */

import { useEffect, useRef, useState } from "react";
import { detectHtmlInCanvasSupport, drawHtmlIntoCanvas } from "./htmlCanvasDetector";

export interface HtmlCanvasRendererProps {
  /** The canvas element to draw into */
  canvas: HTMLCanvasElement | null;
  /** X position to draw the HTML at (canvas coordinates) */
  x?: number;
  /** Y position to draw the HTML at (canvas coordinates) */
  y?: number;
  /** Width to draw (defaults to canvas offsetWidth) */
  width?: number;
  /** Height to draw (defaults to canvas offsetHeight) */
  height?: number;
  /** HTML children to render */
  children: React.ReactNode;
}

export function HtmlCanvasRenderer({
  canvas,
  x = 0,
  y = 0,
  width,
  height,
  children,
}: HtmlCanvasRendererProps) {
  const [supported, setSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const rafRef = useRef<number>(0);
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!canvas) return;

    detectHtmlInCanvasSupport().then((supports) => {
      setSupported(supports);
      setReady(true);
    });
  }, [canvas]);

  useEffect(() => {
    if (!ready || !supported || !canvas || !elementRef.current) return;

    const draw = () => {
      drawHtmlIntoCanvas(canvas, elementRef.current!, x, y, width, height);
      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, supported, canvas, x, y, width, height, children]);

  // When HTML-in-Canvas is not supported, render children as an overlay div
  if (!ready || !supported) {
    if (!canvas) return null;

    return (
      <div
        ref={elementRef}
        style={{
          position: "absolute",
          left: x,
          y,
          width: width ?? canvas!.offsetWidth,
          height: height ?? canvas!.offsetHeight,
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {children}
      </div>
    );
  }

  // When HTML-in-Canvas is supported, children are drawn into canvas each
  // frame — no overlay needed. Still need to mount children so they exist
  // in the DOM for drawHtmlIntoCanvas to read from, but keep them hidden.
      return (
        <div
          ref={elementRef}
          style={{
            position: "absolute",
            left: x,
            y,
            width: width ?? canvas?.offsetWidth,
            height: height ?? canvas?.offsetHeight,
            pointerEvents: "none",
            zIndex: 10,
            visibility: "hidden",
          }}
        >
          {children}
        </div>
      );
}
