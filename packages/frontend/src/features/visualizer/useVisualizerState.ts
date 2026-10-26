/**
 * useVisualizerState &mdash; single source of truth for all Visualizer UI state.
 * Extracted from Visualizer.tsx (T-VIZ-02). Zero behavior change.
 */
import { useEffect, useRef, useState } from "react";
import type {
  AudioAnalysisData,
  AudioData,
  PerceptualScale,
  StemAnalysisData,
  VizParams,
} from "./types";
import { DEFAULT_VIZ_PARAMS } from "./types";
import type { ChannelMeters } from "./professionalMixer/types";
import type { ReactivityTriad } from "./audioReactivityProcessor";
import type { StemName } from "./components/StemMixer";
import type { RenderStats } from "./components/RenderStats";
import type { LyricLine } from "./components/LyricOverlay";
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
  csvContent: string;
  vizParams: VizParams;
  trackMetadata: Record<string, { bpm?: number; duration?: number }>;
  analysisData: Record<string, AudioAnalysisData>;
  stemsData: Record<string, StemAnalysisData>;
  analyzing: boolean;
  rendererReady: boolean;
  rendererBackend: string;
  lyrics: LyricLine[];
  modeFade: number;
  lastBeatIdxRef: React.MutableRefObject<number>;
  lastBeatAtRef: React.MutableRefObject<number>;
  lastAudioDataAtRef: React.MutableRefObject<number | null>;
  last3DUiUpdateRef: React.MutableRefObject<number>;
  testStateRef: React.MutableRefObject<{
    vizMode: VizMode; canvas2DMode: Canvas2DMode;
    currentFilename: string | null; isPlaying: boolean;
    liveAudioData: AudioData; visualizationStyle: VisualizationStyle;
    kineticPreset: string; loadedPresetName: string | null;
    storyboard: unknown; activeVisualPresetId: string | null;
    visualsVisible: boolean; lyricsVisible: boolean;
    characterVisible: boolean;
  }>;
  prevTestState: React.MutableRefObject<{
    vizMode: VizMode; canvas2DMode: Canvas2DMode;
    currentFilename: string | null; isPlaying: boolean;
    liveAudioData: AudioData; visualizationStyle: VisualizationStyle;
    kineticPreset: string; loadedPresetName: string | null;
    storyboard: unknown; activeVisualPresetId: string | null;
    visualsVisible: boolean; lyricsVisible: boolean;
    characterVisible: boolean;
  }>;
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
  perceptualScale: PerceptualScale | undefined;
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
  setCsvContent: Setter<string>;
  setVizParams: Setter<VizParams>;
  setTrackMetadata: Setter<VisualizerState["trackMetadata"]>;
  setAnalysisData: Setter<VisualizerState["analysisData"]>;
  setStemsData: Setter<VisualizerState["stemsData"]>;
  setAnalyzing: Setter<boolean>;
  setRendererReady: Setter<boolean>;
  setRendererBackend: Setter<string>;
  setLyrics: Setter<VisualizerState["lyrics"]>;
  setModeFade: Setter<number>;
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
  setPerceptualScale: Setter<PerceptualScale | undefined>;
  setLoadedPreset: Setter<VisualizerState["loadedPreset"]>;
};


