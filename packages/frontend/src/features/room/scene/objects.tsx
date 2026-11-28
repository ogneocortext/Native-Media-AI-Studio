/**
 * Room object meshes — one builder per state-object kind.
 * Art direction: Night Library x Listening Room (knowledge doc §6).
 * Palette: cream #F7F1E5, walnut #5C3D2E, indigo #0D0D24,
 * plum velvet #4A3566, brass #B08D57; cognac #A65E2E reads as walnut
 * under 2700K. No sixth color.
 */

import { useMemo, type JSX } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";

import { roomMediaUrl } from "../roomApi";
import type { RoomObject } from "../types";
import { useLeather, usePaper, useVelvet, useWalnut } from "./textures";

export const BRASS = "#B08D57";
export const INDIGO = "#0D0D24";
export const CREAM = "#F7F1E5";
export const WALNUT_TINT = "#8a6a52"; // multiplier over the veneer photo

function BrassMat({ roughness = 0.35 }: { roughness?: number }) {
  return (
    <meshStandardMaterial
      color={BRASS}
      metalness={0.85}
      roughness={roughness}
      envMapIntensity={0.7}
    />
  );
}

/** Shared walnut material set for wood furniture. */
function useWood(repeat = 1) {
  const maps = useWalnut(repeat);
  return useMemo(
    () => ({
      map: maps.map,
      normalMap: maps.normalMap,
      roughnessMap: maps.roughnessMap,
      aoMap: maps.aoMap,
      color: WALNUT_TINT,
    }),
    [maps],
  );
}

function WoodBox({
  args,
  position,
  rotation,
  repeat = 1,
  castShadow = true,
  receiveShadow = true,
}: {
  args: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  repeat?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const wood = useWood(repeat);
  return (
    <mesh
      position={position}
      rotation={rotation}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      <boxGeometry args={args} />
      <meshStandardMaterial {...wood} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Seating                                                             */
/* ------------------------------------------------------------------ */

function ArmchairHer() {
  const velvet = useVelvet();
  return (
    <group>
      {/* walnut frame: two arms, back posts, seat deck */}
      <WoodBox args={[0.09, 0.42, 0.62]} position={[-0.36, 0.42, 0]} />
      <WoodBox args={[0.09, 0.42, 0.62]} position={[0.36, 0.42, 0]} />
      <WoodBox args={[0.81, 0.5, 0.09]} position={[0, 0.72, -0.31]} />
      <WoodBox args={[0.78, 0.08, 0.6]} position={[0, 0.4, 0]} />
      {/* plum velvet cushions */}
      <mesh position={[0, 0.48, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.14, 0.52]} />
        <meshStandardMaterial map={velvet} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.82, -0.24]} rotation={[-0.12, 0, 0]} castShadow>
        <boxGeometry args={[0.62, 0.5, 0.12]} />
        <meshStandardMaterial map={velvet} roughness={0.95} />
      </mesh>
      {/* brass nailheads on arms */}
      {[-0.36, 0.36].map((x) =>
        [0.18, 0.36].map((y) => (
          <mesh key={`${x}-${y}`} position={[x, y, 0.28]}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <BrassMat roughness={0.25} />
          </mesh>
        )),
      )}
    </group>
  );
}

function ArmchairCognac() {
  const leather = useLeather();
  return (
    <group>
      <WoodBox args={[0.1, 0.4, 0.6]} position={[-0.37, 0.4, 0]} />
      <WoodBox args={[0.1, 0.4, 0.6]} position={[0.37, 0.4, 0]} />
      <WoodBox args={[0.84, 0.52, 0.1]} position={[0, 0.74, -0.3]} />
      <WoodBox args={[0.8, 0.08, 0.58]} position={[0, 0.38, 0]} />
      <mesh position={[0, 0.46, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.64, 0.14, 0.5]} />
        <meshStandardMaterial map={leather} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.84, -0.23]} rotation={[-0.1, 0, 0]} castShadow>
        <boxGeometry args={[0.64, 0.52, 0.12]} />
        <meshStandardMaterial map={leather} roughness={0.55} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Player + tables                                                      */
/* ------------------------------------------------------------------ */

function RecordPlayer() {
  return (
    <group>
      {/* cabinet */}
      <WoodBox args={[0.62, 0.5, 0.42]} position={[0, 0.32, 0]} />
      {/* plinth shadow gap */}
      <WoodBox args={[0.56, 0.04, 0.36]} position={[0, 0.06, 0]} />
      {/* turntable */}
      <mesh position={[0, 0.585, 0.01]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.17, 0.17, 0.02, 40]} />
        <meshStandardMaterial color="#17130f" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.6, 0.01]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.012, 32]} />
        <meshStandardMaterial color={CREAM} roughness={0.8} />
      </mesh>
      {/* tonearm — brass */}
      <group position={[0.2, 0.62, -0.12]} rotation={[0, 0, -0.5]}>
        <mesh position={[0.08, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.008, 0.008, 0.2, 8]} />
          <BrassMat />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.025, 12, 12]} />
          <BrassMat roughness={0.25} />
        </mesh>
      </group>
      {/* warm dial glow strip */}
      <mesh position={[-0.18, 0.5, 0.215]}>
        <boxGeometry args={[0.1, 0.015, 0.005]} />
        <meshStandardMaterial
          color="#ffb066"
          emissive="#ff9d4d"
          emissiveIntensity={1.6}
        />
      </mesh>
      {/* brass corner protectors */}
      {[
        [-0.3, 0.045, 0.2],
        [0.3, 0.045, 0.2],
        [-0.3, 0.045, -0.2],
        [0.3, 0.045, -0.2],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <boxGeometry args={[0.03, 0.09, 0.03]} />
          <BrassMat />
        </mesh>
      ))}
    </group>
  );
}

