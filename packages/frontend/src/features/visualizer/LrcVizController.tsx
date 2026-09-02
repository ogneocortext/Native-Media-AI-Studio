import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useRef } from "react";
import * as THREE from "three";
import type { LyricLine } from "./components/LyricOverlay";
import { getSectionColor, getSectionIntensity } from "./sectionHelpers";
import type { AudioAnalysisData, AudioData, VizParams } from "./types";

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
    currentLine: LyricLine | null;
    nextLine: LyricLine | null;
    timeToNextPhrase: number;
    currentIndex: number;
    totalLines: number;
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
  const vizState = useRef<LrcVizState>({
    targetColor: new THREE.Color("#6366f1"),
    currentColor: new THREE.Color("#6366f1"),
    intensity: 0.6,
    phraseFlash: 0,
  });

  const groupRef = useRef<THREE.Group>(null);

  // LRC-driven scene modulation — now uses sectionProgress/lineProgress for visible morph
  useFrame((_frameState, delta) => {
    const section = lrcSync?.currentSection || "VERSE";
    const color = getSectionColor(section, vizParams.meshColor || "#6366f1");
    const baseIntensity = getSectionIntensity(section);
    // Boost intensity by lineProgress (build within phrase) and sectionProgress (build within section)
    const lineBoost = lrcSync ? lrcSync.lineProgress * 0.15 : 0;
    const sectionBoost = lrcSync ? lrcSync.sectionProgress * 0.1 : 0;
    const intensity = baseIntensity + lineBoost + sectionBoost;
    vizState.current.intensity = intensity;

    vizState.current.targetColor.set(color);
    vizState.current.currentColor.lerp(vizState.current.targetColor, delta * 3);

    if (lrcSync?.isPhraseStart) {
      vizState.current.phraseFlash = 1.0;
    } else {
      vizState.current.phraseFlash = Math.max(0, vizState.current.phraseFlash - delta * 3.5);
    }

    if (groupRef.current) {
      const targetScale = 1 + (intensity - 0.6) * 0.32 + vizState.current.phraseFlash * 0.28 + lineBoost * 0.2;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 4.5);
      // Phrase-advance nudges rotation
      groupRef.current.rotation.y += delta * (0.15 + intensity * 0.25 + vizState.current.phraseFlash * 0.6);
      // SectionProgress drives subtle pitch for verse→chorus lift
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, (lrcSync?.sectionProgress ?? 0) * 0.08 - 0.04, delta * 2);
    }
  });

  return (
    <LrcVizContext.Provider value={vizState.current}>
      <group ref={groupRef}>{children}</group>
    </LrcVizContext.Provider>
  );
}
