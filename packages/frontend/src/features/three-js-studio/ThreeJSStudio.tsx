import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box, Play, Pause, Sparkles, Download, Settings, Circle,
  ChevronDown, ChevronUp, Music, Zap, Volume2, VolumeX,
} from "lucide-react";
import { listAudioFiles } from "../../services/api";
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

const TRACK_PRESETS = [
  { name: "Take the Crown", bpm: 150, filename: "85a406ef_NeoCortext - Take the Crown.mp3" },
  { name: "The Signal Breaking Through", bpm: 136, filename: "e02f6ccf_NeoCortext - The Signal Breaking Through the Noise.mp3" },
  { name: "Before the Fade", bpm: 130, filename: "8baaf391_NeoCortext - Before the Fade.mp3" },
  { name: "Still I Rise", bpm: 130, filename: "54360357_NeoCortext - Still I Rise.mp3" },
  { name: "Learning How to Stay", bpm: 85, filename: "a19680f6_NeoCortext - Learning How to Stay.mp3" },
];

export function ThreeJSStudio() {
  // ---- Refs ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const sceneRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const objectsMapRef = useRef<Map<string, any>>(new Map());
  const particlesRef = useRef<any>(null);
  const clockRef = useRef<any>(null);
  const bloomPassRef = useRef<any>(null);
  const bloomComposerRef = useRef<any>(null);
  const finalComposerRef = useRef<any>(null);
  const caPassRef = useRef<any>(null);
  const grainPassRef = useRef<any>(null);
  const vignettePassRef = useRef<any>(null);
  const shakeRef = useRef(0);
  const bgImageTextureRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioFreqArrayRef = useRef<Uint8Array | null>(null);

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
  const [libraryTracks, setLibraryTracks] = useState<Array<{ filename: string; path: string }>>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string>("");
  void generatedCode; // used for future scene persistence

  const { analysis: beatAnalysis, loading: beatLoading, error: beatError, getCurrentBeat } = useBeatTimeline(selectedTrack || null);

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
    else { meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); }
    meshGroup.position.set(...obj.position);
    meshGroup.rotation.set(...obj.rotation);
    meshGroup.scale.set(...obj.scale);
    meshGroup.visible = obj.visible;
    meshGroup.castShadow = true;
    meshGroup.receiveShadow = true;
    const targetLayer = obj.bloom ? BLOOM_LAYER : 0;
    meshGroup.traverse((child: any) => { if (child.isMesh) child.layers.set(targetLayer); });
    return meshGroup;
  }, []);

  // ---- Helper: apply generated code to scene ----
  const handleApplyCode = useCallback((code: string) => {
    if (!sceneRef.current || !code) return;
    setGeneratedCode(code);
    try {
      // Extract function body and execute in sandboxed context
      const fn = new Function("scene", "camera", "renderer", "THREE", code + "\nif(typeof applyScene === 'function') { applyScene(scene, camera, renderer); }");
      fn(sceneRef.current, cameraRef.current, rendererRef.current, (window as any).THREE);
    } catch (err) {
      console.error("Failed to apply generated scene code:", err);
    }
  }, []);

  // ---- Scene init + animation loop ----
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const initScene = async () => {
      const THREE = await import("three");
      (window as any).THREE = THREE;
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
      const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
      const { UnrealBloomPass } = await import("three/examples/jsm/postprocessing/UnrealBloomPass.js");
      const { ShaderPass } = await import("three/examples/jsm/postprocessing/ShaderPass.js");
      const { OutputPass } = await import("three/examples/jsm/postprocessing/OutputPass.js");
      const { RGBShiftShader } = await import("three/examples/jsm/shaders/RGBShiftShader.js");
      const { FilmShader } = await import("three/examples/jsm/shaders/FilmShader.js");
      const { VignetteShader } = await import("three/examples/jsm/shaders/VignetteShader.js");

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
        let audioBass = 0, audioTreble = 0;
        if (analyserRef.current && isAudioPlayingRef.current) {
          if (!audioFreqArrayRef.current || audioFreqArrayRef.current.length !== analyserRef.current.frequencyBinCount) audioFreqArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(audioFreqArrayRef.current as Uint8Array<ArrayBuffer>);
          const arr = audioFreqArrayRef.current;
          const bassBins = Math.floor(arr.length * 0.08);
          audioBass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
          const trebleBins = Math.floor(arr.length * 0.4);
          audioTreble = arr.slice(trebleBins).reduce((a, b) => a + b, 0) / ((arr.length - trebleBins) * 255 || 1);
        }
        const beatState = getCurrentBeat(elapsed);
        const beatPunchAmp = sceneConfigRef.current.beatPunch;
        let beatSpike = 0;
        if (beatState.ready && beatState.isOnBeat) beatSpike = beatPunchAmp * (1 - beatState.timeSinceLastBeat / beatState.beatWindowSec);
        if (beatState.ready && beatState.isOnBeat && beatState.timeSinceLastBeat < 0.016) shakeRef.current = beatPunchAmp * 0.6;
        shakeRef.current *= 0.85;
        objectsRef.current.forEach((obj) => {
          const mesh = objectsMapRef.current.get(obj.id);
          if (mesh && obj.visible) {
            mesh.rotation.y += delta * (obj.rotateSpeed + audioTreble * 2);
            mesh.position.x = obj.position[0]; mesh.position.z = obj.position[2];
            mesh.position.y = obj.position[1] + Math.sin(elapsed * obj.bobSpeed) * obj.bobAmount;
            let pulse = 1;
            if (beatState.ready && beatSpike > 0) pulse = 1 + beatSpike;
            else if (beatSyncRef.current) { const bi = 60 / bpmRef.current; pulse = (1 + Math.sin((elapsed % bi) / bi * Math.PI * 2) * 0.08) * (1 + audioBass * 0.35); }
            else if (audioBass > 0) pulse = 1 + audioBass * 0.3;
            const s = obj.scale;
            mesh.scale.set(s[0] * pulse, s[1] * pulse, s[2] * pulse);
          }
        });
        if (particlesRef.current && particleConfigRef.current.enabled) {
          const pos = particlesRef.current.geometry.attributes.position.array;
          const spd = particleConfigRef.current.speed * (1 + audioBass * 2);
          for (let i = 0; i < pos.length; i += 3) { pos[i + 1] += delta * spd * 0.4; if (pos[i + 1] > particleConfigRef.current.spread) pos[i + 1] = 0; }
          particlesRef.current.geometry.attributes.position.needsUpdate = true;
          particlesRef.current.rotation.y += delta * 0.05;
        }
        const cm = cameraModeRef.current; const ir = isPlayingRef.current;
        const sx = (Math.random() - 0.5) * shakeRef.current; const sy = (Math.random() - 0.5) * shakeRef.current;
        if (cm === "orbit" && ir) { const a = elapsed * 0.25; camera.position.x = Math.sin(a) * 8 + sx; camera.position.z = Math.cos(a) * 8; camera.position.y = 3 + Math.sin(a * 0.5) * 0.6 + sy; camera.lookAt(0, 0.5, 0); }
        else if (cm === "dolly" && ir) { const t = (elapsed % 8) / 8; camera.position.z = 10 - t * 6; camera.position.y = 3 - t * 0.8 + sy; camera.lookAt(0, 0.5, 0); }
        else if (cm === "handheld" && ir) { camera.position.x += (Math.random() - 0.5) * 0.02; camera.position.y += (Math.random() - 0.5) * 0.02; camera.lookAt(0, 0.5, 0); }
        if (!ir) { camera.position.x += sx; camera.position.y += sy; }
        if (sceneConfigRef.current.selectiveBloom && bloomComposerRef.current && finalComposerRef.current) {
          const pv: boolean[] = [];
          sceneRef.current.traverse((c: any) => { if (c.isMesh) { pv.push(c.visible); c.visible = pv[pv.length - 1] && ((c.layers.mask & (1 << BLOOM_LAYER)) !== 0); } });
          bloomComposerRef.current.render();
          let i = 0; sceneRef.current.traverse((c: any) => { if (c.isMesh) c.visible = pv[i++]; });
          finalComposerRef.current.render();
        } else { composer.render(); }
      };
      animate();
      const onResize = () => { if (!containerRef.current) return; const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); if (bloomComposerRef.current) bloomComposerRef.current.setSize(w, h); if (finalComposerRef.current) finalComposerRef.current.setSize(w, h); };
      window.addEventListener("resize", onResize);
    };
    initScene();
    return () => { cancelAnimationFrame(animationRef.current); window.removeEventListener("resize", () => {}); rendererRef.current?.dispose(); };
  }, [createMeshForObject, getCurrentBeat, isAudioPlaying]);

  // ---- Object sync ----
  useEffect(() => {
    if (!sceneRef.current) return;
    import("three").then((THREE) => {
      const scene = sceneRef.current;
      const ids = new Set(objects.map((o) => o.id));
      objectsMapRef.current.forEach((mesh, id) => { if (!ids.has(id)) { scene.remove(mesh); objectsMapRef.current.delete(id); } });
      objects.forEach(async (obj) => {
        let mesh = objectsMapRef.current.get(obj.id);
        if (!mesh) { mesh = await createMeshForObject(obj, THREE); scene.add(mesh); objectsMapRef.current.set(obj.id, mesh); }
        else {
          mesh.visible = obj.visible;
          const um = (m: any) => { if (m.material) { if (m.material.color) m.material.color.set(obj.color); if (m.material.emissive) m.material.emissive.set(obj.emissive); m.material.metalness = obj.metalness; m.material.roughness = obj.roughness; m.material.emissiveIntensity = obj.emissiveIntensity; } };
          if (mesh.isGroup) mesh.traverse(um); else um(mesh);
          const tl = obj.bloom ? BLOOM_LAYER : 0;
          mesh.traverse((c: any) => { if (c.isMesh) c.layers.set(tl); });
        }
      });
    });
  }, [objects, createMeshForObject]);

  // ---- Scene config sync ----
  useEffect(() => {
    sceneConfigRef.current = sceneConfig;
    if (sceneRef.current) { import("three").then((THREE) => { sceneRef.current.background = new THREE.Color(sceneConfig.backgroundColor); if (sceneRef.current.fog) { sceneRef.current.fog.color.set(sceneConfig.fogColor); sceneRef.current.fog.density = sceneConfig.fogDensity; } }); }
    if (bloomPassRef.current) bloomPassRef.current.strength = sceneConfig.bloomStrength;
    if (caPassRef.current) caPassRef.current.uniforms.amount.value = sceneConfig.chromaticAberration;
    if (grainPassRef.current) grainPassRef.current.uniforms.intensity.value = sceneConfig.filmGrain;
    if (vignettePassRef.current) { vignettePassRef.current.uniforms.offset.value = sceneConfig.vignetteRadius; vignettePassRef.current.uniforms.darkness.value = sceneConfig.vignetteStrength; }
  }, [sceneConfig]);

  // ---- Background image ----
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!backgroundImageUrl) { if (bgImageTextureRef.current) { bgImageTextureRef.current.dispose(); bgImageTextureRef.current = null; } return; }
    let cancelled = false;
    (async () => {
      const THREE = await import("three");
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
    import("three").then((THREE) => { sceneRef.current.background = backgroundImageVisible ? bgImageTextureRef.current : new THREE.Color(sceneConfigRef.current.backgroundColor); });
  }, [backgroundImageVisible, sceneConfig.backgroundColor]);

  // ---- Load library tracks ----
  useEffect(() => { listAudioFiles().then((f) => { if (Array.isArray(f) && f.length > 0) setLibraryTracks(f); }).catch(() => {}); }, []);

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
  const addObject = (type: AnimObject["type"]) => {
    const id = `${type}-${Date.now()}`;
    const offset = (objects.length % 5) * 1.5 - 3;
    const newObj: AnimObject = {
      id, name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${objects.length + 1}`, type,
      position: [offset, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      color: type === "sphere" ? "#60a5fa" : type === "box" ? "#a855f7" : type === "torus" ? "#f43f5e" : "#e2e8f0",
      metalness: 0.6, roughness: 0.3, emissive: "#000000", emissiveIntensity: 0.1,
      visible: true, bobSpeed: 1.5, bobAmount: 0.15, rotateSpeed: 0.4, bloom: type === "crown",
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

  const exportFrame = () => {
    if (!rendererRef.current) return;
    const link = document.createElement("a");
    link.download = `threejs_frame_${Date.now()}.png`;
    link.href = rendererRef.current.domElement.toDataURL("image/png");
    link.click();
  };

  const handleSelectTrack = (filename: string) => {
    setSelectedTrack(filename);
    const preset = TRACK_PRESETS.find((p) => p.filename === filename || p.name.toLowerCase().includes(filename.toLowerCase()));
    if (preset) { setBpm(preset.bpm); setBeatSync(true); }
  };

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
        const source = ctx.createMediaElementSource(audioElementRef.current);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        audioSourceRef.current = source;
      }
      if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
      if (isAudioPlaying) { audioElementRef.current.pause(); setIsAudioPlaying(false); }
      else { await audioElementRef.current.play(); setIsAudioPlaying(true); setIsPlaying(true); }
    } catch (err) { console.error("Audio playback error:", err); }
  };

  // ---- Render ----
  return (
    <div className="relative w-full h-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 bg-[#12121a] border-b border-gray-800 shrink-0 min-w-0">
        <Sparkles size={16} className="text-purple-400 shrink-0" />
        <span className="font-semibold text-sm shrink-0 hidden sm:inline">Three.js Studio</span>
        <div className="w-px h-5 bg-gray-700 mx-1 shrink-0 hidden sm:block" />
        <button onClick={() => setIsPlaying(!isPlaying)} className={`p-1.5 rounded transition-colors shrink-0 ${isPlaying ? "bg-purple-600 hover:bg-purple-700" : "bg-gray-700 hover:bg-gray-600"}`} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button onClick={() => addObject("crown")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs shrink-0" title="Add Crown">👑</button>
        <button onClick={() => addObject("sphere")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0 hidden xs:block" title="Add Sphere"><Circle size={13} /></button>
        <button onClick={() => addObject("box")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0 hidden sm:block" title="Add Box"><Box size={13} /></button>
        <div className="flex items-center gap-1.5 sm:gap-2 ml-1 sm:ml-2 bg-gray-800/80 px-2 py-1 rounded-lg border border-gray-700 flex-1 min-w-0">
          <Music size={13} className="text-purple-400 shrink-0" />
          <select value={selectedTrack} onChange={(e) => handleSelectTrack(e.target.value)} className="bg-transparent text-xs text-gray-200 outline-none flex-1 min-w-0 truncate">
            <option value="" className="bg-gray-800">Select track…</option>
            {TRACK_PRESETS.map((t) => (<option key={t.filename} value={t.filename} className="bg-gray-800">{t.name} ({t.bpm} BPM)</option>))}
            {libraryTracks.map((t) => (<option key={t.filename} value={t.filename} className="bg-gray-800">{t.filename}</option>))}
          </select>
          {selectedTrack && (
            <button onClick={toggleAudio} className={`p-1 rounded text-xs flex items-center gap-1 shrink-0 ${isAudioPlaying ? "bg-purple-600 text-white" : "bg-gray-700 hover:bg-gray-600"}`} title={isAudioPlaying ? "Mute audio" : "Play audio"}>
              {isAudioPlaying ? <Volume2 size={12} /> : <VolumeX size={12} />}
            </button>
          )}
        </div>
        {selectedTrack && (<audio ref={audioElementRef} src={`/api/audio/file/${selectedTrack}`} crossOrigin="anonymous" onEnded={() => setIsAudioPlaying(false)} className="hidden" />)}
        <button onClick={exportFrame} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0" title="Export frame as PNG"><Download size={13} /></button>
        <button onClick={() => setDrawerOpen(!drawerOpen)} className={`p-1.5 rounded transition-colors shrink-0 ${drawerOpen ? "bg-purple-600" : "bg-gray-700 hover:bg-gray-600"}`} title="Toggle controls panel">
          {drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* Track info bar */}
      {selectedTrack && (
        <div className="flex items-center gap-1.5 sm:gap-3 px-2 sm:px-4 py-1.5 bg-[#0e0e16] border-b border-gray-800 shrink-0 text-xs overflow-x-auto">
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

        {/* AI Scene Generator Panel */}
        <div className="absolute top-2 right-2 w-72 max-h-[calc(100%-1rem)] overflow-y-auto z-10">
          <AISceneGenerator selectedTrack={selectedTrack || null} onApplyCode={handleApplyCode} />
        </div>

        {/* HUD */}
        <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur px-2.5 py-1 rounded text-gray-400 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5 pointer-events-none border border-white/5 max-w-[calc(100%-1rem)]">
          <span>Objs <span className="text-white font-mono">{objects.length}</span></span>
          <span>Cam <span className="text-purple-400 font-mono">{cameraMode}</span></span>
          <span>BPM <span className={beatSync ? "text-green-400 font-mono" : "text-gray-500 font-mono"}>{beatSync ? bpm : "—"}</span></span>
          {sceneConfig.selectiveBloom && <span>Bloom <span className="text-amber-300 font-mono">{objects.filter((o) => o.bloom).length}/{objects.length}</span></span>}
        </div>

        {beatError && selectedTrack && (
          <a href="/audio-analysis" target="_blank" rel="noreferrer" className="absolute bottom-2 right-2 bg-amber-900/70 hover:bg-amber-800/80 backdrop-blur px-2.5 py-1 rounded text-amber-100 text-[11px] border border-amber-700/50 pointer-events-auto transition-colors">
            Open Audio Analysis →
          </a>
        )}
      </div>

      {/* Bottom Drawer */}
      {drawerOpen && (
        <div className="bg-[#0e0e16] border-t border-gray-800 shrink-0 flex flex-col h-[55vh] sm:h-[45vh] min-h-[280px] max-h-[600px]">
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
            {drawerTab === "inspector" && <InspectorTab object={selectedObj} onUpdate={updateObject} />}
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
