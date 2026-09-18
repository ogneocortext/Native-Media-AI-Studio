import type { ShaderPresetName } from "./shaders";

/**
 * Maps track names to their ideal shader preset based on mood/genre.
 * Falls back to abstractWaves for unknown tracks.
 */
const TRACK_SHADER_MAP: Record<string, ShaderPresetName> = {
  // The Signal Breaking Through the Noise → electric blue horizon
  "The Signal Breaking Through the Noise": "electricHorizon",
  "The Signal breaking through the Noise (variation)": "electricHorizon",

  // Before the Fade → foggy noir
  "Before the Fade": "foggyNoir",
  "Still I Rise (variation)": "foggyNoir",

  // Borrowed Flame → West Coast sunset
  "Borrowed Flame": "westCoastSunset",
  "I Won't Ride with the Choir (variation)": "westCoastSunset",

  // Take the Crown → fire crown
  "Take the Crown": "fireCrown",
  "Built by Fire (same prompt as #7, different lyric take)": "fireCrown",

  // System Override → neon grid
  "System Override": "neonGrid",

  // Learning How to Stay → neon rain
  "Learning How to Stay": "neonRain",
  "Learning How to Stay V2 (variation)": "neonRain",
  "NeoCortext - Learning How to Stay V2": "neonRain",
};

/**
 * Get the best shader preset for a track by name.
 * Uses fuzzy matching to handle variations in naming.
 */
export function getShaderPresetForTrack(trackName: string): ShaderPresetName {
  // Blank name (initial mount before a track is selected): neutral default.
  // Without this, `"".includes` vacuity matches the first map entry and the
  // canvas flashes the wrong preset, then recompiles on selection.
  if (!trackName || !trackName.trim()) return "abstractWaves";

  // Normalize: strip artist prefix ("Artist - Track" → "Track") so fuzzy
  // matching works for library filenames that include the artist name.
  const normalized = trackName.split(" - ").slice(-1)[0].trim();

  // Exact match on normalized name
  if (TRACK_SHADER_MAP[normalized]) return TRACK_SHADER_MAP[normalized];

  // Exact match on original name (fallback for bare track names)
  if (TRACK_SHADER_MAP[trackName]) return TRACK_SHADER_MAP[trackName];

  // Fuzzy match by checking if any key is contained in the normalized track name
  const lower = normalized.toLowerCase();
  for (const [key, preset] of Object.entries(TRACK_SHADER_MAP)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return preset;
    }
  }

  // Keyword-based fallback
  if (lower.includes("signal") || lower.includes("noise") || lower.includes("horizon")) return "electricHorizon";
  if (lower.includes("fade") || lower.includes("noir") || lower.includes("fog")) return "foggyNoir";
  if (lower.includes("rain") || lower.includes("cyberpunk") || lower.includes("neon")) return "neonRain";
  if (lower.includes("grid") || lower.includes("system") || lower.includes("override") || lower.includes("glitch")) return "neonGrid";
  if (lower.includes("fire") || lower.includes("crown") || lower.includes("burn") || lower.includes("flame")) return "fireCrown";
  if (lower.includes("west") || lower.includes("coast") || lower.includes("g-funk") || lower.includes("sunset")) return "westCoastSunset";

  return "abstractWaves";
}

export interface ShaderPresetFxDefaults {
  speed?: number;
  brightness?: number;
  contrast?: number;
  hue?: number;
  saturation?: number;
}

export const SHADER_PRESET_INFO: Record<ShaderPresetName, { name: string; description: string; bestFor: string; fxDefaults?: ShaderPresetFxDefaults }> = {
  electricHorizon: { name: "Electric Horizon", description: "Dawn landscape with electric blue signal waves", bestFor: "Progressive Trance, Euphoric", fxDefaults: { brightness: 1.1, saturation: 1.1 } },
  foggyNoir: { name: "Foggy Noir", description: "Layered fog with warm sub-bass glow", bestFor: "Future-garage, Nocturnal", fxDefaults: { brightness: 0.9, contrast: 1.15, saturation: 0.85 } },
  neonRain: { name: "Neon Rain", description: "Rain-soaked neon reflections, cyberpunk", bestFor: "Neo-noir, Cyberpunk Synth", fxDefaults: { brightness: 1.15, saturation: 1.2 } },
  neonGrid: { name: "Neon Grid", description: "Retro-futuristic grid with glitch effects", bestFor: "Dubstep, Synthwave", fxDefaults: { contrast: 1.2, saturation: 1.15 } },
  fireCrown: { name: "Fire Crown", description: "Rising flames with ember particles", bestFor: "Drift Phonk, Triumphant", fxDefaults: { brightness: 1.1, saturation: 1.1 } },
  westCoastSunset: { name: "West Coast Sunset", description: "Sunset gradient with palm silhouettes", bestFor: "G-Funk, Laid-back", fxDefaults: { brightness: 1.05, saturation: 1.1 } },
  abstractWaves: { name: "Abstract Waves", description: "Flowing waveform interference patterns", bestFor: "Any genre" },
};
