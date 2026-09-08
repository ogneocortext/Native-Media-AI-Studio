import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { AnimObject, CameraMode } from "../types";
import type { SceneTemplate } from "../sceneTemplates";

export function useObjectManager({
  objects,
  setObjects,
  selectedObject,
  setSelectedObject,
  characterAnimDataRef,
  cameraRef,
  rendererRef,
  setParticleConfig,
  setCameraMode,
}: {
  objects: AnimObject[];
  setObjects: React.Dispatch<React.SetStateAction<AnimObject[]>>;
  selectedObject: string | null;
  setSelectedObject: React.Dispatch<React.SetStateAction<string | null>>;
  characterAnimDataRef: React.RefObject<Map<string, { mixer: any; action: any; clips: string[] }>>;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  setParticleConfig?: (config: any) => void;
  setCameraMode?: (mode: CameraMode) => void;
}) {
  const objectCounterRef = useRef(0);
  const [characterAnimState, setCharacterAnimState] = useState<
    | {
        isPlaying: boolean;
        currentTime: number;
        duration: number;
        clipNames: string[];
      }
    | undefined
  >(undefined);
  const characterAnimStateRef = useRef(characterAnimState);
  useEffect(() => {
    characterAnimStateRef.current = characterAnimState;
  }, [characterAnimState]);

  const addObject = useCallback(
    (type: AnimObject["type"], overrides?: Omit<Partial<AnimObject>, "id" | "type">) => {
      objectCounterRef.current++;
      const id = `${type}-${Date.now()}-${objectCounterRef.current}`;
      const isCharacter = type === "character";
      const newObj: AnimObject = {
        id,
        name: isCharacter
          ? `Character ${objects.length + 1}`
          : `${type.charAt(0).toUpperCase() + type.slice(1)} ${objects.length + 1}`,
        type,
        position: [0, isCharacter ? 0 : 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color:
          type === "sphere"
            ? "#60a5fa"
            : type === "box"
              ? "#a855f7"
              : type === "torus"
                ? "#f43f5e"
                : isCharacter
                  ? "#fbbf24"
                  : "#e2e8f0",
        metalness: isCharacter ? 0.1 : 0.6,
        roughness: isCharacter ? 0.7 : 0.3,
        emissive: isCharacter ? "#1a1000" : "#000000",
        emissiveIntensity: 0.1,
        visible: true,
        bobSpeed: 1.0,
        bobAmount: isCharacter ? 0.05 : 0.15,
        rotateSpeed: 0.2,
        bloom: type === "crown" || isCharacter,
        modelUrl: isCharacter ? "/models/character_rigged.glb" : undefined,
        animationName: undefined,
        animationSpeed: 1,
        animationLoop: true,
        ...overrides,
      };
      setObjects((prev) => [...prev, newObj]);
      setSelectedObject(id);
    },
    [setObjects, setSelectedObject, objects.length],
  );

  const removeObject = useCallback(
    (id: string) => {
      setObjects((prev) => prev.filter((obj: any) => obj.id !== id));
      if (selectedObject === id) {
        const remaining = objects.filter((obj: any) => obj.id !== id);
        setSelectedObject(remaining[0]?.id || null);
      }
    },
    [selectedObject, objects, setObjects, setSelectedObject],
  );

  const updateObject = useCallback(
    (id: string, updates: Partial<AnimObject>) => {
      setObjects((prev) =>
        prev.map((obj) => (obj.id === id ? { ...obj, ...updates } : obj)),
      );
    },
    [setObjects],
  );

  const loadTemplate = useCallback(
    (template: SceneTemplate) => {
      setObjects(template.objects.map((o: any) => ({ ...o })));
      if (setParticleConfig && template.particleConfig) {
        setParticleConfig({ ...template.particleConfig });
      }
      if (setCameraMode && template.cameraMode) {
        setCameraMode(template.cameraMode);
      }
      setSelectedObject(template.objects[0]?.id ?? null);
    },
    [setObjects, setSelectedObject, setParticleConfig, setCameraMode],
  );

  const refreshCharacterAnimState = useCallback((objId: string) => {
    const data = characterAnimDataRef.current.get(objId);
    if (data && data.action) {
      setCharacterAnimState({
        isPlaying: data.action.isRunning(),
        currentTime: data.action.time,
        duration: data.action.getClip().duration,
        clipNames: data.clips,
      });
    } else {
      setCharacterAnimState(undefined);
    }
  }, []);

  const handleAnimPlayPause = useCallback(() => {
    if (!selectedObject) return;
    const data = characterAnimDataRef.current.get(selectedObject);
    if (data && data.action) {
      if (data.action.isRunning()) {
        data.action.pause();
      } else {
        data.action.play();
      }
      refreshCharacterAnimState(selectedObject);
    }
  }, [selectedObject, refreshCharacterAnimState]);

  const handleAnimSeek = useCallback(
    (time: number) => {
      if (!selectedObject) return;
      const data = characterAnimDataRef.current.get(selectedObject);
      if (data && data.action) {
        data.action.time = time;
        data.mixer.update(0);
        refreshCharacterAnimState(selectedObject);
      }
    },
    [selectedObject, refreshCharacterAnimState],
  );

  const handleAnimSelect = useCallback(
    (clipName: string) => {
      if (!selectedObject) return;
      const data = characterAnimDataRef.current.get(selectedObject);
      if (data && data.mixer) {
        const clip = data.mixer.existingAction(clipName)
          ? clipName
          : data.clips[0];
        if (clip) {
          data.action?.stop();
          const newAction = data.mixer.clipAction(clip);
          newAction.play();
          data.action = newAction;
          refreshCharacterAnimState(selectedObject);
        }
      }
    },
    [selectedObject, refreshCharacterAnimState],
  );

  const handleViewportReset = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.position.set(0, 3, 8);
      cameraRef.current.lookAt(0, 0.5, 0);
    }
  }, [cameraRef]);

  const exportFrame = useCallback(() => {
    if (!rendererRef.current) return;
    const link = document.createElement("a");
    link.download = `threejs_frame_${Date.now()}.png`;
    link.href = rendererRef.current.domElement.toDataURL("image/png");
    link.click();
  }, [rendererRef]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (selectedObject && characterAnimStateRef.current?.isPlaying) {
        refreshCharacterAnimState(selectedObject);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [selectedObject, refreshCharacterAnimState]);

  return {
    addObject,
    removeObject,
    updateObject,
    loadTemplate,
    characterAnimState,
    setCharacterAnimState,
    refreshCharacterAnimState,
    handleAnimPlayPause,
    handleAnimSeek,
    handleAnimSelect,
    handleViewportReset,
    exportFrame,
  };
}
