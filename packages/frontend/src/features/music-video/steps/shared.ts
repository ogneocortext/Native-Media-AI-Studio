/** Shared constants for the music-video wizard steps. */
export const SECTION_COLORS: Record<string, string> = {
  intro: "bg-sky-600",
  verse: "bg-emerald-600",
  chorus: "bg-violet-600",
  bridge: "bg-amber-600",
  outro: "bg-rose-600",
  "pre-chorus": "bg-teal-600",
};

export const SHOT_SIZES = ["Extreme Wide", "Wide", "Medium", "Close-up", "Extreme Close-up"];
export const CAMERA_ANGLES = ["Eye Level", "Low Angle", "High Angle", "Bird's Eye", "Dutch Angle"];

/** Prompt-palette suggestions, keyed by mood category. */
export const PROMPT_SUGGESTIONS: Record<string, string[]> = {
  happy: ["upbeat", "bright", "colorful", "energetic", "joyful", "vibrant"],
  calm: ["peaceful", "serene", "soft", "gentle", "relaxing", "ambient"],
  dark: ["moody", "atmospheric", "cinematic", "dramatic", "intense", "mysterious"],
  electronic: ["neon", "futuristic", "cyberpunk", "glitch", "synth", "digital"],
  natural: ["organic", "earthy", "warm", "sunset", "nature", "flowing"],
};
