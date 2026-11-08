import { Instance, Instances } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import type React from "react";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getGLTFLoader } from "../../../utils/gltfLoader";
import type { AudioData } from "../types";
import type { VizProps } from "./types";

/**
 * StageEnvironment — basement-club concert stage kit (T-VIZ-54).
 *
 * Static set: platform, truss towers + overhead bar, speaker stacks,
 * turntable/boombox props, LED screen, crowd silhouettes, beam cones.
 * Reactive layer: beam intensity/color, screen glow, light rig and crowd
 * bounce all read the shared audioData ref (bass/mid/treble/beat/energy)
 * with smoothed envelopes — per the environment design doc, audio modulates
 * the rig, never replaces it.
 *
 * GLB props are pre-processed copies under public/models/env/ (KTX2
 * textures — loaded via the shared KTX2-aware GLTFLoader).
 */

const ENV = "/models/env";

// Stage coordinates: platform top at STAGE_Y, rear truss at z=-REAR_Z.
const STAGE_Y = -2.1;
const REAR_Z = -1.9;

// Palette discipline (<=6 hues): near-black neutrals + two emissive accents.
const C = {
  truss: "#0b0d12",
  platform: "#14161c",
  platformEdge: "#232838",
  screen: "#0a0a12",
  beamWarm: "#ffb35c",
  beamCool: "#58c8ff",
};

function TrussTower({ x, z }: { x: number; z: number }) {
  // Open ladder-frame tower: 4 posts + rungs, ~4 m tall from the floor.
  const posts: [number, number][] = [
    [-0.28, -0.28],
    [0.28, -0.28],
    [-0.28, 0.28],
    [0.28, 0.28],
  ];
  const rungs: number[] = [];
  for (let y = -3; y <= 0.6; y += 0.45) rungs.push(y);
  return (
    <group position={[x, 0, z]}>
      {posts.map(([px, pz], i) => (
        <mesh key={i} position={[px, -1.2, pz]}>
          <boxGeometry args={[0.07, 4.4, 0.07]} />
          <meshStandardMaterial color={C.truss} roughness={0.6} metalness={0.6} />
        </mesh>
      ))}
      {/* horizontal rungs front/back — instanced to keep draw calls at 1 */}
      <Instances limit={rungs.length * 2} frustumCulled={false}>
        <boxGeometry args={[0.56, 0.05, 0.05]} />
        <meshStandardMaterial color={C.truss} roughness={0.6} metalness={0.6} />
        {rungs.map((y) => (
          <Instance key={`f${y}`} position={[0, y, -0.28]} />
        ))}
        {rungs.map((y) => (
          <Instance key={`b${y}`} position={[0, y, 0.28]} />
        ))}
      </Instances>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[0.6, 0.08, 0.6]} />
        <meshStandardMaterial color={C.truss} roughness={0.6} metalness={0.6} />
      </mesh>
      <mesh position={[0, -3, 0]}>
        <boxGeometry args={[0.6, 0.08, 0.6]} />
        <meshStandardMaterial color={C.truss} roughness={0.6} metalness={0.6} />
      </mesh>
    </group>
  );
}

function OverheadTruss() {
  // Rectangular truss bar spanning the towers, holding the beam fixtures.
  const bars: { pos: [number, number, number]; size: [number, number, number] }[] = [
    { pos: [0, 0.55, 0], size: [6.6, 0.07, 0.07] },
    { pos: [0, 0.72, 0], size: [6.6, 0.07, 0.07] },
    { pos: [0, 0.635, 0], size: [6.6, 0.05, 0.45] },
  ];
  const rungs: number[] = [];
  for (let x = -3; x <= 3; x += 0.55) rungs.push(x);
  return (
    <group position={[0, 0, REAR_Z]}>
      {bars.map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color={C.truss} roughness={0.6} metalness={0.6} />
        </mesh>
      ))}
      <Instances limit={rungs.length} frustumCulled={false}>
        <boxGeometry args={[0.05, 0.2, 0.45]} />
        <meshStandardMaterial color={C.truss} roughness={0.6} metalness={0.6} />
        {rungs.map((x) => (
          <Instance key={x} position={[x, 0.635, 0]} />
        ))}
      </Instances>
    </group>
  );
}

