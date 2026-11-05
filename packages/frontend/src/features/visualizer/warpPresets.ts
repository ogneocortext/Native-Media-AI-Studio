/**
 * Warp presets for the feedback-driven shader lane (T-VIZ-20).
 *
 * Each preset is pure data — no code branches — describing how the
 * feedback buffer warps each frame (zoom, rotation, decay, swirl,
 * radial flow), which draw elements are active, and how strongly each
 * audio band drives the warp. The ShaderVisualizer cycles through
 * presets on section boundaries; transitions ride the feedback buffer
 * so there is never a hard cut.
 */

export type DrawElement = "grid" | "dots" | "rings" | "spiral" | "pulse";

export interface AudioGains {
  /** 0..1 multiplier for the bass band (sub/kick energy) */
  bass: number;
  /** 0..1 multiplier for the mid band (vocals/guitar body) */
  mid: number;
  /** 0..1 multiplier for the treble band (hi-hats/cymbals) */
  treble: number;
  /** 0..1 multiplier for transient/onset energy */
  transient: number;
  /** 0..1 multiplier for overall energy */
  energy: number;
}

export interface WarpPreset {
  /** Stable preset id, used for persistence and UI selection */
  id: string;
  /** Human-readable name shown in the preset selector */
  name: string;
  /** One-line description of the mood */
  description: string;
  // ── Feedback warp params (applied per frame in ShaderCanvas) ──
  /** Per-frame zoom factor: 1.0 = none, >1 = zoom in, <1 = zoom out */
  zoom: number;
  /** Per-frame rotation in radians */
  rotation: number;
  /** Per-frame decay/fade: 0.95 = slow fade, 0.99 = long trails */
  decay: number;
  /** Swirl intensity: radians of extra rotation per unit distance
   *  from center. 0 = off, >0 = vortex spinning faster at edges */
  swirl: number;
  /** Radial flow: push/pull from center. -1 = pull inward, +1 = push
   *  outward, 0 = none */
  radial: number;
  // ── Palette ──
  /** Hex colors used by the draw elements */
  palette: readonly string[];
  // ── Draw elements ──
  /** Which visual elements the preset draws (drawn by ShaderCanvas) */
  drawElements: readonly DrawElement[];
  // ── Audio-response gains ──
  /** How strongly each audio band modulates the warp (0..1) */
  audioGains: AudioGains;
}

/** Swirl/radial values are per-frame. Audio-driven values are computed
 *  in ShaderVisualizer as: bandValue * audioGains.band * dt, so the
 *  warp strength scales with both the preset's gain and the live band. */

// ── 6 starter presets, calm → aggressive ──
export const WARP_PRESETS = [
  {
    id: "deepCalm",
    name: "Deep Calm",
    description: "Slow, subtle feedback — meditative and spacious",
    zoom: 1.001,
    rotation: 0.0005,
    decay: 0.99,
    swirl: 0.0,
    radial: 0.0,
    palette: ["#0a192f", "#172a45", "#233554", "#8892b0"],
    drawElements: ["rings"],
    audioGains: { bass: 0.3, mid: 0.2, treble: 0.1, transient: 0.2, energy: 0.4 },
  },
  {
    id: "glassWater",
    name: "Glass Water",
    description: "Gentle inward pull with soft swirl — liquid and fluid",
    zoom: 1.002,
    rotation: -0.001,
    decay: 0.98,
    swirl: 0.3,
    radial: -0.1,
    palette: ["#4cc9f0", "#48cae4", "#00b4d8", "#0077b6"],
    drawElements: ["dots", "rings"],
    audioGains: { bass: 0.4, mid: 0.4, treble: 0.3, transient: 0.3, energy: 0.5 },
  },
  {
    id: "neonPulse",
    name: "Neon Pulse",
    description: "Moderate energy with steady rotation and outward flow",
    zoom: 1.004,
    rotation: 0.002,
    decay: 0.96,
    swirl: 0.6,
    radial: 0.2,
    palette: ["#00f2ff", "#0096c7", "#bc13fe", "#7000ff"],
    drawElements: ["grid", "dots", "pulse"],
    audioGains: { bass: 0.6, mid: 0.5, treble: 0.6, transient: 0.5, energy: 0.7 },
  },
  {
    id: "copperSpiral",
    name: "Copper Spiral",
    description: "Strong vortex swirl with warm metallic palette",
    zoom: 1.006,
    rotation: 0.003,
    decay: 0.94,
    swirl: 1.0,
    radial: 0.4,
    palette: ["#b8860b", "#daa520", "#cd853f", "#de8f3c"],
    drawElements: ["spiral", "rings", "pulse"],
    audioGains: { bass: 0.8, mid: 0.6, treble: 0.4, transient: 0.7, energy: 0.8 },
  },
  {
    id: "plasmaStorm",
    name: "Plasma Storm",
    description: "Aggressive radial outward flow with intense swirl",
    zoom: 1.010,
    rotation: 0.005,
    decay: 0.92,
    swirl: 1.5,
    radial: 0.7,
    palette: ["#ff00cc", "#3333ff", "#00ccff", "#ccff00"],
    drawElements: ["grid", "spiral", "pulse"],
    audioGains: { bass: 0.9, mid: 0.7, treble: 0.8, transient: 0.9, energy: 0.9 },
  },
  {
    id: "singularity",
    name: "Singularity",
    description: "Maximum warp — extreme zoom, rotation, swirl, radial",
    zoom: 1.015,
    rotation: 0.008,
    decay: 0.90,
    swirl: 2.0,
    radial: 1.0,
    palette: ["#ffffff", "#ffff00", "#ff0000", "#000000"],
    drawElements: ["grid", "dots", "rings", "spiral", "pulse"],
    audioGains: { bass: 1.0, mid: 0.9, treble: 0.9, transient: 1.0, energy: 1.0 },
  },
] as const satisfies readonly WarpPreset[];

export type WarpPresetId = (typeof WARP_PRESETS)[number]["id"];

/** Look up a preset by id. Falls back to deepCalm. */
export function getWarpPreset(id: string): WarpPreset {
  return WARP_PRESETS.find((p) => p.id === id) ?? WARP_PRESETS[0];
}

/** All preset ids in calm→aggressive order. */
export function getWarpPresetIds(): WarpPresetId[] {
  return WARP_PRESETS.map((p) => p.id);
}

/** Next preset in the calm→aggressive sequence, wrapping around. */
export function nextWarpPresetId(currentId: string): WarpPresetId {
  const ids = getWarpPresetIds();
  const idx = ids.indexOf(currentId as WarpPresetId);
  const nextIdx = idx >= 0 ? (idx + 1) % ids.length : 0;
  return ids[nextIdx];
}

/** Previous preset in the calm→aggressive sequence, wrapping around. */
export function prevWarpPresetId(currentId: string): WarpPresetId {
  const ids = getWarpPresetIds();
  const idx = ids.indexOf(currentId as WarpPresetId);
  const prevIdx = idx >= 0 ? (idx + ids.length - 1) % ids.length : 0;
  return ids[prevIdx];
}
