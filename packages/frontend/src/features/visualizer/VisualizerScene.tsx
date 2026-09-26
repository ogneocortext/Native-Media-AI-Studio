import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { LrcVizController } from "./LrcVizController";
import { PostFX } from "./VisualizationFX";
import { WebGPUPostFX } from "./webgpu/WebGPUPostFX";
import {
  AudioReactiveCore,
  AuroraRibbon,
  EnergyWaves,
  FractalViz,
  FrequencyRings,
  GeometricViz,
  InfernoViz,
  OceanWaves,
  OrbitalParticles,
  PulseRings,
  SpectrumBars,
  StormViz,
  ThreeParticlesDemo,
  VinylDisc,
} from "./viz-styles";
import { useDemoAudio, useRealAudio } from "./audioHooks";
import { useAudioAnalysisWorker } from "./useAudioAnalysisWorker";
import { computeLrcSync, computeSectionBounds, EMPTY_LRC_SYNC } from "./useLrcSync";
import type { LrcSyncData } from "./useLrcSync";
import { getStoryState } from "./storyboard";
import type { StoryBeat, Storyboard } from "./storyboard";
import type { LyricLine } from "./components/LyricOverlay";
import { getSectionIntensity } from "./sectionHelpers";
import { updateTrackFeatures } from "./trackFeatures";
import type { AudioData, VisualizerSceneProps } from "./types";

// ---------------------------------------------------------------------------
// PostFX selector — chooses TSL (WebGPU) or GLSL (WebGL) pipeline
// ---------------------------------------------------------------------------
function PostFXSelector({ audioData, lrcSync, lrcSyncRef, prefersReducedMotion }: {
  audioData: React.MutableRefObject<AudioData>;
  lrcSync?: { isPhraseStart: boolean; currentSection: string } | null;
  lrcSyncRef?: { current: { isPhraseStart: boolean; currentSection: string } | null };
  prefersReducedMotion?: boolean;
}) {
  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;
  if (isWebGPU) {
    return <WebGPUPostFX audioData={audioData} lrcSync={lrcSync} lrcSyncRef={lrcSyncRef} />;
  }
  return <PostFX audioData={audioData} lrcSync={lrcSync} lrcSyncRef={lrcSyncRef} safeMode={prefersReducedMotion} />;
}

interface Props extends VisualizerSceneProps {
  /** LRC lyric data for phrase-synchronized visuals */
  lyrics?: LyricLine[];
  /** Current LRC sync state — full type from VisualizerSceneProps */
  lrcSync?: VisualizerSceneProps["lrcSync"];
  /** Narrative storyboard (acts) for story-driven modulation */
  storyboard?: Storyboard | null;
  /** When false, the scene is hidden but kept mounted to preserve graph stability */
  active?: boolean;
}

