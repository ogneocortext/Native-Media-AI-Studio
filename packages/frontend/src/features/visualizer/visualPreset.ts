/**
 * Visual Preset System — unified JSON for complete track visualization.
 *
 * A single VisualPreset defines everything: colors, visualizer style,
 * camera, post-processing, lyrics animation, and audio reactivity.
 */

import type { TimingHint } from "../../shared/timing";

// =============================================================================
// Color Theme
// =============================================================================

export interface ColorTheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  glow: string;
}

export const DEFAULT_COLOR_THEME: ColorTheme = {
  primary: "#c084fc",
  secondary: "#60a5fa",
  accent: "#f472b6",
  background: "#0a0a0a",
  text: "#e0e0e0",
  glow: "#c084fc",
};

// =============================================================================
// Visualizer Config
// =============================================================================

export interface VisualizerConfig {
  style: "particles" | "waveform" | "pulse" | "bars" | "galaxy" | "terrain";
  colors: "neon" | "fire" | "ocean" | "forest" | "sunset" | "monochrome" | "custom";
  intensity: number;
  particleCount: number;
  speed: number;
  scale: number;
  glow: boolean;
  rotation: boolean;
}

export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  style: "particles",
  colors: "neon",
  intensity: 0.8,
  particleCount: 100,
  speed: 1.0,
  scale: 1.0,
  glow: true,
  rotation: true,
};

// =============================================================================
// Camera Keyframes
// =============================================================================

export interface CameraKeyframe {
  at: number; // time in seconds
  position: [number, number, number];
  target: [number, number, number];
  easing?: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

export const DEFAULT_CAMERA_KEYFRAMES: CameraKeyframe[] = [
  { at: 0, position: [0, 2, 5], target: [0, 0, 0], easing: "easeInOut" },
];

// =============================================================================
// Post-Processing
// =============================================================================

export interface PostProcessingConfig {
  bloom: number;
  bloomRadius: number;
  bloomThreshold: number;
  chromaticAberration: number;
  filmGrain: number;
  vignetteRadius: number;
  vignetteStrength: number;
  glitch: number;
  sharpen: number;
}

export const DEFAULT_POST_PROCESSING: PostProcessingConfig = {
  bloom: 0.8,
  bloomRadius: 0.4,
  bloomThreshold: 0.85,
  chromaticAberration: 0,
  filmGrain: 0.1,
  vignetteRadius: 1.0,
  vignetteStrength: 0.4,
  glitch: 0,
  sharpen: 0,
};

// =============================================================================
// Lyric Animation
// =============================================================================

export interface LyricAnimationConfig {
  style: "kinetic" | "fade" | "typewriter" | "glitch" | "neon" | "bounce";
  glowIntensity: number;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  beatReact: boolean;
  enterAnimation: string;
  exitAnimation: string;
}

export const DEFAULT_LYRIC_ANIMATION: LyricAnimationConfig = {
  style: "kinetic",
  glowIntensity: 0.7,
  fontSize: 48,
  fontWeight: 700,
  letterSpacing: 0.02,
  beatReact: true,
  enterAnimation: "fadeInUp",
  exitAnimation: "fadeOut",
};

// =============================================================================
// Audio Reactivity
// =============================================================================

export interface AudioReactivityConfig {
  bass: "none" | "scale" | "glow" | "shake" | "pulse" | "zoom";
  mid: "none" | "scale" | "glow" | "shake" | "pulse" | "zoom";
  treble: "none" | "scale" | "glow" | "shake" | "pulse" | "zoom";
  beat: "none" | "pulse" | "shake" | "flash" | "zoom";
  beatDecay: number;
  smoothing: number;
}

export const DEFAULT_AUDIO_REACTIVITY: AudioReactivityConfig = {
  bass: "scale",
  mid: "glow",
  treble: "pulse",
  beat: "pulse",
  beatDecay: 0.5,
  smoothing: 0.8,
};

// =============================================================================
// Beat Marker Config
// =============================================================================

export interface BeatMarkerConfig {
  color: string;
  icon: string;
  behavior: "pulse" | "flash" | "shake" | "none";
  size: number;
}

export const DEFAULT_BEAT_MARKERS: Record<string, BeatMarkerConfig> = {
  beat: { color: "#c084fc", icon: "circle", behavior: "pulse", size: 1.0 },
  drop: { color: "#f472b6", icon: "diamond", behavior: "flash", size: 1.2 },
  break: { color: "#f59e0b", icon: "square", behavior: "shake", size: 0.8 },
  transition: { color: "#60a5fa", icon: "triangle", behavior: "flash", size: 1.0 },
};

// =============================================================================
// Complete Visual Preset
// =============================================================================

export interface VisualPreset {
  version: string;
  id: string;
  name: string;
  description: string;
  tags: string[];

