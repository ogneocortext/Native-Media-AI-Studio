import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FilmShader } from "three/examples/jsm/shaders/FilmShader.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { SCENE_TEMPLATES } from "../sceneTemplates";
import { BLOOM_LAYER } from "../threeStudioConfig";
import type { UseThreeSceneOptions, UseThreeSceneResult } from "./types";

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

  useEffect(() => { keyframeTracksRef.current = keyframeTracks; }, [keyframeTracks]);
  useEffect(() => { beatAnalysisRef.current = beatAnalysis; }, [beatAnalysis]);
  useEffect(() => { objectsRef.current = objects; }, [objects]);
  useEffect(() => { beatSyncRef.current = beatSync; }, [beatSync]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isAudioPlayingRef.current = isAudioPlaying; }, [isAudioPlaying]);
  useEffect(() => { particleConfigRef.current = particleConfig; }, [particleConfig]);
  useEffect(() => { sceneConfigRef.current = sceneConfig; }, [sceneConfig]);
  useEffect(() => {
    activeAudioDrivenRef.current = SCENE_TEMPLATES.find(
      (t: any) => t.id === activeTemplateId,
    )?.audioDriven;
  }, [activeTemplateId]);
  useEffect(() => { animationTimeRef.current = animationTime; }, [animationTime]);
  useEffect(() => { beatActiveRef.current = beatActive; }, [beatActive]);
  useEffect(() => { getCurrentBeatRef.current = getCurrentBeat; }, [getCurrentBeat]);
  useEffect(() => { renderPlayingRef.current = renderPlayingState; }, [renderPlayingState]);

  // Scene init + animation loop
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const onResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current)
        return;
      const w = containerRef.current.clientWidth,
        h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      if (composerRef.current) composerRef.current.setSize(w, h);
      if (bloomComposerRef.current) bloomComposerRef.current.setSize(w, h);
      if (finalComposerRef.current) finalComposerRef.current.setSize(w, h);
    };
    const initScene = async () => {
      threeRef.current = THREE;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(
        sceneConfigRef.current.backgroundColor,
      );
      scene.fog = new THREE.FogExp2(
        sceneConfigRef.current.fogColor,
        sceneConfigRef.current.fogDensity,
      );
      sceneRef.current = scene;
      const camera = new THREE.PerspectiveCamera(
        50,
        container.clientWidth / container.clientHeight,
        0.1,
        1000,
      );
      camera.position.set(0, 3, 8);
      camera.lookAt(0, 0.5, 0);
      cameraRef.current = camera;
      (window as any).__camera = camera;
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
        stencil: false,
        depth: true,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      (renderer as unknown as { shadowMap: { autoUpdate: boolean } }).shadowMap.autoUpdate = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      rendererRef.current = renderer;
      (window as any).__renderer = renderer;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.minDistance = 2;
      controls.maxDistance = 20;
      controls.enablePan = false;

      const renderScene = new RenderPass(scene, camera);
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(container.clientWidth, container.clientHeight),
        sceneConfigRef.current.bloomStrength,
        0.35,
        0.9,
      );
      bloomPassRef.current = bloomPass;
      const finalComposer = new EffectComposer(renderer);
      finalComposer.addPass(renderScene);
      if (sceneConfigRef.current.selectiveBloom) finalComposer.addPass(bloomPass);
      const caPass = new ShaderPass(RGBShiftShader);
      caPass.uniforms.amount.value = sceneConfigRef.current.chromaticAberration;
      if (caPass.uniforms.amount.value > 0.0005) finalComposer.addPass(caPass);
      caPassRef.current = caPass;
      const grainPass = new ShaderPass(FilmShader);
      grainPass.uniforms.intensity.value = sceneConfigRef.current.filmGrain;
      grainPass.uniforms.grayscale.value = false;
      if (grainPass.uniforms.intensity.value > 0.01) finalComposer.addPass(grainPass);
      grainPassRef.current = grainPass;
      const vignettePass = new ShaderPass(VignetteShader);
      vignettePass.uniforms.offset.value =
        sceneConfigRef.current.vignetteRadius;
      vignettePass.uniforms.darkness.value =
        sceneConfigRef.current.vignetteStrength;
      if (vignettePass.uniforms.darkness.value > 0.05) finalComposer.addPass(vignettePass);
      vignettePassRef.current = vignettePass;
      finalComposer.addPass(new OutputPass());
      bloomComposerRef.current = null;
      composerRef.current = finalComposer;
      finalComposerRef.current = finalComposer;

      scene.add(new THREE.AmbientLight(0x404060, 0.55));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
      dirLight.position.set(5, 8, 5);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(1024, 1024);
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 25;
      (dirLight.shadow as unknown as { bias: number }).bias = -0.0005;
      scene.add(dirLight);
      const spotLight = new THREE.SpotLight(0x8b5cf6, 18);
      spotLight.position.set(0, 10, 0);
      spotLight.angle = 0.42;
      spotLight.penumbra = 0.6;
      spotLight.castShadow = true;
      spotLight.shadow.mapSize.set(512, 512);
      scene.add(spotLight);
      const p1 = new THREE.PointLight(0xff6b9d, 8, 10);
      p1.position.set(-4, 3, 3);
      scene.add(p1);
      const p2 = new THREE.PointLight(0x6b9dff, 8, 10);
      p2.position.set(4, 2, -3);
      scene.add(p2);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.MeshStandardMaterial({
          color: 0x080808,
          metalness: 0.9,
          roughness: 0.1,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.5;
      floor.receiveShadow = true;
      scene.add(floor);
      const grid = new THREE.GridHelper(20, 20, 0x333344, 0x181822);
      grid.position.y = -0.49;
      scene.add(grid);
      const pGeo = new THREE.BufferGeometry();
      const pArr = new Float32Array(particleConfigRef.current.count * 3);
      for (let i = 0; i < particleConfigRef.current.count * 3; i += 3) {
        pArr[i] = (Math.random() - 0.5) * particleConfigRef.current.spread * 2;
        pArr[i + 1] = Math.random() * particleConfigRef.current.spread;
        pArr[i + 2] =
          (Math.random() - 0.5) * particleConfigRef.current.spread * 2;
      }
      pGeo.setAttribute("position", new THREE.BufferAttribute(pArr, 3));
      const particles = new THREE.Points(
        pGeo,
        new THREE.PointsMaterial({
          color: particleConfigRef.current.color,
          size: particleConfigRef.current.size,
          transparent: true,
          opacity: particleConfigRef.current.opacity,
          blending: THREE.AdditiveBlending,
        }),
      );
      scene.add(particles);
      particlesRef.current = particles;
      for (const obj of objectsRef.current) {
        const mesh = await createMeshForObject(obj, THREE);
        scene.add(mesh);
        objectsMapRef.current.set(obj.id, mesh);
      }
      clockRef.current = new THREE.Timer();
      clockRef.current.connect(document);

      const animate = () => {
        animationRef.current = requestAnimationFrame(animate);
        const clock = clockRef.current;
        if (!clock) return;
        clock.update();
        const delta = clock.getDelta();
        const elapsed = clock.getElapsed();
        controls.update();
        if (document.hidden) {
          controls.update();
          (finalComposerRef.current || composerRef.current)?.render();
          return;
        }
        let audioBass = 0,
          audioTreble = 0,
          audioMid = 0;
        if (analyserRef.current && isAudioPlayingRef.current) {
          if (
            !audioFreqArrayRef.current ||
            audioFreqArrayRef.current.length !==
              analyserRef.current.frequencyBinCount
          )
            audioFreqArrayRef.current = new Uint8Array(
              analyserRef.current.frequencyBinCount,
            );
          analyserRef.current.getByteFrequencyData(
            audioFreqArrayRef.current as Uint8Array<ArrayBuffer>,
          );
          const arr = audioFreqArrayRef.current;
          const bassBins = Math.floor(arr.length * 0.08);
          let sum = 0;
          for (let i = 0; i < bassBins; i++) sum += arr[i];
          audioBass = sum / (bassBins * 255 || 1);
          const midBins = Math.floor(arr.length * 0.2);
          sum = 0;
          for (let i = bassBins; i < midBins; i++) sum += arr[i];
          audioMid = sum / ((midBins - bassBins) * 255 || 1);
          const trebleBins = Math.floor(arr.length * 0.4);
          sum = 0;
          for (let i = trebleBins; i < arr.length; i++) sum += arr[i];
          audioTreble = sum / ((arr.length - trebleBins) * 255 || 1);
        }
        const beatState = getCurrentBeatRef.current(elapsed);
        const beatPunchAmp = sceneConfigRef.current.beatPunch;
        let beatSpike = 0;
        let newBeatActive = false;
        if (renderPlayingRef.current && beatState.ready && beatState.isOnBeat) {
          beatSpike =
            beatPunchAmp *
            (1 - beatState.timeSinceLastBeat / beatState.beatWindowSec);
          if (beatState.timeSinceLastBeat < 0.016) {
            shakeRef.current = Math.min(
              shakeRef.current + beatPunchAmp * 0.3,
              0.15,
            );
            newBeatActive = true;
          }
        }
        if (newBeatActive !== beatActiveRef.current) {
          beatActiveRef.current = newBeatActive;
          setBeatActive(newBeatActive);
        }
        shakeRef.current *= 0.75;
        const isPlay = isPlayingRef.current;
        const audioDrivenMode = activeAudioDrivenRef.current;
        objectsRef.current.forEach((obj: any) => {
          const mesh = objectsMapRef.current.get(obj.id);
          if (mesh && obj.visible) {
            if (isPlay) {
              mesh.rotation.y += delta * (obj.rotateSpeed + audioTreble * 2);
              mesh.position.y =
                obj.position[1] +
                Math.sin(elapsed * obj.bobSpeed) * obj.bobAmount;
            }
            let pulse = 1;
            if (isPlay && beatState.ready && beatSpike > 0)
              pulse = 1 + beatSpike;
            else if (isPlay && beatSyncRef.current) {
              const bi = 60 / bpmRef.current;
              pulse =
                (1 + Math.sin(((elapsed % bi) / bi) * Math.PI * 2) * 0.08) *
                (1 + audioBass * 0.35);
            } else if (isPlay && audioBass > 0) pulse = 1 + audioBass * 0.3;
            if (isPlay && audioDrivenMode === "bars" && obj.type === "bars") {
              const barIdx = parseInt(obj.id.replace("bar-", "")) || 0;
              const freqSlice = Math.floor((barIdx / 32) * 256);
              const freqVal = audioFreqArrayRef.current
                ? (audioFreqArrayRef.current[freqSlice] || 0) / 255
                : audioMid;
              const barPulse = 1 + freqVal * 3;
              const s = obj.scale;
              mesh.scale.set(s[0] * barPulse, s[1], s[2]);
            } else if (
              isPlay &&
              audioDrivenMode === "pillars" &&
              obj.type === "box"
            ) {
              const pillarPulse = 1 + audioBass * 1.5;
              const s = obj.scale;
              mesh.scale.set(s[0], s[1] * pillarPulse, s[2]);
            } else {
              const s = obj.scale;
              mesh.scale.set(s[0] * pulse, s[1] * pulse, s[2] * pulse);
            }
          }
        });
        if (isPlay) {
          characterMixersRef.current.forEach((mixer: any) => {
            mixer.update(delta);
          });
        }
        frameCountRef.current++;
        if (
          particlesRef.current &&
          particleConfigRef.current.enabled &&
          isPlay &&
          frameCountRef.current % 2 === 0
        ) {
          const pos = particlesRef.current.geometry.attributes.position.array as Float32Array;
          const spd = particleConfigRef.current.speed * (1 + audioBass * 1.5);
          for (let i = 1; i < pos.length; i += 3) {
            pos[i] += delta * spd * 0.8;
            if (pos[i] > particleConfigRef.current.spread) pos[i] = Math.random() * 0.5;
          }
          (particlesRef.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
          particlesRef.current.rotation.y += delta * 0.03;
        } else if (particlesRef.current && isPlay) {
          particlesRef.current.rotation.y += delta * 0.02;
        }
        const cm = cameraModeRef.current;
        const ir = renderPlayingRef.current;
        const sx = (Math.random() - 0.5) * shakeRef.current;
        const sy = (Math.random() - 0.5) * shakeRef.current;
        if (cm === "orbit" && ir) {
          const a = elapsed * 0.25;
          camera.position.x = Math.sin(a) * 8 + sx;
          camera.position.z = Math.cos(a) * 8;
          camera.position.y = 3 + Math.sin(a * 0.5) * 0.6 + sy;
          camera.lookAt(0, 0.5, 0);
        } else if (cm === "dolly" && ir) {
          const t = (elapsed % 8) / 8;
          camera.position.z = 10 - t * 6;
          camera.position.y = 3 - t * 0.8 + sy;
          camera.lookAt(0, 0.5, 0);
        } else if (cm === "handheld" && ir) {
          camera.position.x += (Math.random() - 0.5) * 0.02;
          camera.position.y += (Math.random() - 0.5) * 0.02;
          camera.lookAt(0, 0.5, 0);
        }
        if (finalComposerRef.current) {
          finalComposerRef.current.render();
        } else if (composerRef.current) {
          composerRef.current.render();
        }

        if (renderPlayingRef.current) {
          const nextTime = animationTimeRef.current + delta;
          animationTimeRef.current =
            nextTime >= animationDuration ? 0 : nextTime;
          const now = performance.now();
          if (now - lastUiUpdateRef.current > 100) {
            lastUiUpdateRef.current = now;
            onAnimationTimeChange(animationTimeRef.current);
          }
        }

        if (generatedSceneUpdateRef.current) {
          if (renderPlayingRef.current) {
            generatedSceneUpdateRef.current(animationTimeRef.current, delta);
          }
        }

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
                  prevKf.position[0] +
                    (nextKf.position[0] - prevKf.position[0]) * t,
                  prevKf.position[1] +
                    (nextKf.position[1] - prevKf.position[1]) * t,
                  prevKf.position[2] +
                    (nextKf.position[2] - prevKf.position[2]) * t,
                );
              }
              if (prevKf.rotation && nextKf.rotation) {
                mesh.rotation.set(
                  prevKf.rotation[0] +
                    (nextKf.rotation[0] - prevKf.rotation[0]) * t,
                  prevKf.rotation[1] +
                    (nextKf.rotation[1] - prevKf.rotation[1]) * t,
                  prevKf.rotation[2] +
                    (nextKf.rotation[2] - prevKf.rotation[2]) * t,
                );
              }
              if (prevKf.scale && nextKf.scale) {
                mesh.scale.set(
                  prevKf.scale[0] + (nextKf.scale[0] - prevKf.scale[0]) * t,
                  prevKf.scale[1] + (nextKf.scale[1] - prevKf.scale[1]) * t,
                  prevKf.scale[2] + (nextKf.scale[2] - prevKf.scale[2]) * t,
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
    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", onResize);
      clockRef.current?.dispose();
      rendererRef.current?.dispose();
    };
  }, [createMeshForObject]);

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
          characterMixersRef.current.delete(id);
        }
      });
      (async () => {
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
            mesh.position.set(...(obj.position as [number, number, number]));
            mesh.rotation.set(...(obj.rotation as [number, number, number]));
            mesh.scale.set(...(obj.scale as [number, number, number]));
            if (
              obj.type === "character" &&
              obj.modelUrl &&
              (mesh as any).__modelUrl !== obj.modelUrl
            ) {
              scene.remove(mesh);
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
      sceneRef.current.background = new THREE.Color(
        sceneConfig.backgroundColor,
      );
      if (sceneRef.current.fog) {
        sceneRef.current.fog.color.set(sceneConfig.fogColor);
        if (sceneRef.current.fog instanceof THREE.FogExp2) {
          sceneRef.current.fog.density = sceneConfig.fogDensity;
        }
      }
    }
    if (bloomPassRef.current)
      bloomPassRef.current.strength = sceneConfig.bloomStrength;
    if (caPassRef.current)
      caPassRef.current.uniforms.amount.value = sceneConfig.chromaticAberration;
    if (grainPassRef.current)
      (grainPassRef.current.uniforms as any).intensity.value = sceneConfig.filmGrain;
    if (vignettePassRef.current) {
      vignettePassRef.current.uniforms.offset.value =
        sceneConfig.vignetteRadius;
      vignettePassRef.current.uniforms.darkness.value =
        sceneConfig.vignetteStrength;
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
    const mat = particlesRef.current.material as THREE.PointsMaterial | THREE.PointsMaterial[] | null;
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
    (async () => {
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
      img.onerror = (err) =>
        console.error("BG image failed:", backgroundImageUrl, err);
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
  };
}
