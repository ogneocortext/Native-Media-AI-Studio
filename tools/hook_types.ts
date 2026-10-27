/**
 * useVisualizerState &mdash; single source of truth for all Visualizer UI state.
 * Extracted from Visualizer.tsx (T-VIZ-02). Zero behavior change.
 */
import { useEffect, useRef, useState } from "react";
import type { AudioData } from "./types";
import type { ChannelMeters } from "./professionalMixer/types";
import type { ReactivityTriad } from "./audioReactivityProcessor";
import type { StemName } from "./components/StemMixer";
import type { RenderStats } from "./components/RenderStats";
import type { VizMode, Canvas2DMode } from "./visualizerHelpers";
import type { ShaderPresetName } from "./shaders";
import type { VisualPreset } from "./visualPreset";
import type { VisualizationStyle } from "./trackConceptAnalyzer";
import { DEFAULT_REACTIVITY_TRIAD } from "./audioReactivityProcessor";
const REACTIVITY_STORAGE_KEY = "visualizerReactivity:triad";

export type OverlayId = "shortcuts" | "more" | "fx" | null;

export type VisualizerState = {
  bgColor: string; meshColor: string; demoEnabled: boolean;
  audioUrl: string | null; currentFilename: string | null;
  isPlaying: boolean; isPaused: boolean; error: string | null;
  liveAudioData: AudioData; adaptiveDpr: [number, number];
  renderStats: RenderStats | null; aiEnhancing: boolean;
  openOverlay: OverlayId;
  activeVisualPresetId: string | null;
  activeShaderPreset: ShaderPresetName | undefined;
  reactivityGain: number;
  frequencyFocus: "balanced" | "bass" | "mid" | "treble";
  reactivityTriad: ReactivityTriad;
  activeGenrePresetId: string | null;
  stemsMixerState: { muted: Record<StemName, boolean>; volumes: Record<StemName, number>; } | null;
  proMixerMeters: Record<StemName, ChannelMeters> | null;
  useProMixer: boolean;
  elapsed: number; audioDuration: number;
  vizMode: VizMode; canvas2DMode: Canvas2DMode;
  sceneFrozen: boolean; prefersReducedMotion: boolean;
  visualsVisible: boolean; lyricsVisible: boolean;
  characterVisible: boolean;
  showTestPanel: boolean; showSettings: boolean;
  showAnimDemo: boolean; showTheatreStudio: boolean;
  showExportModal: boolean; showAIPanel: boolean;
  showAudioBrowser: boolean;
  pendingTrack: string | null;
  loopAnchor: number | null;
  loopRegion: { start: number; end: number } | null;
  kineticPreset: string; visualizationStyle: VisualizationStyle;
  perceptualScale: string;
  loadedPreset: VisualPreset | null;
};

type Setter<T> = (value: T | ((prev: T) => T)) => void;

export type VisualizerStateSetters = {
  setBgColor: Setter<string>;
  setMeshColor: Setter<string>;
  setDemoEnabled: Setter<boolean>;
  setAudioUrl: Setter<string | null>;
  setCurrentFilename: Setter<string | null>;
  setIsPlaying: Setter<boolean>;
  setIsPaused: Setter<boolean>;
  setError: Setter<string | null>;
  setLiveAudioData: Setter<AudioData>;
  setAdaptiveDpr: Setter<[number, number]>;
  setRenderStats: Setter<RenderStats | null>;
  setAiEnhancing: Setter<boolean>;
  setOpenOverlay: Setter<OverlayId>;
  setActiveVisualPresetId: Setter<string | null>;
  setActiveShaderPreset: Setter<ShaderPresetName | undefined>;
  setReactivityGain: Setter<number>;
  setFrequencyFocus: Setter<"balanced" | "bass" | "mid" | "treble">;
  setReactivityTriad: Setter<ReactivityTriad>;
  setActiveGenrePresetId: Setter<string | null>;
  setStemsMixerState: Setter<VisualizerState["stemsMixerState"]>;
  setProMixerMeters: Setter<VisualizerState["proMixerMeters"]>;
  setUseProMixer: Setter<boolean>;
  setElapsed: Setter<number>;
  setAudioDuration: Setter<number>;
  setVizMode: Setter<VizMode>;
  setCanvas2DMode: Setter<Canvas2DMode>;
  setSceneFrozen: Setter<boolean>;
  setPrefersReducedMotion: Setter<boolean>;
  setVisualsVisible: Setter<boolean>;
  setLyricsVisible: Setter<boolean>;
  setCharacterVisible: Setter<boolean>;
  setShowTestPanel: Setter<boolean>;
  setShowSettings: Setter<boolean>;
  setShowAnimDemo: Setter<boolean>;
  setShowTheatreStudio: Setter<boolean>;
  setShowExportModal: Setter<boolean>;
  setShowAIPanel: Setter<boolean>;
  setShowAudioBrowser: Setter<boolean>;
  setPendingTrack: Setter<string | null>;
  setLoopAnchor: Setter<number | null>;
  setLoopRegion: Setter<{ start: number; end: number } | null>;
  setKineticPreset: Setter<string>;
  setVisualizationStyle: Setter<VisualizationStyle>;
  setPerceptualScale: Setter<string>;
  setLoadedPreset: Setter<VisualizerState["loadedPreset"]>;
};

