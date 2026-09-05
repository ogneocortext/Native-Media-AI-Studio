import type { VizParams } from "./types";
import type { VisualizationStyle } from "./trackConceptAnalyzer";

export interface VisualPreset {
  id: string;
  name: string;
  description: string;
  genres: string[];
  vizParams: Partial<VizParams>;
  bgColor: string;
  meshColor: string;
  kineticPreset: string;
  visualizationStyle: VisualizationStyle;
  theatreValues?: Record<string, number>;
}

export const visualPresets: Record<string, VisualPreset> = {
  // ============================================================
  // PHONK / DRIFT — Aggressive, glitchy, high contrast
  // ============================================================
  phonk: {
    id: "phonk",
    name: "Phonk Drift",
    description: "Aggressive glitch with RGB split and high contrast",
    genres: ["phonk", "drift", "trap", "drift phonk"],
    vizParams: {
      scale: 1.4,
      scaleBoost: 2.0,
      rotationSpeed: 2.5,
      colorShift: 1.8,
      glowIntensity: 0.8,
      lerpSpeed: 0.6,
      materialType: "neon",
      wireframe: false,
      opacity: 0.95,
      shadowEnabled: false,
      reflectionEnabled: false,
      particleCount: 400,
      particleSize: 0.06,
      lightIntensity: 2.0,
      ambientColor: "#0a0008",
      fogEnabled: true,
      fogDensity: 0.04,
      showGround: false,
      showFloatingShapes: true,
      showLightRays: true,
      postfx: { bloom: 0.8, vignette: 0.6, glitch: 0.7 },
    },
    bgColor: "#050008",
    meshColor: "#ff0044",
    kineticPreset: "phonk",
    visualizationStyle: "geometric",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1, rotateZ: 0, skewX: -5, letterSpacing: 2, blur: 0 },
  },

  // ============================================================
  // SYNTHWAVE — Neon glow, retro aesthetics
  // ============================================================
  synthwave: {
    id: "synthwave",
    name: "Synthwave",
    description: "Neon glow with retro chrome aesthetics",
    genres: ["synthwave", "retro", "neon", "80s", "outrun"],
    vizParams: {
      scale: 1.3,
      scaleBoost: 1.6,
      rotationSpeed: 0.8,
      colorShift: 1.5,
      glowIntensity: 0.9,
      lerpSpeed: 0.3,
      materialType: "chrome",
      wireframe: false,
      opacity: 1.0,
      shadowEnabled: true,
      reflectionEnabled: true,
      particleCount: 200,
      particleSize: 0.03,
      lightIntensity: 1.5,
      ambientColor: "#1a0033",
      fogEnabled: true,
      fogDensity: 0.02,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: true,
      postfx: { bloom: 0.9, vignette: 0.4, glitch: 0.1 },
    },
    bgColor: "#0a001a",
    meshColor: "#ff00ff",
    kineticPreset: "synthwave",
    visualizationStyle: "cosmic",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 8, blur: 0 },
  },

  // ============================================================
  // AMBIENT / TRANCE — Ethereal, slow floating
  // ============================================================
  ambient: {
    id: "ambient",
    name: "Ambient Flow",
    description: "Ethereal floating with soft glow and slow motion",
    genres: ["ambient", "trance", "progressive", "ethereal", "space"],
    vizParams: {
      scale: 1.0,
      scaleBoost: 1.3,
      rotationSpeed: 0.3,
      colorShift: 0.8,
      glowIntensity: 0.6,
      lerpSpeed: 0.15,
      materialType: "glass",
      wireframe: false,
      opacity: 0.85,
      shadowEnabled: false,
      reflectionEnabled: true,
      particleCount: 500,
      particleSize: 0.02,
      lightIntensity: 0.8,
      ambientColor: "#000a1a",
      fogEnabled: true,
      fogDensity: 0.03,
      showGround: false,
      showFloatingShapes: true,
      showLightRays: false,
      postfx: { bloom: 0.6, vignette: 0.3, glitch: 0 },
    },
    bgColor: "#000510",
    meshColor: "#00ccff",
    kineticPreset: "ambient",
    visualizationStyle: "cosmic",
    theatreValues: { translateX: 0, translateY: 0, opacity: 0.9, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 4, blur: 2 },
  },

  // ============================================================
  // G-FUNK — Smooth, groovy, warm
  // ============================================================
  gfunk: {
    id: "gfunk",
    name: "West Coast G-Funk",
    description: "Smooth groovy bounce with warm sunset colors",
    genres: ["g-funk", "funk", "west coast", "smooth", "rap"],
    vizParams: {
      scale: 1.2,
      scaleBoost: 1.5,
      rotationSpeed: 0.6,
      colorShift: 1.2,
      glowIntensity: 0.5,
      lerpSpeed: 0.25,
      materialType: "metallic",
      wireframe: false,
      opacity: 1.0,
      shadowEnabled: true,
      reflectionEnabled: true,
      particleCount: 150,
      particleSize: 0.04,
      lightIntensity: 1.3,
      ambientColor: "#1a0a00",
      fogEnabled: true,
      fogDensity: 0.015,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: false,
      postfx: { bloom: 0.4, vignette: 0.5, glitch: 0 },
    },
    bgColor: "#1a0800",
    meshColor: "#ff8800",
    kineticPreset: "gfunk",
    visualizationStyle: "geometric",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1, rotateZ: -2, skewX: 0, letterSpacing: 3, blur: 0 },
  },

  // ============================================================
  // GRIME — Sharp, angular, fast
  // ============================================================
  grime: {
    id: "grime",
    name: "UK Grime",
    description: "Sharp angular entrance with fast cuts and high energy",
    genres: ["grime", "uk", "fast", "aggressive", "hip hop"],
    vizParams: {
      scale: 1.5,
      scaleBoost: 2.2,
      rotationSpeed: 3.0,
      colorShift: 2.0,
      glowIntensity: 0.7,
      lerpSpeed: 0.7,
      materialType: "neon",
      wireframe: true,
      opacity: 1.0,
      shadowEnabled: false,
      reflectionEnabled: false,
      particleCount: 350,
      particleSize: 0.05,
      lightIntensity: 1.8,
      ambientColor: "#0a0a00",
      fogEnabled: false,
      fogDensity: 0.01,
      showGround: false,
      showFloatingShapes: true,
      showLightRays: true,
      postfx: { bloom: 0.7, vignette: 0.7, glitch: 0.5 },
    },
    bgColor: "#080800",
    meshColor: "#ffff00",
    kineticPreset: "grime",
    visualizationStyle: "geometric",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1.1, rotateZ: 0, skewX: -8, letterSpacing: 1, blur: 0 },
  },

  // ============================================================
  // DUBSTEP — Heavy bass impact
  // ============================================================
  dubstep: {
    id: "dubstep",
    name: "Dubstep Impact",
    description: "Heavy bass-reactive with screen shake and distortion",
    genres: ["dubstep", "brostep", "bass", "heavy", "electronic"],
    vizParams: {
      scale: 1.6,
      scaleBoost: 2.5,
      rotationSpeed: 1.5,
      colorShift: 1.8,
      glowIntensity: 0.9,
      lerpSpeed: 0.8,
      materialType: "neon",
      wireframe: false,
      opacity: 1.0,
      shadowEnabled: false,
      reflectionEnabled: false,
      particleCount: 600,
      particleSize: 0.08,
      lightIntensity: 2.5,
      ambientColor: "#10000a",
      fogEnabled: true,
      fogDensity: 0.05,
      showGround: false,
      showFloatingShapes: true,
      showLightRays: true,
      postfx: { bloom: 1.0, vignette: 0.8, glitch: 0.6 },
    },
    bgColor: "#080008",
    meshColor: "#00ff44",
    kineticPreset: "dubstep",
    visualizationStyle: "geometric",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1.2, rotateZ: 0, skewX: 0, letterSpacing: 0, blur: 0 },
  },

  // ============================================================
  // LO-FI — Warm, gentle, nostalgic
  // ============================================================
  lofi: {
    id: "lofi",
    name: "Lo-Fi Warmth",
    description: "Warm gentle fade with nostalgic film grain feel",
    genres: ["lo-fi", "lofi", "chill", "warm", "nostalgic", "jazz"],
    vizParams: {
      scale: 1.0,
      scaleBoost: 1.2,
      rotationSpeed: 0.2,
      colorShift: 0.5,
      glowIntensity: 0.3,
      lerpSpeed: 0.15,
      materialType: "matte",
      wireframe: false,
      opacity: 0.9,
      shadowEnabled: true,
      reflectionEnabled: false,
      particleCount: 100,
      particleSize: 0.02,
      lightIntensity: 0.6,
      ambientColor: "#1a1410",
      fogEnabled: true,
      fogDensity: 0.02,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: false,
      postfx: { bloom: 0.2, vignette: 0.6, glitch: 0 },
    },
    bgColor: "#14100a",
    meshColor: "#cc8844",
    kineticPreset: "lofi",
    visualizationStyle: "cosmic",
    theatreValues: { translateX: 0, translateY: 0, opacity: 0.85, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 2, blur: 1 },
  },

  // ============================================================
  // CINEMATIC — Dramatic, orchestral
  // ============================================================
  cinematic: {
    id: "cinematic",
    name: "Cinematic",
    description: "Dramatic orchestral swells with wide elegant letters",
    genres: ["cinematic", "orchestral", "dramatic", "epic", "trailer"],
    vizParams: {
      scale: 1.3,
      scaleBoost: 1.8,
      rotationSpeed: 0.5,
      colorShift: 1.0,
      glowIntensity: 0.6,
      lerpSpeed: 0.2,
      materialType: "metallic",
      wireframe: false,
      opacity: 1.0,
      shadowEnabled: true,
      reflectionEnabled: true,
      particleCount: 300,
      particleSize: 0.03,
      lightIntensity: 1.5,
      ambientColor: "#0a0a1a",
      fogEnabled: true,
      fogDensity: 0.025,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: true,
      postfx: { bloom: 0.7, vignette: 0.6, glitch: 0 },
    },
    bgColor: "#050510",
    meshColor: "#ffffff",
    kineticPreset: "cinematic",
    visualizationStyle: "cosmic",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 12, blur: 0 },
  },

  // ============================================================
  // R&B — Smooth, sensual, warm
  // ============================================================
  rb: {
    id: "rb",
    name: "R&B Soul",
    description: "Smooth sensual flow with warm sunset glow and soft bloom",
    genres: ["r&b", "rnb", "soul", "neo-soul", "slow jam"],
    vizParams: {
      scale: 1.1,
      scaleBoost: 1.4,
      rotationSpeed: 0.5,
      colorShift: 1.1,
      glowIntensity: 0.5,
      lerpSpeed: 0.22,
      materialType: "glass",
      wireframe: false,
      opacity: 0.9,
      shadowEnabled: true,
      reflectionEnabled: true,
      particleCount: 180,
      particleSize: 0.03,
      lightIntensity: 1.2,
      ambientColor: "#120510",
      fogEnabled: true,
      fogDensity: 0.02,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: false,
      postfx: { bloom: 0.5, vignette: 0.4, glitch: 0 },
    },
    bgColor: "#0a0510",
    meshColor: "#ff77aa",
    kineticPreset: "cinematic",
    visualizationStyle: "waveform",
    theatreValues: { translateX: 0, translateY: 0, opacity: 0.95, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 6, blur: 0 },
  },

  // ============================================================
  // POP — Bright, polished, energetic
  // ============================================================
  pop: {
    id: "pop",
    name: "Pop Gloss",
    description: "Bright polished bounce with chrome shimmer and vibrant bloom",
    genres: ["pop", "dance-pop", "electropop", "k-pop", "j-pop"],
    vizParams: {
      scale: 1.2,
      scaleBoost: 1.6,
      rotationSpeed: 1.0,
      colorShift: 1.4,
      glowIntensity: 0.6,
      lerpSpeed: 0.35,
      materialType: "chrome",
      wireframe: false,
      opacity: 1.0,
      shadowEnabled: true,
      reflectionEnabled: true,
      particleCount: 220,
      particleSize: 0.04,
      lightIntensity: 1.6,
      ambientColor: "#0a001a",
      fogEnabled: true,
      fogDensity: 0.02,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: true,
      postfx: { bloom: 0.8, vignette: 0.3, glitch: 0.1 },
    },
    bgColor: "#080015",
    meshColor: "#ff00ff",
    kineticPreset: "synthwave",
    visualizationStyle: "pulse",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 5, blur: 0 },
  },

  // ============================================================
  // INDIE — Organic, warm, introspective
  // ============================================================
  indie: {
    id: "indie",
    name: "Indie Organic",
    description: "Warm introspective flow with soft aurora and gentle particles",
    genres: ["indie", "indie rock", "indie folk", "alternative", "folk"],
    vizParams: {
      scale: 1.0,
      scaleBoost: 1.3,
      rotationSpeed: 0.3,
      colorShift: 0.7,
      glowIntensity: 0.4,
      lerpSpeed: 0.18,
      materialType: "glass",
      wireframe: false,
      opacity: 0.85,
      shadowEnabled: false,
      reflectionEnabled: true,
      particleCount: 160,
      particleSize: 0.025,
      lightIntensity: 0.9,
      ambientColor: "#0f150a",
      fogEnabled: true,
      fogDensity: 0.025,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: false,
      postfx: { bloom: 0.4, vignette: 0.5, glitch: 0 },
    },
    bgColor: "#0a0d08",
    meshColor: "#88cc66",
    kineticPreset: "ambient",
    visualizationStyle: "aurora",
    theatreValues: { translateX: 0, translateY: 0, opacity: 0.9, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 3, blur: 1 },
  },

  // ============================================================
  // TRAP / METAL — Heavy, aggressive, dark
  // ============================================================
  trapMetal: {
    id: "trapMetal",
    name: "Trap Metal",
    description: "Heavy aggressive distortion with rising fire and screen shake",
    genres: ["trap metal", "trap-metal", "metal", "rap metal", "nu metal"],
    vizParams: {
      scale: 1.6,
      scaleBoost: 2.4,
      rotationSpeed: 2.0,
      colorShift: 1.9,
      glowIntensity: 0.9,
      lerpSpeed: 0.75,
      materialType: "neon",
      wireframe: false,
      opacity: 1.0,
      shadowEnabled: false,
      reflectionEnabled: false,
      particleCount: 650,
      particleSize: 0.09,
      lightIntensity: 2.8,
      ambientColor: "#120005",
      fogEnabled: true,
      fogDensity: 0.045,
      showGround: false,
      showFloatingShapes: true,
      showLightRays: true,
      postfx: { bloom: 1.0, vignette: 0.85, glitch: 0.7 },
    },
    bgColor: "#0a0005",
    meshColor: "#ff2200",
    kineticPreset: "dubstep",
    visualizationStyle: "inferno",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1.25, rotateZ: 0, skewX: 0, letterSpacing: 0, blur: 0 },
  },

  // ============================================================
  // DEFAULT — Balanced, works with any track
  // ============================================================
  balanced: {
    id: "balanced",
    name: "Balanced",
    description: "Balanced settings that work well with any track",
    genres: [],
    vizParams: {
      scale: 1.2,
      scaleBoost: 1.5,
      rotationSpeed: 1.0,
      colorShift: 1.0,
      glowIntensity: 0.5,
      lerpSpeed: 0.35,
      materialType: "standard",
      wireframe: false,
      opacity: 1.0,
      shadowEnabled: false,
      reflectionEnabled: false,
      particleCount: 250,
      particleSize: 0.04,
      lightIntensity: 1.2,
      ambientColor: "#1a1a2e",
      fogEnabled: false,
      fogDensity: 0.02,
      showGround: true,
      showFloatingShapes: true,
      showLightRays: false,
      postfx: { bloom: 0.5, vignette: 0.3, glitch: 0 },
    },
    bgColor: "#050505",
    meshColor: "#6366f1",
    kineticPreset: "cinematic",
    visualizationStyle: "geometric",
    theatreValues: { translateX: 0, translateY: 0, opacity: 1, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 4, blur: 0 },
  },
};

