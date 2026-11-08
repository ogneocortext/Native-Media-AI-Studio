import type React from "react";
import type * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { AnimObject, CameraMode, KeyframeTrack, ParticleConfig, SceneConfig } from "../types";
import type { SectionDriverHandle } from "./useTrackMetadata";
import type { AudioAnalysisResult } from "../../../services/api";
import type { BeatState } from "../../../hooks/useBeatTimeline";

/** The runtime `three` module namespace — passed to mesh factories and
 *  applied scene code so they can construct geometries/materials.
 *  `typeof THREE` (value import) is used instead of `typeof import()`
 *  because the repo's consistent-type-imports rule forbids import()
 *  type annotations. */
export type ThreeModule = typeof THREE;

export interface UseThreeSceneOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  objects: AnimObject[];
  sceneConfig: SceneConfig;
  particleConfig: ParticleConfig;
  beatSync: boolean;
  bpm: number;
  cameraMode: CameraMode;
  isPlaying: boolean;
  isAudioPlaying: boolean;
  beatAnalysis: AudioAnalysisResult | null;
  activeTemplateId: string | null;
  backgroundImageUrl: string;
  backgroundImageVisible: boolean;
  renderPlaying: boolean;
  animationDuration: number;
  keyframeTracks: KeyframeTrack[];
  createMeshForObject: (obj: AnimObject, THREE: ThreeModule) => Promise<THREE.Object3D>;
  getCurrentBeat: (elapsed: number) => BeatState;
  generatedSceneUpdateRef: React.RefObject<((time: number, delta: number) => void) | null>;
  onAnimationTimeChange: (time: number) => void;
  onSelectObject?: (id: string | null) => void;
  /** F2: section-aware motion driver. Pass null while the active
   *  template opts out (or no track is loaded) — the loop then drives
   *  the template's cameraMode/beatPunch directly, unchanged. */
  sectionDriver?: SectionDriverHandle | null;
  /** Audio/track seconds getter for the section playhead (the audio
   *  element's currentTime). Null or non-finite → the driver is inert. */
  getPlayheadSec?: () => number | null;
}

export interface UseThreeSceneResult {
  sceneRef: React.RefObject<THREE.Scene | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  objectsMapRef: React.RefObject<Map<string, THREE.Object3D>>;
  particlesRef: React.RefObject<THREE.Points | null>;
  bloomPassRef: React.RefObject<UnrealBloomPass | null>;
  bloomComposerRef: React.RefObject<EffectComposer | null>;
  finalComposerRef: React.RefObject<EffectComposer | null>;
  composerRef: React.RefObject<EffectComposer | null>;
  caPassRef: React.RefObject<ShaderPass | null>;
  grainPassRef: React.RefObject<ShaderPass | null>;
  vignettePassRef: React.RefObject<ShaderPass | null>;
  shakeRef: React.RefObject<number>;
  bgImageTextureRef: React.RefObject<THREE.Texture | null>;
  audioContextRef: React.RefObject<AudioContext | null>;
  analyserRef: React.RefObject<AnalyserNode | null>;
  audioSourceRef: React.RefObject<MediaElementAudioSourceNode | null>;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  audioFreqArrayRef: React.RefObject<Uint8Array | null>;
  threeRef: React.RefObject<ThreeModule | null>;
  lastUiUpdateRef: React.RefObject<number>;
  frameCountRef: React.RefObject<number>;
  characterMixersRef: React.RefObject<Map<string, THREE.AnimationMixer>>;
  sceneLoading: boolean;
  beatActive: boolean;
  animationTime: number;
  renderPlaying: boolean;
  setRenderPlaying: (v: boolean) => void;
  setBeatActive: (v: boolean) => void;
  setSceneLoading: (v: boolean) => void;
  /** F5: render exactly one frame at virtual time `tSec` with
   *  `dtSec` as its step. The canvas holds that frame when this
   *  returns — no rAF, no wall clock. Null before the scene is
   *  built (the call is a safe no-op until then). */
  renderAtTime: (tSec: number, dtSec: number) => void;
  /** F5: quiesce the live loop and reset every stateful driver, so
   *  an export is a pure function of its frame indices (seed, frame
   *  parity, shake, camera blend, section override, light palette,
   *  character mixers, particle layout). Call before frame 0. */
  beginDeterministicRun: () => void;
  /** F5: resume live rendering after the last frame. Safe to call
   *  more than once; pairs with `beginDeterministicRun` in a
   *  finally-style path so a failed export never leaves the scene
   *  frozen. */
  endDeterministicRun: () => void;
}

export interface UseTrackManagerOptions {
  selectedTrack: string;
  setSelectedTrack: React.Dispatch<React.SetStateAction<string>>;
  isAudioPlaying: boolean;
  setIsAudioPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setRenderPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setBeatSync: React.Dispatch<React.SetStateAction<boolean>>;
  setBpm: React.Dispatch<React.SetStateAction<number>>;
  setTrackMetadata: React.Dispatch<
    React.SetStateAction<Record<string, { bpm?: number; duration?: number }>>
  >;
  /** Library entries from the shared audio store; `optionLabel` is display-ready. */
  setLibraryTracks: React.Dispatch<
    React.SetStateAction<{ filename: string; optionLabel: string }[]>
  >;
  setTracksLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setTracksError: React.Dispatch<React.SetStateAction<string | null>>;
  addObject: (
    type: AnimObject["type"],
    overrides?: Omit<Partial<AnimObject>, "id" | "type">,
  ) => void;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  audioContextRef: React.RefObject<AudioContext | null>;
  analyserRef: React.RefObject<AnalyserNode | null>;
  audioSourceRef: React.RefObject<MediaElementAudioSourceNode | null>;
}

export interface UseTrackManagerResult {
  beatAnalysis: AudioAnalysisResult | null;
  beatLoading: boolean;
  beatError: string | null;
  getCurrentBeat: (elapsed: number) => BeatState;
  getCurrentBeatRef: React.RefObject<(elapsed: number) => BeatState>;
  handleSelectTrack: (filename: string) => void;
  toggleAudio: () => Promise<void>;
}

