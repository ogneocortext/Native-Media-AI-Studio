import type { AnimObject, ParticleConfig, SceneConfig } from "./types";

export const BLOOM_LAYER = 1;

export const DEFAULT_SCENE: SceneConfig = {
  backgroundColor: "#0a0a0f",
  fogEnabled: true,
  fogColor: "#0a0a0f",
  fogDensity: 0.012,
  bloomStrength: 0.45,
  selectiveBloom: true,
  chromaticAberration: 0.0015,
  filmGrain: 0.04,
  vignetteStrength: 0.35,
  vignetteRadius: 0.7,
  beatPunch: 0.14,
};

export const DEFAULT_PARTICLES: ParticleConfig = {
  enabled: true,
  count: 150,
  size: 0.018,
  color: "#8b5cf6",
  speed: 0.4,
  spread: 6,
  opacity: 0.6,
};

export const DEFAULT_OBJECTS: AnimObject[] = [
  {
    id: "crown-1",
    name: "Crown",
    type: "crown",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffd700",
    metalness: 0.9,
    roughness: 0.1,
    emissive: "#ff8c00",
    emissiveIntensity: 0.15,
    visible: true,
    bobSpeed: 1.5,
    bobAmount: 0.1,
    rotateSpeed: 0.3,
    bloom: true,
  },
];
