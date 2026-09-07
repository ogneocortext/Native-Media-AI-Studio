import * as THREE from "three";
import type { AnimObject, CameraMode, ParticleConfig, SceneConfig } from "../types";

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
  beatAnalysis: any;
  activeTemplateId: string | null;
  backgroundImageUrl: string;
  backgroundImageVisible: boolean;
  renderPlaying: boolean;
  animationDuration: number;
  keyframeTracks: any[];
  createMeshForObject: (obj: AnimObject, THREE: any) => Promise<THREE.Object3D>;
  getCurrentBeat: (elapsed: number) => any;
  generatedSceneUpdateRef: React.RefObject<((time: number, delta: number) => void) | null>;
  onAnimationTimeChange: (time: number) => void;
}

export interface UseThreeSceneResult {
  sceneRef: React.RefObject<THREE.Scene | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  objectsMapRef: React.RefObject<Map<string, THREE.Object3D>>;
  particlesRef: React.RefObject<THREE.Points | null>;
  bloomPassRef: React.RefObject<any>;
  bloomComposerRef: React.RefObject<any>;
  finalComposerRef: React.RefObject<any>;
  composerRef: React.RefObject<any>;
  caPassRef: React.RefObject<any>;
  grainPassRef: React.RefObject<any>;
  vignettePassRef: React.RefObject<any>;
  shakeRef: React.RefObject<number>;
  bgImageTextureRef: React.RefObject<THREE.Texture | null>;
  audioContextRef: React.RefObject<AudioContext | null>;
  analyserRef: React.RefObject<AnalyserNode | null>;
  audioSourceRef: React.RefObject<MediaElementAudioSourceNode | null>;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  audioFreqArrayRef: React.RefObject<Uint8Array | null>;
  threeRef: React.RefObject<any>;
  lastUiUpdateRef: React.RefObject<number>;
  frameCountRef: React.RefObject<number>;
  characterMixersRef: React.RefObject<Map<string, any>>;
  sceneLoading: boolean;
  beatActive: boolean;
  animationTime: number;
  renderPlaying: boolean;
  setRenderPlaying: (v: boolean) => void;
  setBeatActive: (v: boolean) => void;
  setSceneLoading: (v: boolean) => void;
}

export interface UseObjectManagerOptions {
  objects: AnimObject[];
  setObjects: React.Dispatch<React.SetStateAction<AnimObject[]>>;
  selectedObject: string | null;
  setSelectedObject: React.Dispatch<React.SetStateAction<string | null>>;
  sceneRef: React.RefObject<THREE.Scene | null>;
  objectsMapRef: React.RefObject<Map<string, THREE.Object3D>>;
  characterMixersRef: React.RefObject<Map<string, any>>;
  characterAnimDataRef: React.RefObject<Map<string, { mixer: any; action: any; clips: string[] }>>;
  createMeshForObject: (obj: AnimObject, THREE: any) => Promise<THREE.Object3D>;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  setParticleConfig?: (config: any) => void;
  setCameraMode?: (mode: CameraMode) => void;
}

export interface UseObjectManagerResult {
  addObject: (type: AnimObject["type"], overrides?: Omit<Partial<AnimObject>, "id" | "type">) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<AnimObject>) => void;
  loadTemplate: (template: any) => void;
  characterAnimState: { isPlaying: boolean; currentTime: number; duration: number; clipNames: string[] } | undefined;
  setCharacterAnimState: React.Dispatch<React.SetStateAction<{ isPlaying: boolean; currentTime: number; duration: number; clipNames: string[] } | undefined>>;
  refreshCharacterAnimState: (objId: string) => void;
  handleAnimPlayPause: () => void;
  handleAnimSeek: (time: number) => void;
  handleAnimSelect: (clipName: string) => void;
  handleViewportReset: () => void;
  exportFrame: () => void;
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
  setTrackMetadata: React.Dispatch<React.SetStateAction<Record<string, { bpm?: number; duration?: number }>>>;
  setLibraryTracks: React.Dispatch<React.SetStateAction<Array<{ filename: string }>>>;
  setTracksLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setTracksError: React.Dispatch<React.SetStateAction<string | null>>;
  addObject: (type: AnimObject["type"], overrides?: Omit<Partial<AnimObject>, "id" | "type">) => void;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  audioContextRef: React.RefObject<AudioContext | null>;
  analyserRef: React.RefObject<AnalyserNode | null>;
  audioSourceRef: React.RefObject<MediaElementAudioSourceNode | null>;
}

export interface UseTrackManagerResult {
  beatAnalysis: any;
  beatLoading: boolean;
  beatError: string | null;
  getCurrentBeat: (elapsed: number) => any;
  getCurrentBeatRef: React.RefObject<(elapsed: number) => any>;
  handleSelectTrack: (filename: string) => void;
  toggleAudio: () => Promise<void>;
}
