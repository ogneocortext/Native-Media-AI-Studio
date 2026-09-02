/**
 * Shared types for the Three.js Studio
 *
 * Kept in a separate file so scene templates, the studio component, and
 * future module split-outs can all import the same shapes without circular
 * dependencies.
 */

export type ObjectType = "crown" | "box" | "sphere" | "cylinder" | "cone" | "torus" | "bars" | "character";

export interface AnimObject {
  id: string;
  name: string;
  type: ObjectType;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  visible: boolean;
  bobSpeed: number;
  bobAmount: number;
  rotateSpeed: number;
  /** When true, the object is added to the selective bloom layer and glows. */
  bloom: boolean;
  /** Character-specific: URL to a GLB/GLTF model file (from Hunyuan3D/Blender output). */
  modelUrl?: string;
  /** Character-specific: name of the animation clip to play from the loaded GLB. */
  animationName?: string;
  /** Character-specific: playback speed multiplier for the animation. */
  animationSpeed?: number;
  /** Character-specific: whether the animation should loop. */
  animationLoop?: boolean;
  /** Character-specific: character bible description for prompt regeneration. */
  characterBible?: string;
}

export interface ParticleConfig {
  enabled: boolean;
  count: number;
  size: number;
  color: string;
  speed: number;
  spread: number;
  opacity: number;
}

export interface SceneConfig {
  backgroundColor: string;
  fogEnabled: boolean;
  fogColor: string;
  fogDensity: number;
  bloomStrength: number;
  selectiveBloom: boolean;
  chromaticAberration: number;
  filmGrain: number;
  vignetteStrength: number;
  vignetteRadius: number;
  beatPunch: number;
}

export type CameraMode = "static" | "orbit" | "dolly" | "handheld";
