import type * as THREE from "three";

/**
 * Shared types for the Three.js Studio
 *
 * Kept in a separate file so scene templates, the studio component, and
 * future module split-outs can all import the same shapes without circular
 * dependencies.
 */

export type ObjectType =
  "crown" | "box" | "sphere" | "cylinder" | "cone" | "torus" | "bars" | "character";

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
  /** Optional image URL to use as a material map (diffuse texture) on this object. */
  textureUrl?: string;
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

/** One keyframe sample in a {@link KeyframeTrack}. `target`-less pose
 *  channels stay undefined so the render loop only writes what the
 *  keyframe actually animates. */
export interface KeyframePoint {
  time: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

/** A per-object keyframe track consumed by the render loop's keyframe
 *  pass. `target` is the {@link AnimObject.id} the track drives. */
export interface KeyframeTrack {
  target: string;
  keyframes?: KeyframePoint[];
}

/**
 * Material shape the studio's generated meshes actually carry
 * (`MeshStandardMaterial` / `MeshBasicMaterial`). The base
 * `THREE.Material` type does not declare the PBR fields, and applied
 * scene code can attach arbitrary texture maps — every field is
 * optional so duck-typed access stays honest.
 */
export interface StudioMaterial extends THREE.Material {
  color?: THREE.Color;
  emissive?: THREE.Color;
  map?: THREE.Texture | null;
  metalness?: number;
  roughness?: number;
  emissiveIntensity?: number;
}

/** Per-character animation bookkeeping. The mesh factory writes it
 *  when a GLB with clips loads; the object manager reads it for the
 *  Inspector's play/pause/seek/clip controls. */
export interface CharacterAnimData {
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction | null;
  clips: string[];
}

declare global {
  interface Window {
    /** Camera captured by mountThreeScene; the code applier passes it
     *  to `applyScene(scene, camera, renderer, THREE)`. */
    __camera?: THREE.PerspectiveCamera;
    /** Renderer captured alongside {@link Window.__camera}. */
    __renderer?: THREE.WebGLRenderer;
    /** Per-frame updater installed by applied AI scene code. */
    __sceneUpdate?: ((time: number, delta: number) => void) | null;
    /** One-shot initializer installed by applied AI scene code. */
    __sceneInit?: (() => void) | null;
    /** Legacy hook read by the code applier when invoking generated
     *  scene code (the THREE namespace is also passed positionally). */
    THREE?: unknown;
  }
}
