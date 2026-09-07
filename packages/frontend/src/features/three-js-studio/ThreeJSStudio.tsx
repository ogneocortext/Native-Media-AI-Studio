import { Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUIStore } from "../../state/uiStore";
import { AISceneGenerator } from "./components/AISceneGenerator";
import type {
  AnimObject,
  CameraMode,
  ParticleConfig,
  SceneConfig,
} from "./types";
import { DEFAULT_OBJECTS, DEFAULT_PARTICLES, DEFAULT_SCENE } from "./threeStudioConfig";
import { StudioHeader } from "./components/StudioHeader";
import { TrackInfoBar } from "./components/TrackInfoBar";
import { PlaybackControls } from "./components/PlaybackControls";
import { CodePanel } from "./components/CodePanel";
import { StudioHUD } from "./components/StudioHUD";
import { BottomDrawer } from "./components/BottomDrawer";
import { useMeshFactory } from "./hooks/useMeshFactory";
import { useCodeApplier } from "./hooks/useCodeApplier";
import { useThreeScene } from "./hooks/useThreeScene";
import { useObjectManager } from "./hooks/useObjectManager";
import { useTrackManager } from "./hooks/useTrackManager";

export function ThreeJSStudio() {
  const [searchParams] = useSearchParams();
  const storyboardParam = searchParams.get("storyboard");
  const autoGenerateParam = searchParams.get("autogenerate");
  const storyboardSceneParam = searchParams.get("scene");
  const trackParam = searchParams.get("track");

  const { focusMode, toggleFocusMode } = useUIStore();

  // ---- State ----
  const [isPlaying, setIsPlaying] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"objects" | "inspector" | "scene">(
    "objects",
  );
  const [sceneConfig, setSceneConfig] = useState<SceneConfig>(DEFAULT_SCENE);
  const [particleConfig, setParticleConfig] =
    useState<ParticleConfig>(DEFAULT_PARTICLES);
  const [objects, setObjects] = useState<AnimObject[]>(DEFAULT_OBJECTS);
  const [selectedObject, setSelectedObject] = useState<string | null>(
    "crown-1",
  );
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [activeTemplateId, _setActiveTemplateId] = useState<string | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string>("");
  const [backgroundImageVisible, setBackgroundImageVisible] = useState(true);
  const [libraryImages, _setLibraryImages] = useState<
    Array<{ url: string; label: string }>
  >([]);
  const [bpm, setBpm] = useState(150);
  const [beatSync, setBeatSync] = useState(false);
  const [fps, setFps] = useState(24);
  const [libraryTracks, setLibraryTracks] = useState<
    Array<{ filename: string }>
  >([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [trackMetadata, setTrackMetadata] = useState<
    Record<string, { bpm?: number; duration?: number }>
  >({});
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [beatActive, setBeatActive] = useState(false);
  const [animationTime, setAnimationTime] = useState(0);
  const [animationDuration, _setAnimationDuration] = useState(30);
  const [keyframeTracks, _setKeyframeTracks] = useState<any[]>([]);
  const [codePanelOpen, setCodePanelOpen] = useState(false);
  const [pastedCode, setPastedCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [performanceMode, setPerformanceMode] = useState(false);
  const [renderPlaying, setRenderPlaying] = useState(false);

  // ---- Canvas refs ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ---- Mesh factory ----
  const { createMeshForObject } = useMeshFactory();

  // ---- Code applier ----
  const { handleApplyCode, generatedSceneUpdateRef } =
    useCodeApplier({
      sceneRef: { current: null },
      setCodeError,
    });

  // ---- Three scene engine ----
  const {
    sceneRef: _sceneRef,
    rendererRef,
    cameraRef,
    sceneLoading,
    beatActive: sceneBeatActive,
    renderPlaying: sceneRenderPlaying,
  } = useThreeScene({
    canvasRef,
    containerRef,
    objects,
    sceneConfig,
    particleConfig,
    beatSync,
    bpm,
    cameraMode,
    isPlaying,
    isAudioPlaying,
    beatAnalysis: null,
    activeTemplateId,
    backgroundImageUrl,
    backgroundImageVisible,
    renderPlaying,
    animationDuration,
    keyframeTracks,
    createMeshForObject,
    getCurrentBeat: () => ({ ready: false, isOnBeat: false, timeSinceLastBeat: 0, beatWindowSec: 0 }),
    generatedSceneUpdateRef,
    onAnimationTimeChange: setAnimationTime,
  });

  // Sync beatActive from scene engine
  useEffect(() => {
    setBeatActive(sceneBeatActive);
  }, [sceneBeatActive]);

  // Sync renderPlaying from scene engine
  useEffect(() => {
    setRenderPlaying(sceneRenderPlaying);
  }, [sceneRenderPlaying]);

  // ---- Object manager ----
  const {
    addObject,
    removeObject,
    updateObject,
    loadTemplate,
    characterAnimState,
    handleAnimPlayPause,
    handleAnimSeek,
    handleAnimSelect,
    handleViewportReset,
    exportFrame,
  } = useObjectManager({
    objects,
    setObjects,
    selectedObject,
    setSelectedObject,
    characterAnimDataRef: { current: new Map() },
    cameraRef,
    rendererRef,
    setParticleConfig,
    setCameraMode,
  });

  // ---- Track manager ----
  const {
    beatAnalysis,
    beatLoading,
    beatError,
    handleSelectTrack,
    toggleAudio,
  } = useTrackManager({
    selectedTrack,
    setSelectedTrack,
    isAudioPlaying,
    setIsAudioPlaying,
    setIsPlaying,
    setRenderPlaying,
    setBeatSync,
    setBpm,
    setTrackMetadata,
    setLibraryTracks,
    setTracksLoading,
    setTracksError,
    addObject,
    audioElementRef: { current: null },
    audioContextRef: { current: null },
    analyserRef: { current: null },
    audioSourceRef: { current: null },
  });

  // ---- Effects that stay in main component ----
  
  // Auto-close panels when entering focus mode
  useEffect(() => {
    if (focusMode) {
      setDrawerOpen(false);
      setCodePanelOpen(false);
    }
  }, [focusMode]);

  // Escape key exits focus mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) {
        toggleFocusMode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, toggleFocusMode]);

  // Trigger canvas resize after focus mode toggle
  useEffect(() => {
    if (focusMode) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [focusMode]);

  // Auto-select track from URL param
  useEffect(() => {
    if (trackParam && trackParam !== selectedTrack) {
      setSelectedTrack(trackParam);
      setBeatSync(true);
    }
  }, [trackParam]);

  // Derived state
  const selectedObj = objects.find((o) => o.id === selectedObject);

  // ---- Render ----
  return (
    <div
      className={`relative w-full h-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden ${focusMode ? "focus-mode" : ""}`}
    >
      <StudioHeader
        focusMode={focusMode}
        drawerOpen={drawerOpen}
        codePanelOpen={codePanelOpen}
        performanceMode={performanceMode}
        selectedTrack={selectedTrack}
        isAudioPlaying={isAudioPlaying}
        tracksLoading={tracksLoading}
        tracksError={tracksError}
        libraryTracks={libraryTracks}
        trackMetadata={trackMetadata}
        onExportFrame={exportFrame}
        onToggleCodePanel={() => setCodePanelOpen((v) => !v)}
        onTogglePerformanceMode={() => setPerformanceMode((v) => !v)}
        onToggleFocusMode={toggleFocusMode}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        onAddObject={addObject}
        onSelectTrack={handleSelectTrack}
        onViewportReset={handleViewportReset}
      />

      <TrackInfoBar
        beatSync={beatSync}
        bpm={bpm}
        beatAnalysis={beatAnalysis}
        beatLoading={beatLoading}
        beatError={beatError}
        beatPunch={sceneConfig.beatPunch}
        focusMode={focusMode}
        onBpmChange={setBpm}
        onBeatSyncToggle={() => setBeatSync((v) => !v)}
        onBeatPunchChange={(value) =>
          setSceneConfig((prev) => ({ ...prev, beatPunch: value }))
        }
      />

      <div
        ref={containerRef}
        className="flex-1 relative bg-[#0a0a0f] overflow-hidden min-h-0"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {sceneLoading && (
          <div className="absolute inset-0 bg-[#0a0a0f] flex items-center justify-center z-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-purple-300">
                Initializing 3D scene…
              </span>
            </div>
          </div>
        )}

        <div
          className={`ai-panel absolute top-2 right-2 w-72 max-h-[calc(100%-1rem)] overflow-y-auto z-10 ${focusMode ? "hidden" : ""}`}
        >
          <AISceneGenerator
            selectedTrack={selectedTrack || null}
            onApplyCode={handleApplyCode}
            storyboard={storyboardParam}
            autoGenerate={autoGenerateParam === "true"}
            storyboardScene={
              storyboardSceneParam ? parseInt(storyboardSceneParam, 10) : null
            }
          />
        </div>

        <CodePanel
          open={codePanelOpen}
          pastedCode={pastedCode}
          codeError={codeError}
          onCodeChange={setPastedCode}
          onApply={() => handleApplyCode(pastedCode)}
          onClose={() => setCodePanelOpen(false)}
        />

        <StudioHUD
          objects={objects}
          cameraMode={cameraMode}
          beatSync={beatSync}
          bpm={bpm}
          sceneConfig={sceneConfig}
          beatActive={beatActive}
          focusMode={focusMode}
        />

        {beatError && selectedTrack && (
          <a
            href="/audio-analysis"
            target="_blank"
            rel="noreferrer"
            className="absolute bottom-2 right-2 bg-amber-900/70 hover:bg-amber-800/80 backdrop-blur px-2.5 py-1 rounded text-amber-100 text-[11px] border border-amber-700/50 pointer-events-auto transition-colors"
          >
            Open Audio Analysis →
          </a>
        )}

        <PlaybackControls
          renderPlaying={renderPlaying}
          animationTime={animationTime}
          animationDuration={animationDuration}
          isAudioPlaying={isAudioPlaying}
          keyframeTracks={keyframeTracks}
          focusMode={focusMode}
          onRenderPlayPause={() => setRenderPlaying((v) => !v)}
          onRenderRewind={() => {
            setRenderPlaying(false);
            setAnimationTime(0);
          }}
          onAudioPlayPause={toggleAudio}
          onAudioStop={() => {
            setIsAudioPlaying(false);
            setIsPlaying(false);
            setRenderPlaying(false);
          }}
          onTimelineChange={(time) => {
            setAnimationTime(time);
            setRenderPlaying(false);
          }}
        />
      </div>

      {focusMode && (
        <button
          onClick={toggleFocusMode}
          className="absolute top-2 left-2 z-20 p-2 bg-amber-600/80 hover:bg-amber-600 rounded-lg text-white shadow-lg backdrop-blur transition-colors"
          title="Exit focus mode (Esc)"
        >
          <Minimize2 size={16} />
        </button>
      )}

      <BottomDrawer
        open={drawerOpen}
        drawerTab={drawerTab}
        focusMode={focusMode}
        objects={objects}
        selectedObject={selectedObject}
        activeTemplateId={activeTemplateId}
        selectedObj={selectedObj}
        characterAnimState={characterAnimState}
        sceneConfig={sceneConfig}
        particleConfig={particleConfig}
        cameraMode={cameraMode}
        fps={fps}
        backgroundImageUrl={backgroundImageUrl}
        backgroundImageVisible={backgroundImageVisible}
        libraryImages={libraryImages}
        onDrawerTabChange={setDrawerTab}
        onSelectObject={setSelectedObject}
        onAddObject={addObject}
        onRemoveObject={removeObject}
        onUpdateObject={updateObject}
        onLoadTemplate={loadTemplate}
        onSceneConfigChange={setSceneConfig}
        onParticleConfigChange={setParticleConfig}
        onCameraModeChange={setCameraMode}
        onFpsChange={setFps}
        onBackgroundImageChange={setBackgroundImageUrl}
        onBackgroundImageVisibleChange={setBackgroundImageVisible}
        onAnimationPlayPause={handleAnimPlayPause}
        onAnimationSeek={handleAnimSeek}
        onAnimationSelect={handleAnimSelect}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