function SideTable() {
  return (
    <group>
      <mesh position={[0, 0.53, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.035, 28]} />
        <meshStandardMaterial color={WALNUT_TINT} roughness={0.5} />
      </mesh>
      {/* brass rim */}
      <mesh position={[0, 0.548, 0]}>
        <torusGeometry args={[0.235, 0.008, 8, 32]} />
        <BrassMat />
      </mesh>
      <mesh position={[0, 0.27, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.045, 0.52, 12]} />
        <meshStandardMaterial color="#3a2c20" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.16, 0.18, 0.04, 20]} />
        <meshStandardMaterial color="#3a2c20" roughness={0.6} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Lamp, plant, smalls                                                  */
/* ------------------------------------------------------------------ */

function FloorLamp() {
  return (
    <group>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.14, 0.16, 0.04, 20]} />
        <meshStandardMaterial color="#2c2119" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 1.66, 10]} />
        <meshStandardMaterial color="#2c2119" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* drum shade — the emissive bulb inside */}
      <mesh position={[0, 1.62, 0]}>
        <cylinderGeometry args={[0.16, 0.19, 0.24, 24, 1, true]} />
        <meshStandardMaterial
          color="#d8b98c"
          emissive="#ffb066"
          emissiveIntensity={1.1}
          side={THREE.DoubleSide}
          roughness={0.9}
        />
      </mesh>
      <mesh position={[0, 1.58, 0]}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial
          color="#ffd9a0"
          emissive="#ffbf80"
          emissiveIntensity={3.2}
        />
      </mesh>
    </group>
  );
}

function BookStack() {
  const paper = usePaper();
  const books = useMemo(
    () => [
      { w: 0.22, h: 0.035, d: 0.16, c: "#5C3D2E" },
      { w: 0.19, h: 0.028, d: 0.14, c: "#4A3566" },
      { w: 0.2, h: 0.03, d: 0.15, c: "#8a6a52" },
      { w: 0.17, h: 0.026, d: 0.13, c: "#2c2620" },
    ],
    [],
  );
  return (
    <group>
      {books.map((b, i) => (
        <group key={i} position={[i % 2 === 0 ? 0.01 : -0.015, i * 0.032, 0]} rotation={[0, (i * 0.4) % 0.6 - 0.3, 0]}>
          <mesh castShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.c} roughness={0.8} />
          </mesh>
          <mesh position={[0, b.h / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[b.w * 0.92, b.d * 0.92]} />
            <meshStandardMaterial map={paper} roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* one open book leaning */}
      <group position={[0.12, 0.02, 0.05]} rotation={[0, 0.5, 0]}>
        <mesh position={[-0.05, 0.008, 0]} rotation={[0, 0, 0.12]}>
          <boxGeometry args={[0.11, 0.012, 0.15]} />
          <meshStandardMaterial map={paper} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.05, 0.008, 0]} rotation={[0, 0, -0.12]}>
          <boxGeometry args={[0.11, 0.012, 0.15]} />
          <meshStandardMaterial map={paper} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

function Plant() {
  // Kept dark and desaturated — reads as shadow mass, stays in palette.
  return (
    <group>
      <mesh position={[0, 0.16, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.11, 0.32, 14]} />
        <meshStandardMaterial color="#3d3428" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.33, 0]}>
        <cylinderGeometry args={[0.125, 0.125, 0.02, 14]} />
        <meshStandardMaterial color="#241d16" roughness={1} />
      </mesh>
      {[
        [0, 0.75, 0, 0.16],
        [0.09, 0.62, 0.05, 0.12],
        [-0.08, 0.68, -0.04, 0.11],
        [0.03, 0.95, -0.06, 0.1],
        [-0.05, 0.55, 0.08, 0.09],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} scale={[1, 1.5, 0.6]}>
          <sphereGeometry args={[r, 10, 10]} />
          <meshStandardMaterial color="#22301f" roughness={0.9} />
        </mesh>
      ))}
      {/* dried branch */}
      <mesh position={[0.02, 1.05, 0]} rotation={[0.2, 0, 0.15]}>
        <cylinderGeometry args={[0.008, 0.012, 0.5, 6]} />
        <meshStandardMaterial color="#4a3a28" roughness={1} />
      </mesh>
    </group>
  );
}

