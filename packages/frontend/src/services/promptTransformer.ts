/**
 * Music-to-Visual Prompt Transformer
 *
 * Converts music generation prompts (from Suno, Udio, etc.) into
 * optimized visual generation prompts for ComfyUI.
 */

export interface MusicPromptAnalysis {
  genre: string[];
  mood: string[];
  energy: "high" | "medium" | "low";
  tempo: "fast" | "medium" | "slow";
  instruments: string[];
  themes: string[];
  era?: string;
  rawPrompt: string;
}

export interface VisualPromptResult {
  positive: string;
  negative: string;
  style: string;
  recommendedResolution: { width: number; height: number };
  recommendedSteps: number;
  recommendedCfg: number;
}

// Genre-to-visual mappings
const GENRE_VISUAL_MAP: Record<string, string[]> = {
  synthwave: ["neon grids", "retro-futuristic", "chrome", "sunset gradients", "80s aesthetic", "cyberpunk cityscapes"],
  electronic: ["particle systems", "geometric patterns", "LED arrays", "holographic", "digital art", "data streams"],
  "hip hop": ["urban landscapes", "graffiti art", "street culture", "gold chains", "boom box", "city nights"],
  rock: ["electric guitars", "stages", "crowds", "smoke", "spotlights", "amplifiers", "energy"],
  jazz: ["smoke-filled rooms", "saxophones", "piano keys", "vinyl records", "dim lighting", "sophistication"],
  classical: ["orchestras", "concert halls", "violins", "pianos", "elegant", "symphony", "formal attire"],
  ambient: ["nature", "underwater", "clouds", "mist", "ethereal", "space", "floating"],
  pop: ["colorful", "bright", "dancing", "confetti", "stages", "crowds", "vibrant"],
  metal: ["dark", "fire", "skulls", "heavy", "aggressive", "lightning", "demonic"],
  folk: ["acoustic", "nature", "wooden", "campfires", "mountains", "fields", "handcrafted"],
  rnb: ["smooth", "silk", "city lights", "sensual", "elegant", "night", "chill"],
  reggae: ["tropical", "islands", "rasta colors", "peace", "sunshine", "palm trees", "latin"],
  country: ["deserts", "trucks", "hats", "barns", "fields", "sunset", "americana"],
  latin: ["tropical", "colorful", "dance", "rhythm", "festival", "passion", "warm"],
  indie: ["lo-fi", "vintage", "grainy", "nostalgic", "artistic", "experimental", "moody"],
  punk: ["rebellion", "leather", "mosh pits", "anarchy", "graffiti", "raw", "diy"],
  soul: ["warm", "golden", "vintage microphones", "heartfelt", "gospel", "emotion", "classic"],
};

// Mood-to-visual mappings
const MOOD_VISUAL_MAP: Record<string, string[]> = {
  happy: ["bright colors", "sunshine", "smiling", "warm light", "open spaces"],
  sad: ["rain", "blue tones", "melancholy", "empty spaces", "overcast"],
  energetic: ["explosions", "fast motion", "vibrant colors", "dynamic angles", "high contrast"],
  calm: ["soft light", "gentle motion", "pastel colors", "stillness", "peaceful"],
  dark: ["shadows", "low key", "noir", "mysterious", "dramatic lighting"],
  dreamy: ["soft focus", "bokeh", "ethereal", "clouds", "floating", "pastel"],
  aggressive: ["sharp angles", "harsh lighting", "intense colors", "motion blur", "power"],
  romantic: ["warm tones", "soft focus", "candles", "sunset", "couples", "intimate"],
  nostalgic: ["vintage", "film grain", "sepia", "retro", "aged", "memories"],
  epic: ["vast landscapes", "dramatic skies", "god rays", "monumental", "cinematic"],
  mysterious: ["fog", "shadows", "moonlight", "hidden", "enigmatic", "low key"],
  uplifting: ["bright", "ascending", "sunrise", "hope", "open skies", "flying"],
};

// Instrument-to-visual mappings
const INSTRUMENT_VISUAL_MAP: Record<string, string[]> = {
  piano: ["piano keys", "ivory", "concert grand", "reflections"],
  guitar: ["acoustic guitar", "strings", "wood", "fingerpicking"],
  drums: ["drum kit", "cymbals", "sticks", "rhythm"],
  bass: ["bass guitar", "low frequencies", "vibration", "subwoofer"],
  synthesizer: ["synthesizer", "retro", "analog", "knobs", "patch cables", "synth pads", "waveforms", "oscillators", "modular"],
  violin: ["violin", "bow", "strings", "classical"],
  saxophone: ["saxophone", "brass", "jazz club", "golden"],
  trumpet: ["trumpet", "brass", "shining", "bold"],
  flute: ["flute", "woodwind", "breath", "flowing"],
};

