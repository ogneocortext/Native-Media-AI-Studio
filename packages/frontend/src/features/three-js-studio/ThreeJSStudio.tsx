import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box,
  Play,
  Pause,
  Sparkles,
  Download,
  Settings,
  Circle,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Music,
  Zap,
  Volume2,
  VolumeX,
  Layers,
} from "lucide-react";
import { listAudioFiles } from "../../services/api";
import { useBeatTimeline } from "../../hooks/useBeatTimeline";
import { SCENE_TEMPLATES, type SceneTemplate } from "./sceneTemplates";
import type { AnimObject, ParticleConfig, SceneConfig, CameraMode } from "./types";

/**
 * Layer 1 is reserved for selective bloom: objects added to the bloom layer
 * glow while the rest of the scene stays neutral. Selective bloom is a
 * two-pass composer (BLOOM_SCENE writes bright objects to an offscreen
 * target, then main composer composites the bloom buffer on top).
 */
const BLOOM_LAYER = 1;

const DEFAULT_SCENE: SceneConfig = {
  backgroundColor: "#0a0a0f",
  fogEnabled: true,
  fogColor: "#0a0a0f",
  fogDensity: 0.015,
  bloomStrength: 0.8,
  selectiveBloom: true,
  chromaticAberration: 0.0025,
  filmGrain: 0.12,
  vignetteStrength: 0.55,
  vignetteRadius: 0.65,
  beatPunch: 0.18,
};

const DEFAULT_PARTICLES: ParticleConfig = {
  enabled: true,
  count: 300,
  size: 0.02,
  color: "#8b5cf6",
  speed: 0.5,
  spread: 6,
  opacity: 0.7,
};

const DEFAULT_OBJECTS: AnimObject[] = [
  {
    id: "crown-1",
    name: "Crown",
    type: "crown",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffd700",
    metalness: 0.9,
    roughness: 0.1,
    emissive: "#ff8c00",
    emissiveIntensity: 0.15,
    visible: true,
    bobSpeed: 1.5,
    bobAmount: 0.1,
    rotateSpeed: 0.3,
    bloom: true,
  },
];

const TRACK_PRESETS: Array<{ name: string; bpm: number; filename: string }> = [
  { name: "Take the Crown", bpm: 150, filename: "85a406ef_NeoCortext - Take the Crown.mp3" },
  { name: "The Signal Breaking Through", bpm: 136, filename: "e02f6ccf_NeoCortext - The Signal Breaking Through the Noise.mp3" },
  { name: "Before the Fade", bpm: 130, filename: "8baaf391_NeoCortext - Before the Fade.mp3" },
  { name: "Still I Rise", bpm: 130, filename: "54360357_NeoCortext - Still I Rise.mp3" },
  { name: "Learning How to Stay", bpm: 85, filename: "a19680f6_NeoCortext - Learning How to Stay.mp3" },
];

