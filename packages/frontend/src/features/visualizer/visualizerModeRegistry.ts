/**
 * @module visualizerModeRegistry
 *
 * Central registry for Canvas2D visualizer modes.
 *
 * AI agents can register new visualizer modes here using registerVisualizerMode().
 * The registry is the single source of truth for mode metadata.
 */


/**
 * Canonical parameter shape accepted by every mode render function.
 */
export interface VisualizerModeRenderContext {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  w: number;
  h: number;
  canvas: HTMLCanvasElement | null;
  d: {
    bass: number;
    mid?: number;
    treble?: number;
    beat: boolean;
    beatPhase?: number | null;
    analyzedEnergy?: number;
    peak?: number;
    energy?: number;
  };
  syncLineProgress: number;
  sectionProgress: number;
  colors: string[];
  perceptualScale: "bark" | "erb" | "mel" | "linear" | undefined;
  freq: Uint8Array | null;
  wave: Uint8Array | null;
  bg: string;
  nowMs: () => number;
  analyser: AnalyserNode | null;
  motionScale: number;
  phraseFlash: number;
  energyMod: number;
  analyzedPunch: number;
  isDownbeat: boolean;
  rand: () => number;
  getGradients: (mode: string, cols: string[]) => CanvasGradient[];
  asymmetric: boolean;
}

/**
 * Persistent per-mode state. Mutated in-place by the render function.
 */
export interface VisualizerModeState {
  barValues?: number[];
  particles?: Array<{ x: number; y: number; vx: number; vy: number; size: number; color: string; life: number }>;
  [key: string]: unknown;
}

/**
 * Render function signature for a visualizer mode.
 */
export type VisualizerModeRenderFn = (
  ctx: CanvasRenderingContext2D,
  ctxInfo: VisualizerModeRenderContext,
  state: VisualizerModeState,
) => void;

/**
 * Optional lifecycle hooks.
 */
export interface VisualizerModeLifecycle {
  onInit?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  onDestroy?: () => void;
  onResize?: (w: number, h: number) => void;
}

/**
 * Declarative bridge config for linking visual modes to audio stems.
 */
export interface StemVisualBinding {
  stem: "vocals" | "drums" | "bass" | "other";
  param: string;
  range: [number, number];
  ease: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

/**
 * Full mode definition — the single source of truth for a visualizer mode.
 * AI agents create one of these per new mode.
 */
export interface VisualizerModeDef {
  id: string;
  label: string;
  shortLabel: string;
  category: "bars" | "waveform" | "radial" | "particles" | "spectral" | "abstract" | "geom";
  render: VisualizerModeRenderFn;
  lifecycle?: VisualizerModeLifecycle;
  defaultParams: Record<string, number | string | boolean>;
  paramSchema?: Record<
    string,
    {
      type: "number" | "color" | "boolean";
      min?: number;
      max?: number;
      step?: number;
      label: string;
      description?: string;
    }
  >;
  effects: readonly ("trails" | "phraseFlash" | "beatVignette" | "shockwaves")[];
  trailAlpha: number | null;
  trailAlphaReduced: number | null;
  description: string;
  tags: string[];
  stemBindings?: StemVisualBinding[];
  experimental?: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const MODE_REGISTRY: Map<string, VisualizerModeDef> = new Map();

export function registerVisualizerMode(def: VisualizerModeDef): VisualizerModeDef {
  if (MODE_REGISTRY.has(def.id)) {
    console.warn(`[VisualizerModeRegistry] Overwriting existing mode: ${def.id}`);
  }
  MODE_REGISTRY.set(def.id, def);
  return def;
}

export function getVisualizerMode(id: string): VisualizerModeDef | undefined {
  return MODE_REGISTRY.get(id);
}

export function getAllVisualizerModes(): VisualizerModeDef[] {
  return Array.from(MODE_REGISTRY.values());
}

export function getVisualizerModesByCategory(category: string): VisualizerModeDef[] {
  return Array.from(MODE_REGISTRY.values()).filter((m) => m.category === category);
}

export function getVisualizerModeCategories(): string[] {
  return Array.from(new Set(Array.from(MODE_REGISTRY.values()).map((m) => m.category)));
}

export function isVisualizerModeRegistered(id: string): boolean {
  return MODE_REGISTRY.has(id);
}

export function unregisterVisualizerMode(id: string): boolean {
  return MODE_REGISTRY.delete(id);
}

export function resetVisualizerModeRegistry(): void {
  MODE_REGISTRY.clear();
}

export function getVisualizerModeIds(): string[] {
  return Array.from(MODE_REGISTRY.keys());
}

export function getVisualizerModeLabel(id: string): string {
  const mode = MODE_REGISTRY.get(id);
  return mode ? mode.label : id;
}

export function getVisualizerModeOptions(): Array<{ value: string; label: string }> {
  return Array.from(MODE_REGISTRY.values()).map((m) => ({
    value: m.id,
    label: m.label,
  }));
}

export function createVisualizerModeDef(params: {
  id: string;
  label: string;
  shortLabel: string;
  category: VisualizerModeDef["category"];
  render: VisualizerModeRenderFn;
  description?: string;
  tags?: string[];
  defaultParams?: Record<string, number | string | boolean>;
  effects?: readonly ("trails" | "phraseFlash" | "beatVignette" | "shockwaves")[];
  trailAlpha?: number | null;
  trailAlphaReduced?: number | null;
  lifecycle?: VisualizerModeLifecycle;
  stemBindings?: VisualizerModeDef["stemBindings"];
}): VisualizerModeDef {
  return {
    id: params.id,
    label: params.label,
    shortLabel: params.shortLabel,
    category: params.category,
    render: params.render,
    description: params.description || "",
    tags: params.tags || [],
    defaultParams: params.defaultParams || {},
    effects: params.effects || [],
    trailAlpha: params.trailAlpha ?? null,
    trailAlphaReduced: params.trailAlphaReduced ?? null,
    lifecycle: params.lifecycle,
    stemBindings: params.stemBindings,
    experimental: false,
  };
}

export function isVisualizerModeDef(value: unknown): value is VisualizerModeDef {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as VisualizerModeDef).id === "string" &&
    typeof (value as VisualizerModeDef).label === "string" &&
    typeof (value as VisualizerModeDef).render === "function"
  );
}

export function getVisualizerModeRegistrySummary(): {
  totalModes: number;
  categories: string[];
  modes: Array<{
    id: string;
    label: string;
    shortLabel: string;
    category: string;
    description: string;
    tags: string[];
    effects: string[];
    hasTrails: boolean;
    paramCount: number;
  }>;
} {
  const modes = Array.from(MODE_REGISTRY.values()).map((m) => ({
    id: m.id,
    label: m.label,
    shortLabel: m.shortLabel,
    category: m.category,
    description: m.description,
    tags: m.tags,
    effects: Array.from(m.effects),
    hasTrails: m.trailAlpha !== null,
    paramCount: Object.keys(m.defaultParams).length,
  }));

  return {
    totalModes: modes.length,
    categories: getVisualizerModeCategories(),
    modes,
  };
}
