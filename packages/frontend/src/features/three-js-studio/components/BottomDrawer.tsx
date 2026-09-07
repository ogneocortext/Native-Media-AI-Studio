import { ChevronDown, Settings, Zap } from "lucide-react";
import { Box } from "lucide-react";
import { InspectorTab } from "./InspectorTab";
import { ObjectsTab } from "./ObjectsTab";
import { SceneTab } from "./SceneTab";
import type { AnimObject, CameraMode } from "../types";

interface BottomDrawerProps {
  open: boolean;
  drawerTab: "objects" | "inspector" | "scene";
  focusMode: boolean;
  objects: AnimObject[];
  selectedObject: string | null;
  activeTemplateId: string | null;
  selectedObj: AnimObject | undefined;
  characterAnimState: any;
  sceneConfig: any;
  particleConfig: any;
  cameraMode: CameraMode;
  fps: number;
  backgroundImageUrl: string;
  backgroundImageVisible: boolean;
  libraryImages: Array<{ url: string; label: string }>;
  onDrawerTabChange: (tab: "objects" | "inspector" | "scene") => void;
  onSelectObject: (id: string) => void;
  onAddObject: (type: AnimObject["type"], overrides?: Omit<Partial<AnimObject>, "id" | "type">) => void;
  onRemoveObject: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<AnimObject>) => void;
  onLoadTemplate: (template: any) => void;
  onSceneConfigChange: (config: any) => void;
  onParticleConfigChange: (config: any) => void;
  onCameraModeChange: (mode: CameraMode) => void;
  onFpsChange: (fps: number) => void;
  onBackgroundImageChange: (url: string) => void;
  onBackgroundImageVisibleChange: (visible: boolean) => void;
  onAnimationPlayPause: () => void;
  onAnimationSeek: (time: number) => void;
  onAnimationSelect: (clipName: string) => void;
  onClose: () => void;
}

export function BottomDrawer({
  open,
  drawerTab,
  focusMode,
  objects,
  selectedObject,
  activeTemplateId,
  selectedObj,
  characterAnimState,
  sceneConfig,
  particleConfig,
  cameraMode,
  fps,
  backgroundImageUrl,
  backgroundImageVisible,
  libraryImages,
  onDrawerTabChange,
  onSelectObject,
  onAddObject,
  onRemoveObject,
  onUpdateObject,
  onLoadTemplate,
  onSceneConfigChange,
  onParticleConfigChange,
  onCameraModeChange,
  onFpsChange,
  onBackgroundImageChange,
  onBackgroundImageVisibleChange,
  onAnimationPlayPause,
  onAnimationSeek,
  onAnimationSelect,
  onClose,
}: BottomDrawerProps) {
  if (!open) return null;
  return (
    <div
      className={`bottom-drawer bg-[#0e0e16] border-t border-gray-800 shrink-0 flex flex-col h-[55vh] sm:h-[45vh] min-h-[280px] max-h-[600px] ${focusMode ? "hidden" : ""}`}
    >
      <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1.5 border-b border-gray-800 bg-[#12121a] shrink-0">
        <button
          onClick={() => onDrawerTabChange("objects")}
          className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${drawerTab === "objects" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
        >
          <Box size={12} />{" "}
          <span className="hidden sm:inline">Objects</span>
          <span className="opacity-60 hidden sm:inline">
            ({objects.length})
          </span>
        </button>
        <button
          onClick={() => onDrawerTabChange("inspector")}
          className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${drawerTab === "inspector" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
        >
          <Zap size={12} />{" "}
          <span className="hidden sm:inline">Inspector</span>
        </button>
        <button
          onClick={() => onDrawerTabChange("scene")}
          className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${drawerTab === "scene" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
        >
          <Settings size={12} />{" "}
          <span className="hidden sm:inline">Scene</span>
        </button>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 shrink-0"
          title="Close panel"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {drawerTab === "objects" && (
          <ObjectsTab
            objects={objects}
            selectedObject={selectedObject}
            activeTemplateId={activeTemplateId}
            onSelectObject={onSelectObject}
            onAddObject={onAddObject}
            onRemoveObject={onRemoveObject}
            onUpdateObject={onUpdateObject}
            onLoadTemplate={onLoadTemplate}
          />
        )}
        {drawerTab === "inspector" && (
          <InspectorTab
            object={selectedObj}
            onUpdate={onUpdateObject}
            animationState={
              selectedObj?.type === "character"
                ? characterAnimState
                : undefined
            }
            onAnimationPlayPause={onAnimationPlayPause}
            onAnimationSeek={onAnimationSeek}
            onAnimationSelect={onAnimationSelect}
          />
        )}
        {drawerTab === "scene" && (
          <SceneTab
            sceneConfig={sceneConfig}
            particleConfig={particleConfig}
            cameraMode={cameraMode}
            fps={fps}
            backgroundImageUrl={backgroundImageUrl}
            backgroundImageVisible={backgroundImageVisible}
            libraryImages={libraryImages}
            onSceneConfigChange={onSceneConfigChange}
            onParticleConfigChange={onParticleConfigChange}
            onCameraModeChange={onCameraModeChange}
            onFpsChange={onFpsChange}
            onBackgroundImageChange={onBackgroundImageChange}
            onBackgroundImageVisibleChange={onBackgroundImageVisibleChange}
          />
        )}
      </div>
    </div>
  );
}