export function useVisualizerState() {
  const [bgColor, setBgColor] = useState("#050505");
  const [meshColor, setMeshColor] = useState("#6366f1");
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveAudioData, setLiveAudioData] = useState<AudioData>({
    bass: 0, mid: 0, treble: 0, overall: 0, beat: false,
    peak: 0, energy: 0, drumType: null, nextBeatIn: 0,
  });
  const [adaptiveDpr, setAdaptiveDpr] = useState<[number, number]>([1, 1.5]);
  const [renderStats, setRenderStats] = useState<RenderStats | null>(null);
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const [openOverlay, setOpenOverlay] = useState<OverlayId>(null);
  const [activeVisualPresetId, setActiveVisualPresetId] = useState<string | null>(null);
  const [activeShaderPreset, setActiveShaderPreset] = useState<ShaderPresetName | undefined>(undefined);
  const [reactivityGain, setReactivityGain] = useState(1.0);
  const [frequencyFocus, setFrequencyFocus] = useState<"balanced" | "bass" | "mid" | "treble">("balanced");
  const [reactivityTriad, setReactivityTriad] = useState<ReactivityTriad>(() => {
    try {
      const raw = localStorage.getItem(REACTIVITY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ReactivityTriad>;
        const num = (v: unknown, fallback: number): number => typeof v === "number" && Number.isFinite(v) ? v : fallback;
        return {
          sensitivity: num(parsed.sensitivity, DEFAULT_REACTIVITY_TRIAD.sensitivity),
          attack: num(parsed.attack, DEFAULT_REACTIVITY_TRIAD.attack),
          release: num(parsed.release, DEFAULT_REACTIVITY_TRIAD.release),
          beatResponse: num(parsed.beatResponse, DEFAULT_REACTIVITY_TRIAD.beatResponse),
        };
      }
    } catch {
      // no-op — fall through to defaults
    }
    return DEFAULT_REACTIVITY_TRIAD;
  });
  useEffect(() => {
    try {
      localStorage.setItem(REACTIVITY_STORAGE_KEY, JSON.stringify(reactivityTriad));
    } catch {
      // no-op
    }
  }, [reactivityTriad]);
  const [activeGenrePresetId, setActiveGenrePresetId] = useState<string | null>(null);
  const [stemsMixerState, setStemsMixerState] = useState<{ muted: Record<StemName, boolean>; volumes: Record<StemName, number>; } | null>(null);
  const [proMixerMeters, setProMixerMeters] = useState<Record<StemName, ChannelMeters> | null>(null);
  const [useProMixer, setUseProMixer] = useState(false);
  const [csvContent, setCsvContent] = useState<string>("");
  const [vizParams, setVizParams] = useState<VizParams>(DEFAULT_VIZ_PARAMS);
  const [trackMetadata, setTrackMetadata] = useState<
    Record<string, { bpm?: number; duration?: number }>
  >({});
  const [analysisData, setAnalysisData] = useState<Record<string, AudioAnalysisData>>({});
  const [stemsData, setStemsData] = useState<Record<string, StemAnalysisData>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [vizMode, setVizMode] = useState<VizMode>("3d");
  const [canvas2DMode, setCanvas2DMode] = useState<Canvas2DMode>("bars");
  const [sceneFrozen, setSceneFrozen] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [visualsVisible, setVisualsVisible] = useState(true);
  const [lyricsVisible, setLyricsVisible] = useState(true);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [characterVisible, setCharacterVisible] = useState(true);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAnimDemo, setShowAnimDemo] = useState(false);
  const [showTheatreStudio, setShowTheatreStudio] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showAudioBrowser, setShowAudioBrowser] = useState(false);
  const [pendingTrack, setPendingTrack] = useState<string | null>(null);
  const [loopAnchor, setLoopAnchor] = useState<number | null>(null);
  const [loopRegion, setLoopRegion] = useState<{ start: number; end: number } | null>(null);
  const [kineticPreset, setKineticPreset] = useState("cinematic");
  const [visualizationStyle, setVisualizationStyle] = useState<VisualizationStyle>("geometric");
  const [perceptualScale, setPerceptualScale] = useState<PerceptualScale | undefined>(undefined);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererBackend, setRendererBackend] = useState("");
  const [modeFade, setModeFade] = useState(0);
  const [loadedPreset, setLoadedPreset] = useState<VisualPreset | null>(null);

  const lastBeatIdxRef = useRef(-1);
  const lastBeatAtRef = useRef(0);
  const lastAudioDataAtRef = useRef<number | null>(null);
  const last3DUiUpdateRef = useRef(0);
  const testStateRef = useRef<{
    vizMode: VizMode; canvas2DMode: Canvas2DMode;
    currentFilename: string | null; isPlaying: boolean;
    liveAudioData: AudioData; visualizationStyle: VisualizationStyle;
    kineticPreset: string; loadedPresetName: string | null;
    storyboard: unknown; activeVisualPresetId: string | null;
    visualsVisible: boolean; lyricsVisible: boolean;
    characterVisible: boolean;
  }>({
    vizMode: "3d", canvas2DMode: "bars",
    currentFilename: null, isPlaying: false,
    liveAudioData: { bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0, drumType: null, nextBeatIn: 0 },
    visualizationStyle: "geometric", kineticPreset: "", loadedPresetName: null,
    storyboard: null, activeVisualPresetId: null,
    visualsVisible: true, lyricsVisible: true, characterVisible: true,
  });
  const prevTestState = useRef(testStateRef.current);

  return {
    bgColor, meshColor, demoEnabled, audioUrl, currentFilename, isPlaying, isPaused, error,
    liveAudioData, adaptiveDpr, renderStats, aiEnhancing, openOverlay,
    activeVisualPresetId, activeShaderPreset, reactivityGain, frequencyFocus, reactivityTriad,
    activeGenrePresetId, stemsMixerState, proMixerMeters, useProMixer,
    csvContent, vizParams, trackMetadata, analysisData, stemsData, analyzing,
    rendererReady, rendererBackend, lyrics, modeFade,
    elapsed, audioDuration, vizMode, canvas2DMode, sceneFrozen, prefersReducedMotion,
    visualsVisible, lyricsVisible, characterVisible,
    showTestPanel, showSettings, showAnimDemo, showTheatreStudio, showExportModal, showAIPanel,
    showAudioBrowser, pendingTrack, loopAnchor, loopRegion, kineticPreset, visualizationStyle, perceptualScale, loadedPreset,
    lastBeatIdxRef, lastBeatAtRef, lastAudioDataAtRef, last3DUiUpdateRef,
    testStateRef, prevTestState,
    setBgColor, setMeshColor, setDemoEnabled, setAudioUrl, setCurrentFilename, setIsPlaying, setIsPaused, setError,
    setLiveAudioData, setAdaptiveDpr, setRenderStats, setAiEnhancing, setOpenOverlay,
    setActiveVisualPresetId, setActiveShaderPreset, setReactivityGain, setFrequencyFocus, setReactivityTriad,
    setActiveGenrePresetId, setStemsMixerState, setProMixerMeters, setUseProMixer,
    setCsvContent, setVizParams, setTrackMetadata, setAnalysisData, setStemsData, setAnalyzing,
    setRendererReady, setRendererBackend, setLyrics, setModeFade,
    setElapsed, setAudioDuration, setVizMode, setCanvas2DMode, setSceneFrozen, setPrefersReducedMotion,
    setVisualsVisible, setLyricsVisible, setCharacterVisible,
    setShowTestPanel, setShowSettings, setShowAnimDemo, setShowTheatreStudio, setShowExportModal, setShowAIPanel,
    setShowAudioBrowser, setPendingTrack, setLoopAnchor, setLoopRegion, setKineticPreset, setVisualizationStyle, setPerceptualScale, setLoadedPreset,
  } as VisualizerState & VisualizerStateSetters;
}