const ERA_VISUAL_MAP: Record<string, string> = {
  "50s": "1950s aesthetic, vintage Americana, retro diner, chrome details, pastel colors",
  "60s": "1960s psychedelic, pop art, bold patterns, vintage color palette, flower power",
  "70s": "1970s disco, funk aesthetic, warm tones, shag carpet, retro futurism",
  "80s": "1980s synthwave, neon, VHS aesthetic, retro technology, bold gradients",
  "90s": "1990s grunge, lo-fi, analog, vintage TV, distressed textures",
  "2000s": "Y2K aesthetic, digital, chrome, futuristic, early internet",
  "2010s": "modern minimalist, clean, social media aesthetic, flat design",
  "2020s": "contemporary, AI-generated, hyperrealistic, cutting-edge, sleek",
};

/**
 * Analyze a music generation prompt to extract key characteristics.
 */
export function analyzeMusicPrompt(prompt: string): MusicPromptAnalysis {
  const lower = prompt.toLowerCase();
  const words = lower.split(/[\s,;.]+/);

  // Detect genre
  const genres: string[] = [];
  for (const genre of Object.keys(GENRE_VISUAL_MAP)) {
    if (lower.includes(genre)) {
      genres.push(genre);
    }
  }

  // Detect mood
  const moods: string[] = [];
  for (const mood of Object.keys(MOOD_VISUAL_MAP)) {
    if (lower.includes(mood)) {
      moods.push(mood);
    }
  }

  // Detect instruments
  const instruments: string[] = [];
  for (const instrument of Object.keys(INSTRUMENT_VISUAL_MAP)) {
    if (lower.includes(instrument)) {
      instruments.push(instrument);
    }
  }

  // Detect energy level
  const highEnergyWords = ["fast", "upbeat", "energetic", "intense", "aggressive", "hard", "heavy", "banger", "hype"];
  const lowEnergyWords = ["slow", "calm", "peaceful", "ambient", "chill", "relaxing", "soft", "gentle", "mellow"];
  let energyScore = 0;
  for (const word of words) {
    if (highEnergyWords.some(w => word.includes(w))) energyScore++;
    if (lowEnergyWords.some(w => word.includes(w))) energyScore--;
  }
  const energy: "high" | "medium" | "low" = energyScore > 1 ? "high" : energyScore < -1 ? "low" : "medium";

  // Detect tempo
  const fastWords = ["fast", "upbeat", "quick", "rapid", "high bpm", "fast tempo"];
  const slowWords = ["slow", "downtempo", "ballad", "low bpm", "slow tempo", "laid back"];
  let tempoScore = 0;
  for (const word of words) {
    if (fastWords.some(w => word.includes(w))) tempoScore++;
    if (slowWords.some(w => word.includes(w))) tempoScore--;
  }
  const tempo: "fast" | "medium" | "slow" = tempoScore > 0 ? "fast" : tempoScore < 0 ? "slow" : "medium";

  // Detect themes
  const themeKeywords = ["love", "heartbreak", "party", "dance", "night", "dream", "rebellion", "freedom", "nostalgia", "hope", "fear", "joy", "anger", "peace", "war", "nature", "city", "space", "ocean", "mountain"];
  const themes: string[] = [];
  for (const theme of themeKeywords) {
    if (lower.includes(theme)) {
      themes.push(theme);
    }
  }

  // Detect era
  let era: string | undefined;
  for (const e of Object.keys(ERA_VISUAL_MAP)) {
    if (lower.includes(e)) {
      era = e;
      break;
    }
  }

  return {
    genre: genres.length > 0 ? genres : ["electronic"],
    mood: moods.length > 0 ? moods : ["neutral"],
    energy,
    tempo,
    instruments,
    themes,
    era,
    rawPrompt: prompt,
  };
}

/**
 * Transform a music generation prompt into an optimized visual prompt.
 */
