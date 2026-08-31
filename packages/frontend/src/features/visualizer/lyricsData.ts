/**
 * JSON Lyrics Format — describes lyrics + visual effects for kinetic typography.
 *
 * This format stores everything needed to drive the visualizer:
 * - Lyric text with precise timing
 * - Per-line visual effects and animations
 * - Transition points between sections
 * - Color schemes per section
 * - Energy/intensity curves for reactive effects
 * - Detailed animation configuration for each line
 *
 * Example:
 * {
 *   "version": "1.0",
 *   "metadata": {
 *     "title": "Song Title",
 *     "artist": "Artist",
 *     "bpm": 120,
 *     "duration": 180.5
 *   },
 *   "colorScheme": {
 *     "INTRO": "#818cf8",
 *     "VERSE": "#60a5fa",
 *     "CHORUS": "#c084fc"
 *   },
 *   "lines": [
 *     {
 *       "id": "line-1",
 *       "start": 0.0,
 *       "end": 4.0,
 *       "text": "INTRO",
 *       "section": "INTRO",
 *       "animation": {
 *         "enter": { "type": "fadeInUp", "duration": 0.5, "easing": "easeOut" },
 *         "exit": { "type": "fadeOut", "duration": 0.3, "easing": "easeIn" },
 *         "loop": { "type": "pulse", "duration": 1.0, "intensity": 0.5 },
 *         "beatReact": { "scale": 1.2, "glow": 0.8, "shake": 0.0 },
 *         "style": { "fontSize": 48, "fontWeight": 700, "letterSpacing": 0.02 }
 *       },
 *       "transition": { "type": "dissolve", "duration": 0.5, "easing": "easeInOut" },
 *       "words": [
 *         {"word": "word1", "start": 0.0, "end": 0.5},
 *         {"word": "word2", "start": 0.5, "end": 1.0}
 *       ]
 *     }
 *   ],
 *   "globalEffects": {
 *     "beatPulse": true,
 *     "bassReactive": true,
 *     "particleBurst": false
 *   }
 * }
 */

export interface LyricWord {
  word: string;
  start: number;
  end: number;
}

export interface KeyframeAnimation {
  type: string;
  duration: number;
  easing?: string;
  intensity?: number;
  scale?: number;
  glow?: number;
  shake?: number;
  delay?: number;
}

export interface BeatReactConfig {
  scale?: number;
  glow?: number;
  shake?: number;
  rotation?: number;
  translateY?: number;
}

export interface AnimationStyle {
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  textTransform?: string;
  opacity?: number;
  blur?: number;
  skew?: number;
}

export interface LyricAnimation {
  enter?: KeyframeAnimation;
  exit?: KeyframeAnimation;
  loop?: KeyframeAnimation;
  beatReact?: BeatReactConfig;
  style?: AnimationStyle;
}

export interface LyricEffect {
  preset?: string;
  color?: string;
}

export interface LyricTransition {
  type: string;
  duration: number;
  easing?: string;
}

export interface LyricLine {
  id: string;
  start: number;
  end: number;
  text: string;
  section: string;
  animation?: LyricAnimation;
  effect?: LyricEffect;
  transition?: LyricTransition;
  words?: LyricWord[];
}

export interface GlobalEffects {
  beatPulse?: boolean;
  bassReactive?: boolean;
  colorCycle?: boolean;
  particleBurst?: boolean;
  screenShake?: boolean;
}

export interface LyricsMetadata {
  title?: string;
  artist?: string;
  bpm?: number;
  duration?: number;
}

export interface LyricsData {
  version: string;
  metadata?: LyricsMetadata;
  colorScheme?: Record<string, string>;
  lines: LyricLine[];
  globalEffects?: GlobalEffects;
}

export const DEFAULT_COLOR_SCHEME: Record<string, string> = {
  INTRO: "#818cf8",
  VERSE: "#60a5fa",
  CHORUS: "#c084fc",
  BRIDGE: "#f59e0b",
  "FINAL CHORUS": "#f472b6",
  OUTRO: "#67e8f9",
};

export const DEFAULT_GLOBAL_EFFECTS: GlobalEffects = {
  beatPulse: true,
  bassReactive: true,
  colorCycle: false,
  particleBurst: false,
  screenShake: false,
};

