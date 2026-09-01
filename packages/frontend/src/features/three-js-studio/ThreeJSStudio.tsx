import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box, Play, Pause, Sparkles, Download, Settings, Circle, Square,
  ChevronDown, ChevronUp, Music, Zap, FileCode, Maximize2, Minimize2, User,
} from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";
import { FilmShader } from "three/examples/jsm/shaders/FilmShader.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { listAudioFiles } from "../../services/api";
import { useUIStore } from "../../state/uiStore";
import { useBeatTimeline } from "../../hooks/useBeatTimeline";
import { SCENE_TEMPLATES, type SceneTemplate } from "./sceneTemplates";
import type { AnimObject, ParticleConfig, SceneConfig, CameraMode } from "./types";
import { ObjectsTab } from "./components/ObjectsTab";
import { InspectorTab } from "./components/InspectorTab";
import { SceneTab } from "./components/SceneTab";
import { AISceneGenerator } from "./components/AISceneGenerator";

const BLOOM_LAYER = 1;

const DEFAULT_SCENE: SceneConfig = {
  backgroundColor: "#0a0a0f", fogEnabled: true, fogColor: "#0a0a0f", fogDensity: 0.015,
  bloomStrength: 0.8, selectiveBloom: true, chromaticAberration: 0.0025, filmGrain: 0.12,
  vignetteStrength: 0.55, vignetteRadius: 0.65, beatPunch: 0.18,
};

const DEFAULT_PARTICLES: ParticleConfig = {
  enabled: true, count: 300, size: 0.02, color: "#8b5cf6", speed: 0.5, spread: 6, opacity: 0.7,
};

const DEFAULT_OBJECTS: AnimObject[] = [{
  id: "crown-1", name: "Crown", type: "crown", position: [0, 0.5, 0], rotation: [0, 0, 0],
  scale: [1, 1, 1], color: "#ffd700", metalness: 0.9, roughness: 0.1, emissive: "#ff8c00",
  emissiveIntensity: 0.15, visible: true, bobSpeed: 1.5, bobAmount: 0.1, rotateSpeed: 0.3, bloom: true,
}];

