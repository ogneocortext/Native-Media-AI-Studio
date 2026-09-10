/**
 * Structured prompt lint — mirrors docs/knowledge-library/music-video-production.md
 * checklist (shot + angle + subject + action + setting + lighting + mood).
 * Pure + testable; ConfigureStep renders the result as a live checklist.
 */

export interface PromptCheck {
  key: string;
  label: string;
  pass: boolean;
  hint: string;
}

const SHOT_TOKENS = ["extreme wide", "wide", "medium", "close-up", "close up", "extreme close"];
const ANGLE_TOKENS = ["eye level", "eye-level", "low angle", "high angle", "bird", "dutch", "aerial", "overhead"];
const LIGHT_TOKENS = ["light", "neon", "golden hour", "backlight", "lamp", "laser", "glow", "cinematic", "moody", "bright", "dark"];
const GENERIC_WORDS = ["beautiful", "atmospheric", "nice", "cool", "awesome", "good"];

export function countWords(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

export function lintVideoPrompt(prompt: string): { checks: PromptCheck[]; wordCount: number; score: number } {
  const p = (prompt || "").toLowerCase();
  const words = countWords(prompt);
  const has = (tokens: string[]) => tokens.some((t) => p.includes(t));

  const checks: PromptCheck[] = [
    {
      key: "shot",
      label: "Shot size specified",
      pass: has(SHOT_TOKENS),
      hint: p ? "Add “medium shot” or “close-up”" : "Start with a shot size",
    },
    {
      key: "angle",
      label: "Camera angle specified",
      pass: has(ANGLE_TOKENS),
      hint: "Add “eye-level” or “low angle”",
    },
    {
      key: "lighting",
      label: "Lighting described",
      pass: has(LIGHT_TOKENS),
      hint: "Name the light: “neon”, “golden hour backlight”",
    },
    {
      key: "length",
      label: "Single paragraph, <75 words",
      pass: words > 0 && words <= 75,
      hint: words === 0 ? "Describe one subject per shot" : `${words} words — trim to 75`,
    },
    {
      key: "specific",
      label: "No generic filler",
      pass: !GENERIC_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(p)),
      hint: "Swap “beautiful” for specifics (“fog-filled alley”)",
    },
  ];
  const score = checks.filter((c) => c.pass).length;
  return { checks, wordCount: words, score };
}
