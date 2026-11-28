/**
 * RoomCanvas — the render root, built to the knowledge standard:
 * dpr [1,1.5], shadows "percentage", fov 42, custom Lightformer IBL at
 * 0.3, one shadow Spot key, two non-shadow practicals, ACES 1.0,
 * EffectComposer(mms=4) -> Bloom -> Vignette+Noise -> ToneMapping last.
 * Lighting states: Arrival (three pools) / Late (her pool + ember).
 */

import { Suspense, useEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
} from "@react-three/drei";
import {
  Bloom,
  EffectComposer,
  Noise,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

import { useRoomStore } from "../roomStore";
import { RoomObjectsLayer } from "./RoomObjectsLayer";
import { RoomShell } from "./RoomShell";

/* ---------------- Lighting ---------------- */

function RoomLights() {
  const lightingState = useRoomStore(
    (s) => s.state?.lighting.state ?? "arrival",
  );
  const mayaState = useRoomStore((s) => s.presence?.maya.state ?? "away");
  const { scene } = useThree();
  const spotRef = useRef<THREE.SpotLight>(null);

  useEffect(() => {
    const spot = spotRef.current;
    if (!spot) return;
    spot.target.position.set(0.4, 0.4, 0.3);
    scene.add(spot.target);
    return () => {
      scene.remove(spot.target);
    };
  }, [scene]);

  const late = lightingState === "late";
  // Her pool follows Maya's presence: present 100%, recently ~65%, away ~40%.
  const herPresence =
    mayaState === "present" ? 1 : mayaState === "recently active" ? 0.65 : 0.4;

  // Arrival: her 100%, player 60-70%, entry 30-40%.
  // Late: her pool + one ember pool; everything else near-off.
  const spotI = late ? 26 * herPresence : 32 * herPresence;
  const playerA = late ? 1.8 : 5.5;
  const playerB = late ? 3.0 : 8;
  const entry = late ? 0 : 5;

  return (
    <group>
      {/* The one shadow-casting key: warm spot over her vignette */}
      <spotLight
        ref={spotRef}
        position={[-1.7, 2.3, -0.7]}
        angle={0.6}
        penumbra={0.8}
        intensity={spotI}
        color="#ffd2a1"
        distance={0}
        decay={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-camera-near={0.3}
        shadow-camera-far={12}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      {/* two non-shadow point practicals at the player (2700K) */}
      <pointLight
        position={[0.55, 1.15, -0.35]}
        intensity={playerA}
        color="#ffa757"
        distance={6}
        decay={2}
      />
      <pointLight
        position={[-0.45, 0.95, 0.35]}
        intensity={playerB}
        color="#ffa757"
        distance={6}
        decay={2}
      />
      {/* entry pool — arrival only, 30-40% */}
      <pointLight
        position={[1.9, 2.1, 1.55]}
        intensity={entry}
        color="#ffc98f"
        distance={5}
        decay={2}
      />
      {/* Late state's single ember pool near the player */}
      {late && (
        <pointLight
          position={[0, 0.7, -0.15]}
          intensity={6}
          color="#ff9d5c"
          distance={2.2}
          decay={2}
        />
      )}
    </group>
  );
}

/* ---------------- Camera bookmarks ---------------- */

export interface Bookmark {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export const BOOKMARKS: Bookmark[] = [
  // Entry standing (~1.6 m eye) just inside the door, looking to the vignette.
  { name: "Entry", position: [1.2, 1.6, 1.55], target: [-0.4, 1.0, -0.5] },
  // Seated at the cognac chair, toward the player.
  { name: "Seated", position: [0.9, 1.2, 1.1], target: [-0.2, 0.8, -0.3] },
  // Her vignette diagonal — the money shot across the rug.
  { name: "Her vignette", position: [1.7, 1.55, 1.5], target: [-0.85, 0.85, -0.85] },
  // Player close — cabinet, sleeves, brass.
  { name: "Player", position: [0.75, 1.05, 0.7], target: [0, 0.72, -0.1] },
  // Wide — high NW corner, whole room in one frame.
  { name: "Wide", position: [-1.8, 2.2, 1.6], target: [0.3, 0.9, -0.4] },
];

function CameraRig({ bookmark }: { bookmark: number }) {
  const { camera } = useThree();
  const controlsEnabled = useRoomStore((s) => s.controlsEnabled);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls> | null>(null);
  const anim = useRef<{
    t: number;
    fromP: THREE.Vector3;
    toP: THREE.Vector3;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    fromFov: number;
    toFov: number;
  } | null>(null);

  useEffect(() => {
    const b = BOOKMARKS[((bookmark % BOOKMARKS.length) + BOOKMARKS.length) % BOOKMARKS.length];
    anim.current = {
      t: 0,
      fromP: camera.position.clone(),
      toP: new THREE.Vector3(...b.position),
      fromT: controlsRef.current?.target.clone() ?? new THREE.Vector3(0, 1.1, 0),
      toT: new THREE.Vector3(...b.target),
      fromFov: (camera as THREE.PerspectiveCamera).fov,
      toFov: b.fov ?? 42,
    };
  }, [bookmark, camera]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / 0.9);
    const k = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.fromP, a.toP, k);
    if (controlsRef.current) {
      controlsRef.current.target.lerpVectors(a.fromT, a.toT, k);
      controlsRef.current.update();
    }
    // Pan clamped to the room (knowledge doc §2).
    const c = controlsRef.current;
    if (c && !anim.current) {
      c.target.x = THREE.MathUtils.clamp(c.target.x, -2.2, 2.2);
      c.target.y = THREE.MathUtils.clamp(c.target.y, 0.3, 2.4);
      c.target.z = THREE.MathUtils.clamp(c.target.z, -1.7, 1.7);
    }
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = a.fromFov + (a.toFov - a.fromFov) * k;
    cam.updateProjectionMatrix();
    if (a.t >= 1) anim.current = null;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, 1.1, 0]}
      minDistance={1.2}
      maxDistance={7.5}
      minPolarAngle={0.35}
      maxPolarAngle={Math.PI / 2 + 0.08}
      enabled={controlsEnabled}
    />
  );
}

