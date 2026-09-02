import type { VisualizationStyle } from "./trackConceptAnalyzer";

export interface AudioData {
  bass: number;
  mid: number;
  treble: number;
  overall: number;
  beat: boolean;
  peak: number;
  energy: number;
}

export interface AudioAnalysisData {
  tempo_bpm: number;
  beat_count: number;
  beat_times: number[];
  onset_times: number[];
  energy_curve: number[];
  amplitude_envelope: number[];
  sections: Array<{ type: string; start: number; end: number; energy: number }>;
  confidence: number;
  duration_seconds: number;
  spectral_centroid?: number[];
  spectral_rolloff?: number[];
  spectral_bandwidth?: number[];
  zero_crossing_rate?: number[];
}

export interface VizParams {
  scale: number;
  scaleBoost: number;
  rotationSpeed: number;
  colorShift: number;
  glowIntensity: number;
  lerpSpeed: number;
  materialType: "standard" | "metallic" | "glass" | "neon" | "matte" | "chrome" | "holographic";
  wireframe: boolean;
  opacity: number;
  shadowEnabled: boolean;
  reflectionEnabled: boolean;
  particleCount: number;
  particleSize: number;
  lightIntensity: number;
  ambientColor: string;
  fogEnabled: boolean;
  fogDensity: number;
  showGround: boolean;
  showFloatingShapes: boolean;
  showLightRays: boolean;
  matchTrack: boolean;
  /** Post-processing effects from AI preset */
  postfx?: {
    bloom: number;
    vignette: number;
    glitch: number;
  };
}

export const DEFAULT_VIZ_PARAMS: VizParams = {
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
  matchTrack: false,
};

export interface VisualizerSceneProps {
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
  isPaused: boolean;
  demoEnabled: boolean;
  demoBpm: number;
  onAudioData?: (data: AudioData) => void;
  visualizationStyle: string;
  vizParams: VizParams;
  bgColor?: string;
  meshColor?: string;
  analysisData?: AudioAnalysisData | null;
  audioElapsedRef?: React.MutableRefObject<number>;
  sceneFrozen?: boolean;
  /** LRC lyric data for phrase-synchronized visuals */
  lyrics?: LyricLine[];
  /** Current LRC sync state */
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
  } | null;
}