export function ThreeJSStudio() {
  const [searchParams] = useSearchParams();
  const storyboardParam = searchParams.get("storyboard");
  const autoGenerateParam = searchParams.get("autogenerate");
  const storyboardSceneParam = searchParams.get("scene");
  const trackParam = searchParams.get("track");
  // ---- Refs ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectsMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const particlesRef = useRef<THREE.Points | null>(null);
  const clockRef = useRef<THREE.Clock | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const bloomComposerRef = useRef<EffectComposer | null>(null);
  const finalComposerRef = useRef<EffectComposer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const caPassRef = useRef<ShaderPass | null>(null);
  const grainPassRef = useRef<FilmPass | null>(null);
  const vignettePassRef = useRef<ShaderPass | null>(null);
  const shakeRef = useRef(0);
  const bgImageTextureRef = useRef<THREE.Texture | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioFreqArrayRef = useRef<Uint8Array | null>(null);
  const threeRef = useRef<any>(null);
  const lastUiUpdateRef = useRef(0);
  const characterMixersRef = useRef<Map<string, any>>(new Map());

  // ---- State ----
  const [isPlaying, setIsPlaying] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"objects" | "inspector" | "scene">("objects");
  const [sceneConfig, setSceneConfig] = useState<SceneConfig>(DEFAULT_SCENE);
  const [particleConfig, setParticleConfig] = useState<ParticleConfig>(DEFAULT_PARTICLES);
  const [objects, setObjects] = useState<AnimObject[]>(DEFAULT_OBJECTS);
  const [selectedObject, setSelectedObject] = useState<string | null>("crown-1");
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string>("");
  const [backgroundImageVisible, setBackgroundImageVisible] = useState(true);
  const [libraryImages, setLibraryImages] = useState<Array<{ url: string; label: string }>>([]);
  const [bpm, setBpm] = useState(150);
  const [beatSync, setBeatSync] = useState(false);
  const [fps, setFps] = useState(24);
  const [libraryTracks, setLibraryTracks] = useState<Array<{ filename: string }>>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [trackMetadata, setTrackMetadata] = useState<Record<string, { bpm?: number; duration?: number }>>({});
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [beatActive, setBeatActive] = useState(false);
  const [animationTime, setAnimationTime] = useState(0);
  const [animationDuration, _setAnimationDuration] = useState(30);
  const [keyframeTracks, _setKeyframeTracks] = useState<any[]>([]);
  const keyframeTracksRef = useRef(keyframeTracks);
  useEffect(() => { keyframeTracksRef.current = keyframeTracks; }, [keyframeTracks]);
  const [codePanelOpen, setCodePanelOpen] = useState(false);
  const [pastedCode, setPastedCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const { focusMode, toggleFocusMode } = useUIStore();

  const { analysis: beatAnalysis, loading: beatLoading, error: beatError, getCurrentBeat } = useBeatTimeline(selectedTrack || null);
  const getCurrentBeatRef = useRef(getCurrentBeat);

  // Character animation state per object
  const characterAnimDataRef = useRef<Map<string, { mixer: any; action: any; clips: string[] }>>(new Map());
  const [characterAnimState, setCharacterAnimState] = useState<{ isPlaying: boolean; currentTime: number; duration: number; clipNames: string[] } | undefined>(undefined);
  const characterAnimStateRef = useRef(characterAnimState);
  useEffect(() => { characterAnimStateRef.current = characterAnimState; }, [characterAnimState]);
  useEffect(() => { getCurrentBeatRef.current = getCurrentBeat; }, [getCurrentBeat]);

  // ---- Refs for animation loop access ----
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

  // ---- Sync refs ----
  useEffect(() => { beatAnalysisRef.current = beatAnalysis; }, [beatAnalysis]);
  useEffect(() => { objectsRef.current = objects; }, [objects]);
  useEffect(() => { beatSyncRef.current = beatSync; }, [beatSync]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isAudioPlayingRef.current = isAudioPlaying; }, [isAudioPlaying]);
  useEffect(() => { particleConfigRef.current = particleConfig; }, [particleConfig]);
  useEffect(() => { sceneConfigRef.current = sceneConfig; }, [sceneConfig]);
  useEffect(() => { activeAudioDrivenRef.current = SCENE_TEMPLATES.find((t) => t.id === activeTemplateId)?.audioDriven; }, [activeTemplateId]);
  useEffect(() => { animationTimeRef.current = animationTime; }, [animationTime]);

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

  // Trigger canvas resize after focus mode toggle (container size changes)
  useEffect(() => {
    if (focusMode) {
      // Delay to allow DOM to update after hiding elements
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

  // ---- Helper: create mesh for object ----
  const createMeshForObject = useCallback(async (obj: AnimObject, THREE: any) => {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(obj.color), metalness: obj.metalness, roughness: obj.roughness,
      emissive: new THREE.Color(obj.emissive), emissiveIntensity: obj.emissiveIntensity,
    });
    let meshGroup: any;
    if (obj.type === "crown") {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 16, 32), mat));
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 8), mat);
        spike.position.set(Math.cos(angle) * 0.85, 0.4, Math.sin(angle) * 0.85);
        group.add(spike);
      }
      const gemMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, metalness: 0.5, roughness: 0, emissive: 0x8b5cf6, emissiveIntensity: 0.8 });
      group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2), gemMat));
      meshGroup = group;
    } else if (obj.type === "sphere") { meshGroup = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), mat); }
    else if (obj.type === "box") { meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat); }
    else if (obj.type === "cylinder") { meshGroup = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32), mat); }
    else if (obj.type === "cone") { meshGroup = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 32), mat); }
    else if (obj.type === "torus") { meshGroup = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.25, 16, 32), mat); }
    else if (obj.type === "bars") { meshGroup = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), mat); }
    else if (obj.type === "character") {
      if (obj.modelUrl) {
        const loader = new GLTFLoader();
        const url = obj.modelUrl;
        meshGroup = await new Promise<any>((resolve) => {
          loader.load(url, (gltf) => {
            const model = gltf.scene;
            model.traverse((child: any) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.layers.set(0);
                if (obj.bloom) child.layers.enable(BLOOM_LAYER);
              }
            });
            const mixer = new THREE.AnimationMixer(model);
            if (gltf.animations && gltf.animations.length > 0) {
              const requestedName = obj.animationName || gltf.animations[0].name;
              const clipName = gltf.animations.find((a: any) => a.name === requestedName)
                ? requestedName
                : gltf.animations[0].name;
              const action = mixer.clipAction(
                gltf.animations.find((a: any) => a.name === clipName) || gltf.animations[0]
              );
              action.setLoop(obj.animationLoop !== false ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
              action.setEffectiveTimeScale(obj.animationSpeed ?? 1);
              action.play();
              characterAnimDataRef.current.set(obj.id, {
                mixer,
                action,
                clips: gltf.animations.map((a: any) => a.name),
              });
            } else {
              characterAnimDataRef.current.set(obj.id, { mixer, action: null, clips: [] });
            }
            characterMixersRef.current.set(obj.id, mixer);
            resolve(model);
          }, undefined, () => {
            const fallback = new THREE.Group();
            const bodyMat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(obj.color),
              metalness: 0.1, roughness: 0.7,
              emissive: new THREE.Color(obj.emissive), emissiveIntensity: obj.emissiveIntensity,
            });
            const headMat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(obj.color).multiplyScalar(1.1),
              metalness: 0.8, roughness: 0.2,
              emissive: new THREE.Color(obj.emissive), emissiveIntensity: obj.emissiveIntensity * 0.5,
            });
            const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 8, 16), bodyMat);
            body.position.y = 0.8;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 24), headMat);
            head.position.set(0, 1.58, 0.02);
            const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), bodyMat);
            armL.position.set(-0.42, 1.0, 0); armL.rotation.z = 0.15; armL.rotation.x = -0.05;
            const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), bodyMat);
            armR.position.set(0.42, 1.0, 0); armR.rotation.z = -0.15; armR.rotation.x = -0.05;
            const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), bodyMat);
            legL.position.set(-0.15, 0.15, 0);
            const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), bodyMat);
            legR.position.set(0.15, 0.15, 0);
            const shadowCanvas = document.createElement('canvas');
            shadowCanvas.width = 128; shadowCanvas.height = 128;
            const ctx = shadowCanvas.getContext('2d')!;
            const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
            gradient.addColorStop(0.5, 'rgba(0,0,0,0.3)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);
            const shadowTex = new THREE.CanvasTexture(shadowCanvas);
            const shadowContact = new THREE.Mesh(
              new THREE.PlaneGeometry(1.2, 1.2),
              new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
            );
            shadowContact.rotation.x = -Math.PI / 2; shadowContact.position.y = 0.01;
            fallback.rotation.x = 0.03;
            fallback.add(body, head, armL, armR, legL, legR, shadowContact);
            fallback.traverse((c: any) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
            resolve(fallback);
          });
        });
      } else {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(obj.color),
          metalness: 0.1,
          roughness: 0.7,
          emissive: new THREE.Color(obj.emissive),
          emissiveIntensity: obj.emissiveIntensity,
        });
        const headMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(obj.color).multiplyScalar(1.1),
          metalness: 0.8,
          roughness: 0.2,
          emissive: new THREE.Color(obj.emissive),
          emissiveIntensity: obj.emissiveIntensity * 0.5,
        });
        // Torso
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 8, 16), bodyMat);
        body.position.y = 0.8;
        // Head (slightly forward for natural look)
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 24), headMat);
        head.position.set(0, 1.58, 0.02);
        // Arms with slight bend
        const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), bodyMat);
        armL.position.set(-0.42, 1.0, 0);
        armL.rotation.z = 0.15;
        armL.rotation.x = -0.05;
        const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), bodyMat);
        armR.position.set(0.42, 1.0, 0);
        armR.rotation.z = -0.15;
        armR.rotation.x = -0.05;
        // Legs with slight stance
        const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), bodyMat);
        legL.position.set(-0.15, 0.15, 0);
        const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), bodyMat);
        legR.position.set(0.15, 0.15, 0);
        // Soft contact shadow with radial gradient
        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = 128; shadowCanvas.height = 128;
        const ctx = shadowCanvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
        gradient.addColorStop(0.5, 'rgba(0,0,0,0.3)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        const shadowTex = new THREE.CanvasTexture(shadowCanvas);
        const shadowContact = new THREE.Mesh(
          new THREE.PlaneGeometry(1.2, 1.2),
          new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
        );
        shadowContact.rotation.x = -Math.PI / 2;
        shadowContact.position.y = 0.01;
        // Apply contrapposto pose to the whole group
        group.rotation.x = 0.03;
        group.add(body, head, armL, armR, legL, legR, shadowContact);
        group.traverse((c: any) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        meshGroup = group;
      }
    }
    else { meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); }
    meshGroup.position.set(...obj.position);
    meshGroup.rotation.set(...obj.rotation);
    meshGroup.scale.set(...obj.scale);
    meshGroup.visible = obj.visible;
    meshGroup.castShadow = true;
    meshGroup.receiveShadow = true;
    const targetLayer = obj.bloom ? BLOOM_LAYER : 0;
    meshGroup.traverse((child: any) => { if (child.isMesh) { child.layers.set(0); if (obj.bloom) child.layers.enable(BLOOM_LAYER); } });
    return meshGroup;
  }, []);

  // ---- Generated scene update function (controlled by playback) ----
  const generatedSceneUpdateRef = useRef<((time: number, delta: number) => void) | null>(null);
  const generatedSceneInitRef = useRef<(() => void) | null>(null);
  const [renderPlaying, setRenderPlaying] = useState(false);
  const [sceneLoading, setSceneLoading] = useState(true);
  const renderPlayingRef = useRef(renderPlaying);

  // Sync ref with state
  useEffect(() => {
    renderPlayingRef.current = renderPlaying;
  }, [renderPlaying]);

  // ---- Helper: create a single scene object from JSON description ----
  const createSceneObject = useCallback((objDesc: any, THREE: any, scene: any) => {
    let geometry: any;
    const t = objDesc.type;
    if (t === "sphere") geometry = new THREE.SphereGeometry(0.8, 32, 32);
    else if (t === "box") geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    else if (t === "cylinder") geometry = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32);
    else if (t === "cone") geometry = new THREE.ConeGeometry(0.8, 1.5, 32);
    else if (t === "torus") geometry = new THREE.TorusGeometry(0.8, 0.25, 16, 32);
    else if (t === "crown") {
      const group = new THREE.Group();
      const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 16, 32), new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.1 }));
      group.add(band);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.1 }));
        spike.position.set(Math.cos(angle) * 0.85, 0.4, Math.sin(angle) * 0.85);
        group.add(spike);
      }
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshStandardMaterial({ color: 0x8b5cf6, metalness: 0.5, roughness: 0, emissive: 0x8b5cf6, emissiveIntensity: 0.8 }));
      gem.position.y = 0.3;
      group.add(gem);
      const gpos = objDesc.position as [number, number, number] || [0, 0.5, 0];
      const gscl = objDesc.scale as [number, number, number] || [1, 1, 1];
      group.position.set(gpos[0], gpos[1], gpos[2]);
      group.scale.set(gscl[0], gscl[1], gscl[2]);
      group.castShadow = true;
      scene.add(group);
      return;
    }
    else if (t === "orb") geometry = new THREE.SphereGeometry(1, 64, 64);
    else if (t === "ring") geometry = new THREE.TorusGeometry(1.5, 0.05, 16, 64);
    else if (t === "spiral") geometry = new THREE.TorusKnotGeometry(0.8, 0.2, 128, 16);
    else if (t === "mountain") geometry = new THREE.ConeGeometry(2, 4, 6);
    else if (t === "tree") geometry = new THREE.ConeGeometry(0.8, 3, 8);
    else if (t === "city" || t === "skyline") geometry = new THREE.BoxGeometry(0.5, 3, 0.5);
    else if (t === "stage") geometry = new THREE.BoxGeometry(8, 0.3, 5);
    else if (t === "equalizer" || t === "bar") geometry = new THREE.BoxGeometry(0.12, 1, 0.12);
    else if (t === "pillar") geometry = new THREE.CylinderGeometry(0.3, 0.3, 4, 16);
    else if (t === "vinyl") geometry = new THREE.CylinderGeometry(1.5, 1.5, 0.05, 64);
    else if (t === "wave") geometry = new THREE.TorusGeometry(2, 0.3, 16, 32);
    else if (t === "galaxy") geometry = new THREE.TorusGeometry(3, 0.8, 16, 64);
    else if (t === "neuron") geometry = new THREE.IcosahedronGeometry(0.5, 1);
    else if (t === "fractal") geometry = new THREE.OctahedronGeometry(1, 2);
    else if (t === "lightning") geometry = new THREE.ConeGeometry(0.1, 3, 4);
    else if (t === "fire") geometry = new THREE.ConeGeometry(0.5, 2, 8);
    else if (t === "snow" || t === "rain") geometry = new THREE.SphereGeometry(0.05, 8, 8);
    else if (t === "character") {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(objDesc.color || "#fbbf24"),
        metalness: objDesc.metalness ?? 0.1,
        roughness: objDesc.roughness ?? 0.7,
        emissive: new THREE.Color(objDesc.emissive || "#1a1000"),
        emissiveIntensity: objDesc.emissiveIntensity ?? 0.1,
      });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 8, 16), bodyMat);
      body.position.y = 0.8;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), bodyMat);
      head.position.y = 1.6;
      group.add(body, head);
      group.castShadow = true;
      const gpos = objDesc.position as [number, number, number] || [0, 0, 0];
      const gscl = objDesc.scale as [number, number, number] || [1.5, 1.5, 1.5];
      group.position.set(gpos[0], gpos[1], gpos[2]);
      group.scale.set(gscl[0], gscl[1], gscl[2]);
      if (objDesc.rotation) group.rotation.set(...(objDesc.rotation as [number, number, number]));
      scene.add(group);
      return;
    }
    else if (t === "text" || t === "particle_field" || t === "light_rays" || t === "lens_flare") {
      return; // Special effects, skip geometry
    }
    else geometry = new THREE.BoxGeometry(1, 1, 1);

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(objDesc.color || "#ffffff"),
      metalness: objDesc.metalness ?? 0.6,
      roughness: objDesc.roughness ?? 0.3,
      emissive: new THREE.Color(objDesc.emissive || "#000000"),
      emissiveIntensity: objDesc.emissiveIntensity ?? 0.1,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    const pos = objDesc.position as [number, number, number] || [0, 0.5, 0];
    const scl = objDesc.scale as [number, number, number] || [1, 1, 1];
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scl[0], scl[1], scl[2]);
    if (objDesc.rotation) mesh.rotation.set(...(objDesc.rotation as [number, number, number]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }, []);

  // ---- Helper: apply generated code to scene ----
  const handleApplyCode = useCallback((code: string) => {
    if (!sceneRef.current || !code) return;
    setCodeError(null);

    // Sanitize: strip markdown fences that LLMs often wrap around code
    const stripFences = (s: string) => {
      // Remove ```javascript ... ``` or ``` ... ``` blocks, keep inner code
      const fenceRe = /```(?:javascript|js|json)?\s*\n([\s\S]*?)```/gi;
      let out = s;
      let m: RegExpExecArray | null;
      let last: string | null = null;
      // If multiple fenced blocks (corrupted file with 2x applyScene), keep the LAST one
      while ((m = fenceRe.exec(s)) !== null) last = m[1];
      if (last !== null) out = last;
      // Also strip stray fence markers left at start/end
      out = out.replace(/^```[a-z]*\s*\n?/i, "").replace(/```\s*$/i, "");
      return out.trim();
    };

    const looksLikeJson = (s: string) => {
      const t = s.trim();
      return (t.startsWith("{") || t.startsWith("[")) && !t.includes("function ") && !t.includes("=>") && !t.includes("THREE.");
    };

    const rawTrimmed = code.trim();
    // Try JSON path first (for pure JSON scene descriptions)
    if (looksLikeJson(rawTrimmed) || looksLikeJson(stripFences(code))) {
      try {
        let jsonStr = stripFences(code);
        // Fallback to raw if strip produced empty
        if (!jsonStr) jsonStr = code;
        const startIdx = jsonStr.search(/[\[{]/);
        if (startIdx >= 0) jsonStr = jsonStr.substring(startIdx);
        const sceneDesc = JSON.parse(jsonStr);
        {
          const scene = sceneRef.current;
          const toRemove: any[] = [];
          scene.traverse((child: any) => {
            if (child.isMesh && child.geometry && child.geometry.type !== "PlaneGeometry") {
              toRemove.push(child);
            }
          });
          toRemove.forEach((obj) => scene.remove(obj));
          if (sceneDesc.objects) {
            for (const objDesc of sceneDesc.objects) {
              createSceneObject(objDesc, THREE, scene);
            }
          }
        }
        // Clear any previous AI-update loop
        generatedSceneUpdateRef.current = null;
        generatedSceneInitRef.current = null;
        (window as any).__sceneUpdate = null;
        (window as any).__sceneInit = null;
        return;
      } catch {
        // fall through to JS path — not valid JSON
      }
    }

    // ---- JS path: sanitize and execute applyScene once ----
    try {
      let jsCode = stripFences(code);
      if (!jsCode) jsCode = code;

      // If file contains two concatenated applyScene definitions (corrupted generation),
      // keep only the LAST one — the first is incomplete/buggy and would be shadowed.
      const applyIdx = jsCode.lastIndexOf("function applyScene");
      if (applyIdx > 0) {
        // Check if there's an earlier applyScene — slice from last
        const firstIdx = jsCode.indexOf("function applyScene");
        if (firstIdx !== applyIdx) {
          jsCode = jsCode.slice(applyIdx);
        }
      }

      if (!jsCode.includes("function applyScene") && !jsCode.includes("THREE.")) {
        setCodeError("No applyScene(scene,camera,renderer,THREE) found in code.");
        console.warn("handleApplyCode: no applyScene or THREE usage detected");
        return;
      }

      // Clean up previous AI artefacts before running new code
      const disposeGroup = (g: any) => {
        if (!g) return;
        g.traverse((c: any) => {
          if (c.geometry) { try { c.geometry.dispose(); } catch {} }
          if (c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach((m: any) => { try { m.dispose(); } catch {} });
          }
        });
      };
      const oldGroup = sceneRef.current.getObjectByName("__aiGenerated");
      if (oldGroup) { disposeGroup(oldGroup); sceneRef.current.remove(oldGroup); }
      // Also remove legacy tagged objects/lights from older runs
      sceneRef.current.children.slice().forEach((c: any) => {
        if (c.userData && c.userData.__ai) {
          disposeGroup(c);
          sceneRef.current.remove(c);
        }
      });
      // Reset previous update hooks
      (window as any).__sceneUpdate = null;
      (window as any).__sceneInit = null;
      generatedSceneUpdateRef.current = null;
      generatedSceneInitRef.current = null;

      // Defensive sanitization: prevent the AI code from hijacking the render loop
      // or resizing the renderer to window size (studio owns the canvas size).
      const sanitized = jsCode
        // Remove rAF loops — studio drives frames
        .replace(/requestAnimationFrame\s*\([^)]+\)\s*;?/g, "/* rAF stripped — studio drives loop */")
        // Remove direct renderer.setSize(window.innerWidth ...) calls
        .replace(/renderer\s*\.\s*setSize\s*\(\s*window\.innerWidth[^)]+\)\s*;?/g, "/* renderer.setSize stripped */")
        .replace(/renderer\s*\.\s*setPixelRatio\s*\([^)]+\)\s*;?/g, "/* setPixelRatio stripped */")
        // Remove window resize listeners that leak
        .replace(/window\s*\.\s*addEventListener\s*\(\s*['\"]resize['\"][^)]+\)\s*;?/g, "/* resize listener stripped */")
        // Remove standalone animate() invocations at top-level (not method calls)
        .replace(/^\s*animate\s*\(\s*[^)]*\)\s*;?\s*$/gm, "/* animate() stripped */")
        // Neutralize direct THREE import assumptions — scene already provides globals
        .replace(/document\.getElementById\s*\(\s*['\"]three-container['\"]\s*\)/g, "null");

      // Wrap: execute once, capture returned update function if provided,
      // otherwise fall back to window.__sceneUpdate that the code may have set.
      const wrapped = sanitized + `
        // --- capture contract ---
        // If applyScene returns a function, treat it as the per-frame update.
        // Otherwise check for window.__sceneUpdate set by the cleaned file.
        let __ret = null;
        if (typeof applyScene === 'function') {
          __ret = applyScene(scene, camera, renderer, THREE);
          if (typeof __ret === 'function') {
            window.__sceneUpdate = __ret;
            window.__sceneInit = () => __ret(0, 0);
          }
        }
        // Legacy fallback: code that sets window.__sceneUpdate itself
        // or code that defines update/animate helpers
        if (!window.__sceneUpdate && typeof update === 'function') {
          window.__sceneUpdate = update;
        }
        if (!window.__sceneInit && typeof init === 'function') {
          window.__sceneInit = init;
        }
      `;

      const fn = new Function("scene", "camera", "renderer", "THREE", wrapped);
      fn(sceneRef.current, cameraRef.current, rendererRef.current, (window as any).THREE);

      const upd = (window as any).__sceneUpdate;
      const init = (window as any).__sceneInit;
      if (typeof upd === "function") {
        generatedSceneUpdateRef.current = upd;
        generatedSceneInitRef.current = typeof init === "function" ? init : null;
        try { generatedSceneInitRef.current?.(); } catch (e) { console.warn("sceneInit error", e); }
        try { upd(0, 0); } catch (e) { console.warn("sceneUpdate(0) error", e); }
      } else {
        // No update hook — static scene, just force one render via studio loop
        // The addition is already in the scene graph, it will appear next frame
        console.info("Applied static AI scene (no per-frame update)");
      }
    } catch (err) {
      console.error("Failed to apply generated scene:", err);
      setCodeError(err instanceof Error ? err.message : String(err));
    }
  }, [createSceneObject]);

  // ---- Scene init + animation loop ----
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const onResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      if (composerRef.current) composerRef.current.setSize(w, h);
      if (bloomComposerRef.current) bloomComposerRef.current.setSize(w, h);
      if (finalComposerRef.current) finalComposerRef.current.setSize(w, h);
    };
    const initScene = async () => {
      (window as any).THREE = THREE;
      threeRef.current = THREE;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(sceneConfigRef.current.backgroundColor);
      scene.fog = new THREE.FogExp2(sceneConfigRef.current.fogColor, sceneConfigRef.current.fogDensity);
      sceneRef.current = scene;
      const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
      camera.position.set(0, 3, 8); camera.lookAt(0, 0.5, 0); cameraRef.current = camera;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
      rendererRef.current = renderer;
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.05; controls.minDistance = 2; controls.maxDistance = 20;
      const composer = new EffectComposer(renderer);
      composerRef.current = composer;
      composer.addPass(new RenderPass(scene, camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), sceneConfigRef.current.bloomStrength, 0.4, 0.85);
      composer.addPass(bloomPass); bloomPassRef.current = bloomPass;
      const renderScene = new RenderPass(scene, camera);
      const bloomComposer = new EffectComposer(renderer); bloomComposer.renderToScreen = false;
      bloomComposer.addPass(renderScene); bloomComposer.addPass(bloomPass);
      const finalPass = new ShaderPass(new THREE.ShaderMaterial({
        uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture,vUv) + vec4(1.0)*texture2D(bloomTexture,vUv); }`,
        defines: {},
      }), "baseTexture"); finalPass.needsSwap = true;
      const finalComposer = new EffectComposer(renderer);
      finalComposer.addPass(renderScene); finalComposer.addPass(finalPass);
      const caPass = new ShaderPass(RGBShiftShader); caPass.uniforms.amount.value = sceneConfigRef.current.chromaticAberration;
      finalComposer.addPass(caPass); caPassRef.current = caPass;
      const grainPass = new ShaderPass(FilmShader); grainPass.uniforms.intensity.value = sceneConfigRef.current.filmGrain;
      grainPass.uniforms.grayscale.value = false; finalComposer.addPass(grainPass); grainPassRef.current = grainPass;
      const vignettePass = new ShaderPass(VignetteShader);
      vignettePass.uniforms.offset.value = sceneConfigRef.current.vignetteRadius;
      vignettePass.uniforms.darkness.value = sceneConfigRef.current.vignetteStrength;
      finalComposer.addPass(vignettePass); vignettePassRef.current = vignettePass;
      finalComposer.addPass(new OutputPass());
      bloomComposerRef.current = bloomComposer; finalComposerRef.current = finalComposer;
      scene.add(new THREE.AmbientLight(0x404060, 0.6));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2); dirLight.position.set(5, 8, 5); dirLight.castShadow = true; scene.add(dirLight);
      const spotLight = new THREE.SpotLight(0x8b5cf6, 35); spotLight.position.set(0, 10, 0); spotLight.angle = 0.45; spotLight.penumbra = 0.5; spotLight.castShadow = true; scene.add(spotLight);
      const p1 = new THREE.PointLight(0xff6b9d, 15, 12); p1.position.set(-4, 3, 3); scene.add(p1);
      const p2 = new THREE.PointLight(0x6b9dff, 15, 12); p2.position.set(4, 2, -3); scene.add(p2);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 0.9, roughness: 0.1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.5; floor.receiveShadow = true; scene.add(floor);
      const grid = new THREE.GridHelper(20, 20, 0x333344, 0x181822); grid.position.y = -0.49; scene.add(grid);
      const pGeo = new THREE.BufferGeometry();
      const pArr = new Float32Array(particleConfigRef.current.count * 3);
      for (let i = 0; i < particleConfigRef.current.count * 3; i += 3) {
        pArr[i] = (Math.random() - 0.5) * particleConfigRef.current.spread * 2;
        pArr[i + 1] = Math.random() * particleConfigRef.current.spread;
        pArr[i + 2] = (Math.random() - 0.5) * particleConfigRef.current.spread * 2;
      }
      pGeo.setAttribute("position", new THREE.BufferAttribute(pArr, 3));
      const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: particleConfigRef.current.color, size: particleConfigRef.current.size, transparent: true, opacity: particleConfigRef.current.opacity, blending: THREE.AdditiveBlending }));
      scene.add(particles); particlesRef.current = particles;
      for (const obj of objectsRef.current) { const mesh = await createMeshForObject(obj, THREE); scene.add(mesh); objectsMapRef.current.set(obj.id, mesh); }
      clockRef.current = new THREE.Timer();

      const animate = () => {
        animationRef.current = requestAnimationFrame(animate);
        clockRef.current.update();
        const delta = clockRef.current.getDelta();
        const elapsed = clockRef.current.getElapsed();
        controls.update();
        let audioBass = 0, audioTreble = 0, audioMid = 0;
        if (analyserRef.current && isAudioPlayingRef.current) {
          if (!audioFreqArrayRef.current || audioFreqArrayRef.current.length !== analyserRef.current.frequencyBinCount) audioFreqArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(audioFreqArrayRef.current as Uint8Array<ArrayBuffer>);
          const arr = audioFreqArrayRef.current;
          const bassBins = Math.floor(arr.length * 0.08);
          audioBass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
          const midBins = Math.floor(arr.length * 0.2);
          audioMid = arr.slice(bassBins, midBins).reduce((a, b) => a + b, 0) / ((midBins - bassBins) * 255 || 1);
          const trebleBins = Math.floor(arr.length * 0.4);
          audioTreble = arr.slice(trebleBins).reduce((a, b) => a + b, 0) / ((arr.length - trebleBins) * 255 || 1);
        }
        const beatState = getCurrentBeatRef.current(elapsed);
        const beatPunchAmp = sceneConfigRef.current.beatPunch;
        let beatSpike = 0;
        let newBeatActive = false;
        if (renderPlayingRef.current && beatState.ready && beatState.isOnBeat) {
          beatSpike = beatPunchAmp * (1 - beatState.timeSinceLastBeat / beatState.beatWindowSec);
          if (beatState.timeSinceLastBeat < 0.016) {
            shakeRef.current = Math.min(shakeRef.current + beatPunchAmp * 0.3, 0.15);
            newBeatActive = true;
          }
        }
        // Only update state when beat active changes (avoid per-frame re-renders)
        if (newBeatActive !== beatActiveRef.current) {
          beatActiveRef.current = newBeatActive;
          setBeatActive(newBeatActive);
        }
        shakeRef.current *= 0.75;
        const isPlay = isPlayingRef.current;
        const audioDrivenMode = activeAudioDrivenRef.current;
        objectsRef.current.forEach((obj) => {
          const mesh = objectsMapRef.current.get(obj.id);
          if (mesh && obj.visible) {
            if (isPlay) {
              mesh.rotation.y += delta * (obj.rotateSpeed + audioTreble * 2);
              mesh.position.y = obj.position[1] + Math.sin(elapsed * obj.bobSpeed) * obj.bobAmount;
            }
            let pulse = 1;
            if (isPlay && beatState.ready && beatSpike > 0) pulse = 1 + beatSpike;
            else if (isPlay && beatSyncRef.current) { const bi = 60 / bpmRef.current; pulse = (1 + Math.sin((elapsed % bi) / bi * Math.PI * 2) * 0.08) * (1 + audioBass * 0.35); }
            else if (isPlay && audioBass > 0) pulse = 1 + audioBass * 0.3;
            // Audio-driven modes for bars/pillars
            if (isPlay && audioDrivenMode === "bars" && obj.type === "bars") {
              const barIdx = parseInt(obj.id.replace("bar-", "")) || 0;
              const freqSlice = Math.floor((barIdx / 32) * 256);
              const freqVal = audioFreqArrayRef.current ? (audioFreqArrayRef.current[freqSlice] || 0) / 255 : audioMid;
              const barPulse = 1 + freqVal * 3;
              const s = obj.scale;
              mesh.scale.set(s[0] * barPulse, s[1], s[2]);
            } else if (isPlay && audioDrivenMode === "pillars" && obj.type === "box") {
              const pillarPulse = 1 + audioBass * 1.5;
              const s = obj.scale;
              mesh.scale.set(s[0], s[1] * pillarPulse, s[2]);
            } else {
              const s = obj.scale;
              mesh.scale.set(s[0] * pulse, s[1] * pulse, s[2] * pulse);
            }
          }
});
         // Tick character animation mixers
         if (isPlay) {
           characterMixersRef.current.forEach((mixer) => { mixer.update(delta); });
         }
         if (particlesRef.current && particleConfigRef.current.enabled && isPlay) {
          const pos = particlesRef.current.geometry.attributes.position.array;
          const spd = particleConfigRef.current.speed * (1 + audioBass * 2);
          for (let i = 0; i < pos.length; i += 3) { pos[i + 1] += delta * spd * 0.4; if (pos[i + 1] > particleConfigRef.current.spread) pos[i + 1] = 0; }
          particlesRef.current.geometry.attributes.position.needsUpdate = true;
          particlesRef.current.rotation.y += delta * 0.05;
        }
        const cm = cameraModeRef.current; const ir = renderPlayingRef.current;
        const sx = (Math.random() - 0.5) * shakeRef.current; const sy = (Math.random() - 0.5) * shakeRef.current;
        if (cm === "orbit" && ir) { const a = elapsed * 0.25; camera.position.x = Math.sin(a) * 8 + sx; camera.position.z = Math.cos(a) * 8; camera.position.y = 3 + Math.sin(a * 0.5) * 0.6 + sy; camera.lookAt(0, 0.5, 0); }
        else if (cm === "dolly" && ir) { const t = (elapsed % 8) / 8; camera.position.z = 10 - t * 6; camera.position.y = 3 - t * 0.8 + sy; camera.lookAt(0, 0.5, 0); }
        else if (cm === "handheld" && ir) { camera.position.x += (Math.random() - 0.5) * 0.02; camera.position.y += (Math.random() - 0.5) * 0.02; camera.lookAt(0, 0.5, 0); }
        if (sceneConfigRef.current.selectiveBloom && bloomComposerRef.current && finalComposerRef.current) {
          const pv: boolean[] = [];
          sceneRef.current.traverse((c: any) => { if (c.isMesh) { pv.push(c.visible); c.visible = pv[pv.length - 1] && ((c.layers.mask & (1 << BLOOM_LAYER)) !== 0); } });
          bloomComposerRef.current.render();
          let i = 0; sceneRef.current.traverse((c: any) => { if (c.isMesh) c.visible = pv[i++]; });
          finalComposerRef.current.render();
        } else { composer.render(); }

        // Update animation timeline (only when render is playing)
        // Throttle state updates to ~10fps to avoid excessive re-renders
        if (renderPlayingRef.current) {
          const nextTime = animationTimeRef.current + delta;
          animationTimeRef.current = nextTime >= animationDuration ? 0 : nextTime;
          const now = performance.now();
          if (now - lastUiUpdateRef.current > 100) {
            lastUiUpdateRef.current = now;
            setAnimationTime(animationTimeRef.current);
          }
        }

        // Call generated scene update using ref for current time
        if (generatedSceneUpdateRef.current) {
          if (renderPlayingRef.current) {
            generatedSceneUpdateRef.current(animationTimeRef.current, delta);
          }
        }

        // Apply keyframe animations (only when render is playing)
        if (keyframeTracksRef.current.length > 0 && renderPlayingRef.current) {
          keyframeTracksRef.current.forEach((track: any) => {
            const mesh = objectsMapRef.current.get(track.target);
            if (!mesh) return;
            const time = animationTimeRef.current;
            const kfs = track.keyframes || [];
            if (kfs.length < 2) return;
            let prevKf = kfs[0];
            let nextKf = kfs[kfs.length - 1];
            for (let i = 0; i < kfs.length - 1; i++) {
              if (time >= kfs[i].time && time <= kfs[i + 1].time) {
                prevKf = kfs[i];
                nextKf = kfs[i + 1];
                break;
              }
            }
            if (prevKf !== nextKf) {
              const duration = nextKf.time - prevKf.time;
              const t = duration > 0 ? (time - prevKf.time) / duration : 0;
              if (prevKf.position && nextKf.position) {
                mesh.position.set(
                  prevKf.position[0] + (nextKf.position[0] - prevKf.position[0]) * t,
                  prevKf.position[1] + (nextKf.position[1] - prevKf.position[1]) * t,
                  prevKf.position[2] + (nextKf.position[2] - prevKf.position[2]) * t
                );
              }
              if (prevKf.rotation && nextKf.rotation) {
                mesh.rotation.set(
                  prevKf.rotation[0] + (nextKf.rotation[0] - prevKf.rotation[0]) * t,
                  prevKf.rotation[1] + (nextKf.rotation[1] - prevKf.rotation[1]) * t,
                  prevKf.rotation[2] + (nextKf.rotation[2] - prevKf.rotation[2]) * t
                );
              }
              if (prevKf.scale && nextKf.scale) {
                mesh.scale.set(
                  prevKf.scale[0] + (nextKf.scale[0] - prevKf.scale[0]) * t,
                  prevKf.scale[1] + (nextKf.scale[1] - prevKf.scale[1]) * t,
                  prevKf.scale[2] + (nextKf.scale[2] - prevKf.scale[2]) * t
                );
              }
            }
          });
        }
      };
    animate();
    window.addEventListener("resize", onResize);
    setSceneLoading(false);
  };
  initScene();
  return () => { cancelAnimationFrame(animationRef.current); window.removeEventListener("resize", onResize); rendererRef.current?.dispose(); };
  }, [createMeshForObject]);

  // ---- Object sync ----
  useEffect(() => {
    if (!sceneRef.current) return;
    let cancelled = false;
    {
      if (cancelled) return;
      const scene = sceneRef.current;
      const ids = new Set(objects.map((o) => o.id));
      objectsMapRef.current.forEach((mesh, id) => {
        if (!ids.has(id)) {
          scene.remove(mesh);
          objectsMapRef.current.delete(id);
          characterMixersRef.current.delete(id);
          characterAnimDataRef.current.delete(id);
        }
      });
      // Use sequential async iteration instead of forEach+async to avoid race conditions
      (async () => {
        for (const obj of objects) {
          if (cancelled) break;
          let mesh = objectsMapRef.current.get(obj.id);
          if (!mesh) { mesh = await createMeshForObject(obj, THREE); if (!cancelled) { scene.add(mesh); objectsMapRef.current.set(obj.id, mesh); } }
          else {
            mesh.visible = obj.visible;
            mesh.position.set(...obj.position);
            mesh.rotation.set(...obj.rotation);
            mesh.scale.set(...obj.scale);
            // For character type with changed modelUrl, reload the model
            if (obj.type === "character" && obj.modelUrl && (mesh as any).__modelUrl !== obj.modelUrl) {
              scene.remove(mesh);
              const newMesh = await createMeshForObject(obj, THREE);
              if (!cancelled) {
                scene.add(newMesh);
                objectsMapRef.current.set(obj.id, newMesh);
                (newMesh as any).__modelUrl = obj.modelUrl;
              }
              continue;
            }
            const um = (m: any) => { if (m.material) { if (m.material.color) m.material.color.set(obj.color); if (m.material.emissive) m.material.emissive.set(obj.emissive); m.material.metalness = obj.metalness; m.material.roughness = obj.roughness; m.material.emissiveIntensity = obj.emissiveIntensity; } };
            if (mesh.isGroup) mesh.traverse(um); else um(mesh);
            const tl = obj.bloom ? BLOOM_LAYER : 0;
            mesh.traverse((c: any) => { if (c.isMesh) { c.layers.set(0); if (obj.bloom) c.layers.enable(BLOOM_LAYER); } });
          }
        }
      })();
    }
    return () => { cancelled = true; };
  }, [objects, createMeshForObject]);

  // ---- Scene config sync ----
  useEffect(() => {
    sceneConfigRef.current = sceneConfig;
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(sceneConfig.backgroundColor);
      if (sceneRef.current.fog) {
        sceneRef.current.fog.color.set(sceneConfig.fogColor);
        sceneRef.current.fog.density = sceneConfig.fogDensity;
      }
    }
    if (bloomPassRef.current) bloomPassRef.current.strength = sceneConfig.bloomStrength;
    if (caPassRef.current) caPassRef.current.uniforms.amount.value = sceneConfig.chromaticAberration;
    if (grainPassRef.current) grainPassRef.current.uniforms.intensity.value = sceneConfig.filmGrain;
    if (vignettePassRef.current) { vignettePassRef.current.uniforms.offset.value = sceneConfig.vignetteRadius; vignettePassRef.current.uniforms.darkness.value = sceneConfig.vignetteStrength; }
  }, [sceneConfig]);

  // ---- Particle config sync ----
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
    const mat = particlesRef.current.material;
    if (mat) {
      mat.color.set(particleConfig.color);
      mat.size = particleConfig.size;
      mat.opacity = particleConfig.opacity;
    }
    particlesRef.current.visible = particleConfig.enabled;
  }, [particleConfig]);

  // ---- Background image ----
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!backgroundImageUrl) { if (bgImageTextureRef.current) { bgImageTextureRef.current.dispose(); bgImageTextureRef.current = null; } return; }
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { if (cancelled) return; const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true; if (bgImageTextureRef.current) bgImageTextureRef.current.dispose(); bgImageTextureRef.current = tex; sceneRef.current.background = tex; };
      img.onerror = (err) => console.error("BG image failed:", backgroundImageUrl, err);
      img.src = backgroundImageUrl;
    })();
    return () => { cancelled = true; };
  }, [backgroundImageUrl]);

  useEffect(() => {
    if (!sceneRef.current || !bgImageTextureRef.current) return;
    sceneRef.current.background = backgroundImageVisible ? bgImageTextureRef.current : new THREE.Color(sceneConfigRef.current.backgroundColor);
  }, [backgroundImageVisible, sceneConfig.backgroundColor]);

  // ---- Load library tracks ----
  useEffect(() => {
    setTracksLoading(true);
    setTracksError(null);
    listAudioFiles()
      .then((f) => {
        if (Array.isArray(f) && f.length > 0) {
          setLibraryTracks(f);
        } else {
          setLibraryTracks([]);
        }
      })
      .catch((err) => {
        setTracksError(err.message || "Failed to load tracks");
        setLibraryTracks([]);
      })
      .finally(() => setTracksLoading(false));
  }, []);

  // Validate selected track still exists in library
  useEffect(() => {
    if (selectedTrack && libraryTracks.length > 0 && !libraryTracks.some((t) => t.filename === selectedTrack)) {
      setSelectedTrack("");
      setIsAudioPlaying(false);
    }
  }, [libraryTracks, selectedTrack]);

  // Fetch metadata (BPM/duration) for selected track only
  useEffect(() => {
    if (!selectedTrack) { setTrackMetadata({}); return; }
    const fetchMetadata = async () => {
      const metadata: Record<string, { bpm?: number; duration?: number }> = {};
      try {
        const res = await fetch(`/api/audio/analysis/${encodeURIComponent(selectedTrack)}`);
        if (res.ok) {
          const data: any = await res.json();
          metadata[selectedTrack] = {
            bpm: data.tempo_bpm ? Math.round(data.tempo_bpm) : undefined,
            duration: data.duration_seconds ? Math.round(data.duration_seconds) : undefined,
          };
        }
      } catch { /* ignore */ }
      setTrackMetadata(metadata);
    };
    fetchMetadata();
  }, [selectedTrack]);

  // ---- Load library images ----
  useEffect(() => {
    let cancelled = false;
    const load = (fileType: string) => fetch(`/api/outputs?file_type=${fileType}&limit=12`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([load("audio"), load("video"), load("image")]).then(([a, v, i]) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const imgs: Array<{ url: string; label: string }> = [];
      const collect = (data: any) => { if (!data?.outputs) return; for (const o of data.outputs) { const cover = o.cover_image ? `/output/${o.cover_image}` : null; if (cover && !seen.has(cover)) { seen.add(cover); imgs.push({ url: cover, label: `${o.filename} cover` }); } } };
      collect(a); collect(v); collect(i);
      setLibraryImages(imgs.slice(0, 12));
    });
    return () => { cancelled = true; };
  }, []);

  // ---- Derived state ----
  const selectedObj = objects.find((o) => o.id === selectedObject);

  // ---- Event handlers ----
  const objectCounterRef = useRef(0);
  const addObject = (type: AnimObject["type"]) => {
    objectCounterRef.current++;
    const id = `${type}-${Date.now()}-${objectCounterRef.current}`;
    const isCharacter = type === "character";
    const newObj: AnimObject = {
      id, name: isCharacter ? `Character ${objects.length + 1}` : `${type.charAt(0).toUpperCase() + type.slice(1)} ${objects.length + 1}`, type,
      position: [0, isCharacter ? 0 : 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      color: type === "sphere" ? "#60a5fa" : type === "box" ? "#a855f7" : type === "torus" ? "#f43f5e" : isCharacter ? "#fbbf24" : "#e2e8f0",
      metalness: isCharacter ? 0.1 : 0.6, roughness: isCharacter ? 0.7 : 0.3, emissive: isCharacter ? "#1a1000" : "#000000", emissiveIntensity: 0.1,
      visible: true, bobSpeed: 1.0, bobAmount: isCharacter ? 0.05 : 0.15, rotateSpeed: 0.2, bloom: type === "crown" || isCharacter,
      modelUrl: isCharacter ? "/models/character_rigged.glb" : undefined,
      animationName: undefined,
      animationSpeed: 1,
      animationLoop: true,
    };
    setObjects((prev) => [...prev, newObj]);
    setSelectedObject(id);
  };

  const removeObject = (id: string) => {
    setObjects((prev) => prev.filter((obj) => obj.id !== id));
    if (selectedObject === id) { const remaining = objects.filter((obj) => obj.id !== id); setSelectedObject(remaining[0]?.id || null); }
  };

  const updateObject = (id: string, updates: Partial<AnimObject>) => {
    setObjects((prev) => prev.map((obj) => (obj.id === id ? { ...obj, ...updates } : obj)));
  };

  const loadTemplate = (template: SceneTemplate) => {
    setObjects(template.objects.map((o) => ({ ...o })));
    setParticleConfig({ ...template.particleConfig });
    setCameraMode(template.cameraMode);
    setSceneConfig((prev) => ({ ...prev, ...template.sceneConfig }));
    setSelectedObject(template.objects[0]?.id ?? null);
    setActiveTemplateId(template.id);
  };

  // ---- Character animation controls ----
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
      if (data.action.isRunning()) { data.action.pause(); } else { data.action.play(); }
      refreshCharacterAnimState(selectedObject);
    }
  }, [selectedObject, refreshCharacterAnimState]);

  const handleAnimSeek = useCallback((time: number) => {
    if (!selectedObject) return;
    const data = characterAnimDataRef.current.get(selectedObject);
    if (data && data.action) {
      data.action.time = time;
      data.mixer.update(0);
      refreshCharacterAnimState(selectedObject);
    }
  }, [selectedObject, refreshCharacterAnimState]);

  const handleAnimSelect = useCallback((clipName: string) => {
    if (!selectedObject) return;
    const data = characterAnimDataRef.current.get(selectedObject);
    if (data && data.mixer) {
      const clip = data.mixer.existingAction(clipName) ? clipName : data.clips[0];
      if (clip) {
        data.action?.stop();
        const newAction = data.mixer.clipAction(clip);
        newAction.play();
        data.action = newAction;
        refreshCharacterAnimState(selectedObject);
      }
    }
  }, [selectedObject, refreshCharacterAnimState]);

  const handleViewportReset = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.position.set(0, 3, 8);
      cameraRef.current.lookAt(0, 0.5, 0);
    }
  }, []);

  // ---- Character animation state refresh (10fps during playback) ----
  useEffect(() => {
    const interval = setInterval(() => {
      if (selectedObject && characterAnimStateRef.current?.isPlaying) {
        refreshCharacterAnimState(selectedObject);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [selectedObject, refreshCharacterAnimState]);

  const exportFrame = () => {
    if (!rendererRef.current) return;
    const link = document.createElement("a");
    link.download = `threejs_frame_${Date.now()}.png`;
    link.href = rendererRef.current.domElement.toDataURL("image/png");
    link.click();
  };

  const handleSelectTrack = (filename: string) => {
    const wasPlaying = isAudioPlaying;
    setSelectedTrack(filename);
    setBeatSync(true);
    // If audio was playing, auto-switch to new track
    if (wasPlaying && audioElementRef.current) {
      setIsAudioPlaying(false);
      // Small delay to allow state update before starting new track
      setTimeout(() => {
        audioElementRef.current?.play().catch(() => {});
      }, 50);
    }
  };

  // Auto-set BPM from analysis metadata when it loads
  useEffect(() => {
    if (beatAnalysis?.tempo_bpm) {
      setBpm(Math.round(beatAnalysis.tempo_bpm));
    }
  }, [beatAnalysis]);

  const toggleAudio = async () => {
    if (!audioElementRef.current) return;
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        // Guard: createMediaElementSource throws if called twice on same element
        if (!audioSourceRef.current) {
          const source = ctx.createMediaElementSource(audioElementRef.current);
          source.connect(analyser);
          analyser.connect(ctx.destination);
          audioSourceRef.current = source;
        }
      }
      if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
      if (isAudioPlaying) { audioElementRef.current.pause(); setIsAudioPlaying(false); setIsPlaying(false); }
      else { await audioElementRef.current.play(); setIsAudioPlaying(true); setIsPlaying(true); setRenderPlaying(true); }
    } catch (err) { console.error("Audio playback error:", err); }
  };

  // ---- Render ----
  return (
    <div className={`relative w-full h-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden ${focusMode ? "focus-mode" : ""}`}>
      {/* Header bar */}
      <div className={`header-bar flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 bg-[#12121a] border-b border-gray-800 shrink-0 min-w-0 ${focusMode ? "hidden" : ""}`}>
        <Sparkles size={16} className="text-purple-400 shrink-0" />
        <span className="font-semibold text-sm shrink-0 hidden sm:inline">Three.js Studio</span>
        <div className="w-px h-5 bg-gray-700 mx-1 shrink-0 hidden sm:block" />
        <button onClick={() => addObject("crown")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs shrink-0" title="Add Crown">👑</button>
        <button onClick={() => addObject("sphere")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0 hidden xs:block" title="Add Sphere"><Circle size={13} /></button>
        <button onClick={() => addObject("box")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0 hidden sm:block" title="Add Box"><Box size={13} /></button>
          <button onClick={() => addObject("character")} className="p-1.5 bg-amber-700/50 hover:bg-amber-600/50 rounded shrink-0" title="Add Character"><User size={13} className="text-amber-200" /></button>
          <button onClick={handleViewportReset} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0" title="Reset Camera"><Maximize2 size={13} /></button>
        <div className="flex items-center gap-1.5 sm:gap-2 ml-1 sm:ml-2 bg-gray-800/80 px-2 py-1 rounded-lg border border-gray-700 flex-1 min-w-0">
          <Music size={13} className="text-purple-400 shrink-0" />
          <select
            value={selectedTrack}
            onChange={(e) => handleSelectTrack(e.target.value)}
            className="bg-transparent text-xs text-gray-200 outline-none flex-1 min-w-0 truncate"
            disabled={tracksLoading}
          >
            {tracksLoading && <option value="" className="bg-gray-800">Loading tracks…</option>}
            {!tracksLoading && tracksError && <option value="" className="bg-gray-800">Error loading tracks</option>}
            {!tracksLoading && !tracksError && libraryTracks.length === 0 && <option value="" className="bg-gray-800">No tracks in library</option>}
            {!tracksLoading && !tracksError && libraryTracks.length > 0 && <option value="" className="bg-gray-800">Select track…</option>}
            {!tracksLoading && !tracksError && libraryTracks.map((t) => {
              const displayName = t.filename
                .replace(/^[0-9a-f]{8}_[0-9a-f]{8}_/i, '')
                .replace(/\.(mp3|wav|flac|ogg)$/i, '');
              const meta = trackMetadata[t.filename];
              const metaStr = meta?.bpm && meta?.duration ? ` (${meta.bpm} BPM, ${meta.duration}s)` : '';
              // If multiple files have the same display name, append hash to disambiguate
              const sameNameCount = libraryTracks.filter((x) => {
                const xName = x.filename.replace(/^[0-9a-f]{8}_[0-9a-f]{8}_/i, '').replace(/\.(mp3|wav|flac|ogg)$/i, '');
                return xName === displayName;
              }).length;
              const needsDisambiguation = sameNameCount > 1;
              const shortHash = t.filename.match(/^[0-9a-f]{8}/)?.[0] || '';
              const label = needsDisambiguation && shortHash ? `${displayName} [${shortHash}]${metaStr}` : `${displayName}${metaStr}`;
              return (<option key={t.filename} value={t.filename} className="bg-gray-800">{label}</option>);
            })}
          </select>
          {!tracksLoading && selectedTrack && isAudioPlaying && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" title="Playing" />
          )}
        </div>
        {selectedTrack && (<audio ref={audioElementRef} src={`/api/audio/file/${encodeURIComponent(selectedTrack)}`} crossOrigin="anonymous" onEnded={() => setIsAudioPlaying(false)} className="hidden" />)}
        <button onClick={exportFrame} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0" title="Export frame as PNG"><Download size={13} /></button>
        <button onClick={() => setCodePanelOpen(!codePanelOpen)} className={`p-1.5 rounded transition-colors shrink-0 ${codePanelOpen ? "bg-emerald-600" : "bg-gray-700 hover:bg-gray-600"}`} title="Paste generated code"><FileCode size={13} /></button>
        <button onClick={toggleFocusMode} className={`p-1.5 rounded transition-colors shrink-0 ${focusMode ? "bg-amber-600" : "bg-gray-700 hover:bg-gray-600"}`} title={focusMode ? "Exit focus mode" : "Focus mode (hide UI)"}>
          {focusMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button onClick={() => setDrawerOpen(!drawerOpen)} className={`p-1.5 rounded transition-colors shrink-0 ${drawerOpen ? "bg-purple-600" : "bg-gray-700 hover:bg-gray-600"}`} title="Toggle controls panel">
          {drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Track info bar */}
      {selectedTrack && (
        <div className={`track-info-bar flex items-center gap-1.5 sm:gap-3 px-2 sm:px-4 py-1.5 bg-[#0e0e16] border-b border-gray-800 shrink-0 text-xs overflow-x-auto ${focusMode ? "hidden" : ""}`}>
          <div className="flex items-center gap-1.5 shrink-0">
            <Zap size={12} className={beatSync ? "text-amber-400" : "text-gray-500"} />
            <input type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-12 bg-gray-800 text-white rounded px-1.5 py-0.5 text-center font-mono border border-gray-700" min={60} max={220} />
            <span className="text-gray-400">BPM</span>
          </div>
          <button onClick={() => setBeatSync(!beatSync)} className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${beatSync ? "bg-purple-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-300"}`}>
            {beatSync ? "Sync ON" : "Sync OFF"}
          </button>
          <div className="text-gray-400 shrink-0">Beats: <span className={beatAnalysis ? "text-amber-300 font-mono" : "text-gray-500 font-mono"}>{beatLoading ? "loading…" : beatAnalysis ? beatAnalysis.beat_count : beatError ? "0" : "—"}</span></div>
          {beatAnalysis && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-gray-400">Punch</span>
              <input type="range" min="0" max="0.5" step="0.01" value={sceneConfig.beatPunch} onChange={(e) => setSceneConfig({ ...sceneConfig, beatPunch: Number(e.target.value) })} className="w-20 accent-amber-400" />
              <span className="text-amber-300 font-mono w-6 text-right">{sceneConfig.beatPunch.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Canvas + AI Panel */}
      <div ref={containerRef} className="flex-1 relative bg-[#0a0a0f] overflow-hidden min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Scene loading overlay */}
        {sceneLoading && (
          <div className="absolute inset-0 bg-[#0a0a0f] flex items-center justify-center z-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-purple-300">Initializing 3D scene…</span>
            </div>
          </div>
        )}

        {/* AI Scene Generator Panel */}
        <div className={`ai-panel absolute top-2 right-2 w-72 max-h-[calc(100%-1rem)] overflow-y-auto z-10 ${focusMode ? "hidden" : ""}`}>
          <AISceneGenerator
            selectedTrack={selectedTrack || null}
            onApplyCode={handleApplyCode}
            storyboard={storyboardParam}
            autoGenerate={autoGenerateParam === "true"}
            storyboardScene={storyboardSceneParam ? parseInt(storyboardSceneParam, 10) : null}
          />
        </div>

        {/* Paste Code Panel */}
        {codePanelOpen && (
          <div className={`code-panel absolute top-2 left-2 w-80 max-h-[calc(100%-1rem)] z-10 flex flex-col gap-2 ${focusMode ? "hidden" : ""}`}>
            <div className="bg-[#0e0e16] border border-emerald-500/30 rounded-lg overflow-hidden shadow-xl">
              <div className="flex items-center justify-between px-3 py-2 bg-emerald-900/20 border-b border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <FileCode size={14} className="text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-300">Paste Code</span>
                </div>
                <button onClick={() => setCodePanelOpen(false)} className="text-gray-400 hover:text-white p-0.5">
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <textarea
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder={`// Available: scene, camera, renderer, THREE\n// Define: function applyScene(scene, camera, renderer) { ... }\n// Or return JSON: { "objects": [...] }`}
                  spellCheck={false}
                  className="w-full h-40 bg-gray-900 border border-gray-700 rounded p-2 text-xs font-mono text-green-300 placeholder-gray-600 resize-none focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => handleApplyCode(pastedCode)}
                  disabled={!pastedCode.trim()}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Zap size={12} /> Apply to Scene
                </button>
                {codeError && (
                  <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded p-2">
                    Error: {codeError}
                  </div>
                )}
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Paste JavaScript or JSON from an AI agent. The code runs in the scene context with access to Three.js.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* HUD */}
        <div className={`hud absolute bottom-2 left-2 bg-black/60 backdrop-blur px-2.5 py-1 rounded text-gray-400 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5 pointer-events-none border border-white/5 max-w-[calc(100%-1rem)] ${focusMode ? "hidden" : ""}`}>
          <span>Objs <span className="text-white font-mono">{objects.length}</span></span>
          <span>Cam <span className="text-purple-400 font-mono">{cameraMode}</span></span>
          <span>BPM <span className={beatSync ? "text-green-400 font-mono" : "text-gray-500 font-mono"}>{beatSync ? bpm : "—"}</span></span>
          {sceneConfig.selectiveBloom && <span>Bloom <span className="text-amber-300 font-mono">{objects.filter((o) => o.bloom).length}/{objects.length}</span></span>}
          {beatSync && (
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full transition-all duration-75 ${beatActive ? "bg-green-400 scale-125" : "bg-gray-600 scale-100"}`} />
              <span className={beatActive ? "text-green-400" : "text-gray-500"}>Beat</span>
            </span>
          )}
        </div>

        {beatError && selectedTrack && (
          <a href="/audio-analysis" target="_blank" rel="noreferrer" className="absolute bottom-2 right-2 bg-amber-900/70 hover:bg-amber-800/80 backdrop-blur px-2.5 py-1 rounded text-amber-100 text-[11px] border border-amber-700/50 pointer-events-auto transition-colors">
            Open Audio Analysis →
          </a>
        )}

         {/* Playback Controls */}
         <div className={`playback-controls absolute bottom-10 left-2 right-2 bg-[#12121a]/95 backdrop-blur-md rounded-xl border border-gray-700/60 shadow-2xl shadow-black/40 ${focusMode ? "hidden" : ""}`}>
          {/* Main transport row */}
          <div className="flex items-center gap-2 px-4 py-2.5">
            {/* Render Transport */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRenderPlaying(!renderPlaying)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${renderPlaying ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/40" : "bg-gray-700 hover:bg-gray-600"}`}
                title={renderPlaying ? "Pause render" : "Play render"}
              >
                {renderPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>
              <button
                onClick={() => { setRenderPlaying(false); setAnimationTime(0); }}
                className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                title="Rewind to start"
              >
                <Square size={14} />
              </button>
              <div className="flex flex-col items-center">
                <span className={`text-xs font-mono font-bold ${renderPlaying ? "text-emerald-400" : "text-gray-300"}`}>
                  {Math.floor(animationTime / 60)}:{String(Math.floor(animationTime % 60)).padStart(2, "0")}
                </span>
                <span className="text-[9px] text-gray-500 uppercase tracking-wider">Render</span>
              </div>
            </div>

            {/* Divider */}
            <div className="w-px h-8 bg-gray-700/60" />

            {/* Audio Transport */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleAudio}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${isAudioPlaying ? "bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-900/40" : "bg-gray-700 hover:bg-gray-600"}`}
                title={isAudioPlaying ? "Pause audio" : "Play audio"}
              >
                {isAudioPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>
              <button
                onClick={() => { setIsAudioPlaying(false); setIsPlaying(false); setRenderPlaying(false); }}
                className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                title="Stop all"
              >
                <Square size={14} />
              </button>
              <div className="flex flex-col items-center">
                <span className={`text-xs font-mono font-bold ${isAudioPlaying ? "text-purple-400" : "text-gray-300"}`}>
                  {isAudioPlaying ? "LIVE" : "— : —"}
                </span>
                <span className="text-[9px] text-gray-500 uppercase tracking-wider">Audio</span>
              </div>
            </div>

            {/* Divider */}
            <div className="w-px h-8 bg-gray-700/60" />

            {/* Timeline Scrubber */}
            <div className="flex-1 flex items-center gap-2 px-2">
              <span className="text-[10px] text-gray-500 font-mono">{animationTime.toFixed(1)}s</span>
              <div className="flex-1 relative">
                <input
                  type="range"
                  min={0}
                  max={animationDuration}
                  step={0.1}
                  value={animationTime}
                  onChange={(e) => { setAnimationTime(Number(e.target.value)); setRenderPlaying(false); }}
                  className="w-full h-2 bg-gray-700 rounded-full appearance-none cursor-pointer accent-purple-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-purple-900/50"
                />
              </div>
              <span className="text-[10px] text-gray-500 font-mono">{animationDuration.toFixed(0)}s</span>
            </div>

            {/* Keyframe indicator */}
              {keyframeTracks.length > 0 && (
                <span className="text-[10px] text-purple-400 bg-purple-900/30 px-2 py-1 rounded-md font-medium">{keyframeTracks.length} keyframes</span>
              )}
            </div>
          </div>
        </div>

        {/* Exit focus mode button */}
        {focusMode && (
          <button
            onClick={toggleFocusMode}
            className="absolute top-2 left-2 z-20 p-2 bg-amber-600/80 hover:bg-amber-600 rounded-lg text-white shadow-lg backdrop-blur transition-colors"
            title="Exit focus mode (Esc)"
          >
            <Minimize2 size={16} />
          </button>
        )}

      {/* Bottom Drawer */}
      {drawerOpen && (
        <div className={`bottom-drawer bg-[#0e0e16] border-t border-gray-800 shrink-0 flex flex-col h-[55vh] sm:h-[45vh] min-h-[280px] max-h-[600px] ${focusMode ? "hidden" : ""}`}>
          <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1.5 border-b border-gray-800 bg-[#12121a] shrink-0">
            <button onClick={() => setDrawerTab("objects")} className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${drawerTab === "objects" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}><Box size={12} /> <span className="hidden sm:inline">Objects</span><span className="opacity-60 hidden sm:inline">({objects.length})</span></button>
            <button onClick={() => setDrawerTab("inspector")} className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${drawerTab === "inspector" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}><Zap size={12} /> <span className="hidden sm:inline">Inspector</span></button>
            <button onClick={() => setDrawerTab("scene")} className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${drawerTab === "scene" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}><Settings size={12} /> <span className="hidden sm:inline">Scene</span></button>
            <div className="flex-1" />
            <button onClick={() => setDrawerOpen(false)} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 shrink-0" title="Close panel"><ChevronDown size={14} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {drawerTab === "objects" && (
              <ObjectsTab
                objects={objects} selectedObject={selectedObject} activeTemplateId={activeTemplateId}
                onSelectObject={setSelectedObject} onAddObject={addObject} onRemoveObject={removeObject}
                onUpdateObject={updateObject} onLoadTemplate={loadTemplate}
              />
            )}
            {drawerTab === "inspector" && (
              <InspectorTab
                object={selectedObj}
                onUpdate={updateObject}
                animationState={selectedObj?.type === "character" ? characterAnimState : undefined}
                onAnimationPlayPause={handleAnimPlayPause}
                onAnimationSeek={handleAnimSeek}
                onAnimationSelect={handleAnimSelect}
              />
            )}
            {drawerTab === "scene" && (
              <SceneTab
                sceneConfig={sceneConfig} particleConfig={particleConfig} cameraMode={cameraMode} fps={fps}
                backgroundImageUrl={backgroundImageUrl} backgroundImageVisible={backgroundImageVisible} libraryImages={libraryImages}
                onSceneConfigChange={setSceneConfig} onParticleConfigChange={setParticleConfig}
                onCameraModeChange={setCameraMode} onFpsChange={setFps}
                onBackgroundImageChange={setBackgroundImageUrl} onBackgroundImageVisibleChange={setBackgroundImageVisible}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