export const visualPresetList = Object.values(visualPresets);

/** Auto-select preset based on track name, genre, and analysis data */
export function selectVisualPreset(
  trackName: string,
  genre?: string,
  energy?: number,
  bpm?: number
): string {
  const name = trackName.toLowerCase();
  const g = (genre || "").toLowerCase();

  // Check by genre first
  for (const preset of visualPresetList) {
    if (preset.genres.some(pg => g.includes(pg) || name.includes(pg))) {
      return preset.id;
    }
  }

  // Check by track name keywords
  if (name.includes("phonk") || name.includes("drift")) return "phonk";
  if (name.includes("synthwave") || name.includes("neon") || name.includes("retro")) return "synthwave";
  if (name.includes("ambient") || name.includes("trance") || name.includes("space")) return "ambient";
  if (name.includes("g-funk") || name.includes("funk") || name.includes("west coast")) return "gfunk";
  if (name.includes("grime") || name.includes("uk")) return "grime";
  if (name.includes("dubstep") || name.includes("bass") || name.includes("heavy")) return "dubstep";
  if (name.includes("lo-fi") || name.includes("lofi") || name.includes("chill")) return "lofi";
  if (name.includes("cinematic") || name.includes("epic") || name.includes("trailer")) return "cinematic";
  if (name.includes("r&b") || name.includes("rnb") || name.includes("soul") || name.includes("neo-soul")) return "rb";
  if (name.includes("pop") || name.includes("dance-pop") || name.includes("electropop")) return "pop";
  if (name.includes("indie") || name.includes("indie rock") || name.includes("indie folk") || name.includes("alternative")) return "indie";
  if (name.includes("trap metal") || name.includes("trap-metal") || name.includes("nu metal")) return "trapMetal";

  // Fall back to energy/BPM-based selection
  if (energy !== undefined) {
    if (energy > 0.75) return "dubstep";
    if (energy > 0.6) return "grime";
    if (energy < 0.3) return "ambient";
    if (energy < 0.4) return "lofi";
  }

  if (bpm !== undefined) {
    if (bpm > 140) return "dubstep";
    if (bpm > 120) return "grime";
    if (bpm < 85) return "ambient";
    if (bpm < 100) return "lofi";
  }

  return "balanced";
}