  theme: ColorTheme;
  visualizer: VisualizerConfig;
  camera: {
    keyframes: CameraKeyframe[];
    mode: "orbit" | "fixed" | "flythrough" | "handheld";
    fov: number;
  };
  postfx: PostProcessingConfig;
  lyrics: LyricAnimationConfig;
  audioReactivity: AudioReactivityConfig;
  beatMarkers: Record<string, BeatMarkerConfig>;

  // Per-section overrides
  sections?: Record<string, {
    theme?: Partial<ColorTheme>;
    visualizer?: Partial<VisualizerConfig>;
    postfx?: Partial<PostProcessingConfig>;
  }>;

  /** AI-generated timing hints for Remotion / agent-driven animations */
  timingHints?: TimingHint[];
}

export const DEFAULT_VISUAL_PRESET: VisualPreset = {
  version: "1.0",
  id: "default",
  name: "Default Preset",
  description: "A balanced starting point for any track",
  tags: ["balanced", "clean"],

  theme: { ...DEFAULT_COLOR_THEME },
  visualizer: { ...DEFAULT_VISUALIZER_CONFIG },
  camera: {
    keyframes: [{ ...DEFAULT_CAMERA_KEYFRAMES[0] }],
    mode: "orbit",
    fov: 60,
  },
  postfx: { ...DEFAULT_POST_PROCESSING },
  lyrics: { ...DEFAULT_LYRIC_ANIMATION },
  audioReactivity: { ...DEFAULT_AUDIO_REACTIVITY },
  beatMarkers: { ...DEFAULT_BEAT_MARKERS },
};

// =============================================================================
// Preset Library
// =============================================================================

export const PRESET_LIBRARY: VisualPreset[] = [
  DEFAULT_VISUAL_PRESET,
  {
    version: "1.0",
    id: "phonk-drift",
    name: "Phonk Drift",
    description: "Aggressive glitch with RGB split and shake",
    tags: ["phonk", "drift", "aggressive", "glitch"],
    theme: {
      primary: "#ff0040",
      secondary: "#00ff88",
      accent: "#ff8800",
      background: "#0a0008",
      text: "#ff3366",
      glow: "#ff0040",
    },
    visualizer: {
      style: "bars",
      colors: "fire",
      intensity: 0.9,
      particleCount: 64,
      speed: 1.5,
      scale: 1.2,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
        { at: 5, position: [2, 2, 3], target: [0, 0, 0], easing: "easeInOut" },
        { at: 10, position: [-2, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "handheld",
      fov: 70,
    },
    postfx: {
      bloom: 1.2,
      bloomRadius: 0.5,
      bloomThreshold: 0.7,
      chromaticAberration: 0.005,
      filmGrain: 0.2,
      vignetteRadius: 0.8,
      vignetteStrength: 0.6,
      glitch: 0.15,
      sharpen: 0.3,
    },
    lyrics: {
      style: "glitch",
      glowIntensity: 0.9,
      fontSize: 56,
      fontWeight: 900,
      letterSpacing: 0.05,
      beatReact: true,
      enterAnimation: "glitchIn",
      exitAnimation: "glitchOut",
    },
    audioReactivity: {
      bass: "shake",
      mid: "glow",
      treble: "pulse",
      beat: "shake",
      beatDecay: 0.3,
      smoothing: 0.6,
    },
    beatMarkers: {
      beat: { color: "#ff0040", icon: "circle", behavior: "shake", size: 1.2 },
      drop: { color: "#ff8800", icon: "diamond", behavior: "flash", size: 1.5 },
      break: { color: "#00ff88", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#ff3366", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "synthwave",
    name: "Synthwave",
    description: "Neon glow with retro chrome aesthetics",
    tags: ["synthwave", "retro", "neon", "80s"],
    theme: {
      primary: "#ff6b9d",
      secondary: "#6b9dff",
      accent: "#ffe66d",
      background: "#0a0018",
      text: "#ff6b9d",
      glow: "#ff6b9d",
    },
    visualizer: {
      style: "waveform",
      colors: "neon",
      intensity: 0.7,
      particleCount: 50,
      speed: 0.5,
      scale: 1.0,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 3, 8], target: [0, 0, 0], easing: "linear" },
      ],
      mode: "fixed",
      fov: 50,
    },
    postfx: {
      bloom: 1.5,
      bloomRadius: 0.6,
      bloomThreshold: 0.6,
      chromaticAberration: 0.002,
      filmGrain: 0.05,
      vignetteRadius: 1.2,
      vignetteStrength: 0.5,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "neon",
      glowIntensity: 1.0,
      fontSize: 64,
      fontWeight: 700,
      letterSpacing: 0.08,
      beatReact: true,
      enterAnimation: "neonFlicker",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "glow",
      mid: "pulse",
      treble: "scale",
      beat: "pulse",
      beatDecay: 0.6,
      smoothing: 0.9,
    },
    beatMarkers: {
      beat: { color: "#ff6b9d", icon: "circle", behavior: "pulse", size: 1.0 },
      drop: { color: "#ffe66d", icon: "diamond", behavior: "flash", size: 1.3 },
      break: { color: "#6b9dff", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#ff6b9d", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "ambient-flow",
    name: "Ambient Flow",
    description: "Ethereal floating text with soft glow",
    tags: ["ambient", "trance", "progressive", "ethereal"],
    theme: {
      primary: "#818cf8",
      secondary: "#a5b4fc",
      accent: "#c4b5fd",
      background: "#050510",
      text: "#e0e7ff",
      glow: "#818cf8",
    },
    visualizer: {
      style: "particles",
      colors: "ocean",
      intensity: 0.4,
      particleCount: 200,
      speed: 0.3,
      scale: 0.8,
      glow: true,
      rotation: true,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 2, 6], target: [0, 0, 0], easing: "easeInOut" },
        { at: 30, position: [3, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
        { at: 60, position: [-2, 3, 5], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "flythrough",
      fov: 55,
    },
    postfx: {
      bloom: 1.0,
      bloomRadius: 0.7,
      bloomThreshold: 0.5,
      chromaticAberration: 0,
      filmGrain: 0.02,
      vignetteRadius: 1.5,
      vignetteStrength: 0.3,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "fade",
      glowIntensity: 0.5,
      fontSize: 42,
      fontWeight: 400,
      letterSpacing: 0.04,
      beatReact: false,
      enterAnimation: "fadeIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "glow",
      mid: "scale",
      treble: "pulse",
      beat: "none",
      beatDecay: 0.8,
      smoothing: 0.95,
    },
    beatMarkers: {
      beat: { color: "#818cf8", icon: "circle", behavior: "pulse", size: 0.8 },
      drop: { color: "#a5b4fc", icon: "diamond", behavior: "pulse", size: 1.0 },
      break: { color: "#c4b5fd", icon: "square", behavior: "pulse", size: 0.6 },
      transition: { color: "#e0e7ff", icon: "triangle", behavior: "flash", size: 0.8 },
    },
  },
  {
    version: "1.0",
    id: "gfunk",
    name: "West Coast G-Funk",
    description: "Smooth groovy bounce with warm sunset colors",
    tags: ["g-funk", "funk", "west coast", "smooth", "rap"],
    theme: {
      primary: "#ff8800",
      secondary: "#ffbb44",
      accent: "#ff4400",
      background: "#1a0800",
      text: "#ffd9a0",
      glow: "#ff8800",
    },
    visualizer: {
      style: "pulse",
      colors: "sunset",
      intensity: 0.6,
      particleCount: 150,
      speed: 0.6,
      scale: 1.1,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 2, 6], target: [0, 0, 0], easing: "easeInOut" },
        { at: 20, position: [2, 1.5, 5], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "orbit",
      fov: 55,
    },
    postfx: {
      bloom: 0.8,
      bloomRadius: 0.5,
      bloomThreshold: 0.7,
      chromaticAberration: 0,
      filmGrain: 0.08,
      vignetteRadius: 1.0,
      vignetteStrength: 0.5,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "bounce",
      glowIntensity: 0.6,
      fontSize: 52,
      fontWeight: 700,
      letterSpacing: 0.03,
      beatReact: true,
      enterAnimation: "bounceIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "pulse",
      mid: "glow",
      treble: "scale",
      beat: "pulse",
      beatDecay: 0.5,
      smoothing: 0.85,
    },
    beatMarkers: {
      beat: { color: "#ff8800", icon: "circle", behavior: "pulse", size: 1.0 },
      drop: { color: "#ff4400", icon: "diamond", behavior: "flash", size: 1.3 },
      break: { color: "#ffbb44", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#ffd9a0", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "grime",
    name: "UK Grime",
    description: "Sharp angular cuts with high-energy yellow/black contrast",
    tags: ["grime", "uk", "fast", "aggressive"],
    theme: {
      primary: "#ffff00",
      secondary: "#ffffff",
      accent: "#ffaa00",
      background: "#080800",
      text: "#ffff88",
      glow: "#ffff00",
    },
    visualizer: {
      style: "bars",
      colors: "neon",
      intensity: 0.9,
      particleCount: 64,
      speed: 1.6,
      scale: 1.2,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
        { at: 4, position: [1.5, 1.5, 3], target: [0, 0, 0], easing: "easeInOut" },
        { at: 8, position: [-1.5, 1, 3.5], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "handheld",
      fov: 70,
    },
    postfx: {
      bloom: 1.1,
      bloomRadius: 0.5,
      bloomThreshold: 0.7,
      chromaticAberration: 0.004,
      filmGrain: 0.15,
      vignetteRadius: 0.9,
      vignetteStrength: 0.6,
      glitch: 0.12,
      sharpen: 0.3,
    },
    lyrics: {
      style: "typewriter",
      glowIntensity: 0.7,
      fontSize: 50,
      fontWeight: 800,
      letterSpacing: 0.02,
      beatReact: true,
      enterAnimation: "typewriterIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "shake",
      mid: "pulse",
      treble: "scale",
      beat: "shake",
      beatDecay: 0.3,
      smoothing: 0.6,
    },
    beatMarkers: {
      beat: { color: "#ffff00", icon: "circle", behavior: "shake", size: 1.1 },
      drop: { color: "#ffaa00", icon: "diamond", behavior: "flash", size: 1.4 },
      break: { color: "#ffffff", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#ffff88", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "dubstep",
    name: "Dubstep Impact",
    description: "Heavy bass-reactive drops with screen shake and distortion",
    tags: ["dubstep", "brostep", "bass", "heavy", "electronic"],
    theme: {
      primary: "#00ff44",
      secondary: "#00ccff",
      accent: "#ff00ff",
      background: "#080008",
      text: "#aaffcc",
      glow: "#00ff44",
    },
    visualizer: {
      style: "bars",
      colors: "neon",
      intensity: 1.0,
      particleCount: 128,
      speed: 1.4,
      scale: 1.3,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
        { at: 6, position: [2, 2, 3], target: [0, 0, 0], easing: "easeInOut" },
        { at: 12, position: [-2, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "handheld",
      fov: 72,
    },
    postfx: {
      bloom: 1.3,
      bloomRadius: 0.5,
      bloomThreshold: 0.65,
      chromaticAberration: 0.005,
      filmGrain: 0.15,
      vignetteRadius: 0.8,
      vignetteStrength: 0.7,
      glitch: 0.1,
      sharpen: 0.2,
    },
    lyrics: {
      style: "bounce",
      glowIntensity: 0.9,
      fontSize: 58,
      fontWeight: 900,
      letterSpacing: 0.02,
      beatReact: true,
      enterAnimation: "bounceIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "shake",
      mid: "glow",
      treble: "pulse",
      beat: "shake",
      beatDecay: 0.25,
      smoothing: 0.55,
    },
    beatMarkers: {
      beat: { color: "#00ff44", icon: "circle", behavior: "shake", size: 1.2 },
      drop: { color: "#ff00ff", icon: "diamond", behavior: "flash", size: 1.5 },
      break: { color: "#00ccff", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#aaffcc", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "lofi",
    name: "Lo-Fi Warmth",
    description: "Warm gentle fade with nostalgic film grain feel",
    tags: ["lo-fi", "lofi", "chill", "warm", "nostalgic", "jazz"],
    theme: {
      primary: "#cc8844",
      secondary: "#aa6644",
      accent: "#ddaa66",
      background: "#14100a",
      text: "#e8d5b5",
      glow: "#cc8844",
    },
    visualizer: {
      style: "waveform",
      colors: "sunset",
      intensity: 0.4,
      particleCount: 60,
      speed: 0.3,
      scale: 0.9,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 2.5, 7], target: [0, 0, 0], easing: "linear" },
      ],
      mode: "fixed",
      fov: 50,
    },
    postfx: {
      bloom: 0.6,
      bloomRadius: 0.6,
      bloomThreshold: 0.7,
      chromaticAberration: 0,
      filmGrain: 0.18,
      vignetteRadius: 1.0,
      vignetteStrength: 0.6,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "fade",
      glowIntensity: 0.4,
      fontSize: 44,
      fontWeight: 500,
      letterSpacing: 0.03,
      beatReact: false,
      enterAnimation: "fadeIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "glow",
      mid: "scale",
      treble: "pulse",
      beat: "none",
      beatDecay: 0.8,
      smoothing: 0.95,
    },
    beatMarkers: {
      beat: { color: "#cc8844", icon: "circle", behavior: "pulse", size: 0.8 },
      drop: { color: "#ddaa66", icon: "diamond", behavior: "pulse", size: 1.0 },
      break: { color: "#aa6644", icon: "square", behavior: "pulse", size: 0.6 },
      transition: { color: "#e8d5b5", icon: "triangle", behavior: "flash", size: 0.8 },
    },
  },
  {
    version: "1.0",
    id: "cinematic",
    name: "Cinematic",
    description: "Dramatic orchestral swells with wide elegant letters",
    tags: ["cinematic", "orchestral", "dramatic", "epic", "trailer"],
    theme: {
      primary: "#ffffff",
      secondary: "#a0a0c0",
      accent: "#ffd700",
      background: "#050510",
      text: "#f0f0ff",
      glow: "#ffffff",
    },
    visualizer: {
      style: "galaxy",
      colors: "monochrome",
      intensity: 0.6,
      particleCount: 150,
      speed: 0.4,
      scale: 1.0,
      glow: true,
      rotation: true,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 2, 8], target: [0, 0, 0], easing: "easeInOut" },
        { at: 30, position: [4, 1, 6], target: [0, 0, 0], easing: "easeInOut" },
        { at: 60, position: [-3, 3, 7], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "flythrough",
      fov: 60,
    },
    postfx: {
      bloom: 1.0,
      bloomRadius: 0.6,
      bloomThreshold: 0.6,
      chromaticAberration: 0,
      filmGrain: 0.05,
      vignetteRadius: 1.2,
      vignetteStrength: 0.5,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "kinetic",
      glowIntensity: 0.6,
      fontSize: 54,
      fontWeight: 600,
      letterSpacing: 0.12,
      beatReact: false,
      enterAnimation: "fadeInUp",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "glow",
      mid: "pulse",
      treble: "scale",
      beat: "pulse",
      beatDecay: 0.6,
      smoothing: 0.9,
    },
    beatMarkers: {
      beat: { color: "#ffffff", icon: "circle", behavior: "pulse", size: 1.0 },
      drop: { color: "#ffd700", icon: "diamond", behavior: "flash", size: 1.3 },
      break: { color: "#a0a0c0", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#f0f0ff", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "rb",
    name: "R&B Soul",
    description: "Smooth sensual flow with warm glow and soft bloom",
    tags: ["r&b", "rnb", "soul", "neo-soul", "slow jam"],
    theme: {
      primary: "#ff77aa",
      secondary: "#cc55ff",
      accent: "#ffbb88",
      background: "#0a0510",
      text: "#ffd5e5",
      glow: "#ff77aa",
    },
    visualizer: {
      style: "waveform",
      colors: "sunset",
      intensity: 0.5,
      particleCount: 80,
      speed: 0.5,
      scale: 1.0,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 2, 6], target: [0, 0, 0], easing: "easeInOut" },
        { at: 20, position: [2, 1.5, 5], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "orbit",
      fov: 55,
    },
    postfx: {
      bloom: 0.9,
      bloomRadius: 0.6,
      bloomThreshold: 0.65,
      chromaticAberration: 0,
      filmGrain: 0.04,
      vignetteRadius: 1.2,
      vignetteStrength: 0.4,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "fade",
      glowIntensity: 0.6,
      fontSize: 48,
      fontWeight: 500,
      letterSpacing: 0.06,
      beatReact: false,
      enterAnimation: "fadeIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "glow",
      mid: "pulse",
      treble: "scale",
      beat: "pulse",
      beatDecay: 0.6,
      smoothing: 0.9,
    },
    beatMarkers: {
      beat: { color: "#ff77aa", icon: "circle", behavior: "pulse", size: 1.0 },
      drop: { color: "#cc55ff", icon: "diamond", behavior: "flash", size: 1.2 },
      break: { color: "#ffbb88", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#ffd5e5", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "pop",
    name: "Pop Gloss",
    description: "Bright polished bounce with shimmer and vibrant bloom",
    tags: ["pop", "dance-pop", "electropop", "k-pop", "j-pop"],
    theme: {
      primary: "#ff00ff",
      secondary: "#00ccff",
      accent: "#ffff00",
      background: "#080015",
      text: "#ffd5ff",
      glow: "#ff00ff",
    },
    visualizer: {
      style: "pulse",
      colors: "neon",
      intensity: 0.7,
      particleCount: 100,
      speed: 1.0,
      scale: 1.1,
      glow: true,
      rotation: true,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 2, 6], target: [0, 0, 0], easing: "easeInOut" },
        { at: 15, position: [2, 2, 5], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "orbit",
      fov: 60,
    },
    postfx: {
      bloom: 1.1,
      bloomRadius: 0.5,
      bloomThreshold: 0.6,
      chromaticAberration: 0.001,
      filmGrain: 0.03,
      vignetteRadius: 1.2,
      vignetteStrength: 0.3,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "bounce",
      glowIntensity: 0.8,
      fontSize: 54,
      fontWeight: 800,
      letterSpacing: 0.05,
      beatReact: true,
      enterAnimation: "bounceIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "pulse",
      mid: "glow",
      treble: "scale",
      beat: "pulse",
      beatDecay: 0.4,
      smoothing: 0.8,
    },
    beatMarkers: {
      beat: { color: "#ff00ff", icon: "circle", behavior: "pulse", size: 1.0 },
      drop: { color: "#ffff00", icon: "diamond", behavior: "flash", size: 1.3 },
      break: { color: "#00ccff", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#ffd5ff", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
  {
    version: "1.0",
    id: "indie",
    name: "Indie Organic",
    description: "Warm introspective flow with soft aurora and gentle particles",
    tags: ["indie", "indie rock", "indie folk", "alternative", "folk"],
    theme: {
      primary: "#88cc66",
      secondary: "#44aa88",
      accent: "#ddcc66",
      background: "#0a0d08",
      text: "#d5e8cc",
      glow: "#88cc66",
    },
    visualizer: {
      style: "particles",
      colors: "forest",
      intensity: 0.45,
      particleCount: 160,
      speed: 0.35,
      scale: 0.9,
      glow: true,
      rotation: true,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 2, 6], target: [0, 0, 0], easing: "easeInOut" },
        { at: 30, position: [3, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "flythrough",
      fov: 55,
    },
    postfx: {
      bloom: 0.8,
      bloomRadius: 0.6,
      bloomThreshold: 0.6,
      chromaticAberration: 0,
      filmGrain: 0.06,
      vignetteRadius: 1.2,
      vignetteStrength: 0.45,
      glitch: 0,
      sharpen: 0,
    },
    lyrics: {
      style: "fade",
      glowIntensity: 0.5,
      fontSize: 46,
      fontWeight: 500,
      letterSpacing: 0.04,
      beatReact: false,
      enterAnimation: "fadeIn",
      exitAnimation: "fadeOut",
    },
    audioReactivity: {
      bass: "glow",
      mid: "scale",
      treble: "pulse",
      beat: "none",
      beatDecay: 0.7,
      smoothing: 0.92,
    },
    beatMarkers: {
      beat: { color: "#88cc66", icon: "circle", behavior: "pulse", size: 0.9 },
      drop: { color: "#ddcc66", icon: "diamond", behavior: "pulse", size: 1.1 },
      break: { color: "#44aa88", icon: "square", behavior: "pulse", size: 0.7 },
      transition: { color: "#d5e8cc", icon: "triangle", behavior: "flash", size: 0.9 },
    },
  },
  {
    version: "1.0",
    id: "trap-metal",
    name: "Trap Metal",
    description: "Heavy aggressive distortion with rising fire and screen shake",
    tags: ["trap metal", "trap-metal", "metal", "rap metal", "nu metal"],
    theme: {
      primary: "#ff2200",
      secondary: "#ff8800",
      accent: "#ffff00",
      background: "#0a0005",
      text: "#ff8866",
      glow: "#ff2200",
    },
    visualizer: {
      style: "bars",
      colors: "fire",
      intensity: 1.0,
      particleCount: 128,
      speed: 1.6,
      scale: 1.3,
      glow: true,
      rotation: false,
    },
    camera: {
      keyframes: [
        { at: 0, position: [0, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
        { at: 5, position: [2, 2, 3], target: [0, 0, 0], easing: "easeInOut" },
        { at: 10, position: [-2, 1, 4], target: [0, 0, 0], easing: "easeInOut" },
      ],
      mode: "handheld",
      fov: 72,
    },
    postfx: {
      bloom: 1.3,
      bloomRadius: 0.5,
      bloomThreshold: 0.65,
      chromaticAberration: 0.006,
      filmGrain: 0.18,
      vignetteRadius: 0.8,
      vignetteStrength: 0.7,
      glitch: 0.15,
      sharpen: 0.3,
    },
    lyrics: {
      style: "glitch",
      glowIntensity: 0.9,
      fontSize: 58,
      fontWeight: 900,
      letterSpacing: 0.02,
      beatReact: true,
      enterAnimation: "glitchIn",
      exitAnimation: "glitchOut",
    },
    audioReactivity: {
      bass: "shake",
      mid: "glow",
      treble: "pulse",
      beat: "shake",
      beatDecay: 0.25,
      smoothing: 0.55,
    },
    beatMarkers: {
      beat: { color: "#ff2200", icon: "circle", behavior: "shake", size: 1.2 },
      drop: { color: "#ffff00", icon: "diamond", behavior: "flash", size: 1.5 },
      break: { color: "#ff8800", icon: "square", behavior: "pulse", size: 0.8 },
      transition: { color: "#ff8866", icon: "triangle", behavior: "flash", size: 1.0 },
    },
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

export function getPresetById(id: string): VisualPreset | undefined {
  return PRESET_LIBRARY.find((p) => p.id === id);
}

export function getPresetsByTag(tag: string): VisualPreset[] {
  return PRESET_LIBRARY.filter((p) => p.tags.includes(tag));
}

export function createPresetFromCurrent(
  base: VisualPreset,
  overrides: Partial<VisualPreset>
): VisualPreset {
  return {
    ...base,
    ...overrides,
    theme: { ...base.theme, ...overrides.theme },
    visualizer: { ...base.visualizer, ...overrides.visualizer },
    camera: { ...base.camera, ...overrides.camera },
    postfx: { ...base.postfx, ...overrides.postfx },
    lyrics: { ...base.lyrics, ...overrides.lyrics },
    audioReactivity: { ...base.audioReactivity, ...overrides.audioReactivity },
    beatMarkers: { ...base.beatMarkers, ...overrides.beatMarkers },
  };
}

export function exportPresetToString(preset: VisualPreset): string {
  return JSON.stringify(preset, null, 2);
}

export function importPresetFromString(json: string): VisualPreset | null {
  try {
    const parsed = JSON.parse(json) as Partial<VisualPreset>;
    // Minimal shape validation — previously any JSON object was accepted and
    // could crash consumers expecting theme/visualizer/camera/postfx/lyrics.
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return null;
    if (!parsed.theme || !parsed.visualizer || !parsed.camera) return null;
    if (!parsed.postfx || !parsed.lyrics || !parsed.audioReactivity) return null;
    if (!Array.isArray(parsed.camera.keyframes) || parsed.camera.keyframes.length === 0) return null;
    return parsed as VisualPreset;
  } catch {
    return null;
  }
}

/** Apply a camera easing curve to a [0, 1] interpolation factor. */
function applyCameraEasing(
  easing: CameraKeyframe["easing"],
  t: number
): number {
  const clamped = Math.min(1, Math.max(0, t));
  switch (easing) {
    case "easeIn":
      return clamped * clamped;
    case "easeOut":
      return 1 - (1 - clamped) * (1 - clamped);
    case "easeInOut":
      return clamped < 0.5
        ? 2 * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
    case "linear":
    default:
      return clamped;
  }
}

/**
 * Get the effective config for a given time, interpolating camera keyframes
 * and applying section overrides.
 */
export function getConfigAtTime(
  preset: VisualPreset,
  time: number,
  section?: string
): {
  theme: ColorTheme;
  visualizer: VisualizerConfig;
  camera: { position: [number, number, number]; target: [number, number, number] };
  postfx: PostProcessingConfig;
  lyrics: LyricAnimationConfig;
} {
  // Apply section overrides
  const sectionOverrides = section && preset.sections
    ? preset.sections[section]
    : undefined;
  const theme = sectionOverrides?.theme
    ? { ...preset.theme, ...sectionOverrides.theme }
    : { ...preset.theme };
  const visualizer = sectionOverrides?.visualizer
    ? { ...preset.visualizer, ...sectionOverrides.visualizer }
    : { ...preset.visualizer };
  const postfx = sectionOverrides?.postfx
    ? { ...preset.postfx, ...sectionOverrides.postfx }
    : { ...preset.postfx };

  // Interpolate camera position (clamped + eased — the `easing` field was
  // previously ignored and times before the first keyframe interpolated
  // across the whole timeline instead of holding the first frame).
  const keyframes = preset.camera.keyframes;
  let cameraPosition: [number, number, number] = keyframes[0].position;
  let cameraTarget: [number, number, number] = keyframes[0].target;

  if (keyframes.length > 1) {
    let startKf = keyframes[0];
    let endKf = keyframes[keyframes.length - 1];

    if (time <= keyframes[0].at) {
      startKf = keyframes[0];
      endKf = keyframes[0];
    } else if (time >= keyframes[keyframes.length - 1].at) {
      startKf = keyframes[keyframes.length - 1];
      endKf = keyframes[keyframes.length - 1];
    } else {
      // Find the keyframes surrounding the current time
      for (let i = 0; i < keyframes.length - 1; i++) {
        if (time >= keyframes[i].at && time < keyframes[i + 1].at) {
          startKf = keyframes[i];
          endKf = keyframes[i + 1];
          break;
        }
      }
    }

    // Calculate interpolation factor with the segment's easing curve
    const duration = endKf.at - startKf.at;
    const rawT = duration > 0 ? (time - startKf.at) / duration : 0;
    const t = applyCameraEasing(endKf.easing ?? startKf.easing, rawT);

    cameraPosition = [
      startKf.position[0] + (endKf.position[0] - startKf.position[0]) * t,
      startKf.position[1] + (endKf.position[1] - startKf.position[1]) * t,
      startKf.position[2] + (endKf.position[2] - startKf.position[2]) * t,
    ];
    cameraTarget = [
      startKf.target[0] + (endKf.target[0] - startKf.target[0]) * t,
      startKf.target[1] + (endKf.target[1] - startKf.target[1]) * t,
      startKf.target[2] + (endKf.target[2] - startKf.target[2]) * t,
    ];
  }

  return {
    theme,
    visualizer,
    camera: { position: cameraPosition, target: cameraTarget },
    postfx,
    lyrics: preset.lyrics,
  };
}
