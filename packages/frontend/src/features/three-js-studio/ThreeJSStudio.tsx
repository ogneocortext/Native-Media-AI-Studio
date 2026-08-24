import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box,
  Play,
  Pause,
  Camera,
  Sparkles,
  Sun,
  Download,
  Settings,
  Circle,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Music,
  Zap,
  Volume2,
  VolumeX,
} from "lucide-react";
import { listAudioFiles } from "../../services/api";

interface AnimObject {
  id: string;
  name: string;
  type: "crown" | "box" | "sphere" | "cylinder" | "cone" | "torus";
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  visible: boolean;
  bobSpeed: number;
  bobAmount: number;
  rotateSpeed: number;
}

interface ParticleConfig {
  enabled: boolean;
  count: number;
  size: number;
  color: string;
  speed: number;
  spread: number;
  opacity: number;
}

interface SceneConfig {
  backgroundColor: string;
  fogEnabled: boolean;
  fogColor: string;
  fogDensity: number;
  bloomStrength: number;
}

const DEFAULT_SCENE: SceneConfig = {
  backgroundColor: "#0a0a0f",
  fogEnabled: true,
  fogColor: "#0a0a0f",
  fogDensity: 0.015,
  bloomStrength: 0.4,
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
  },
];

const TRACK_PRESETS: Array<{ name: string; bpm: number; filename: string }> = [
  { name: "Take the Crown", bpm: 150, filename: "85a406ef_Nathaniel Smalley - Take the Crown.mp3" },
  { name: "The Signal Breaking Through", bpm: 136, filename: "e02f6ccf_Nathaniel Smalley - The Signal Breaking Through the Noise.mp3" },
  { name: "Before the Fade", bpm: 130, filename: "8baaf391_Nathaniel Smalley - Before the Fade.mp3" },
  { name: "Still I Rise", bpm: 130, filename: "54360357_Nathaniel Smalley - Still I Rise.mp3" },
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

  // Web Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioFreqArrayRef = useRef<Uint8Array | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showObjects, setShowObjects] = useState(true);
  const [showAnimation, setShowAnimation] = useState(true);
  const [sceneConfig, setSceneConfig] = useState<SceneConfig>(DEFAULT_SCENE);
  const [particleConfig, setParticleConfig] = useState<ParticleConfig>(DEFAULT_PARTICLES);
  const [objects, setObjects] = useState<AnimObject[]>(DEFAULT_OBJECTS);
  const [selectedObject, setSelectedObject] = useState<string | null>("crown-1");
  const [cameraMode, setCameraMode] = useState<"static" | "orbit" | "dolly" | "handheld">("orbit");
  const [bpm, setBpm] = useState(150);
  const [beatSync, setBeatSync] = useState(false);
  const [fps, setFps] = useState(24);
  const [libraryTracks, setLibraryTracks] = useState<Array<{ filename: string; stored_path: string }>>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

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
    } else {
      meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    }

    meshGroup.position.set(...obj.position);
    meshGroup.rotation.set(...obj.rotation);
    meshGroup.scale.set(...obj.scale);
    meshGroup.visible = obj.visible;
    meshGroup.castShadow = true;
    meshGroup.receiveShadow = true;
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

      clockRef.current = new THREE.Clock();

      // Main Render / Animation Loop
      const animate = () => {
        animationRef.current = requestAnimationFrame(animate);
        const delta = clockRef.current.getDelta();
        const elapsed = clockRef.current.getElapsedTime();

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

        // Animate objects
        const currentObjects = objectsRef.current;
        const isSync = beatSyncRef.current;
        const currentBpm = bpmRef.current;

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

            if (isSync) {
              const beatInterval = 60 / currentBpm;
              const beatPhase = (elapsed % beatInterval) / beatInterval;
              const beatPulse = 1 + Math.sin(beatPhase * Math.PI * 2) * 0.08;
              const audioPulse = 1 + (audioBass * 0.35);
              const totalPulse = beatPulse * audioPulse;
              mesh.scale.set(obj.scale[0] * totalPulse, obj.scale[1] * totalPulse, obj.scale[2] * totalPulse);
            } else if (audioBass > 0) {
              const audioPulse = 1 + (audioBass * 0.3);
              mesh.scale.set(obj.scale[0] * audioPulse, obj.scale[1] * audioPulse, obj.scale[2] * audioPulse);
            } else {
              mesh.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
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

        // Camera dynamics
        const activeCameraMode = cameraModeRef.current;
        const isRun = isPlayingRef.current;

        if (activeCameraMode === "orbit" && isRun) {
          const angle = elapsed * 0.25;
          camera.position.x = Math.sin(angle) * 8;
          camera.position.z = Math.cos(angle) * 8;
          camera.position.y = 3 + Math.sin(angle * 0.5) * 0.6;
          camera.lookAt(0, 0.5, 0);
        } else if (activeCameraMode === "dolly" && isRun) {
          const t = (elapsed % 8) / 8;
          camera.position.z = 10 - t * 6;
          camera.position.y = 3 - t * 0.8;
          camera.lookAt(0, 0.5, 0);
        } else if (activeCameraMode === "handheld" && isRun) {
          camera.position.x += (Math.random() - 0.5) * 0.02;
          camera.position.y += (Math.random() - 0.5) * 0.02;
          camera.lookAt(0, 0.5, 0);
        }

        composer.render();
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
    <div className="fixed inset-0 flex flex-col bg-[#0a0a0f] text-white">
      {/* Header Bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#12121a] border-b border-gray-800 shrink-0">
        <Sparkles size={18} className="text-purple-400" />
        <span className="font-semibold text-sm">Three.js Studio</span>
        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* Play/Pause Animation */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`p-1.5 rounded transition-colors ${
            isPlaying ? "bg-purple-600 hover:bg-purple-700" : "bg-gray-700 hover:bg-gray-600"
          }`}
          title={isPlaying ? "Pause Scene Animation" : "Play Scene Animation"}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        {/* Add Quick Objects */}
        <button onClick={() => addObject("crown")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs flex items-center gap-1">
          👑 +Crown
        </button>
        <button onClick={() => addObject("sphere")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs flex items-center gap-1">
          <Circle size={13} /> +Sphere
        </button>
        <button onClick={() => addObject("box")} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs flex items-center gap-1">
          <Box size={13} /> +Box
        </button>

        {/* Media Library Track Selector */}
        <div className="flex items-center gap-2 ml-2 bg-gray-800/80 px-2 py-1 rounded-lg border border-gray-700">
          <Music size={13} className="text-purple-400" />
          <select
            value={selectedTrack}
            onChange={(e) => handleSelectTrack(e.target.value)}
            className="bg-transparent text-xs text-gray-200 outline-none max-w-[200px] truncate"
          >
            <option value="" className="bg-gray-800">Select Library Track...</option>
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
              className={`p-1 rounded text-xs flex items-center gap-1 ${
                isAudioPlaying ? "bg-purple-600 text-white" : "bg-gray-700 hover:bg-gray-600"
              }`}
              title="Play Track Audio"
            >
              {isAudioPlaying ? <Volume2 size={12} /> : <VolumeX size={12} />}
              {isAudioPlaying ? "Audio ON" : "Audio OFF"}
            </button>
          )}

          {selectedTrack && (
            <audio
              ref={audioElementRef}
              src={`/api/audio/file/${selectedTrack}`}
              crossOrigin="anonymous"
              onEnded={() => setIsAudioPlaying(false)}
              className="hidden"
            />
          )}
        </div>

        <div className="flex-1" />

        {/* BPM & Beat Sync */}
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-800/60 px-2 py-1 rounded border border-gray-700">
          <Zap size={13} className={beatSync ? "text-amber-400" : "text-gray-500"} />
          <input
            type="number"
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-12 bg-gray-700 text-white rounded px-1 py-0.5 text-center font-mono"
            min={60}
            max={220}
          />
          <span>BPM</span>
          <button
            onClick={() => setBeatSync(!beatSync)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              beatSync ? "bg-purple-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-300"
            }`}
          >
            {beatSync ? "Sync ON" : "Sync OFF"}
          </button>
        </div>

        {/* Export Frame */}
        <button onClick={exportFrame} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded flex items-center gap-1 text-xs" title="Export Frame">
          <Download size={13} /> Export
        </button>

        {/* Settings Toggle */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-1.5 rounded transition-colors ${
            showSettings ? "bg-purple-600" : "bg-gray-700 hover:bg-gray-600"
          }`}
          title="Scene Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left Panel: Objects & Animation Inspector */}
        <div className="w-72 bg-[#0e0e16] border-r border-gray-800 flex flex-col shrink-0 overflow-hidden">
          {/* Objects Section */}
          <div className="border-b border-gray-800 shrink-0">
            <button
              onClick={() => setShowObjects(!showObjects)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-gray-800/50"
            >
              <div className="flex items-center gap-2">
                {showObjects ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Box size={14} className="text-purple-400" />
                <span>3D Meshes ({objects.length})</span>
              </div>
            </button>
            {showObjects && (
              <div className="px-2 pb-2 space-y-1 max-h-48 overflow-y-auto">
                {objects.map((obj) => (
                  <div
                    key={obj.id}
                    onClick={() => setSelectedObject(obj.id)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                      selectedObject === obj.id
                        ? "bg-purple-600/30 border border-purple-500/50 text-white font-medium"
                        : "hover:bg-gray-800 text-gray-300"
                    }`}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateObject(obj.id, { visible: !obj.visible });
                      }}
                      className="text-gray-400 hover:text-white"
                    >
                      {obj.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: obj.color }} />
                    <span className="flex-1 truncate">{obj.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeObject(obj.id);
                      }}
                      className="text-gray-500 hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-1 pt-1.5">
                  <button onClick={() => addObject("cylinder")} className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[11px]">+ Cyl</button>
                  <button onClick={() => addObject("cone")} className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[11px]">+ Cone</button>
                  <button onClick={() => addObject("torus")} className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[11px]">+ Torus</button>
                </div>
              </div>
            )}
          </div>

          {/* Animation & Transform Controls */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <button
              onClick={() => setShowAnimation(!showAnimation)}
              className="w-full flex items-center gap-2 text-sm font-medium text-gray-200"
            >
              {showAnimation ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Zap size={14} className="text-amber-400" />
              <span>Inspector {selectedObj ? `(${selectedObj.name})` : ""}</span>
            </button>

            {showAnimation && selectedObj && (
              <div className="space-y-3 pt-1 text-xs">
                {/* Position */}
                <div>
                  <label className="text-gray-400 block mb-1">Position (X, Y, Z)</label>
                  <div className="grid grid-cols-3 gap-1">
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
                        className="bg-gray-800 rounded px-1.5 py-1 text-center font-mono border border-gray-700"
                      />
                    ))}
                  </div>
                </div>

                {/* Rotation Speed */}
                <div>
                  <div className="flex justify-between text-gray-400 mb-1">
                    <span>Rotation Speed</span>
                    <span className="font-mono text-purple-400">{selectedObj.rotateSpeed.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.1"
                    value={selectedObj.rotateSpeed}
                    onChange={(e) => updateObject(selectedObj.id, { rotateSpeed: Number(e.target.value) })}
                    className="w-full accent-purple-500"
                  />
                </div>

                {/* Bob Amplitude & Speed */}
                <div>
                  <div className="flex justify-between text-gray-400 mb-1">
                    <span>Bob Speed</span>
                    <span className="font-mono text-purple-400">{selectedObj.bobSpeed.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.1"
                    value={selectedObj.bobSpeed}
                    onChange={(e) => updateObject(selectedObj.id, { bobSpeed: Number(e.target.value) })}
                    className="w-full accent-purple-500"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-gray-400 mb-1">
                    <span>Bob Amount</span>
                    <span className="font-mono text-purple-400">{selectedObj.bobAmount.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.02"
                    value={selectedObj.bobAmount}
                    onChange={(e) => updateObject(selectedObj.id, { bobAmount: Number(e.target.value) })}
                    className="w-full accent-purple-500"
                  />
                </div>

                {/* Material & Shaders */}
                <div className="border-t border-gray-800 pt-2 space-y-2">
                  <div className="text-gray-400 font-medium">Material & Shading</div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Diffuse Color</span>
                    <input
                      type="color"
                      value={selectedObj.color}
                      onChange={(e) => updateObject(selectedObj.id, { color: e.target.value })}
                      className="w-7 h-7 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-gray-400 mb-1">
                      <span>Metalness</span>
                      <span className="font-mono">{selectedObj.metalness.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={selectedObj.metalness}
                      onChange={(e) => updateObject(selectedObj.id, { metalness: Number(e.target.value) })}
                      className="w-full accent-purple-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-gray-400 mb-1">
                      <span>Roughness</span>
                      <span className="font-mono">{selectedObj.roughness.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={selectedObj.roughness}
                      onChange={(e) => updateObject(selectedObj.id, { roughness: Number(e.target.value) })}
                      className="w-full accent-purple-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-gray-400 mb-1">
                      <span>Glow / Emissive</span>
                      <span className="font-mono">{selectedObj.emissiveIntensity.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={selectedObj.emissiveIntensity}
                      onChange={(e) => updateObject(selectedObj.id, { emissiveIntensity: Number(e.target.value) })}
                      className="w-full accent-purple-500"
                    />
                  </div>
                </div>
              </div>
            )}
            {showAnimation && !selectedObj && (
              <div className="text-gray-500 text-xs py-4 text-center">Select an object above to inspect</div>
            )}
          </div>
        </div>

        {/* 3D WebGL Canvas */}
        <div ref={containerRef} className="flex-1 relative bg-[#0a0a0f] overflow-hidden">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur px-3 py-1.5 rounded text-gray-400 text-xs space-y-0.5 pointer-events-none border border-white/5">
            <div>Objects: <span className="text-white font-mono">{objects.length}</span></div>
            <div>Camera: <span className="text-purple-400 font-mono">{cameraMode}</span></div>
            <div>BPM Sync: <span className={beatSync ? "text-green-400 font-mono" : "text-gray-500 font-mono"}>{beatSync ? `${bpm} BPM` : "OFF"}</span></div>
          </div>
        </div>

        {/* Right Panel: Scene Settings */}
        {showSettings && (
          <div className="w-64 bg-[#0e0e16] border-l border-gray-800 p-3 overflow-y-auto shrink-0 space-y-4 text-xs">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-white"><Settings size={14} /> Scene Configuration</h3>

            {/* Background Color */}
            <div>
              <label className="text-gray-400 block mb-1">Background Color</label>
              <input
                type="color"
                value={sceneConfig.backgroundColor}
                onChange={(e) => setSceneConfig({ ...sceneConfig, backgroundColor: e.target.value })}
                className="w-full h-7 rounded cursor-pointer bg-transparent"
              />
            </div>

            {/* Bloom Intensity */}
            <div>
              <div className="flex justify-between text-gray-400 mb-1">
                <span>Bloom Post-Processing</span>
                <span className="font-mono">{sceneConfig.bloomStrength.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={sceneConfig.bloomStrength}
                onChange={(e) => setSceneConfig({ ...sceneConfig, bloomStrength: Number(e.target.value) })}
                className="w-full accent-purple-500"
              />
            </div>

            {/* Particle Settings */}
            <div>
              <div className="flex justify-between items-center mb-1">
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
                <div className="space-y-2 pt-1">
                  <div>
                    <span className="text-gray-500">Count: {particleConfig.count}</span>
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="50"
                      value={particleConfig.count}
                      onChange={(e) => setParticleConfig({ ...particleConfig, count: Number(e.target.value) })}
                      className="w-full accent-purple-500"
                    />
                  </div>
                  <input
                    type="color"
                    value={particleConfig.color}
                    onChange={(e) => setParticleConfig({ ...particleConfig, color: e.target.value })}
                    className="w-full h-6 rounded cursor-pointer bg-transparent"
                  />
                </div>
              )}
            </div>

            {/* Camera Modes */}
            <div>
              <label className="text-gray-400 block mb-1">Camera Trajectory</label>
              <select
                value={cameraMode}
                onChange={(e) => setCameraMode(e.target.value as any)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
              >
                <option value="orbit">Orbit 360°</option>
                <option value="dolly">Dolly Zoom</option>
                <option value="handheld">Handheld Organic</option>
                <option value="static">Static Manual</option>
              </select>
            </div>

            {/* Framerate Selection */}
            <div>
              <label className="text-gray-400 block mb-1">Target Framerate</label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
              >
                <option value={24}>24 fps (Cinematic Film)</option>
                <option value={30}>30 fps (Standard Video)</option>
                <option value={60}>60 fps (Smooth Performance)</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

}
