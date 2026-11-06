import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SCENE_TEMPLATES } from "../sceneTemplates";
import { BLOOM_LAYER } from "../threeStudioConfig";
import type { CameraMode } from "../types";
import type { CameraTransitionState } from "../services/cameraTransitions";
import type { SectionDriverHandle } from "./useTrackMetadata";
import type { UseThreeSceneOptions, UseThreeSceneResult } from "./types";
import { mountThreeScene } from "./mountThreeScene";

export function useThreeScene({
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
  beatAnalysis,
  activeTemplateId,
  backgroundImageUrl,
  backgroundImageVisible,
  renderPlaying,
  animationDuration,
  keyframeTracks,
  createMeshForObject,
  getCurrentBeat,
  generatedSceneUpdateRef,
  onAnimationTimeChange,
  onSelectObject,
  sectionDriver = null,
  getPlayheadSec,
}: UseThreeSceneOptions): UseThreeSceneResult {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectsMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const particlesRef = useRef<THREE.Points | null>(null);
  const clockRef = useRef<THREE.Timer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const bloomComposerRef = useRef<EffectComposer | null>(null);
  const finalComposerRef = useRef<EffectComposer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const caPassRef = useRef<ShaderPass | null>(null);
  const grainPassRef = useRef<ShaderPass | null>(null);
  const vignettePassRef = useRef<ShaderPass | null>(null);
  const shakeRef = useRef(0);
  const bgImageTextureRef = useRef<THREE.Texture | null>(null);
  const objectTextureRefs = useRef<Map<string, THREE.Texture>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioFreqArrayRef = useRef<Uint8Array | null>(null);
  const threeRef = useRef<any>(null);
  const lastUiUpdateRef = useRef(0);
  const frameCountRef = useRef(0);
  const characterMixersRef = useRef<Map<string, any>>(new Map());
  const animationRef = useRef(0);
  const controlsRef = useRef<any>(null);
  // F1: an in-flight eased camera blend (mode switch). Null
  // when the camera is driven directly by its mode pose.
  const cameraTransitionRef = useRef<CameraTransitionState | null>(null);
  // The mode the render loop last applied; a change against
  // this is what begins a blend.
  const lastCameraModeRef = useRef(cameraMode);
  // F4: whether the active template opts into beat-phrased
  // animation (anticipation → pop → hold).
  const beatPhraseRef = useRef(false);
  // F2: the section-aware motion driver (null while the active
  // template opts out or no track is loaded).
  const sectionDriverRef = useRef<SectionDriverHandle | null>(null);
  const getPlayheadSecRef = useRef<(() => number | null) | undefined>(undefined);
  // Camera mode the current section asks for; null falls back to the
  // template's cameraMode. Set on a boundary, cleared outside sections.
  const sectionCameraModeRef = useRef<CameraMode | null>(null);
  // Scene lights + their authored colors, captured at scene build so
  // a section's palette shift can hue-rotate against the base.
  const sectionLightsRef = useRef<{ light: THREE.Light; baseColor: THREE.Color }[] | null>(null);
  // F5: deterministic-export clock hijack. While `active`, the loop
  // takes delta/elapsed from the export driver instead of the
  // THREE.Timer, and the live rAF driver is quiesced for the whole
  // export — not just per captured frame — so no state (frame parity,
  // shake, camera drift) mutates between two captures.
  const exportClockRef = useRef({ active: false, t: 0, dt: 0 });
  const exportActiveRef = useRef(false);
  const frameRunnerRef = useRef<(() => void) | null>(null);
  const renderAtTimeRef = useRef<(tSec: number, dtSec: number) => void>(() => {
    void 0;
  });
  const resetDeterministicRef = useRef<() => void>(() => {
    void 0;
  });
  // Particle layout at scene build, so an export can start from a
  // known state instead of wherever the live drift left them.
  const initialParticlePositionsRef = useRef<Float32Array | null>(null);
  const onSelectObjectRef = useRef(onSelectObject);
  const pointerHandlersRef = useRef<{
    down: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);

  const [sceneLoading, setSceneLoading] = useState(true);
  const [beatActive, setBeatActive] = useState(false);
  const [animationTime, _setAnimationTime] = useState(0);
  const [renderPlayingState, setRenderPlaying] = useState(renderPlaying);

  const beatAnalysisRef = useRef(beatAnalysis);
  const objectsRef = useRef(objects);
  const beatSyncRef = useRef(beatSync);
  const bpmRef = useRef(bpm);
  const cameraModeRef = useRef(cameraMode);
  const isPlayingRef = useRef(isPlaying);
  const isAudioPlayingRef = useRef(isAudioPlaying);
  const particleConfigRef = useRef(particleConfig);
  const sceneConfigRef = useRef(sceneConfig);
  const activeAudioDrivenRef = useRef<string | undefined>(undefined);
  const animationTimeRef = useRef(0);
  const beatActiveRef = useRef(false);
  const keyframeTracksRef = useRef(keyframeTracks);
  const getCurrentBeatRef = useRef(getCurrentBeat);
  const renderPlayingRef = useRef(renderPlaying);

  useEffect(() => {
    keyframeTracksRef.current = keyframeTracks;
  }, [keyframeTracks]);
  useEffect(() => {
    beatAnalysisRef.current = beatAnalysis;
  }, [beatAnalysis]);
  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);
  useEffect(() => {
    beatSyncRef.current = beatSync;
  }, [beatSync]);
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);
  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);
  useEffect(() => {
    sectionDriverRef.current = sectionDriver;
    // A driver swap (template opt-in/out) drops any section camera
    // override so the template's mode is authoritative again.
    sectionCameraModeRef.current = null;
  }, [sectionDriver]);
  useEffect(() => {
    getPlayheadSecRef.current = getPlayheadSec;
  }, [getPlayheadSec]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    isAudioPlayingRef.current = isAudioPlaying;
  }, [isAudioPlaying]);
  useEffect(() => {
    particleConfigRef.current = particleConfig;
  }, [particleConfig]);
  useEffect(() => {
    sceneConfigRef.current = sceneConfig;
  }, [sceneConfig]);
  useEffect(() => {
    activeAudioDrivenRef.current = SCENE_TEMPLATES.find(
      (t: any) => t.id === activeTemplateId,
    )?.audioDriven;
  }, [activeTemplateId]);
  // F4: the beat-phrasing flag rides the active template the
  // same way `audioDriven` does — per-template, not global.
  useEffect(() => {
    beatPhraseRef.current = Boolean(
      SCENE_TEMPLATES.find((t: any) => t.id === activeTemplateId)?.beatPhrase,
    );
  }, [activeTemplateId]);
  useEffect(() => {
    animationTimeRef.current = animationTime;
  }, [animationTime]);
  useEffect(() => {
    beatActiveRef.current = beatActive;
  }, [beatActive]);
  useEffect(() => {
    getCurrentBeatRef.current = getCurrentBeat;
  }, [getCurrentBeat]);
  useEffect(() => {
    renderPlayingRef.current = renderPlayingState;
  }, [renderPlayingState]);
  // The parent owns the transport state; without this reverse sync the
  // Preview button only toggled the UI and never reached the render loop.
  useEffect(() => {
    setRenderPlaying(renderPlaying);
  }, [renderPlaying]);
  useEffect(() => {
    onSelectObjectRef.current = onSelectObject;
  }, [onSelectObject]);

  // Release GPU resources held by a removed object. Without this the scene
  // accumulates undisposed geometries/materials for the whole session (F1).
  const disposeObject3D = (root: THREE.Object3D) => {
    root.traverse((child: any) => {
      child.geometry?.dispose?.();
      const materials = child.material;
      if (!materials) return;
      (Array.isArray(materials) ? materials : [materials]).forEach((m: any) => {
        if (!m) return;
        Object.keys(m).forEach((key) => {
          const value = m[key];
          if (
            value &&
            typeof value === "object" &&
            value.isTexture &&
            value !== bgImageTextureRef.current
          ) {
            value.dispose?.();
          }
        });
        m.dispose?.();
      });
    });
  };

  const disposeEntry = (id: string, root: THREE.Object3D) => {
    characterMixersRef.current.get(id)?.stopAllAction?.();
    characterMixersRef.current.delete(id);
    disposeObject3D(root);
  };

  // Scene init + animation loop
  // Scene init + animation loop — the mount/loop body lives in
  // ./mountThreeScene.ts; this effect only fires on createMeshForObject
  // changes, same as before.
  useEffect(
    () =>
      mountThreeScene({
        canvasRef,
        containerRef,
        sceneRef,
        rendererRef,
        cameraRef,
        objectsMapRef,
        particlesRef,
        clockRef,
        bloomPassRef,
        bloomComposerRef,
        finalComposerRef,
        composerRef,
        caPassRef,
        grainPassRef,
        vignettePassRef,
        shakeRef,
        analyserRef,
        audioFreqArrayRef,
        threeRef,
        lastUiUpdateRef,
        frameCountRef,
        characterMixersRef,
        animationRef,
        controlsRef,
        cameraTransitionRef,
        lastCameraModeRef,
        beatPhraseRef,
        sectionDriverRef,
        getPlayheadSecRef,
        sectionCameraModeRef,
        sectionLightsRef,
        exportClockRef,
        exportActiveRef,
        frameRunnerRef,
        renderAtTimeRef,
        resetDeterministicRef,
        initialParticlePositionsRef,
        onSelectObjectRef,
        pointerHandlersRef,
        objectsRef,
        beatSyncRef,
        bpmRef,
        cameraModeRef,
        isPlayingRef,
        isAudioPlayingRef,
        particleConfigRef,
        sceneConfigRef,
        activeAudioDrivenRef,
        animationTimeRef,
        beatActiveRef,
        keyframeTracksRef,
        getCurrentBeatRef,
        renderPlayingRef,
        generatedSceneUpdateRef,
        createMeshForObject,
        disposeEntry,
        setSceneLoading,
        setBeatActive,
        onAnimationTimeChange,
        animationDuration,
      }),
    [createMeshForObject],
  );

  // Object sync
  useEffect(() => {
    if (!sceneRef.current) return;
    let cancelled = false;
    {
      if (cancelled) return;
      const scene = sceneRef.current;
      const ids = new Set(objects.map((o: any) => o.id));
      objectsMapRef.current.forEach((mesh, id) => {
        if (!ids.has(id)) {
          scene.remove(mesh);
          objectsMapRef.current.delete(id);
          disposeEntry(id, mesh);
        }
      });
      void (async () => {
        for (const obj of objects) {
          if (cancelled) break;
          let mesh = objectsMapRef.current.get(obj.id);
          if (!mesh) {
            mesh = await createMeshForObject(obj, THREE);
            if (!cancelled && mesh) {
              scene.add(mesh);
              objectsMapRef.current.set(obj.id, mesh);
            }
          } else {
            mesh.visible = obj.visible;
            mesh.position.set(...obj.position);
            mesh.rotation.set(...obj.rotation);
            mesh.scale.set(...obj.scale);
            if (
              obj.type === "character" &&
              obj.modelUrl &&
              (mesh as any).__modelUrl !== obj.modelUrl
            ) {
              scene.remove(mesh);
              disposeEntry(obj.id, mesh);
              const newMesh = await createMeshForObject(obj, THREE);
              if (!cancelled) {
                scene.add(newMesh);
                objectsMapRef.current.set(obj.id, newMesh);
                (newMesh as any).__modelUrl = obj.modelUrl;
              }
              continue;
            }
            const um = (m: any) => {
              if (m.material) {
                if (m.material.color) m.material.color.set(obj.color);
                if (m.material.emissive) m.material.emissive.set(obj.emissive);
                m.material.metalness = obj.metalness;
                m.material.roughness = obj.roughness;
                m.material.emissiveIntensity = obj.emissiveIntensity;
              }
            };
            if (mesh instanceof THREE.Group) mesh.traverse(um);
            else um(mesh);
            mesh.traverse((c: any) => {
              if (c.isMesh) {
                c.layers.set(0);
                if (obj.bloom) c.layers.enable(BLOOM_LAYER);
              }
            });
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [objects, createMeshForObject]);

  // Scene config sync
  useEffect(() => {
    sceneConfigRef.current = sceneConfig;
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(sceneConfig.backgroundColor);
      if (sceneRef.current.fog) {
        sceneRef.current.fog.color.set(sceneConfig.fogColor);
        if (sceneRef.current.fog instanceof THREE.FogExp2) {
          sceneRef.current.fog.density = sceneConfig.fogDensity;
        }
      }
    }
    if (bloomPassRef.current) bloomPassRef.current.strength = sceneConfig.bloomStrength;
    if (caPassRef.current)
      caPassRef.current.uniforms.amount.value = sceneConfig.chromaticAberration;
    if (grainPassRef.current)
      (grainPassRef.current.uniforms as any).intensity.value = sceneConfig.filmGrain;
    if (vignettePassRef.current) {
      vignettePassRef.current.uniforms.offset.value = sceneConfig.vignetteRadius;
      vignettePassRef.current.uniforms.darkness.value = sceneConfig.vignetteStrength;
    }
  }, [sceneConfig]);

  // Particle config sync
  useEffect(() => {
    if (!sceneRef.current || !particlesRef.current || !threeRef.current) return;
    const scene = sceneRef.current;
    const THREE = threeRef.current;
    const prevCount = particlesRef.current.geometry.attributes.position.count;
    if (prevCount !== particleConfig.count) {
      scene.remove(particlesRef.current);
      particlesRef.current.geometry.dispose();
      const pGeo = new THREE.BufferGeometry();
      const pArr = new Float32Array(particleConfig.count * 3);
      for (let i = 0; i < particleConfig.count * 3; i += 3) {
        pArr[i] = (Math.random() - 0.5) * particleConfig.spread * 2;
        pArr[i + 1] = Math.random() * particleConfig.spread;
        pArr[i + 2] = (Math.random() - 0.5) * particleConfig.spread * 2;
      }
      pGeo.setAttribute("position", new THREE.BufferAttribute(pArr, 3));
      particlesRef.current.geometry = pGeo;
      scene.add(particlesRef.current);
    }
    const mat = particlesRef.current.material as
      THREE.PointsMaterial | THREE.PointsMaterial[] | null;
    if (mat) {
      const applyMat = (m: THREE.PointsMaterial) => {
        m.color.set(particleConfig.color);
        m.size = particleConfig.size;
        m.opacity = particleConfig.opacity;
      };
      if (Array.isArray(mat)) {
        mat.forEach(applyMat);
      } else {
        applyMat(mat);
      }
    }
    particlesRef.current.visible = particleConfig.enabled;
  }, [particleConfig]);

  // Background image
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!backgroundImageUrl) {
      if (bgImageTextureRef.current) {
        bgImageTextureRef.current.dispose();
        bgImageTextureRef.current = null;
      }
      return;
    }
    let cancelled = false;
    void (() => {
      if (cancelled) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (cancelled) return;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        if (bgImageTextureRef.current) bgImageTextureRef.current.dispose();
        bgImageTextureRef.current = tex;
        const s = sceneRef.current;
        if (s) s.background = tex;
      };
      img.onerror = (err) => console.error("BG image failed:", backgroundImageUrl, err);
      img.src = backgroundImageUrl;
    })();
    return () => {
      cancelled = true;
    };
  }, [backgroundImageUrl]);

  useEffect(() => {
    if (!sceneRef.current || !bgImageTextureRef.current) return;
    sceneRef.current.background = backgroundImageVisible
      ? bgImageTextureRef.current
      : new THREE.Color(sceneConfigRef.current.backgroundColor);
  }, [backgroundImageVisible, sceneConfig.backgroundColor]);

  // Object textures: load images for objects that have textureUrl and apply
  // them as material.map so custom images can be used as diffuse textures.
  useEffect(() => {
    if (!sceneRef.current) return;

    const cancelled = new Set<string>();

    const loadTextureForObject = (obj: (typeof objects)[number]) => {
      if (!obj.textureUrl) return;
      const existing = objectTextureRefs.current.get(obj.id);
      if (existing) {
        applyTextureToObject(obj, existing);
        return;
      }
      cancelled.add(obj.id);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        cancelled.delete(obj.id);
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        objectTextureRefs.current.set(obj.id, tex);
        applyTextureToObject(obj, tex);
      };
      img.onerror = (err) => {
        cancelled.delete(obj.id);
        console.error("Object texture failed:", obj.textureUrl, err);
      };
      img.src = obj.textureUrl;
    };

    const applyTextureToObject = (obj: (typeof objects)[number], tex: THREE.Texture) => {
      const mesh = objectsMapRef.current.get(obj.id);
      if (!mesh) return;
      const setMap = (m: any) => {
        if (m.material) {
          if (m.material.map) m.material.map.dispose();
          m.material.map = tex;
          m.material.needsUpdate = true;
        }
      };
      if (mesh instanceof THREE.Group) mesh.traverse(setMap);
      else setMap(mesh);
    };

    objects.forEach(loadTextureForObject);

    // Cleanup textures for removed objects
    const activeIds = new Set(objects.map((o) => o.id));
    objectTextureRefs.current.forEach((tex, id) => {
      if (!activeIds.has(id)) {
        tex.dispose();
        objectTextureRefs.current.delete(id);
      }
    });

    return () => {
      objectTextureRefs.current.forEach((tex) => tex.dispose());
      objectTextureRefs.current.clear();
    };
  }, [objects]);

  return {
    sceneRef,
    rendererRef,
    cameraRef,
    objectsMapRef,
    particlesRef,
    bloomPassRef,
    bloomComposerRef,
    finalComposerRef,
    composerRef,
    caPassRef,
    grainPassRef,
    vignettePassRef,
    shakeRef,
    bgImageTextureRef,
    audioContextRef,
    analyserRef,
    audioSourceRef,
    audioElementRef,
    audioFreqArrayRef,
    threeRef,
    lastUiUpdateRef,
    frameCountRef,
    characterMixersRef,
    sceneLoading,
    beatActive,
    animationTime,
    renderPlaying: renderPlayingState,
    setRenderPlaying,
    setBeatActive,
    setSceneLoading,
    // F5: the export entry points. Both are ref-backed, so they are
    // safe no-ops before the scene effect runs.
    renderAtTime: (tSec: number, dtSec: number) => renderAtTimeRef.current(tSec, dtSec),
    beginDeterministicRun: () => {
      exportActiveRef.current = true;
      resetDeterministicRef.current();
    },
    endDeterministicRun: () => {
      exportActiveRef.current = false;
    },
  };
}
