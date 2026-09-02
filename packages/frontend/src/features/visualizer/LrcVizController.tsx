import { createContext, useContext, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AudioData, VizParams, AudioAnalysisData } from "./types";
import type { LyricLine } from "./components/LyricOverlay";

interface LrcVizState {
  /** Current target color based on LRC section */
  targetColor: THREE.Color;
  /** Current interpolated color */
  currentColor: THREE.Color;
  /** Current section intensity multiplier */
  intensity: number;
  /** Phrase flash amount (0-1) */
  phraseFlash: number;
}

const LrcVizContext = createContext<LrcVizState>({
  targetColor: new THREE.Color("#6366f1"),
  currentColor: new THREE.Color("#6366f1"),
  intensity: 0.6,
  phraseFlash: 0,
});

export function useLrcViz() {
  return useContext(LrcVizContext);
}

interface LrcVizControllerProps {
  audioData: React.MutableRefObject<AudioData>;
  vizParams: VizParams;
  analysisData?: AudioAnalysisData | null;
  audioElapsedRef?: React.MutableRefObject<number>;
  lyrics?: LyricLine[];
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
  } | null;
  children: React.ReactNode;
}

/**
 * Controller component that synchronizes 3D visualizations with LRC timing data.
 * Provides section-driven color and intensity via React context.
 * Directly manipulates the 3D scene for visible effects.
 */
export function LrcVizController({
  vizParams,
  lrcSync,
  children,
}: LrcVizControllerProps) {
  const state = useRef<LrcVizState>({
    targetColor: new THREE.Color("#6366f1"),
    currentColor: new THREE.Color("#6366f1"),
    intensity: 0.6,
    phraseFlash: 0,
  });
  
  const groupRef = useRef<THREE.Group>(null);

  // Update target when section changes
  useFrame((state, delta) => {
    if (!lrcSync) return;

    const section = lrcSync.currentSection;
    const sectionColors: Record<string, string> = {
      INTRO: "#818cf8",
      VERSE: "#60a5fa",
      "PRE-CHORUS": "#c084fc",
      CHORUS: "#f472b6",
      BRIDGE: "#f59e0b",
      BREAKDOWN: "#34d399",
      "BUILD-UP": "#fb923c",
      DROP: "#ef4444",
      "FINAL CHORUS": "#e879f9",
      "FINAL DROP": "#f43f5e",
      OUTRO: "#94a3b8",
    };

    const sectionIntensities: Record<string, number> = {
      INTRO: 0.4,
      VERSE: 0.6,
      "PRE-CHORUS": 0.7,
      CHORUS: 1.0,
      BRIDGE: 0.7,
      BREAKDOWN: 0.5,
      "BUILD-UP": 0.8,
      DROP: 1.5,
      "FINAL CHORUS": 1.3,
      "FINAL DROP": 1.6,
      OUTRO: 0.4,
    };

    vizParams.meshColor = sectionColors[section] || "#6366f1";
    state.current.intensity = sectionIntensities[section] ?? 0.6;

    // Smooth color interpolation
    state.current.targetColor.set(sectionColors[section] || "#6366f1");
    state.current.currentColor.lerp(state.current.targetColor, delta * 3);

    // Phrase flash
    if (lrcSync.isPhraseStart) {
      state.current.phraseFlash = 1.0;
    } else {
      state.current.phraseFlash = Math.max(0, state.current.phraseFlash - delta * 4);
    }

    // Apply effects to the visualization group
    if (groupRef.current) {
      const targetScale = 1 + (state.current.intensity - 0.6) * 0.3 + state.current.phraseFlash * 0.2;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 5);
      
      // Rotation speed based on section intensity
      groupRef.current.rotation.y += delta * state.current.intensity * 0.3;
    }
  });

  return (
    <LrcVizContext.Provider value={state.current}>
      <group ref={groupRef}>
        {children}
      </group>
    </LrcVizContext.Provider>
  );
}

/** Helper to get section color for materials */
export function getSectionColor(section: string, defaultColor: string): string {
  const sectionColors: Record<string, string> = {
    INTRO: "#818cf8",
    VERSE: "#60a5fa",
    "PRE-CHORUS": "#c084fc",
    CHORUS: "#f472b6",
    BRIDGE: "#f59e0b",
    BREAKDOWN: "#34d399",
    "BUILD-UP": "#fb923c",
    DROP: "#ef4444",
    "FINAL CHORUS": "#e879f9",
    "FINAL DROP": "#f43f5e",
    OUTRO: "#94a3b8",
  };
  return sectionColors[section] || defaultColor;
}

/** Helper to get section intensity */
export function getSectionIntensity(section: string): number {
  const intensityMap: Record<string, number> = {
    INTRO: 0.4,
    VERSE: 0.6,
    "PRE-CHORUS": 0.7,
    CHORUS: 1.0,
    BRIDGE: 0.7,
    BREAKDOWN: 0.5,
    "BUILD-UP": 0.8,
    DROP: 1.3,
    "FINAL CHORUS": 1.1,
    "FINAL DROP": 1.4,
    OUTRO: 0.4,
  };
  return intensityMap[section] ?? 0.6;
}