function Mug() {
  return (
    <group>
      <mesh position={[0, 0.045, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.035, 0.09, 18]} />
        <meshStandardMaterial color={CREAM} roughness={0.6} />
      </mesh>
      <mesh position={[0.05, 0.045, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.03, 0.008, 8, 16, Math.PI]} />
        <meshStandardMaterial color={CREAM} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.085, 0]}>
        <cylinderGeometry args={[0.034, 0.034, 0.005, 18]} />
        <meshStandardMaterial color="#3a2417" roughness={0.3} />
      </mesh>
    </group>
  );
}

function Blanket() {
  const velvet = useVelvet();
  return (
    <group>
      {/* folded throw over a chair arm — soft stacked slabs, plum family */}
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.34, 0.05, 0.42]} />
        <meshStandardMaterial map={velvet} roughness={1} />
      </mesh>
      <mesh position={[0.02, 0.07, -0.02]} rotation={[0, 0.12, 0.04]} castShadow>
        <boxGeometry args={[0.3, 0.045, 0.36]} />
        <meshStandardMaterial map={velvet} roughness={1} />
      </mesh>
      <mesh position={[-0.01, 0.115, 0.03]} rotation={[0, -0.08, -0.03]} castShadow>
        <boxGeometry args={[0.26, 0.04, 0.3]} />
        <meshStandardMaterial color="#5d4775" roughness={1} />
      </mesh>
    </group>
  );
}

