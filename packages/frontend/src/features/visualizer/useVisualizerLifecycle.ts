/**
 * useVisualizerLifecycle &mdash; global input, loop, capture and harness.
 *
 * Extracted from Visualizer.tsx (T-VIZ-13). Owns everything that is not
 * track selection, playback clock, or preset application:
 *
 * - dev keyboard shortcuts (Ctrl+Shift+T test panel, Ctrl+Shift+A analyze),
 * - `handleLoopToggle` — A-B loop: set-start &rarr; set-end &rarr; clear,
 * - `captureFrame` — PNG snapshot of the topmost visible canvas,
 * - the stage keyboard map (space / arrows / 1-9 / f / l / h / Escape),
 * - the outside-click overlay dismisser,
 * - mode crossfade (brief black fade when switching visualization modes),
 * - reduced-motion (OS preference + manual toggle),
 * - the __VIZ_TEST__ harness (dev-only, registered once, gated on import.meta.env.DEV),
 * - the testStateRef sync that keeps `getState` fresh without re-registering
 *   the harness every frame.
 *
 * Zero behavior change.
 */
import { useCallback, useEffect } from "react";
import { showToast } from "../../utils/toast";
import { cleanTrackName } from "./visualizerHelpers";
import { CANVAS_2D_MODES, type Canvas2DMode } from "./visualizerHelpers";
import type { VizMode } from "./visualizerHelpers";
import type { VisualizationStyle } from "./trackConceptAnalyzer";
import type { ShaderPresetName } from "./shaders";
import type { VisualizerStateSetters } from "./useVisualizerState";

interface TestState {
  vizMode: VizMode;
  canvas2DMode: Canvas2DMode;
  currentFilename: string | null;
  isPlaying: boolean;
  liveAudioData: unknown;
  visualizationStyle: string;
  kineticPreset: string;
  loadedPresetName: string | null;
  storyboard: unknown;
  activeVisualPresetId: string | null;
  activeShaderPreset: ShaderPresetName | undefined;
  visualsVisible: boolean;
  lyricsVisible: boolean;
  characterVisible: boolean;
}

// Function-typed properties (not method shorthand) so destructuring the api
// object can't trip unbound-method — these callbacks never use `this`.
export interface UseVisualizerLifecycleApi {
  togglePlayPause: () => void;
  cycleVizMode: (dir: 1 | -1) => void;
  toggleFocusMode: () => void;
  toggleOverlay: (id: "shortcuts" | "more" | "fx") => void;
  handleAnalyzeTrack: (filename: string) => Promise<void>;
  handleSelectLibraryTrack: (fileRef: string) => Promise<void>;
}

export interface UseVisualizerLifecycleOptions {
  state: {
    vizMode: VizMode;
    loopRegion: { start: number; end: number } | null;
    loopAnchor: number | null;
    prefersReducedMotion: boolean;
    openOverlay: string | null;
    showTestPanel: boolean;
    currentFilename: string | null;
    isPlaying: boolean;
    liveAudioData: unknown;
    visualizationStyle: string;
    kineticPreset: string;
    storyboard: unknown;
    loadedPreset: { name: string } | null;
    visualsVisible: boolean;
    lyricsVisible: boolean;
    characterVisible: boolean;
    canvas2DMode: Canvas2DMode;
    activeVisualPresetId: string | null;
    activeShaderPreset: ShaderPresetName | undefined;
  };
  setters: Pick<
    VisualizerStateSetters,
    | "setLoopRegion"
    | "setLoopAnchor"
    | "setPrefersReducedMotion"
    | "setShowTestPanel"
    | "setVizMode"
    | "setCanvas2DMode"
    | "setOpenOverlay"
    | "setVisualsVisible"
    | "setLyricsVisible"
    | "setCharacterVisible"
    | "setModeFade"
    | "setVisualizationStyle"
    | "setActiveShaderPreset"
  >;
  refs: {
    audioElRef: React.MutableRefObject<HTMLAudioElement | null>;
    audioElapsedRef: React.MutableRefObject<number>;
    prevModeRef: React.MutableRefObject<VizMode | null>;
    testStateRef: React.MutableRefObject<TestState>;
    prevTestState: React.MutableRefObject<TestState>;
  };
  api: UseVisualizerLifecycleApi;
}

// Function-typed properties so destructuring can't trip unbound-method.
export interface UseVisualizerLifecycleResult {
  handleLoopToggle: () => void;
  captureFrame: () => void;
}

/** Dev-only `window.__VIZ_TEST__` harness surface (see effect below). */
interface VizTestHarness {
  selectTrack: (filename: string) => Promise<void>;
  setMode: (mode: "3d" | "shader" | "2d") => void;
  setStyle: (style: VisualizationStyle) => void;
  set2DMode: (mode: Canvas2DMode) => void;
  setShaderPreset: (preset: ShaderPresetName) => void;
  togglePlay: () => void;
  getState: () => TestState;
  toggleTestPanel: () => void;
  setLayerVisible: (layer: "visuals" | "lyrics" | "character", v: boolean) => void;
  toggleLayer: (layer: "visuals" | "lyrics" | "character") => void;
}

