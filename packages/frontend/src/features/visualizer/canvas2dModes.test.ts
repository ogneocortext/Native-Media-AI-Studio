import { describe, it, expect } from "vitest";
import { renderBars, renderMirroredBars, type BarModeContext, type BarModeState } from "./canvas2dModes";

/**
 * Regression coverage for the T-VIZ-38 bar fixes:
 *  - peak indicators must hold a high-water mark and decay (PEAK_DECAY),
 *    so after a spectral drop the white tick floats ABOVE the bar top
 *    instead of being pinned to it every frame;
 *  - reflections must hang below the bar baseline inside the canvas,
 *    not at `h + 2*dpr` offscreen.
 *
 * The ctx is a call recorder — renderBars only needs the Canvas2D method
 * surface, and the peak tick is identifiable by its exact fillStyle
 * ("rgba(255,255,255,0.85)"), which no other draw call in these modes uses.
 */
/* eslint-disable @typescript-eslint/no-empty-function -- canvas mock stubs */

interface RecordedCall {
  kind: "roundRect" | "fillRect";
  args: number[];
  alpha: number;
  fill: unknown;
}

function makeRecorder() {
  const calls: RecordedCall[] = [];
  const alphaStack: number[] = [];
  let globalAlpha = 1;
  let fillStyle: unknown = "";
  const noop = () => {};
  const ctx = {
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(v: number) {
      globalAlpha = v;
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: unknown) {
      fillStyle = v;
    },
    get globalCompositeOperation() {
      return "source-over";
    },
    set globalCompositeOperation(_v: string) {},
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clearRect: noop,
    strokeRect: noop,
    save() {
      alphaStack.push(globalAlpha);
    },
    restore() {
      const prev = alphaStack.pop();
      if (prev !== undefined) globalAlpha = prev;
    },
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 0 }),
    setLineDash: noop,
    createLinearGradient: () => ({}),
    createRadialGradient: () => ({}),
    createPattern: () => ({}),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData: noop,
    roundRect(x: number, y: number, w: number, h: number) {
      calls.push({ kind: "roundRect", args: [x, y, w, h], alpha: globalAlpha, fill: fillStyle });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ kind: "fillRect", args: [x, y, w, h], alpha: globalAlpha, fill: fillStyle });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function makeModeCtx(ctx: CanvasRenderingContext2D, freq: Uint8Array): BarModeContext {
  return {
    ctx,
    dpr: 1,
    w: 800,
    h: 600,
    canvas: null,
    d: { bass: 0, treble: 0, beat: false, beatPhase: null },
    syncLineProgress: 0,
    sectionProgress: 0,
    colors: ["#ff0044", "#00ff88", "#4488ff"],
    perceptualScale: undefined,
    freq,
    wave: null,
    bg: "#000000",
    nowMs: () => 0,
    analyser: null,
    motionScale: 1,
    phraseFlash: 0,
    energyMod: 1,
    analyzedPunch: 0,
    isDownbeat: false,
    rand: () => 0.5,
    getGradients: () => [{}, {}, {}] as unknown as CanvasGradient[],
  };
}

function makeState(): BarModeState {
  return {
    barVelocities: null,
    barPeaks: null,
    smoothedBars: null,
    waveEnvelope: null,
    waveVelocities: null,
    smoothed: null,
    particles: [],
    lastMs: null,
  };
}

const BAR_COUNT = 64;
const W = 800;
const H = 600;
const BAR_W = W / BAR_COUNT;

/** Per-bar topmost white tick y and topmost solid bar y from one frame's calls. */
function barGeometry(calls: RecordedCall[]) {
  const tickY = new Map<number, number>();
  const barTop = new Map<number, number>();
  const reflections: { y: number; h: number }[] = [];
  for (const c of calls) {
    const barIdx = Math.round((c.args[0] - 1) / BAR_W);
    if (c.kind === "fillRect" && c.fill === "rgba(255,255,255,0.85)") {
      const prev = tickY.get(barIdx);
      if (prev === undefined || c.args[1] < prev) tickY.set(barIdx, c.args[1]);
    } else if (c.kind === "roundRect") {
      if (c.alpha === 0.18) {
        reflections.push({ y: c.args[1], h: c.args[3] });
      } else if (c.alpha === 1) {
        const prev = barTop.get(barIdx);
        if (prev === undefined || c.args[1] < prev) barTop.set(barIdx, c.args[1]);
      }
    }
  }
  return { tickY, barTop, reflections };
}

describe("renderBars peak indicators and reflections (T-VIZ-38)", () => {
  it("holds the peak above the bar after a spectral drop, then reflections stay on-canvas", () => {
    const freq = new Uint8Array(1024);
    const state = makeState();

    // Frame 1: loud across the spectrum — bars tall, peaks = bar tops.
    freq.fill(255);
    let rec = makeRecorder();
    renderBars(1, W, H, makeModeCtx(rec.ctx, freq), state);

    // Frames 2-4: spectrum collapses — bars shrink, peaks must decay slowly.
    freq.fill(10);
    for (let f = 0; f < 3; f++) {
      rec = makeRecorder();
      renderBars(1, W, H, makeModeCtx(rec.ctx, freq), state);
    }

    const { tickY, barTop, reflections } = barGeometry(rec.calls);
    expect(tickY.size).toBe(BAR_COUNT);
    expect(barTop.size).toBe(BAR_COUNT);

    // At least one bar's tick must sit clearly above its bar top — proof the
    // high-water mark is held instead of pinned to the current height.
    let floating = 0;
    for (const [i, ty] of tickY) {
      const bt = barTop.get(i);
      if (bt !== undefined && ty < bt - 3) floating++;
    }
    expect(floating).toBeGreaterThan(0);

    // Every reflection's top edge must be inside the canvas (old bug put it
    // at h + 2*dpr, fully clipped).
    expect(reflections.length).toBeGreaterThan(0);
    for (const r of reflections) {
      expect(r.y).toBeLessThan(H);
    }
  });
});

describe("renderMirroredBars peak indicators (T-VIZ-38)", () => {
  it("decays the upper peak toward the bar after a spectral drop", () => {
    const freq = new Uint8Array(1024);
    const state = makeState();

    freq.fill(255);
    let rec = makeRecorder();
    renderMirroredBars(1, W, H, makeModeCtx(rec.ctx, freq), state);

    freq.fill(10);
    for (let f = 0; f < 3; f++) {
      rec = makeRecorder();
      renderMirroredBars(1, W, H, makeModeCtx(rec.ctx, freq), state);
    }

    const { tickY, barTop } = barGeometry(rec.calls);
    expect(tickY.size).toBe(BAR_COUNT);
    expect(barTop.size).toBe(BAR_COUNT);

    let floating = 0;
    for (const [i, ty] of tickY) {
      const bt = barTop.get(i);
      if (bt !== undefined && ty < bt - 3) floating++;
    }
    expect(floating).toBeGreaterThan(0);
  });
});