function Headphones() {
  return (
    <group>
      {/* resting on the cabinet: band + two cups */}
      <mesh position={[0, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.09, 0.012, 8, 20, Math.PI]} />
        <meshStandardMaterial color="#241d18" roughness={0.7} />
      </mesh>
      <mesh position={[-0.09, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.035, 16]} />
        <meshStandardMaterial color="#2c2620" roughness={0.6} />
      </mesh>
      <mesh position={[0.09, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.035, 16]} />
        <meshStandardMaterial color="#2c2620" roughness={0.6} />
      </mesh>
      {[-0.09, 0.09].map((x) => (
        <mesh key={x} position={[x, 0.02, 0.045]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.032, 16]} />
          <meshStandardMaterial color={CREAM} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Wall pieces: shelf-in-progress, frames, screen                       */
/* ------------------------------------------------------------------ */

function ShelfProgress() {
  const wood = useWood(1);
  return (
    <group>
      {/* uprights */}
      <mesh position={[-0.45, 0, 0]} castShadow>
        <boxGeometry args={[0.035, 0.62, 0.28]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      <mesh position={[0.45, 0, 0]} castShadow>
        <boxGeometry args={[0.035, 0.62, 0.28]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* top board */}
      <mesh position={[0, 0.31, 0]} castShadow>
        <boxGeometry args={[0.94, 0.03, 0.28]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* bottom board */}
      <mesh position={[0, -0.31, 0]}>
        <boxGeometry args={[0.94, 0.03, 0.28]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* ONE shelf visibly in progress: a board mid-install, a couple of
          books already on it, the rest of the bay empty */}
      <mesh position={[0.05, -0.05, 0]} rotation={[0, 0, 0.015]} castShadow>
        <boxGeometry args={[0.86, 0.025, 0.26]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {[
        [-0.28, -0.02, "#5C3D2E"],
        [-0.12, -0.02, "#4A3566"],
        [0.05, -0.02, "#8a6a52"],
      ].map(([x, y, c], i) => (
        <mesh key={i} position={[x as number, (y as number) + 0.16, 0]} castShadow>
          <boxGeometry args={[0.11 - i * 0.01, 0.22 - i * 0.02, 0.18]} />
          <meshStandardMaterial color={c as string} roughness={0.8} />
        </mesh>
      ))}
      {/* stack of uninstalled boards leaning on the side — the "in progress" tell */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[0.62 + i * 0.012, -0.18 + i * 0.045, 0.05]}
          rotation={[0, 0, -0.22]}
          castShadow
        >
          <boxGeometry args={[0.8, 0.022, 0.24]} />
          <meshStandardMaterial {...wood} />
        </mesh>
      ))}
    </group>
  );
}

function FrameArt({ url }: { url: string }) {
  const tex = useTexture(url);
  return (
    <mesh>
      <planeGeometry args={[0.34, 0.44]} />
      <meshStandardMaterial map={tex} roughness={0.85} />
    </mesh>
  );
}

function FrameEmpty() {
  // Empty private store = an empty frame: dark indigo mat, faint inner glow.
  return (
    <mesh position={[0, 0, 0.004]}>
      <planeGeometry args={[0.34, 0.44]} />
      <meshStandardMaterial color={INDIGO} roughness={0.95} />
    </mesh>
  );
}

export function FrameMesh({ media }: { media?: string | null }) {
  const wood = useWood(1);
  const inner = media ? <FrameArt url={roomMediaUrl(media)} /> : <FrameEmpty />;
  return (
    <group>
      {/* frame: walnut slip with mitred look via four rails */}
      <mesh position={[0, 0.245, 0]} castShadow>
        <boxGeometry args={[0.4, 0.035, 0.03]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      <mesh position={[0, -0.245, 0]}>
        <boxGeometry args={[0.4, 0.035, 0.03]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      <mesh position={[-0.185, 0, 0]}>
        <boxGeometry args={[0.03, 0.455, 0.03]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      <mesh position={[0.185, 0, 0]}>
        <boxGeometry args={[0.03, 0.455, 0.03]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* dark mat behind the art */}
      <mesh position={[0, 0, -0.002]}>
        <planeGeometry args={[0.37, 0.425]} />
        <meshStandardMaterial color="#14101c" roughness={1} />
      </mesh>
      <group position={[0, 0, 0.006]}>{inner}</group>
      {/* brass hanging wire hint */}
      <mesh position={[0, 0.28, -0.02]} rotation={[0.3, 0, 0]}>
        <cylinderGeometry args={[0.003, 0.003, 0.12, 6]} />
        <BrassMat roughness={0.4} />
      </mesh>
    </group>
  );
}

function ScreenArt({ url }: { url: string }) {
  const tex = useTexture(url);
  return (
    <mesh>
      <planeGeometry args={[0.92, 0.56]} />
      <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.4} />
    </mesh>
  );
}

function ScreenIdle() {
  // Empty store: the screen sleeps — faint indigo standby glow.
  return (
    <mesh>
      <planeGeometry args={[0.92, 0.56]} />
      <meshStandardMaterial
        color="#0a0a18"
        emissive="#1a1a3d"
        emissiveIntensity={0.5}
        roughness={0.3}
      />
    </mesh>
  );
}

export function ScreenMesh({ media }: { media?: string | null }) {
  return (
    <group>
      {/* slim walnut panel + stand foot */}
      <WoodBox args={[1.0, 0.64, 0.05]} position={[0, 0, 0]} />
      <WoodBox args={[0.3, 0.04, 0.2]} position={[0, -0.42, 0]} />
      <group position={[0, 0, 0.028]}>
        {media ? <ScreenArt url={roomMediaUrl(media)} /> : <ScreenIdle />}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const BUILDERS: Record<string, () => JSX.Element> = {
  "armchair-her": ArmchairHer,
  "armchair-cognac": ArmchairCognac,
  "record-player": RecordPlayer,
  "side-table": SideTable,
  "floor-lamp": FloorLamp,
  "book-stack": BookStack,
  plant: Plant,
  mug: Mug,
  blanket: Blanket,
  headphones: Headphones,
  "shelf-progress": ShelfProgress,
};

function FallbackCrate() {
  return (
    <mesh castShadow receiveShadow position={[0, 0.15, 0]}>
      <boxGeometry args={[0.3, 0.3, 0.3]} />
      <meshStandardMaterial color="#6b5138" roughness={0.9} />
    </mesh>
  );
}

export function RoomObjectMesh({ obj }: { obj: RoomObject }) {
  if (obj.kind === "frame") return <FrameMesh media={obj.media} />;
  if (obj.kind === "screen") return <ScreenMesh media={obj.media} />;
  const Builder = BUILDERS[obj.kind] ?? FallbackCrate;
  return <Builder />;
}
