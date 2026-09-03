// Backward-compatible barrel — re-exports from viz-styles/ modules.
// Import path preserved for any external consumers that still reference
// `./VisualizationStyles`; new code should import from `./viz-styles` directly.
export {
  GeometricViz,
  AudioReactiveCore,
  OrbitalParticles,
  EnergyWaves,
  FrequencyRings,
  PulseRings,
  SpectrumBars,
  VinylDisc,
  AuroraRibbon,
  OceanWaves,
  FractalViz,
  StormViz,
  InfernoViz,
  getSectionColor,
  getSectionIntensity,
} from "./viz-styles";