export function ThreeJSStudio() {
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
  // Selective bloom pipeline refs
  const bloomComposerRef = useRef<any>(null);
  const finalComposerRef = useRef<any>(null);
  const caPassRef = useRef<any>(null);
  const grainPassRef = useRef<any>(null);
  const vignettePassRef = useRef<any>(null);
  // Camera shake seed for beat punch
  const shakeRef = useRef(0);
  // Background image: a textured fullscreen plane behind the 3D scene.
  // Mesh + texture refs are kept in sync with the backgroundImageUrl state
  // so we don't reload the texture on every render.
  const bgImageRef = useRef<any>(null);
  const bgImageTextureRef = useRef<any>(null);

  // Web Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioFreqArrayRef = useRef<Uint8Array | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  // Bottom drawer replaces the previous left + right side panels. It opens
  // upward from the bottom of the canvas and hosts three tabs: Objects
  // (mesh list + add buttons), Inspector (per-object transforms + material),
  // and Scene (post FX + camera + particles). Default closed so the
  // canvas fills the viewport on small/vertical displays.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"objects" | "inspector" | "scene">("objects");
  const [sceneConfig, setSceneConfig] = useState<SceneConfig>(DEFAULT_SCENE);
  const [particleConfig, setParticleConfig] = useState<ParticleConfig>(DEFAULT_PARTICLES);
  const [objects, setObjects] = useState<AnimObject[]>(DEFAULT_OBJECTS);
  const [selectedObject, setSelectedObject] = useState<string | null>("crown-1");
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  // Which scene template is currently active. null = custom / unsaved.
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  // Optional background image URL — when set, the scene background is a
  // fullscreen textured plane behind the 3D content. Lets the user drop in
  // an album cover, an AI-generated image from ComfyUI, or any /output URL
  // and immediately get a custom music-video background. Empty string = use
  // the solid sceneConfig.backgroundColor.
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string>("");
  const [backgroundImageVisible, setBackgroundImageVisible] = useState(true);
  // Quick-pick thumbnails for the background image field. Pulled from
  // /api/outputs so users can click an album cover without typing paths.
  const [libraryImages, setLibraryImages] = useState<Array<{ url: string; label: string }>>([]);
  const [bpm, setBpm] = useState(150);
  const [beatSync, setBeatSync] = useState(false);
  const [fps, setFps] = useState(24);
  const [libraryTracks, setLibraryTracks] = useState<Array<{ filename: string; path: string }>>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  // Real beat-precise timeline from audio analysis (replaces sine-wave beatPhase)
  const { analysis: beatAnalysis, loading: beatLoading, error: beatError, getCurrentBeat } = useBeatTimeline(selectedTrack || null);
  const beatAnalysisRef = useRef(beatAnalysis);
  useEffect(() => { beatAnalysisRef.current = beatAnalysis; }, [beatAnalysis]);
  // Resolve the audioDriven mode ("bars" | "pillars" | undefined) for the
  // currently active template so the animation loop can modulate the
  // matching primitive every frame.
  const activeAudioDriven = SCENE_TEMPLATES.find((t) => t.id === activeTemplateId)?.audioDriven;
  const activeAudioDrivenRef = useRef(activeAudioDriven);
  useEffect(() => { activeAudioDrivenRef.current = activeAudioDriven; }, [activeAudioDriven]);

  // Store live state in refs so the animation loop always has current values
  const objectsRef = useRef(objects);
  const beatSyncRef = useRef(beatSync);
  const bpmRef = useRef(bpm);
  const cameraModeRef = useRef(cameraMode);
  const isPlayingRef = useRef(isPlaying);
  const particleConfigRef = useRef(particleConfig);
  const sceneConfigRef = useRef(sceneConfig);

  useEffect(() => { objectsRef.current = objects; }, [objects]);
  useEffect(() => { beatSyncRef.current = beatSync; }, [beatSync]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { particleConfigRef.current = particleConfig; }, [particleConfig]);

  // Background image — fetch the texture and assign it to the scene
  // background. scene.background can be a Color, a CubeTexture (skybox),
  // or a regular Texture. For an album-art-style background, a single
  // Texture works: the image is drawn filling the viewport behind the
  // 3D content. The selective bloom + post-FX chain still applies on top
  // so the image gets the same cinematic color treatment.
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!backgroundImageUrl) {
      // No image — restore the solid color background
      if (bgImageTextureRef.current) {
        bgImageTextureRef.current.dispose();
        bgImageTextureRef.current = null;
      }
      if (bgImageRef.current && sceneRef.current.children.includes(bgImageRef.current)) {
        sceneRef.current.remove(bgImageRef.current);
        bgImageRef.current = null;
      }
      return;
    }
    let cancelled = false;
    (async () => {
      const THREE = await import("three");
      if (cancelled) return;
      // Use a canvas image to CORS-safely load the image, then build a
      // THREE.Texture. This avoids the TextureLoader's stricter CORS path
      // and works for both same-origin and external URLs.
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
        sceneRef.current.background = tex;
        // Also drop any extra plane mesh we had hanging around
        if (bgImageRef.current && sceneRef.current.children.includes(bgImageRef.current)) {
          sceneRef.current.remove(bgImageRef.current);
          bgImageRef.current = null;
        }
      };
      img.onerror = (err) => {
        console.error("Background image failed to load:", backgroundImageUrl, err);
      };
      img.src = backgroundImageUrl;
    })();
    return () => { cancelled = true; };
  }, [backgroundImageUrl]);

  // Toggle the background image plane visibility without unloading the texture.
  // When the image is hidden, fall back to the solid scene color.
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!bgImageTextureRef.current) return;
    if (backgroundImageVisible) {
      sceneRef.current.background = bgImageTextureRef.current;
    } else {
      // Import three lazily to keep this in one effect
      import("three").then((THREE) => {
        if (sceneRef.current) sceneRef.current.background = new THREE.Color(sceneConfigRef.current.backgroundColor);
      });
    }
  }, [backgroundImageVisible, sceneConfig.backgroundColor]);
  useEffect(() => {
    sceneConfigRef.current = sceneConfig;
    if (sceneRef.current) {
      import("three").then((THREE) => {
        sceneRef.current.background = new THREE.Color(sceneConfig.backgroundColor);
        if (sceneRef.current.fog) {
          sceneRef.current.fog.color.set(sceneConfig.fogColor);
          sceneRef.current.fog.density = sceneConfig.fogDensity;
        }
      });
    }
    if (bloomPassRef.current) {
      bloomPassRef.current.strength = sceneConfig.bloomStrength;
    }
    if (caPassRef.current) {
      caPassRef.current.uniforms.amount.value = sceneConfig.chromaticAberration;
    }
    if (grainPassRef.current) {
      grainPassRef.current.uniforms.intensity.value = sceneConfig.filmGrain;
    }
    if (vignettePassRef.current) {
      vignettePassRef.current.uniforms.offset.value = sceneConfig.vignetteRadius;
      vignettePassRef.current.uniforms.darkness.value = sceneConfig.vignetteStrength;
    }
  }, [sceneConfig]);

  // Load available library tracks on mount
  useEffect(() => {
    listAudioFiles()
      .then((files) => {
        if (Array.isArray(files) && files.length > 0) {
          setLibraryTracks(files);
        }
      })
      .catch(() => {
        // Fallback to presets
      });
  }, []);

  // Load recent output images for the background-image quick-pick. We
  // pull audio + video outputs because each one has a `cover_image` (the
  // extracted album art / video thumbnail) which is the cleanest source
  // for a music-video background. Also pulls standalone image outputs
  // when they exist.
  useEffect(() => {
    let cancelled = false;
    const load = (fileType: string) =>
      fetch(`/api/outputs?file_type=${fileType}&limit=12`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    Promise.all([load("audio"), load("video"), load("image")]).then(([a, v, i]) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const imgs: Array<{ url: string; label: string }> = [];
      const collect = (data: any) => {
        if (!data?.outputs) return;
        for (const o of data.outputs) {
          const cover = o.cover_image ? `/output/${o.cover_image}` : null;
          if (cover && !seen.has(cover)) {
            seen.add(cover);
            imgs.push({ url: cover, label: `${o.filename} cover` });
          }
        }
      };
      collect(a);
      collect(v);
      collect(i);
      setLibraryImages(imgs.slice(0, 12));
    });
    return () => { cancelled = true; };
  }, []);

  // Helper to build a 3D mesh based on AnimObject
  const createMeshForObject = useCallback(async (obj: AnimObject, THREE: any) => {
    let meshGroup: any;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(obj.color),
      metalness: obj.metalness,
      roughness: obj.roughness,
      emissive: new THREE.Color(obj.emissive),
      emissiveIntensity: obj.emissiveIntensity,
    });

    if (obj.type === "crown") {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 16, 32), mat));
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 8), mat);
        spike.position.set(Math.cos(angle) * 0.85, 0.4, Math.sin(angle) * 0.85);
        group.add(spike);
      }
      const gemMat = new THREE.MeshStandardMaterial({
        color: 0x8b5cf6,
        metalness: 0.5,
        roughness: 0,
        emissive: 0x8b5cf6,
        emissiveIntensity: 0.8,
      });
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), gemMat);
      gem.position.y = 0.3;
      group.add(gem);
      meshGroup = group;
    } else if (obj.type === "sphere") {
      meshGroup = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), mat);
    } else if (obj.type === "box") {
      meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
    } else if (obj.type === "cylinder") {
      meshGroup = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32), mat);
    } else if (obj.type === "cone") {
      meshGroup = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 32), mat);
    } else if (obj.type === "torus") {
      meshGroup = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.25, 16, 32), mat);
    } else if ((obj.type as any) === "bars") {
      // Equalizer bar — thin tall box. The animation loop scales Y per frame
      // to drive the audio-reactive equalizer effect. Width 0.12 fits the
      // template's 0.18 bar spacing with a small visible gap between bars.
      meshGroup = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), mat);
    } else {
      meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    }

    meshGroup.position.set(...obj.position);
    meshGroup.rotation.set(...obj.rotation);
    meshGroup.scale.set(...obj.scale);
    meshGroup.visible = obj.visible;
    meshGroup.castShadow = true;
    meshGroup.receiveShadow = true;
    // Selective bloom: when obj.bloom is true, push the mesh onto BLOOM_LAYER
    // so bloomComposer renders it. Otherwise it stays on the default layer 0
    // and is excluded from the bloom pass.
    const targetLayer = obj.bloom ? BLOOM_LAYER : 0;
    meshGroup.traverse((child: any) => {
      if (child.isMesh) {
        child.layers.set(targetLayer);
      }
    });
    return meshGroup;
  }, []);

  // Re-sync objects into 3D scene when list changes
  useEffect(() => {
    if (!sceneRef.current) return;
    import("three").then((THREE) => {
      const scene = sceneRef.current;
      const currentIds = new Set(objects.map((o) => o.id));

      // Remove deleted meshes
      objectsMapRef.current.forEach((mesh, id) => {
        if (!currentIds.has(id)) {
          scene.remove(mesh);
          objectsMapRef.current.delete(id);
        }
      });

        // Add or update meshes
        objects.forEach(async (obj) => {
          let mesh = objectsMapRef.current.get(obj.id);
          if (!mesh) {
            mesh = await createMeshForObject(obj, THREE);
            scene.add(mesh);
            objectsMapRef.current.set(obj.id, mesh);
          } else {
            mesh.visible = obj.visible;
            // Update materials
            const updateMat = (m: any) => {
              if (m.material) {
                if (m.material.color) m.material.color.set(obj.color);
                if (m.material.emissive) m.material.emissive.set(obj.emissive);
                m.material.metalness = obj.metalness;
                m.material.roughness = obj.roughness;
                m.material.emissiveIntensity = obj.emissiveIntensity;
              }
            };
            if (mesh.isGroup) {
              mesh.traverse(updateMat);
            } else {
              updateMat(mesh);
            }
            // Re-apply bloom layer membership whenever the flag changes
            const targetLayer = obj.bloom ? BLOOM_LAYER : 0;
            mesh.traverse((child: any) => {
              if (child.isMesh) child.layers.set(targetLayer);
            });
          }
        });
    });
  }, [objects, createMeshForObject]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    const initScene = async () => {
      const THREE = await import("three");
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
      camera.position.set(0, 3, 8);
      camera.lookAt(0, 0.5, 0);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      rendererRef.current = renderer;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.minDistance = 2;
      controls.maxDistance = 20;

      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(container.clientWidth, container.clientHeight),
        sceneConfigRef.current.bloomStrength,
        0.4,
        0.85
      );
      composer.addPass(bloomPass);
      bloomPassRef.current = bloomPass;

      // Selective bloom pipeline: bloomComposer renders only the BLOOM_LAYER
      // (set via obj.bloom = true on each mesh) to an offscreen target. The
      // finalComposer then renders the full scene and blends the bloom buffer
      // additively. This makes hero objects glow while the rest of the scene
      // stays neutral — the standard "music video" look.
      const renderScene = new RenderPass(scene, camera);
      const bloomComposer = new EffectComposer(renderer);
      bloomComposer.renderToScreen = false;
      bloomComposer.addPass(renderScene);
      bloomComposer.addPass(bloomPass);

      const finalPass = new ShaderPass(
        new THREE.ShaderMaterial({
          uniforms: {
            baseTexture: { value: null },
            bloomTexture: { value: bloomComposer.renderTarget2.texture },
          },
          vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
          fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture,vUv) + vec4(1.0)*texture2D(bloomTexture,vUv); }`,
          defines: {},
        }),
        "baseTexture"
      );
      finalPass.needsSwap = true;

      const finalComposer = new EffectComposer(renderer);
      finalComposer.addPass(renderScene);
      finalComposer.addPass(finalPass);

      // Post-processing chain: chromatic aberration -> film grain -> vignette -> sRGB output
      const caPass = new ShaderPass(RGBShiftShader);
      caPass.uniforms.amount.value = sceneConfigRef.current.chromaticAberration;
      finalComposer.addPass(caPass);
      caPassRef.current = caPass;

      const grainPass = new ShaderPass(FilmShader);
      grainPass.uniforms.intensity.value = sceneConfigRef.current.filmGrain;
      grainPass.uniforms.grayscale.value = false;
      finalComposer.addPass(grainPass);
      grainPassRef.current = grainPass;

      const vignettePass = new ShaderPass(VignetteShader);
      vignettePass.uniforms.offset.value = sceneConfigRef.current.vignetteRadius;
      vignettePass.uniforms.darkness.value = sceneConfigRef.current.vignetteStrength;
      finalComposer.addPass(vignettePass);
      vignettePassRef.current = vignettePass;

      const outputPass = new OutputPass();
      finalComposer.addPass(outputPass);

      bloomComposerRef.current = bloomComposer;
      finalComposerRef.current = finalComposer;

      // Lights
      scene.add(new THREE.AmbientLight(0x404060, 0.6));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight.position.set(5, 8, 5);
      dirLight.castShadow = true;
      scene.add(dirLight);

      const spotLight = new THREE.SpotLight(0x8b5cf6, 35);
      spotLight.position.set(0, 10, 0);
      spotLight.angle = 0.45;
      spotLight.penumbra = 0.5;
      spotLight.castShadow = true;
      scene.add(spotLight);

      const pointLight1 = new THREE.PointLight(0xff6b9d, 15, 12);
      pointLight1.position.set(-4, 3, 3);
      scene.add(pointLight1);

      const pointLight2 = new THREE.PointLight(0x6b9dff, 15, 12);
      pointLight2.position.set(4, 2, -3);
      scene.add(pointLight2);

      // Reflective Floor
      const floorGeo = new THREE.PlaneGeometry(50, 50);
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0x080808,
        metalness: 0.9,
        roughness: 0.1,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.5;
      floor.receiveShadow = true;
      scene.add(floor);

      const grid = new THREE.GridHelper(20, 20, 0x333344, 0x181822);
      grid.position.y = -0.49;
      scene.add(grid);

      // Create Particle Field
      const particleGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(particleConfigRef.current.count * 3);
      for (let i = 0; i < particleConfigRef.current.count * 3; i += 3) {
        posArray[i] = (Math.random() - 0.5) * particleConfigRef.current.spread * 2;
        posArray[i + 1] = Math.random() * particleConfigRef.current.spread;
        posArray[i + 2] = (Math.random() - 0.5) * particleConfigRef.current.spread * 2;
      }
      particleGeo.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
      const particleMat = new THREE.PointsMaterial({
        color: particleConfigRef.current.color,
        size: particleConfigRef.current.size,
        transparent: true,
        opacity: particleConfigRef.current.opacity,
        blending: THREE.AdditiveBlending,
      });
      const particles = new THREE.Points(particleGeo, particleMat);
      scene.add(particles);
      particlesRef.current = particles;

      // Populate initial objects
      for (const obj of objectsRef.current) {
        const mesh = await createMeshForObject(obj, THREE);
        scene.add(mesh);
        objectsMapRef.current.set(obj.id, mesh);
      }

      clockRef.current = new THREE.Timer();

      // Main Render / Animation Loop
      const animate = () => {
        animationRef.current = requestAnimationFrame(animate);
        clockRef.current.update();
        const delta = clockRef.current.getDelta();
        const elapsed = clockRef.current.getElapsed();

        controls.update();

        // Audio Frequency Reactive Energy (if Web Audio is active)
        let audioBass = 0;
        let audioTreble = 0;
        if (analyserRef.current && isAudioPlaying) {
          if (!audioFreqArrayRef.current || audioFreqArrayRef.current.length !== analyserRef.current.frequencyBinCount) {
            audioFreqArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
          }
          analyserRef.current.getByteFrequencyData(audioFreqArrayRef.current as Uint8Array<ArrayBuffer>);
          const arr = audioFreqArrayRef.current;
          const bassBins = Math.floor(arr.length * 0.08);
          audioBass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
          const trebleBins = Math.floor(arr.length * 0.4);
          audioTreble = arr.slice(trebleBins).reduce((a, b) => a + b, 0) / ((arr.length - trebleBins) * 255 || 1);
        }

        // Real beat timeline: when the audio analysis is loaded, prefer the
        // discrete beat events over a continuous sine wave. isOnBeat is a
        // 100ms window after each onset; beatPunch is the configured spike
        // amplitude (0 = no spike).
        const beatState = getCurrentBeat(elapsed);
        const beatPunchAmp = sceneConfigRef.current.beatPunch;
        let beatSpike = 0;
        if (beatState.ready && beatState.isOnBeat) {
          // Linear decay inside the beat window so the spike is punchy, not flat
          beatSpike = beatPunchAmp * (1 - beatState.timeSinceLastBeat / beatState.beatWindowSec);
        }
        // Camera shake seed: only the first frame after a beat, decaying per frame
        if (beatState.ready && beatState.isOnBeat && beatState.timeSinceLastBeat < 0.016) {
          shakeRef.current = beatPunchAmp * 0.6;
        }
        shakeRef.current *= 0.85; // exponential decay

        // Animate objects
        const currentObjects = objectsRef.current;
        const isSync = beatSyncRef.current;
        const currentBpm = bpmRef.current;
        const useRealBeats = beatState.ready;

        currentObjects.forEach((obj) => {
          const mesh = objectsMapRef.current.get(obj.id);
          if (mesh && obj.visible) {
            const rotSpeed = obj.rotateSpeed + (audioTreble * 2.0);
            mesh.rotation.y += delta * rotSpeed;
            mesh.position.x = obj.position[0];
            mesh.position.z = obj.position[2];

            // Harmonic Bobbing
            const bob = Math.sin(elapsed * obj.bobSpeed) * obj.bobAmount;
            mesh.position.y = obj.position[1] + bob;

            // Pulse: prefer real-beat discrete spike; fall back to continuous
            // sine from BPM, then to live audio bass, then to rest.
            let pulse = 1;
            if (useRealBeats && beatSpike > 0) {
              pulse = 1 + beatSpike;
            } else if (isSync) {
              const beatInterval = 60 / currentBpm;
              const beatPhase = (elapsed % beatInterval) / beatInterval;
              const beatPulse = 1 + Math.sin(beatPhase * Math.PI * 2) * 0.08;
              const audioPulse = 1 + (audioBass * 0.35);
              pulse = beatPulse * audioPulse;
            } else if (audioBass > 0) {
              pulse = 1 + (audioBass * 0.3);
            }
            // Audio-driven templates override the pulse on Y scale for the
            // matching primitive. Each bar in an equalizer template scales
            // its Y axis to live bass; pillars scale uniformly to bass too.
            // This is the music-video "wall of light" effect.
            const audioMode = activeAudioDrivenRef.current;
            if (audioMode === "bars" && obj.type === ("bars" as any)) {
              // Per-bar Y scale: use the bar's index as a phase offset so the
              // wave "ripples" across the wall instead of all bars jumping
              // together.
              const barIdx = parseInt(obj.id.replace("bar-", ""), 10) || 0;
              const ripple = Math.sin(elapsed * 4 - barIdx * 0.35) * 0.3 + 0.7;
              const bass = audioBass > 0 ? audioBass : (useRealBeats ? beatState.smoothedEnergy : 0.3);
              const yScale = Math.max(0.15, ripple * (0.4 + bass * 1.6));
              mesh.scale.set(obj.scale[0] * pulse, obj.scale[1] * yScale, obj.scale[2] * pulse);
            } else if (audioMode === "pillars" && obj.type === "box") {
              const bass = audioBass > 0 ? audioBass : (useRealBeats ? beatState.smoothedEnergy : 0.3);
              const pillarPulse = 1 + bass * 0.6 + (beatSpike > 0 ? beatSpike * 0.5 : 0);
              mesh.scale.set(obj.scale[0] * pillarPulse, obj.scale[1] * (1 + bass * 0.25), obj.scale[2] * pillarPulse);
            } else {
              mesh.scale.set(obj.scale[0] * pulse, obj.scale[1] * pulse, obj.scale[2] * pulse);
            }
          }
        });

        // Particle dynamics
        if (particlesRef.current && particleConfigRef.current.enabled) {
          const positions = particlesRef.current.geometry.attributes.position.array;
          const speed = particleConfigRef.current.speed * (1 + audioBass * 2);
          for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] += delta * speed * 0.4;
            if (positions[i + 1] > particleConfigRef.current.spread) {
              positions[i + 1] = 0;
            }
          }
          particlesRef.current.geometry.attributes.position.needsUpdate = true;
          particlesRef.current.rotation.y += delta * 0.05;
        }

        // Camera dynamics + beat-triggered shake
        const activeCameraMode = cameraModeRef.current;
        const isRun = isPlayingRef.current;
        const shakeX = (Math.random() - 0.5) * shakeRef.current;
        const shakeY = (Math.random() - 0.5) * shakeRef.current;

        if (activeCameraMode === "orbit" && isRun) {
          const angle = elapsed * 0.25;
          camera.position.x = Math.sin(angle) * 8 + shakeX;
          camera.position.z = Math.cos(angle) * 8;
          camera.position.y = 3 + Math.sin(angle * 0.5) * 0.6 + shakeY;
          camera.lookAt(0, 0.5, 0);
        } else if (activeCameraMode === "dolly" && isRun) {
          const t = (elapsed % 8) / 8;
          camera.position.z = 10 - t * 6;
          camera.position.y = 3 - t * 0.8 + shakeY;
          camera.lookAt(0, 0.5, 0);
        } else if (activeCameraMode === "handheld" && isRun) {
          camera.position.x += (Math.random() - 0.5) * 0.02;
          camera.position.y += (Math.random() - 0.5) * 0.02;
          camera.lookAt(0, 0.5, 0);
        }
        // Apply shake to static mode too (the user is just observing)
        if (!isRun) {
          camera.position.x += shakeX;
          camera.position.y += shakeY;
        }

        // Selective bloom: bloomComposer renders only BLOOM_LAYER objects.
        // The darkening pass hides everything on layer 0, leaving just the
        // bright objects' glow. finalComposer then renders the full scene
        // with the bloom buffer additively blended on top.
        if (sceneConfigRef.current.selectiveBloom && bloomComposerRef.current && finalComposerRef.current) {
          // Standard selective-bloom trick: hide all non-bloom objects, render
          // bloom-only pass, then restore visibility. Layers-based culling is
          // not enough because RenderPass renders the whole scene; we use
          // a per-object visibility mask instead.
          const prevVisibility: boolean[] = [];
          sceneRef.current.traverse((child: any) => {
            if (child.isMesh) {
              prevVisibility.push(child.visible);
              const onBloom = (child.layers.mask & (1 << BLOOM_LAYER)) !== 0;
              child.visible = prevVisibility[prevVisibility.length - 1] && onBloom;
            }
          });
          bloomComposerRef.current.render();
          // Restore visibility for the final pass
          let i = 0;
          sceneRef.current.traverse((child: any) => {
            if (child.isMesh) {
              child.visible = prevVisibility[i++];
            }
          });
          finalComposerRef.current.render();
        } else {
          // Fallback: no selective bloom, single composer for the whole frame
          composer.render();
        }
      };
      animate();

      const handleResize = () => {
        if (!containerRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setSize(w, h);
        if (bloomComposerRef.current) bloomComposerRef.current.setSize(w, h);
        if (finalComposerRef.current) finalComposerRef.current.setSize(w, h);
      };
      window.addEventListener("resize", handleResize);
    };

    initScene();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", () => {});
      rendererRef.current?.dispose();
    };
  }, [createMeshForObject, isAudioPlaying]);

  // Audio setup for media library track playback & Web Audio analyser
  const handleSelectTrack = (filename: string) => {
    setSelectedTrack(filename);
    const preset = TRACK_PRESETS.find((p) => p.filename === filename || p.name.toLowerCase().includes(filename.toLowerCase()));
    if (preset) {
      setBpm(preset.bpm);
      setBeatSync(true);
    }
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
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      if (isAudioPlaying) {
        audioElementRef.current.pause();
        setIsAudioPlaying(false);
      } else {
        await audioElementRef.current.play();
        setIsAudioPlaying(true);
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  };

  // Add object
  const addObject = (type: AnimObject["type"]) => {
    const id = `${type}-${Date.now()}`;
    const offset = (objects.length % 5) * 1.5 - 3;
    const newObj: AnimObject = {
      id,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${objects.length + 1}`,
      type,
      position: [offset, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: type === "sphere" ? "#60a5fa" : type === "box" ? "#a855f7" : type === "torus" ? "#f43f5e" : "#e2e8f0",
      metalness: 0.6,
      roughness: 0.3,
      emissive: "#000000",
      emissiveIntensity: 0.1,
      visible: true,
      bobSpeed: 1.5,
      bobAmount: 0.15,
      rotateSpeed: 0.4,
      bloom: type === "crown",
    };
    setObjects((prev) => [...prev, newObj]);
    setSelectedObject(id);
  };

  // Remove object
  const removeObject = (id: string) => {
    setObjects((prev) => prev.filter((obj) => obj.id !== id));
    if (selectedObject === id) {
      const remaining = objects.filter((obj) => obj.id !== id);
      setSelectedObject(remaining[0]?.id || null);
    }
  };

  const updateObject = (id: string, updates: Partial<AnimObject>) => {
    setObjects((prev) => prev.map((obj) => (obj.id === id ? { ...obj, ...updates } : obj)));
  };

  // Load a pre-built scene template. Replaces the current object list,
  // particle config, and camera mode, and applies the template's tuned
  // scene config. The user can still tweak any of these afterwards —
  // the template is just a starting point, not a lock-in.
  const loadTemplate = (template: SceneTemplate) => {
    setObjects(template.objects.map((o) => ({ ...o }))); // shallow clone so we don't share refs
    setParticleConfig({ ...template.particleConfig });
    setCameraMode(template.cameraMode);
    setSceneConfig((prev) => ({ ...prev, ...template.sceneConfig }));
    setSelectedObject(template.objects[0]?.id ?? null);
    setActiveTemplateId(template.id);
  };

  // Export frame
  const exportFrame = useCallback(() => {
    if (!rendererRef.current) return;
    const link = document.createElement("a");
    link.download = `threejs_frame_${Date.now()}.png`;
    link.href = rendererRef.current.domElement.toDataURL("image/png");
    link.click();
  }, []);

  const selectedObj = objects.find((o) => o.id === selectedObject);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden">
      {/* ============================================================
          ROW 1: Compact header bar
          Logo + Play + Add (icon buttons) + Track selector (flex-1)
          + Export + Drawer toggle. On small windows the track selector
          shrinks via min-w-0; the icon buttons stay full size.
         ============================================================ */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 bg-[#12121a] border-b border-gray-800 shrink-0 min-w-0">
        <Sparkles size={16} className="text-purple-400 shrink-0" />
        <span className="font-semibold text-sm shrink-0 hidden sm:inline">Three.js Studio</span>
        <div className="w-px h-5 bg-gray-700 mx-1 shrink-0 hidden sm:block" />

        {/* Play/Pause */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`p-1.5 rounded transition-colors shrink-0 ${
            isPlaying ? "bg-purple-600 hover:bg-purple-700" : "bg-gray-700 hover:bg-gray-600"
          }`}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        {/* Add object — icon-only on small screens, with text on sm+ */}
        <button onClick={() => addObject("crown")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs shrink-0" title="Add Crown">👑</button>
        <button onClick={() => addObject("sphere")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0 hidden xs:block" title="Add Sphere"><Circle size={13} /></button>
        <button onClick={() => addObject("box")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0 hidden sm:block" title="Add Box"><Box size={13} /></button>

        {/* Track selector — flex-1 + min-w-0 so it can shrink */}
        <div className="flex items-center gap-1.5 sm:gap-2 ml-1 sm:ml-2 bg-gray-800/80 px-2 py-1 rounded-lg border border-gray-700 flex-1 min-w-0">
          <Music size={13} className="text-purple-400 shrink-0" />
          <select
            value={selectedTrack}
            onChange={(e) => handleSelectTrack(e.target.value)}
            className="bg-transparent text-xs text-gray-200 outline-none flex-1 min-w-0 truncate"
          >
            <option value="" className="bg-gray-800">Select track…</option>
            {TRACK_PRESETS.map((t) => (
              <option key={t.filename} value={t.filename} className="bg-gray-800">
                {t.name} ({t.bpm} BPM)
              </option>
            ))}
            {libraryTracks.map((t) => (
              <option key={t.filename} value={t.filename} className="bg-gray-800">
                {t.filename}
              </option>
            ))}
          </select>

          {selectedTrack && (
            <button
              onClick={toggleAudio}
              className={`p-1 rounded text-xs flex items-center gap-1 shrink-0 ${
                isAudioPlaying ? "bg-purple-600 text-white" : "bg-gray-700 hover:bg-gray-600"
              }`}
              title={isAudioPlaying ? "Mute audio" : "Play audio"}
            >
              {isAudioPlaying ? <Volume2 size={12} /> : <VolumeX size={12} />}
            </button>
          )}
        </div>

        {selectedTrack && (
          <audio
            ref={audioElementRef}
            src={`/api/audio/file/${selectedTrack}`}
            crossOrigin="anonymous"
            onEnded={() => setIsAudioPlaying(false)}
            className="hidden"
          />
        )}

        {/* Export */}
        <button onClick={exportFrame} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded shrink-0" title="Export frame as PNG">
          <Download size={13} />
        </button>

        {/* Drawer toggle (replaces Settings toggle) */}
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className={`p-1.5 rounded transition-colors shrink-0 ${
            drawerOpen ? "bg-purple-600" : "bg-gray-700 hover:bg-gray-600"
          }`}
          title="Toggle controls panel"
        >
          {drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* ============================================================
          ROW 2: Contextual track info bar — only when a track is selected
          BPM input + Sync + Beat count + Beat Punch slider.
          This is the only place BPM lives; the drawer doesn't need it.
         ============================================================ */}
      {selectedTrack && (
        <div className="flex items-center gap-1.5 sm:gap-3 px-2 sm:px-4 py-1.5 bg-[#0e0e16] border-b border-gray-800 shrink-0 text-xs overflow-x-auto">
          <div className="flex items-center gap-1.5 shrink-0">
            <Zap size={12} className={beatSync ? "text-amber-400" : "text-gray-500"} />
            <input
              type="number"
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              className="w-12 bg-gray-800 text-white rounded px-1.5 py-0.5 text-center font-mono border border-gray-700"
              min={60}
              max={220}
            />
            <span className="text-gray-400">BPM</span>
          </div>

          <button
            onClick={() => setBeatSync(!beatSync)}
            className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
              beatSync ? "bg-purple-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-300"
            }`}
          >
            {beatSync ? "Sync ON" : "Sync OFF"}
          </button>

          <div className="text-gray-400 shrink-0">
            Beats: <span className={beatAnalysis ? "text-amber-300 font-mono" : "text-gray-500 font-mono"}>
              {beatLoading ? "loading…" : beatAnalysis ? beatAnalysis.beat_count : beatError ? "0" : "—"}
            </span>
          </div>

          {beatAnalysis && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-gray-400">Punch</span>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={sceneConfig.beatPunch}
                onChange={(e) => setSceneConfig({ ...sceneConfig, beatPunch: Number(e.target.value) })}
                className="w-20 accent-amber-400"
                title={`Beat punch amplitude (${sceneConfig.beatPunch.toFixed(2)})`}
              />
              <span className="text-amber-300 font-mono w-6 text-right">{sceneConfig.beatPunch.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          ROW 3: Canvas — fills all remaining space
         ============================================================ */}
      <div ref={containerRef} className="flex-1 relative bg-[#0a0a0f] overflow-hidden min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Bottom-left compact HUD — now a single row, smaller */}
        <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur px-2.5 py-1 rounded text-gray-400 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5 pointer-events-none border border-white/5 max-w-[calc(100%-1rem)]">
          <span>Objs <span className="text-white font-mono">{objects.length}</span></span>
          <span>Cam <span className="text-purple-400 font-mono">{cameraMode}</span></span>
          <span>BPM <span className={beatSync ? "text-green-400 font-mono" : "text-gray-500 font-mono"}>{beatSync ? bpm : "—"}</span></span>
          {sceneConfig.selectiveBloom && (
            <span>Bloom <span className="text-amber-300 font-mono">{objects.filter((o) => o.bloom).length}/{objects.length}</span></span>
          )}
        </div>

        {beatError && selectedTrack && (
          <a
            href="/audio-analysis"
            target="_blank"
            rel="noreferrer"
            className="absolute bottom-2 right-2 bg-amber-900/70 hover:bg-amber-800/80 backdrop-blur px-2.5 py-1 rounded text-amber-100 text-[11px] border border-amber-700/50 pointer-events-auto transition-colors"
            title="Open Audio Analysis in a new tab to populate the cache"
          >
            Open Audio Analysis →
          </a>
        )}
      </div>

      {/* ============================================================
          BOTTOM DRAWER: tabbed controls (Objects / Inspector / Scene)
          Default closed, opens upward from the bottom of the canvas.
          height: 60vh on mobile, 45vh on desktop — never fills the screen.
         ============================================================ */}
      {drawerOpen && (
        <div className="bg-[#0e0e16] border-t border-gray-800 shrink-0 flex flex-col h-[55vh] sm:h-[45vh] min-h-[280px] max-h-[600px]">
          {/* Tab bar — single-line with compact labels so it fits on narrow
              viewports. Icon-first, label only on sm+. Active tab has the
              purple highlight from the rest of the UI. */}
          <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1.5 border-b border-gray-800 bg-[#12121a] shrink-0">
            <button
              onClick={() => setDrawerTab("objects")}
              className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${
                drawerTab === "objects" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <Box size={12} /> <span className="hidden sm:inline">Objects</span><span className="opacity-60 hidden sm:inline">({objects.length})</span>
            </button>
            <button
              onClick={() => setDrawerTab("inspector")}
              className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${
                drawerTab === "inspector" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <Zap size={12} /> <span className="hidden sm:inline">Inspector</span>
              {selectedObj && <span className="hidden md:inline opacity-60">({selectedObj.name})</span>}
            </button>
            <button
              onClick={() => setDrawerTab("scene")}
              className={`px-2 sm:px-3 py-1 rounded text-xs flex items-center gap-1 sm:gap-1.5 shrink-0 ${
                drawerTab === "scene" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <Settings size={12} /> <span className="hidden sm:inline">Scene</span>
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 shrink-0"
              title="Close panel"
            >
              <ChevronDown size={14} />
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {drawerTab === "objects" && (
              <div className="space-y-2">
                {/* Scene Templates — pre-built music-video scenes. One click
                    loads a complete production-ready layout: meshes, particles,
                    camera, and tuned post-FX. Replaces the current scene. */}
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5 flex items-center gap-1.5">
                    <Sparkles size={10} /> Scene Templates
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {SCENE_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => loadTemplate(tpl)}
                        title={tpl.description}
                        className={`px-2 py-2 rounded text-xs flex flex-col items-center gap-0.5 transition-colors min-w-0 ${
                          activeTemplateId === tpl.id
                            ? "bg-purple-600/30 border border-purple-500/50 text-white"
                            : "bg-gray-800 hover:bg-gray-700 border border-transparent text-gray-200"
                        }`}
                      >
                        <span className="text-base leading-none">{tpl.emoji}</span>
                        <span className="truncate w-full text-center">{tpl.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick add row — 4 cols on mobile (fits 6 chars), 6 on wider.
                    Each button truncates so even narrow viewports show all 6. */}
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Add Shape</div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                    <button onClick={() => addObject("crown")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center gap-1 min-w-0 truncate">👑 <span className="hidden sm:inline">Crown</span></button>
                    <button onClick={() => addObject("sphere")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center gap-1 min-w-0 truncate"><Circle size={11} /> <span className="hidden sm:inline">Sphere</span></button>
                    <button onClick={() => addObject("box")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center gap-1 min-w-0 truncate"><Box size={11} /> <span className="hidden sm:inline">Box</span></button>
                    <button onClick={() => addObject("cylinder")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center min-w-0 truncate">Cyl</button>
                    <button onClick={() => addObject("cone")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center min-w-0 truncate">Cone</button>
                    <button onClick={() => addObject("torus")} className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs flex items-center justify-center min-w-0 truncate">Torus</button>
                  </div>
                </div>

                {/* Object list */}
                <div className="space-y-1">
                  {objects.map((obj) => (
                    <div
                      key={obj.id}
                      onClick={() => setSelectedObject(obj.id)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                        selectedObject === obj.id
                          ? "bg-purple-600/30 border border-purple-500/50 text-white font-medium"
                          : "hover:bg-gray-800 text-gray-300 border border-transparent"
                      }`}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); updateObject(obj.id, { visible: !obj.visible }); }}
                        className="text-gray-400 hover:text-white shrink-0"
                        title={obj.visible ? "Hide" : "Show"}
                      >
                        {obj.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateObject(obj.id, { bloom: !obj.bloom }); }}
                        className={obj.bloom ? "text-amber-300 shrink-0" : "text-gray-600 hover:text-amber-300 shrink-0"}
                        title={obj.bloom ? "Hero glow ON" : "Hero glow OFF"}
                      >
                        <Layers size={12} />
                      </button>
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: obj.color }} />
                      <span className="flex-1 truncate min-w-0">{obj.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeObject(obj.id); }}
                        className="text-gray-500 hover:text-red-400 shrink-0"
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {objects.length === 0 && (
                    <div className="text-gray-500 text-xs py-4 text-center">No objects. Click a button above to add one.</div>
                  )}
                </div>
              </div>
            )}

            {drawerTab === "inspector" && selectedObj && (
              <div className="space-y-3 text-xs max-w-2xl">
                {/* Position */}
                <div>
                  <label className="text-gray-400 block mb-1">Position (X, Y, Z)</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {["X", "Y", "Z"].map((axis, i) => (
                      <input
                        key={axis}
                        type="number"
                        step="0.2"
                        value={selectedObj.position[i]}
                        onChange={(e) => {
                          const pos = [...selectedObj.position] as [number, number, number];
                          pos[i] = Number(e.target.value);
                          updateObject(selectedObj.id, { position: pos });
                        }}
                        className="bg-gray-800 rounded px-1.5 py-1 text-center font-mono border border-gray-700 w-full"
                      />
                    ))}
                  </div>
                </div>

                <SliderRow
                  label="Rotation Speed"
                  min={0} max={3} step={0.1} value={selectedObj.rotateSpeed}
                  onChange={(v) => updateObject(selectedObj.id, { rotateSpeed: v })}
                />
                <SliderRow
                  label="Bob Speed"
                  min={0} max={5} step={0.1} value={selectedObj.bobSpeed}
                  onChange={(v) => updateObject(selectedObj.id, { bobSpeed: v })}
                />
                <SliderRow
                  label="Bob Amount"
                  min={0} max={0.5} step={0.02} value={selectedObj.bobAmount}
                  onChange={(v) => updateObject(selectedObj.id, { bobAmount: v })}
                />

                <div className="border-t border-gray-800 pt-2 space-y-2">
                  <div className="text-gray-400 font-medium">Material & Shading</div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Diffuse Color</span>
                    <input
                      type="color"
                      value={selectedObj.color}
                      onChange={(e) => updateObject(selectedObj.id, { color: e.target.value })}
                      className="w-9 h-7 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <SliderRow label="Metalness" min={0} max={1} step={0.05} value={selectedObj.metalness} onChange={(v) => updateObject(selectedObj.id, { metalness: v })} />
                  <SliderRow label="Roughness" min={0} max={1} step={0.05} value={selectedObj.roughness} onChange={(v) => updateObject(selectedObj.id, { roughness: v })} />
                  <SliderRow label="Glow / Emissive" min={0} max={2} step={0.1} value={selectedObj.emissiveIntensity} onChange={(v) => updateObject(selectedObj.id, { emissiveIntensity: v })} />
                </div>
              </div>
            )}

            {drawerTab === "inspector" && !selectedObj && (
              <div className="text-gray-500 text-xs py-8 text-center">Select an object in the Objects tab to inspect its properties.</div>
            )}

            {drawerTab === "scene" && (
              <div className="space-y-3 text-xs max-w-2xl">
                <h3 className="text-sm font-semibold flex items-center gap-2 text-white"><Settings size={14} /> Scene Configuration</h3>

                <div>
                  <label className="text-gray-400 block mb-1">Background Color</label>
                  <input
                    type="color"
                    value={sceneConfig.backgroundColor}
                    onChange={(e) => setSceneConfig({ ...sceneConfig, backgroundColor: e.target.value })}
                    className="w-12 h-7 rounded cursor-pointer bg-transparent"
                  />
                </div>

                {/* Background image — paste any URL or use the Media Library.
                    Most common use case: a ComfyUI-generated image or album art
                    from the library. When set, it fills the screen behind the
                    3D objects. Toggle the visibility checkbox to A/B compare
                    without reloading. */}
                <div className="border border-gray-700 rounded p-2 bg-gray-900/50">
                  <div className="text-gray-300 font-medium mb-1.5">Background Image</div>
                  <input
                    type="text"
                    placeholder="/output/image/foo.png or https://..."
                    value={backgroundImageUrl}
                    onChange={(e) => setBackgroundImageUrl(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white placeholder-gray-500"
                  />

                  {/* Quick-pick recent images from the outputs library. Avoids
                      users having to type/copy paths manually. We fetch the
                      same list the media library shows (audio covers, image
                      outputs, video covers) and render small thumbnails. */}
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                      Recent from library
                    </div>
                    <div className="grid grid-cols-6 gap-1 max-h-24 overflow-y-auto">
                      {libraryImages.map((img) => (
                        <button
                          key={img.url}
                          onClick={() => setBackgroundImageUrl(img.url)}
                          title={img.label}
                          className="aspect-square bg-gray-800 rounded overflow-hidden border border-gray-700 hover:border-purple-500 transition-colors p-0"
                        >
                          <img
                            src={img.url}
                            alt={img.label}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-400">
                      <input
                        type="checkbox"
                        checked={backgroundImageVisible}
                        onChange={(e) => setBackgroundImageVisible(e.target.checked)}
                        className="accent-purple-500"
                      />
                      <span>Show background image</span>
                    </label>
                    {backgroundImageUrl && (
                      <button
                        onClick={() => setBackgroundImageUrl("")}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Generate album art in <a href="/image-generation" target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">Image Gen</a>, then paste the <code className="text-violet-300">/output/image/...</code> URL here.
                  </p>
                </div>

                <SliderRow
                  label="Bloom Strength"
                  min={0} max={1.5} step={0.05}
                  value={sceneConfig.bloomStrength}
                  onChange={(v) => setSceneConfig({ ...sceneConfig, bloomStrength: v })}
                />

                <label className="flex items-center gap-2 cursor-pointer text-gray-400">
                  <input
                    type="checkbox"
                    checked={sceneConfig.selectiveBloom}
                    onChange={(e) => setSceneConfig({ ...sceneConfig, selectiveBloom: e.target.checked })}
                    className="accent-purple-500"
                  />
                  <Layers size={13} className="text-amber-300" />
                  <span>Selective Bloom (hero glow only)</span>
                </label>

                <div className="border-t border-gray-800 pt-2">
                  <h4 className="text-xs font-semibold text-gray-300 mb-2">Post FX Chain</h4>
                  <SliderRow label="Chromatic Aberration" min={0} max={0.01} step={0.0005} value={sceneConfig.chromaticAberration} onChange={(v) => setSceneConfig({ ...sceneConfig, chromaticAberration: v })} displayDecimals={4} />
                  <SliderRow label="Film Grain" min={0} max={0.5} step={0.01} value={sceneConfig.filmGrain} onChange={(v) => setSceneConfig({ ...sceneConfig, filmGrain: v })} />
                  <SliderRow label="Vignette Darkness" min={0} max={1} step={0.05} value={sceneConfig.vignetteStrength} onChange={(v) => setSceneConfig({ ...sceneConfig, vignetteStrength: v })} />
                  <SliderRow label="Vignette Radius" min={0} max={1} step={0.05} value={sceneConfig.vignetteRadius} onChange={(v) => setSceneConfig({ ...sceneConfig, vignetteRadius: v })} />
                </div>

                <div className="border-t border-gray-800 pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Particle Cloud</span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={particleConfig.enabled}
                        onChange={(e) => setParticleConfig({ ...particleConfig, enabled: e.target.checked })}
                        className="accent-purple-500"
                      />
                      <span>Active</span>
                    </label>
                  </div>
                  {particleConfig.enabled && (
                    <SliderRow
                      label={`Count: ${particleConfig.count}`}
                      min={50} max={1000} step={50}
                      value={particleConfig.count}
                      onChange={(v) => setParticleConfig({ ...particleConfig, count: v })}
                    />
                  )}
                  {particleConfig.enabled && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Color</span>
                      <input
                        type="color"
                        value={particleConfig.color}
                        onChange={(e) => setParticleConfig({ ...particleConfig, color: e.target.value })}
                        className="w-9 h-6 rounded cursor-pointer bg-transparent"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-400 block mb-1">Camera Trajectory</label>
                    <select
                      value={cameraMode}
                      onChange={(e) => setCameraMode(e.target.value as any)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                    >
                      <option value="orbit">Orbit 360°</option>
                      <option value="dolly">Dolly Zoom</option>
                      <option value="handheld">Handheld</option>
                      <option value="static">Static</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-gray-400 block mb-1">Target FPS</label>
                    <select
                      value={fps}
                      onChange={(e) => setFps(Number(e.target.value))}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                    >
                      <option value={24}>24 (Cinematic)</option>
                      <option value={30}>30 (Standard)</option>
                      <option value={60}>60 (Smooth)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * SliderRow — compact slider with label, value, and range input.
 * Used in the Inspector and Scene tabs of the bottom drawer to keep the
 * markup uniform and easy to scan instead of duplicating the same 8-line
 * <div> wrapper for every slider.
 */
function SliderRow({
  label, min, max, step, value, onChange, displayDecimals = 2,
}: {
  label: string;
  min: number; max: number; step: number;
  value: number;
  onChange: (v: number) => void;
  displayDecimals?: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-gray-400 mb-1">
        <span>{label}</span>
        <span className="font-mono text-purple-400">{value.toFixed(displayDecimals)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-500"
      />
    </div>
  );
}