function BeamCone({
  position,
  target,
  color,
  intensityRef,
}: {
  position: [number, number, number];
  target: [number, number, number];
  color: string;
  intensityRef: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { position: mid, quaternion, length } = useMemo(() => {
    const from = new THREE.Vector3(...position);
    const to = new THREE.Vector3(...target);
    const dir = to.clone().sub(from);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      dir.clone().normalize(),
    );
    return {
      position: from.clone().add(to).multiplyScalar(0.5),
      quaternion: quat,
      length: dir.length(),
    };
  }, [position, target]);
  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.05 + intensityRef.current * 0.16;
  });
  return (
    <mesh ref={meshRef} position={mid} quaternion={quaternion} renderOrder={5}>
      <coneGeometry args={[1.1, length, 20, 1, true]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function makeCrowdTexture(): THREE.CanvasTexture {
  // Head-and-shoulders silhouette with raised arms — a plain quad reads as
  // a crate, this reads as a person. One shared texture for all instances;
  // per-instance scale + instanceColor carry the variety.
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d");
  if (!g) return new THREE.CanvasTexture(c);
  g.fillStyle = "#10141d";
  g.beginPath();
  // head
  g.ellipse(64, 42, 24, 28, 0, 0, Math.PI * 2);
  g.fill();
  // neck + shoulders: wide rounded mass to the bottom edge
  g.beginPath();
  g.moveTo(64, 52);
  g.bezierCurveTo(30, 56, 18, 78, 16, 110);
  g.lineTo(8, 256);
  g.lineTo(120, 256);
  g.lineTo(112, 110);
  g.bezierCurveTo(110, 78, 98, 56, 64, 52);
  g.fill();
  // raised arms — two short angled slabs up from the shoulders
  g.save();
  g.translate(64, 150);
  g.rotate(-0.55);
  g.beginPath();
  g.roundRect(-70, -9, 44, 18, 9);
  g.fill();
  g.rotate(1.1);
  g.beginPath();
  g.roundRect(26, -9, 44, 18, 9);
  g.fill();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function CrowdField({ audioData }: { audioData: React.MutableRefObject<AudioData> }) {
  // Foreground silhouette cards in an arc — instanced via drei so they
  // render reliably; the whole field bounces on downbeat (group-level,
  // no per-instance matrix bookkeeping).
  const groupRef = useRef<THREE.Group>(null);
  const crowdTex = useMemo(makeCrowdTexture, []);
  const seeds = useMemo(
    () =>
      // Fewer, spaced figures — 30 overlapping cards merged into a blob.
      // Width tracks height (~0.32 ratio) so bodies keep human proportion.
      Array.from({ length: 20 }, (_, i) => {
        const h = 1.5 + Math.abs(Math.sin(i * 4.1414)) * 0.9;
        return {
          x: -5.2 + (i / 19) * 10.4 + (Math.sin(i * 12.9898) * 0.45),
          // Closer to the stage + taller cards so heads clear the camera's
          // bottom frame edge (cam at y=0, z=7, fov 55 — bottom ray hits
          // y≈-2.1 at z≈3). Two depth bands for parallax; far band is
          // smaller on screen and darker via instanceColor.
          z: i % 3 === 0 ? 3.4 + Math.abs(Math.sin(i * 78.233)) * 0.9 : 2.4 + Math.abs(Math.sin(i * 78.233)) * 1.0,
          h,
          w: h * (0.26 + Math.abs(Math.sin(i * 9.7)) * 0.1),
          shade: 0.7 + Math.abs(Math.sin(i * 3.3)) * 0.5,
        };
      }),
    [],
  );
  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const beat = audioData.current.isDownbeat ? 1 : 0;
    // Gentle idle sway + a sharp-ish downbeat hop, eased back down.
    g.position.y = -3 + Math.sin(t * 2.2) * 0.015 + beat * 0.09;
    g.rotation.z = Math.sin(t * 0.7) * 0.004;
  });
  // Imperative InstancedMesh — matrices written once on mount; the
  // group-level useFrame above handles the downbeat bounce for the field.
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    const d = new THREE.Object3D();
    seeds.forEach((s, i) => {
      d.position.set(s.x, s.h / 2, s.z);
      d.scale.set(s.w, s.h, 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      // Farther/deeper cards read darker — cheap aerial perspective.
      m.setColorAt(i, new THREE.Color(s.shade, s.shade, s.shade * 1.15));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.count = seeds.length;
  }, [seeds]);
  return (
    <group ref={groupRef} position={[0, -3, 0]}>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, seeds.length]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        {/* Silhouette texture does the "person" read; instanceColor gives
            per-card shade. Kept dark — they are silhouettes against the
            beam glow and LED screen, not lit objects. */}
        <meshBasicMaterial
          map={crowdTex}
          transparent
          color="#dfe8f8"
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

function LedScreen({ audioData }: { audioData: React.MutableRefObject<AudioData> }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const d = audioData.current;
    const m = matRef.current;
    if (!m) return;
    const glow = 0.35 + d.energy * 0.9 + (d.isDownbeat ? 0.4 : 0);
    // Hue drifts with mid content; brightness with energy.
    const hue = (d.mid * 0.35 + 0.52) % 1;
    m.color.setHSL(hue, 0.85, Math.min(0.75, 0.18 + glow * 0.35));
  });
  return (
    <group position={[0, STAGE_Y + 0.4, REAR_Z - 0.55]}>
      <mesh>
        <planeGeometry args={[3.4, 1.7]} />
        <meshBasicMaterial ref={matRef} color="#101024" toneMapped={false} />
      </mesh>
      {/* bezel */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[3.7, 2.0]} />
        <meshStandardMaterial color="#050507" roughness={0.8} />
      </mesh>
    </group>
  );
}

export function StageEnvironment({ audioData }: VizProps) {
  // Smoothed reactive channels.
  const beamLevel = useRef(0);
  const screenGlow = useRef(0);
  const lightLevel = useRef(0);

  useFrame((_, dt) => {
    const d = audioData.current;
    const k = Math.min(dt * 6, 1);
    beamLevel.current += (Math.min(1, d.bass * 1.6 + d.energy * 0.5) - beamLevel.current) * k;
    screenGlow.current += (d.energy - screenGlow.current) * k;
    lightLevel.current += (d.mid - lightLevel.current) * k;
  });

  // Targets 0-2 hit the stage (front wash); 3-4 are backlight beams that
  // sail over the stage edge and catch the crowd's backs — the silhouette
  // read the environment doc calls for.
  const beamTargets: [number, number, number][] = [
    [-1.4, STAGE_Y, 0.4],
    [0, STAGE_Y, 0.6],
    [1.4, STAGE_Y, 0.4],
    [-2.2, -2.4, 3.2],
    [2.2, -2.4, 3.2],
  ];
  const beamPositions: [number, number, number][] = [
    [-2.6, 0.4, REAR_Z],
    [-0.9, 0.4, REAR_Z],
    [0.9, 0.4, REAR_Z],
    [2.6, 0.4, REAR_Z],
    [0, 0.4, REAR_Z - 0.3],
  ];

  return (
    <group>
      {/* Stage platform */}
      <mesh position={[0, STAGE_Y - 0.2, 0.2]} receiveShadow>
        <boxGeometry args={[5.2, 0.4, 3.6]} />
        <meshStandardMaterial color={C.platform} roughness={0.85} metalness={0.1} />
      </mesh>
      {/* platform edge light strip */}
      <mesh position={[0, STAGE_Y + 0.005, 1.85]}>
        <boxGeometry args={[5.2, 0.02, 0.06]} />
        <meshBasicMaterial color={C.platformEdge} toneMapped={false} />
      </mesh>

      {/* Truss: two rear towers + overhead bar */}
      <TrussTower x={-3.1} z={REAR_Z} />
      <TrussTower x={3.1} z={REAR_Z} />
      <OverheadTruss />

      {/* LED screen (rear wall) */}
      <LedScreen audioData={audioData} />

      {/* Beam cones — fake volumetrics, additive, bass-driven */}
      {beamPositions.map((p, i) => (
        <BeamCone
          key={i}
          position={p}
          target={beamTargets[i % beamTargets.length]}
          color={i % 2 === 0 ? C.beamWarm : C.beamCool}
          intensityRef={beamLevel}
        />
      ))}

      {/* Reactive practicals on the truss */}
      <ReactiveLights levelRef={lightLevel} />

      {/* DJ-area practical — keeps the GLB props readable against the
          near-black stage without flattening the beam contrast. */}
      <pointLight
        position={[0.4, -0.6, 1.6]}
        intensity={6}
        distance={7}
        decay={2}
        color="#ffc98a"
      />

      {/* Crowd silhouettes (foreground depth plane) */}
      <CrowdField audioData={audioData} />

      {/* GLB props — placed on the platform grid. Each suspends on its
          KTX2-aware load; per-prop Suspense keeps the set dressing visible
          while textures decode instead of blanking the whole scene. */}
      <Suspense fallback={null}>
        <GlbProp url={`${ENV}/speakers.glb`} position={[-1.7, STAGE_Y, REAR_Z + 0.35]} targetSize={1.9} />
        <GlbProp url={`${ENV}/speakers.glb`} position={[1.7, STAGE_Y, REAR_Z + 0.35]} targetSize={1.9} rotationY={Math.PI} />
        <GlbProp url={`${ENV}/turntable.glb`} position={[0.9, STAGE_Y, -0.7]} targetSize={2.4} rotationY={Math.PI} />
        <GlbProp url={`${ENV}/boombox.glb`} position={[-2.3, STAGE_Y, -1.3]} targetSize={1.1} rotationY={0.9} />
      </Suspense>
    </group>
  );
}

function ReactiveLights({ levelRef }: { levelRef: React.MutableRefObject<number> }) {
  const warm = useRef<THREE.SpotLight>(null);
  const cool = useRef<THREE.SpotLight>(null);
  useFrame(() => {
    const lv = levelRef.current;
    if (warm.current) {
      warm.current.intensity = 20 + lv * 60;
      warm.current.color.setHSL(0.07 + lv * 0.12, 0.9, 0.6);
    }
    if (cool.current) {
      cool.current.intensity = 16 + lv * 50;
      cool.current.color.setHSL(0.55 + lv * 0.15, 0.9, 0.62);
    }
  });
  return (
    <>
      <spotLight
        ref={warm}
        position={[-2.4, 0.4, REAR_Z]}
        target-position={[0.4, STAGE_Y, 0.5]}
        angle={0.7}
        penumbra={0.6}
        distance={14}
        decay={2}
        color={C.beamWarm}
      />
      <spotLight
        ref={cool}
        position={[2.4, 0.4, REAR_Z]}
        target-position={[-0.4, STAGE_Y, 0.5]}
        angle={0.7}
        penumbra={0.6}
        distance={14}
        decay={2}
        color={C.beamCool}
      />
    </>
  );
}

function GlbProp({ url, position, targetSize = 1.5, rotationY = 0 }: {
  url: string;
  position: [number, number, number];
  targetSize?: number;
  rotationY?: number;
}) {
  const { gl } = useThree();
  const { scene } = useLoader(getGLTFLoader(gl), url);
  const clone = useMemo(() => {
    // GLB scenes may carry KTX2 textures; clone shallowly per instance.
    const c = scene.clone(true);
    // Sketchfab sources arrive in arbitrary units with inconsistent node
    // TRS (turntable sits ~27 units off-origin at scale 100), so a fixed
    // `scale` prop renders them microscopic, colossal, or off-screen.
    // Fit the world bbox to targetSize and rest the bottom on y=0.
    const box = new THREE.Box3().setFromObject(c);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 1e-6 && isFinite(maxDim)) {
      c.scale.multiplyScalar(targetSize / maxDim);
      const box2 = new THREE.Box3().setFromObject(c);
      const c2 = box2.getCenter(new THREE.Vector3());
      c.position.set(-c2.x, -box2.min.y, -c2.z);
    }
    return c;
  }, [scene, targetSize]);
  return (
    <primitive
      object={clone}
      position={position}
      rotation={[0, rotationY, 0]}
    />
  );
}