export function useVisualizerLifecycle({
  state,
  setters,
  refs,
  api,
}: UseVisualizerLifecycleOptions): UseVisualizerLifecycleResult {
  const {
    vizMode,
    loopRegion,
    loopAnchor,
    openOverlay,
    currentFilename,
    isPlaying,
    liveAudioData,
    visualizationStyle,
    kineticPreset,
    storyboard,
    loadedPreset,
    visualsVisible,
    lyricsVisible,
    characterVisible,
    canvas2DMode,
    activeVisualPresetId,
    activeShaderPreset,
  } = state;
  const {
    setLoopRegion,
    setLoopAnchor,
    setPrefersReducedMotion,
    setShowTestPanel,
    setVizMode,
    setCanvas2DMode,
    setOpenOverlay,
    setVisualsVisible,
    setLyricsVisible,
    setCharacterVisible,
    setModeFade,
    setVisualizationStyle,
    setActiveShaderPreset,
  } = setters;
  const { audioElRef, audioElapsedRef, prevModeRef, testStateRef, prevTestState } = refs;
  const {
    togglePlayPause,
    cycleVizMode,
    toggleFocusMode,
    toggleOverlay,
    handleAnalyzeTrack,
    handleSelectLibraryTrack,
  } = api;

  // DEV-ONLY keyboard shortcuts: Ctrl+Shift+T toggles the test panel,
  // Ctrl+Shift+A analyzes the selected track. Not reachable in production
  // builds (import.meta.env is statically replaced at build time).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!import.meta.env.DEV) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setShowTestPanel((v) => !v);
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "a" &&
        currentFilename
      ) {
        e.preventDefault();
        void handleAnalyzeTrack(currentFilename);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFilename, handleAnalyzeTrack]);

  // A-B loop: one button cycles set-start &rarr; set-end &rarr; clear. Reads
  // the latency-compensated clock ref so the callback keeps a stable identity
  // (the stage keyboard map registers it once).
  const handleLoopToggle = useCallback(() => {
    const el = audioElRef.current;
    const duration = el?.duration;
    if (!el || duration === undefined || !Number.isFinite(duration) || duration <= 0) return;
    const now = audioElapsedRef.current;
    if (loopRegion) {
      setLoopRegion(null);
      setLoopAnchor(null);
    } else if (loopAnchor === null) {
      setLoopAnchor(now);
    } else {
      const start = loopAnchor;
      // A degenerate span (clicked twice in the same instant) falls back
      // to a 5 s loop so the button never arms a zero-length region.
      const end = now > start + 0.25 ? now : Math.min(duration, start + 5);
      setLoopRegion({ start, end });
      setLoopAnchor(null);
    }
  }, [loopRegion, loopAnchor]);

  // Frame snapshot: the topmost visible canvas. Shader and 2D canvases
  // paint over the always-mounted 3D canvas, so scan in reverse DOM
  // order — ties resolve to the canvas on top.
  const captureFrame = useCallback(() => {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>(".viz-page canvas"));
    let best: HTMLCanvasElement | null = null;
    let bestArea = 0;
    for (let i = canvases.length - 1; i >= 0; i--) {
      const rect = canvases[i].getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = canvases[i];
      }
    }
    if (!best) {
      showToast("No visualizer canvas to capture", "error");
      return;
    }
    try {
      const url = best.toDataURL("image/png");
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `${cleanTrackName(currentFilename ?? "visualizer")}-frame-${stamp}.png`;
      a.click();
      showToast("Frame captured as PNG", "success");
    } catch {
      showToast("Frame capture failed", "error");
    }
  }, [currentFilename]);

  // Stage keyboard map — "instruments are played, not clicked".
  // Kept in a separate listener so the Ctrl+Shift+T / Ctrl+Shift+A shortcuts
  // above are untouched.
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el || typeof el.tagName !== "string") return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "select" || tag === "textarea" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // Leave modified shortcuts (Ctrl+Shift+T test panel, Ctrl+Shift+A analyze) alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Never hijack typing.
      if (isTypingTarget(e.target)) return;
      const k = e.key;
      if (k === " ") {
        // preventDefault stops page scroll and cancels focused-button activation.
        e.preventDefault();
        togglePlayPause();
      } else if (k === "ArrowRight") {
        e.preventDefault();
        cycleVizMode(1);
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        cycleVizMode(-1);
      } else if (k >= "1" && k <= "9") {
        // Jump to a 2D mode and switch to 2D so the keypress visibly does something.
        setVizMode("2d");
        setCanvas2DMode(CANVAS_2D_MODES[Number(k) - 1]);
      } else if (k === "f" || k === "F") {
        toggleFocusMode();
      } else if (k === "l" || k === "L") {
        handleLoopToggle();
      } else if (k === "h" || k === "H" || k === "?") {
        toggleOverlay("shortcuts");
      } else if (k === "Escape") {
        setOpenOverlay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlayPause, cycleVizMode, toggleFocusMode, toggleOverlay, handleLoopToggle]);

  // Plan 1.3 — a single outside-click dismisser replaces the two per-menu
  // listeners (shortcuts / more). Clicks on the toggles themselves, on the
  // open menu, or inside the shader HUD (FX panel + preset dropdown) are
  // allowed through; anything else — including the scrim — closes the overlay.
  useEffect(() => {
    if (openOverlay === null) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          ".viz-shortcuts-menu, .viz-more-menu, .viz-shader-hud, [data-viz-overlay-toggle]",
        )
      ) {
        return;
      }
      setOpenOverlay(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openOverlay]);

  // Mode crossfade: brief black fade when switching visualization modes.
  useEffect(() => {
    if (prevModeRef.current !== vizMode) {
      prevModeRef.current = vizMode;
      // Fade to black
      setModeFade(1);
      // At peak opacity, start fading back in (content swaps naturally mid-fade)
      const t = setTimeout(() => setModeFade(0), 180);
      return () => clearTimeout(t);
    }
  }, [vizMode]);

  // Respect OS reduced-motion preference and allow manual toggle.
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setPrefersReducedMotion(e.matches);
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Keeps `testStateRef.current` fresh so `getState` (exposed via
  // __VIZ_TEST__) reads current values without re-registering the harness
  // every frame. DEV-ONLY — the whole block is dropped from the production
  // bundle because `import.meta.env` is statically replaced at build time.
  useEffect(() => {
    if (
      prevTestState.current.vizMode !== vizMode ||
      prevTestState.current.currentFilename !== currentFilename ||
      prevTestState.current.isPlaying !== isPlaying ||
      prevTestState.current.liveAudioData !== liveAudioData ||
      prevTestState.current.visualizationStyle !== visualizationStyle ||
      prevTestState.current.kineticPreset !== kineticPreset ||
      prevTestState.current.storyboard !== storyboard ||
      prevTestState.current.activeVisualPresetId !== activeVisualPresetId ||
      prevTestState.current.visualsVisible !== visualsVisible ||
      prevTestState.current.lyricsVisible !== lyricsVisible ||
      prevTestState.current.characterVisible !== characterVisible ||
      prevTestState.current.canvas2DMode !== canvas2DMode ||
      prevTestState.current.activeShaderPreset !== activeShaderPreset
    ) {
      testStateRef.current = {
        vizMode,
        canvas2DMode,
        currentFilename,
        isPlaying,
        liveAudioData,
        visualizationStyle,
        kineticPreset,
        loadedPresetName: loadedPreset?.name ?? null,
        storyboard,
        activeVisualPresetId,
        activeShaderPreset,
        visualsVisible,
        lyricsVisible,
        characterVisible,
      };
      prevTestState.current = { ...testStateRef.current };
    }
  }, [
    vizMode,
    currentFilename,
    isPlaying,
    liveAudioData,
    visualizationStyle,
    kineticPreset,
    storyboard,
    loadedPreset,
    visualsVisible,
    lyricsVisible,
    characterVisible,
    canvas2DMode,
    activeShaderPreset,
  ]);

  // __VIZ_TEST__ harness — dev-only, registered once.
  //
  // DEV-ONLY. This harness was unguarded and shipped in the production
  // bundle, where `window.__VIZ_TEST__` let anyone with a devtools console
  // load an arbitrary library track and drive every render mode and layer.
  // Playwright runs against the Vite dev server, so `import.meta.env.DEV` is
  // true there and every spec keeps working. `import.meta.env` is statically
  // replaced at build time, so the whole block is dropped from the production
  // bundle rather than merely skipped at runtime.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const harness: VizTestHarness = {
      selectTrack: async (filename: string) => handleSelectLibraryTrack(filename),
      setMode: (mode: "3d" | "shader" | "2d") => setVizMode(mode),
      setStyle: (style: VisualizationStyle) => setVisualizationStyle(style),
      set2DMode: (mode: Canvas2DMode) => setCanvas2DMode(mode),
      setShaderPreset: (preset: ShaderPresetName) => setActiveShaderPreset(preset),
      togglePlay: () => togglePlayPause(),
      getState: () => ({ ...testStateRef.current }),
      toggleTestPanel: () => setShowTestPanel((v) => !v),
      setLayerVisible: (layer: "visuals" | "lyrics" | "character", v: boolean) => {
        if (layer === "visuals") setVisualsVisible(v);
        if (layer === "lyrics") setLyricsVisible(v);
        if (layer === "character") setCharacterVisible(v);
      },
      toggleLayer: (layer: "visuals" | "lyrics" | "character") => {
        if (layer === "visuals") setVisualsVisible((x) => !x);
        if (layer === "lyrics") setLyricsVisible((x) => !x);
        if (layer === "character") setCharacterVisible((x) => !x);
      },
    };
    (window as Window & { __VIZ_TEST__?: VizTestHarness }).__VIZ_TEST__ = harness;
    return () => {
      delete (window as Window & { __VIZ_TEST__?: VizTestHarness }).__VIZ_TEST__;
    };
  }, [handleSelectLibraryTrack]);

  return { handleLoopToggle, captureFrame };
}