// Available animation types for the editor
export const ANIMATION_TYPES = [
  "none",
  "fadeIn",
  "fadeInUp",
  "fadeInDown",
  "fadeInLeft",
  "fadeInRight",
  "slideInUp",
  "slideInDown",
  "slideInLeft",
  "slideInRight",
  "scaleIn",
  "rotateIn",
  "bounceIn",
  "elasticIn",
  "typewriter",
  "glitchIn",
  "burnIn",
  "neonFlicker",
  "rgbSplit",
  "matrixRain",
];

export const EXIT_ANIMATION_TYPES = [
  "none",
  "fadeOut",
  "fadeOutUp",
  "fadeOutDown",
  "fadeOutLeft",
  "fadeOutRight",
  "slideOutUp",
  "slideOutDown",
  "scaleOut",
  "rotateOut",
  "dissolve",
  "glitchOut",
  "burnOut",
];

export const LOOP_ANIMATION_TYPES = [
  "none",
  "pulse",
  "breathe",
  "float",
  "shake",
  "glowPulse",
  "rgbCycle",
  "neonPulse",
  "bassJump",
];

export const EASING_TYPES = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "cubicIn",
  "cubicOut",
  "cubicInOut",
  "elastic",
  "bounce",
];

export const TRANSITION_TYPES = [
  "none",
  "dissolve",
  "cut",
  "wipe",
  "zoom",
  "spin",
  "glitch",
  "flash",
];

/**
 * Create a default animation config for a lyric line.
 */
export function createDefaultAnimation(): LyricAnimation {
  return {
    enter: { type: "fadeInUp", duration: 0.5, easing: "easeOut" },
    exit: { type: "fadeOut", duration: 0.3, easing: "easeIn" },
    loop: { type: "none", duration: 1.0, intensity: 0.5 },
    beatReact: { scale: 1.0, glow: 0.5, shake: 0 },
    style: { fontSize: 48, fontWeight: 700, letterSpacing: 0.02 },
  };
}

/**
 * Create a default empty lyrics data structure.
 */
export function createDefaultLyricsData(): LyricsData {
  return {
    version: "1.0",
    colorScheme: { ...DEFAULT_COLOR_SCHEME },
    lines: [],
    globalEffects: { ...DEFAULT_GLOBAL_EFFECTS },
  };
}

/**
 * Validate lyrics data structure.
 */
export function validateLyricsData(data: LyricsData): string[] {
  const errors: string[] = [];

  if (!data.version) errors.push("Missing version");
  if (!Array.isArray(data.lines)) errors.push("lines must be an array");

  data.lines.forEach((line, i) => {
    if (typeof line.start !== "number") errors.push(`Line ${i}: start must be a number`);
    if (typeof line.end !== "number") errors.push(`Line ${i}: end must be a number`);
    if (!line.text) errors.push(`Line ${i}: missing text`);
    if (line.start > line.end) errors.push(`Line ${i}: start > end`);
  });

  return errors;
}

/**
 * Convert legacy LyricLine format to new JSON format.
 */
export function legacyToLyricsData(lines: Array<{
  start: number;
  end: number;
  text: string;
  section?: string;
  words?: Array<{ word: string; start: number; end: number }>;
}>): LyricsData {
  return {
    version: "1.0",
    colorScheme: { ...DEFAULT_COLOR_SCHEME },
    lines: lines.map((l, i) => ({
      id: `line-${i}`,
      start: l.start,
      end: l.end,
      text: l.text,
      section: l.section || "VERSE",
      words: l.words,
      animation: createDefaultAnimation(),
      transition: { type: "dissolve", duration: 0.3, easing: "easeInOut" },
    })),
    globalEffects: { ...DEFAULT_GLOBAL_EFFECTS },
  };
}

/**
 * Convert JSON format to legacy LyricLine array (for backward compatibility).
 */
export function lyricsDataToLegacy(data: LyricsData): Array<{
  start: number;
  end: number;
  text: string;
  section: string;
  words?: Array<{ word: string; start: number; end: number }>;
}> {
  return data.lines.map((l) => ({
    start: l.start,
    end: l.end,
    text: l.text,
    section: l.section,
    words: l.words,
  }));
}

/**
 * Find the current line for a given time from lyrics data.
 */
export function findCurrentLineFromData(
  data: LyricsData,
  time: number
): LyricLine | null {
  for (const line of data.lines) {
    if (time >= line.start && time < line.end) {
      return line;
    }
  }
  return null;
}

/**
 * Export lyrics data to formatted JSON string.
 */
export function exportLyricsToJSON(data: LyricsData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Import lyrics data from JSON string.
 */
export function importLyricsFromJSON(json: string): LyricsData {
  const data = JSON.parse(json);
  return data as LyricsData;
}