export function VisualizerScene({
  analyserRef,
  isPlaying,
  isPaused,
  demoEnabled,
  demoBpm,
  onAudioData,
  visualizationStyle,
  vizParams,
  bgColor = "#050505",
  meshColor = "#6366f1",
  analysisData,
  audioElapsedRef,
  sceneFrozen,
  lyrics = [],
  lrcSync = null,
  storyboard = null,
  prefersReducedMotion = false,
  perceptualScale = "mel",
  active = true,
  sampleAudio,
  stems,
}: Props) {
  // Pass elapsed ref to hook so it reads live value inside useFrame
  const audioWorker = useAudioAnalysisWorker({
    // The worker is only needed for the real analyser path. Avoid creating
    // and messaging a worker while the demo/paused visualizer is running.
    enabled: isPlaying,
    perceptualScale,
  });
  const realData = useRealAudio(
    analyserRef,
    isPlaying,
    isPaused,
    analysisData,
    audioElapsedRef,
    perceptualScale,
    undefined,
    audioWorker,
  );
  const demoData = useDemoAudio(
    demoEnabled && !isPlaying && !isPaused,
    demoBpm,
    perceptualScale,
  );
  const audioData = isPlaying ? realData : demoData;

  // Per-frame LRC + story state from the compensated audio clock (see audioTiming.ts).
  // The React-state `lrcSync` prop is quantized to ~20 fps — too coarse for the
  // 150 ms phrase-pulse window — so frame-critical children read these refs.
  const sectionBounds = useMemo(() => computeSectionBounds(lyrics), [lyrics]);
  const storyboardRef = useRef(storyboard);
  storyboardRef.current = storyboard;
  const lrcSyncLiveRef = useRef<LrcSyncData>(EMPTY_LRC_SYNC);
  const storyLiveRef = useRef<StoryBeat | null>(null);

  // Update track features once per frame (shared across all visualizations)
  useFrame(() => {
    // Prefer the latency-compensated clock callback when the parent supplies one;
    // this avoids a potential one-frame lag between the parent rAF update and
    // the R3F useFrame callback.
    const heard = sampleAudio ? sampleAudio() : (audioElapsedRef?.current ?? 0);
    updateTrackFeatures(analysisData, heard);
    lrcSyncLiveRef.current = lyrics.length ? computeLrcSync(lyrics, heard, sectionBounds) : EMPTY_LRC_SYNC;
    storyLiveRef.current = getStoryState(storyboardRef.current, heard).beat;
  });

  // Pass audio data to parent for spectrum display
  const onAudioDataRef = useRef(onAudioData);
  onAudioDataRef.current = onAudioData;
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      if (onAudioDataRef.current) {
        onAudioDataRef.current(audioData.current);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [isPlaying, audioData]);

  const renderVisualization = () => {
    const props = {
      audioData,
      vizParams,
      analysisData,
      sceneFrozen,
      lrcSync,
      lyrics,
      prefersReducedMotion,
      stems,
      audioElapsedRef,
    };
    // Wrap with LRC controller for section-synchronized color/intensity
    const viz = (() => {
      switch (visualizationStyle) {
        case "waveform":
          return <AudioReactiveCore {...props} />;
        case "particles":
          return <OrbitalParticles {...props} />;
        case "neural":
          return <FrequencyRings {...props} />;
        case "cosmic":
          return <EnergyWaves {...props} />;
        case "fractal":
          return <FractalViz {...props} />;
        case "pulse":
          return <PulseRings {...props} />;
        case "storm":
          return <StormViz {...props} />;
        case "vinyl":
          return <VinylDisc {...props} />;
        case "synthwave":
          return <SpectrumBars {...props} />;
        case "aurora":
          return <AuroraRibbon {...props} />;
        case "inferno":
          return <InfernoViz {...props} />;
        case "ocean":
          return <OceanWaves {...props} />;
        case "geometric":
        default:
          return <GeometricViz {...props} />;
        case "three-particles":
          return <ThreeParticlesDemo {...props} />;
      }
    })();

    return (
      <LrcVizController
        audioData={audioData}
        vizParams={vizParams}
        analysisData={analysisData}
        audioElapsedRef={audioElapsedRef}
        lyrics={lyrics}
        lrcSync={lrcSync}
        lrcSyncRef={lrcSyncLiveRef}
        storyRef={storyLiveRef}
      >
        {viz}
      </LrcVizController>
    );
  };

  return (
    <group visible={active}>
      <>
        {vizParams.fogEnabled && (
          <fogExp2
            attach="fog"
            args={[bgColor ?? "#050505", vizParams.fogDensity]}
          />
        )}
        {/* IBL studio environment (local Lightformers — no HDR fetch) gives metals
            and clearcoat materials real reflections; 2026 standard lighting rig. */}
        <Environment resolution={64} frames={1}>
          <Lightformer
            form="rect"
            intensity={
              2.2 * (lrcSync ? getSectionIntensity(lrcSync.currentSection) : 1)
            }
            position={[0, 5, -4]}
            rotation={[Math.PI / 2.4, 0, 0]}
            scale={[9, 4, 1]}
            color="#dfe8ff"
          />
          <Lightformer
            form="circle"
            intensity={1.6}
            position={[-5, 2, 3]}
            scale={3}
            color="#8ea2ff"
          />
          <Lightformer
            form="circle"
            intensity={1.1}
            position={[5, -1, 2]}
            scale={2.4}
            color={meshColor}
          />
          <Lightformer
            form="rect"
            intensity={0.9}
            position={[0, -4, 2]}
            rotation={[-Math.PI / 2.6, 0, 0]}
            scale={[8, 3, 1]}
            color="#2a2f45"
          />
        </Environment>
        {/* Key/fill/rim — physical falloff (decay 2) instead of legacy decay-0 */}
        <ambientLight
          intensity={vizParams.lightIntensity * 0.35}
          color={vizParams.ambientColor}
        />
        <pointLight
          position={[6, 6, 6]}
          intensity={vizParams.lightIntensity * (prefersReducedMotion ? 15 : 40)}
          decay={2}
          color="#fff"
        />
        <pointLight
          position={[-5, -3, 4]}
          intensity={vizParams.lightIntensity * (prefersReducedMotion ? 8 : 22)}
          decay={2}
          color="#4da6ff"
        />
        <pointLight
          position={[0, 4, -6]}
          intensity={vizParams.lightIntensity * (prefersReducedMotion ? 6 : 16)}
          decay={2}
          color={meshColor}
        />

        {renderVisualization()}

        {vizParams.showGround && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -3, 0]}
            receiveShadow={false}
          >
            <planeGeometry args={[20, 20]} />
            <meshStandardMaterial
              color="#111111"
              metalness={0.9}
              roughness={0.15}
            />
          </mesh>
        )}

        {/* Post pipeline: bloom + film grade — now LRC-reactive (phrase pulse boosts bloom) */}
        <PostFXSelector audioData={audioData} lrcSync={lrcSync} lrcSyncRef={lrcSyncLiveRef} prefersReducedMotion={prefersReducedMotion} />

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={3}
          maxDistance={15}
          autoRotate={false}
          dampingFactor={0.05}
          enableDamping
        />
      </>
    </group>
  );
}
