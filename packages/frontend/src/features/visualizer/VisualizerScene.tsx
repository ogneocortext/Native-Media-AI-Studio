import { useRef, useEffect } from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  AudioReactiveCore,
  OrbitalParticles,
  FrequencyRings,
  EnergyWaves,
  SpectrumBars,
  GeometricViz,
  PulseRings,
  VinylDisc,
  AuroraRibbon,
  OceanWaves,
  FractalViz,
  StormViz,
  InfernoViz,
} from "./VisualizationStyles";
import { useRealAudio, useDemoAudio } from "./audioHooks";
import { updateTrackFeatures } from "./trackFeatures";
import type { VisualizerSceneProps } from "./types";

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
}: VisualizerSceneProps) {
  // Pass elapsed ref to hook so it reads live value inside useFrame
  const realData = useRealAudio(analyserRef, isPlaying, isPaused, analysisData, audioElapsedRef);
  const demoData = useDemoAudio(demoEnabled && !isPlaying && !isPaused, demoBpm);
  const audioData = isPlaying ? realData : demoData;

  // Update track features once per frame (shared across all visualizations)
  useFrame(() => {
    updateTrackFeatures(analysisData, audioElapsedRef?.current ?? 0);
  });

  // Pass audio data to parent for spectrum display
  const onAudioDataRef = useRef(onAudioData);
  onAudioDataRef.current = onAudioData;
  useEffect(() => {
    const interval = setInterval(() => {
      if (onAudioDataRef.current) {
        onAudioDataRef.current(audioData.current);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [audioData]);

  const renderVisualization = () => {
    const props = { audioData, vizParams, analysisData, sceneFrozen };
    switch (visualizationStyle) {
      case "waveform": return <AudioReactiveCore {...props} />;
      case "particles": return <OrbitalParticles {...props} />;
      case "neural": return <FrequencyRings {...props} />;
      case "cosmic": return <EnergyWaves {...props} />;
      case "fractal": return <FractalViz {...props} />;
      case "pulse": return <PulseRings {...props} />;
      case "storm": return <StormViz {...props} />;
      case "vinyl": return <VinylDisc {...props} />;
      case "synthwave": return <SpectrumBars {...props} />;
      case "aurora": return <AuroraRibbon {...props} />;
      case "inferno": return <InfernoViz {...props} />;
      case "ocean": return <OceanWaves {...props} />;
      case "geometric":
      default: return <GeometricViz {...props} />;
    }
  };

  return (
    <>
      {vizParams.fogEnabled && <fogExp2 attach="fog" args={[bgColor ?? "#050505", vizParams.fogDensity]} />}
      <ambientLight intensity={vizParams.lightIntensity * 0.55} color={vizParams.ambientColor} />
      <pointLight position={[6, 6, 6]} intensity={vizParams.lightIntensity * 1.2} decay={0} color="#fff" />
      <pointLight position={[-5, -3, 4]} intensity={vizParams.lightIntensity * 0.7} decay={0} color="#4da6ff" />
      <pointLight position={[0, 4, -6]} intensity={vizParams.lightIntensity * 0.5} decay={0} color={meshColor} />

      {renderVisualization()}

      {vizParams.showGround && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3, 0]} receiveShadow={false}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#111111" metalness={0.9} roughness={0.15} />
        </mesh>
      )}

      <OrbitControls enablePan={false} enableZoom={true} minDistance={3} maxDistance={15} autoRotate={false} dampingFactor={0.05} enableDamping />
    </>
  );
}
