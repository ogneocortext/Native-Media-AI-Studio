import type { VisualizationStyle } from "./trackConceptAnalyzer";

export interface AudioData { bass: number; mid: number; treble: number; overall: number; beat: boolean; }

export interface VizParams {
  // Model
  scale: number;
  scaleBoost: number;
  rotationSpeed: number;
  colorShift: number;
  glowIntensity: number;
  lerpSpeed: number;
  // Material
  materialType: "standard" | "metallic" | "glass" | "neon" | "matte";
  wireframe: boolean;
  opacity: number;
  // Scene
  shadowEnabled: boolean;
  reflectionEnabled: boolean;
  particleCount: number;
  particleSize: number;
  // Environment
  lightIntensity: number;
  ambientColor: string;
  fogEnabled: boolean;
  fogDensity: number;
  // Props
  showGround: boolean;
  showFloatingShapes: boolean;
  showLightRays: boolean;
  // Match Track
  matchTrack: boolean;
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
  shadowEnabled: true,
  reflectionEnabled: true,
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
  visualizationStyle: VisualizationStyle;
  vizParams: VizParams;
}
