/**
 * @module visualizerModeTemplate
 *
 * Template/boilerplate for creating new Canvas2D visualizer modes.
 *
 * AI AGENT GUIDE:
 *   Copy this file to `viz-styles/your-mode-name.ts`, implement the render
 *   function, and register it via registerVisualizerMode().
 *
 *   Render function signature:
 *     (ctx: CanvasRenderingContext2D, ctxInfo: VisualizerModeRenderContext, state: VisualizerModeState) => void
 */

import type { VisualizerModeRenderContext, VisualizerModeState } from "./visualizerModeRegistry";
import { createVisualizerModeDef, registerVisualizerMode } from "./visualizerModeRegistry";

// ---------------------------------------------------------------------------
// Example: Simple pulse circle that grows on beat and decays.
// ---------------------------------------------------------------------------

/** Per-mode scratch fields this example persists on the shared state bag. */
interface ExampleModeState extends VisualizerModeState {
  circleRadius?: number;
  circleAlpha?: number;
  lastBeat?: boolean;
}

function renderExampleMode(
  ctx: CanvasRenderingContext2D,
  ctxInfo: VisualizerModeRenderContext,
  state: VisualizerModeState,
): void {
  const { w, h, d } = ctxInfo;
  const s = state as ExampleModeState;

  if (s.circleRadius === undefined || s.circleAlpha === undefined || s.lastBeat === undefined) {
    s.circleRadius = 0;
    s.circleAlpha = 0;
    s.lastBeat = false;
  }

  const isBeat = d.beat;

  if (isBeat && !s.lastBeat) {
    s.circleRadius = w * 0.4;
    s.circleAlpha = 0.8;
  }
  s.lastBeat = isBeat;

  s.circleRadius *= 0.95;
  s.circleAlpha *= 0.92;

  ctx.fillStyle = `rgba(0, 255, 255, ${Math.max(0, s.circleAlpha)})`;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, s.circleRadius, 0, Math.PI * 2);
  ctx.fill();

  if (isBeat && s.circleRadius > w * 0.35) {
    ctx.strokeStyle = `rgba(255, 100, 50, ${s.circleAlpha * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, s.circleRadius * 1.2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export const exampleModeDef = createVisualizerModeDef({
  id: "example-mode",
  label: "Example Mode",
  shortLabel: "Example",
  category: "abstract",
  render: renderExampleMode,
  description: "Example mode showing the API. Use this as a template for new modes.",
  tags: ["example", "template"],
  defaultParams: {
    color: "#00ffff",
    maxRadius: 0.4,
    decayRate: 0.95,
  },
  effects: ["beatVignette"],
  trailAlpha: null,
  trailAlphaReduced: null,
});

registerVisualizerMode(exampleModeDef);