export function transformMusicToVisualPrompt(
  musicPrompt: string,
  trackName: string,
  options?: {
    style?: "cinematic" | "abstract" | "geometric" | "nature" | "glitch" | "minimal" | "surreal";
    duration?: number;
  }
): VisualPromptResult {
  const analysis = analyzeMusicPrompt(musicPrompt);
  const style = options?.style || selectBestStyle(analysis);

  // Build visual elements from analysis
  const visualElements: string[] = [];

  // Add genre-specific visuals
  for (const genre of analysis.genre) {
    const visuals = GENRE_VISUAL_MAP[genre];
    if (visuals) {
      visualElements.push(...visuals.slice(0, 3));
    }
  }

  // Add mood-specific visuals
  for (const mood of analysis.mood) {
    const visuals = MOOD_VISUAL_MAP[mood];
    if (visuals) {
      visualElements.push(...visuals.slice(0, 2));
    }
  }

  // Add instrument-specific visuals
  for (const instrument of analysis.instruments) {
    const visuals = INSTRUMENT_VISUAL_MAP[instrument];
    if (visuals) {
      visualElements.push(...visuals.slice(0, 2));
    }
  }

  // Add era-specific visuals
  if (analysis.era) {
    const eraVisuals = ERA_VISUAL_MAP[analysis.era];
    if (eraVisuals) {
      visualElements.push(eraVisuals);
    }
  }

  // Add energy-based descriptors
  const energyDesc = analysis.energy === "high"
    ? "high-energy, dynamic motion, fast cuts, explosive visuals"
    : analysis.energy === "low"
      ? "slow, meditative, gentle transitions, ambient"
      : "balanced rhythm, moderate pacing, flowing motion";

  // Add tempo-based descriptors
  const tempoDesc = analysis.tempo === "fast"
    ? "rapid transitions, quick cuts, staccato motion"
    : analysis.tempo === "slow"
      ? "long takes, slow reveals, gradual builds"
      : "steady pacing, consistent rhythm";

  // Add theme-based visuals
  const themeDesc = analysis.themes.length > 0
    ? `Thematic elements: ${analysis.themes.join(", ")}`
    : "";

  // Build the final prompt
  const uniqueElements = [...new Set(visualElements)].slice(0, 8);

  const positive = [
    `Music video visual for "${trackName}"`,
    `Style: ${style}, ${analysis.genre.join("/")} aesthetic`,
    uniqueElements.join(", "),
    energyDesc,
    tempoDesc,
    themeDesc,
    "Deep vibrant colors, volumetric lighting, 4K, ultra detailed",
    "Professional music video, audio-reactive elements, synchronized to rhythm",
  ].filter(Boolean).join(". ");

  // Negative prompt to avoid common issues
  const negative = [
    "blurry, low quality, distorted, deformed, ugly",
    "bad anatomy, watermark, text, logo, signature",
    "oversaturated, underexposed, noisy, grainy",
    "jpeg artifacts, compression artifacts, cropped, out of frame",
    "duplicate, morbid, mutilated, extra fingers, mutated hands",
    "poorly drawn, poorly drawn hands, poorly drawn face",
    "mutation, dehydrated, bad proportions, gross proportions",
    "cloned face, disfigured, malformed limbs, missing arms, missing legs",
    "extra arms, extra legs, fused fingers, too many fingers, long neck",
    "username, artist name, low resolution, worst quality",
  ].join(", ");

  // Recommended generation settings based on style
  const settings = getStyleSettings(style);

  return {
    positive,
    negative,
    style,
    recommendedResolution: settings.resolution,
    recommendedSteps: settings.steps,
    recommendedCfg: settings.cfg,
  };
}

/**
 * Select the best visual style based on music analysis.
 */
function selectBestStyle(analysis: MusicPromptAnalysis): string {
  const genre = analysis.genre[0];
  const energy = analysis.energy;

  if (genre === "synthwave" || genre === "electronic") return "geometric";
  if (genre === "ambient" || genre === "classical") return "nature";
  if (genre === "metal" || energy === "high") return "glitch";
  if (genre === "jazz" || genre === "soul") return "cinematic";
  if (genre === "hip hop" || genre === "rnb") return "cinematic";
  if (genre === "indie") return "abstract";
  if (genre === "folk") return "nature";
  return "abstract";
}

/**
 * Get recommended generation settings for a style.
 */
function getStyleSettings(style: string): {
  resolution: { width: number; height: number };
  steps: number;
  cfg: number;
} {
  switch (style) {
    case "cinematic":
      return { resolution: { width: 1280, height: 720 }, steps: 25, cfg: 7 };
    case "abstract":
      return { resolution: { width: 1024, height: 1024 }, steps: 20, cfg: 7.5 };
    case "geometric":
      return { resolution: { width: 1024, height: 1024 }, steps: 20, cfg: 7 };
    case "nature":
      return { resolution: { width: 1280, height: 720 }, steps: 30, cfg: 6.5 };
    case "glitch":
      return { resolution: { width: 1024, height: 1024 }, steps: 20, cfg: 8 };
    case "minimal":
      return { resolution: { width: 1024, height: 1024 }, steps: 15, cfg: 6 };
    case "surreal":
      return { resolution: { width: 1024, height: 1024 }, steps: 25, cfg: 7.5 };
    default:
      return { resolution: { width: 1024, height: 1024 }, steps: 20, cfg: 7 };
  }
}

/**
 * Generate a prompt from Suno/Udio-style tags.
 */
export function parseFromGenerationTags(tags: string[]): string {
  const tagMap: Record<string, string> = {
    "synthwave": "synthwave, retro-futuristic, neon, 80s aesthetic",
    "electronic": "electronic, digital, futuristic, synthetic",
    "upbeat": "energetic, fast tempo, happy, dance",
    "melancholy": "sad, slow, emotional, reflective",
    "dark": "dark, moody, intense, atmospheric",
    "epic": "epic, grand, cinematic, orchestral",
    "chill": "chill, relaxed, ambient, downtempo",
    "aggressive": "aggressive, heavy, intense, powerful",
    "dreamy": "dreamy, ethereal, soft, floating",
    "groovy": "groovy, funky, rhythmic, dance",
  };

  const visualTags: string[] = [];
  for (const tag of tags) {
    const visual = tagMap[tag.toLowerCase()];
    if (visual) {
      visualTags.push(visual);
    }
  }

  return visualTags.join(", ");
}

export default {
  analyzeMusicPrompt,
  transformMusicToVisualPrompt,
  parseFromGenerationTags,
};