/* ---------------- Canvas ---------------- */

export function RoomCanvas({ bookmark }: { bookmark: number }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      shadows="percentage"
      gl={{
        antialias: false,
        stencil: false,
        powerPreference: "high-performance",
      }}
      camera={{ fov: 42, near: 0.1, far: 30, position: [1.2, 1.6, 1.55] }}
      onCreated={({ gl, scene, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        // QA probe handle (temporary diagnostics).
        (window as unknown as { __room?: unknown; __THREE?: unknown }).__room = {
          gl,
          scene,
          camera,
        };
        (window as unknown as { __THREE?: unknown }).__THREE = THREE;
      }}
    >
      <color attach="background" args={["#07070f"]} />
      <fog attach="fog" args={["#07070f", 9, 22]} />

      <Suspense fallback={null}>
        {/* IBL: custom Lightformer environment, never a daylight HDRI */}
        <Environment resolution={256} frames={1} environmentIntensity={0.3} background={false}>
          <Lightformer
            form="rect"
            intensity={3}
            color="#ffd9a0"
            position={[-1.7, 1.7, -0.7]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[1.2, 0.5, 1]}
          />
          <Lightformer
            form="rect"
            intensity={3}
            color="#ffd9a0"
            position={[0.4, 1.5, 0.6]}
            rotation={[0, -Math.PI / 3, 0]}
            scale={[0.9, 0.45, 1]}
          />
          <Lightformer
            form="rect"
            intensity={0.7}
            color="#7787a8"
            position={[2.4, 1.5, 0.4]}
            rotation={[0, -Math.PI / 2, 0]}
            scale={[1.4, 0.9, 1]}
          />
        </Environment>

        <RoomShell />
        <RoomObjectsLayer />
        <RoomLights />

        {/* grounding: baked aoMap on textures + exactly one ContactShadows
            under the seating group — never both shadow systems */}
        <ContactShadows
          position={[-0.1, 0.001, -0.2]}
          opacity={0.6}
          scale={4.2}
          blur={2}
          far={1.6}
          resolution={512}
          frames={1}
          color="#0a0812"
        />

        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.5} luminanceThreshold={1.2} />
          <Vignette eskil={false} offset={0.18} darkness={0.72} />
          <Noise opacity={0.04} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Suspense>

      <CameraRig bookmark={bookmark} />
    </Canvas>
  );
}
