/**
 * Room shell — the architecture. 5.0 x 4.0 m, ceiling 2.7 (knowledge doc §4).
 * Walls have real thickness and jambs; the bookcase wall carries the ONE
 * arch motif behind her seat; window stays indigo night; ceiling unlit.
 */

import { useMemo } from "react";
import * as THREE from "three";

import { INDIGO } from "./objects";
import { useFloor, useNightWindow, usePlaster, useRug, useWalnut } from "./textures";

const WALL_H = 2.7;
const WALL_T = 0.2; // exterior thickness
const INNER_T = 0.12; // interior partition thickness

function useWoodMat(repeat = 1) {
  const maps = useWalnut(repeat);
  return useMemo(
    () => ({
      map: maps.map,
      normalMap: maps.normalMap,
      roughnessMap: maps.roughnessMap,
      aoMap: maps.aoMap,
      color: "#a08064",
    }),
    [maps],
  );
}

/** A wall segment: box with real thickness, plaster both faces. */
function Wall({
  position,
  size,
  rotationY = 0,
  plaster,
}: {
  position: [number, number, number];
  size: [number, number, number];
  rotationY?: number;
  plaster: THREE.Texture;
}) {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: plaster,
        roughness: 0.92,
        metalness: 0,
      }),
    [plaster],
  );
  // edges get a slightly darker plaster variation via vertex-free trick:
  // keep it simple — one material, AO does the grounding.
  return (
    <mesh position={position} rotation={[0, rotationY, 0]} material={mat} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** Deterministic PRNG so shelf dressing is stable across renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Five-color book palette — cream, walnut, indigo, plum + rare brass. */
const BOOK_COLORS = ["#e9dfc8", "#5C3D2E", "#2a3054", "#4A3566", "#8a6a52"];
const BOOK_BRASS = "#B08D57";

/** A run of book spines filling ~66% of the shelf length, with small
 *  gaps and the occasional lean — the focal-wall density target. */
function BookRow({
  x0,
  x1,
  bottomY,
  z,
  seed,
}: {
  x0: number;
  x1: number;
  bottomY: number;
  z: number;
  seed: number;
}) {
  const books = useMemo(() => {
    const rnd = mulberry32(seed);
    const out: { dx: number; w: number; h: number; c: string; lean: number }[] = [];
    let x = x0 + 0.02;
    let covered = 0;
    const target = (x1 - x0) * 0.66;
    while (covered < target && x < x1 - 0.05) {
      const w = 0.024 + rnd() * 0.028;
      const h = 0.19 + rnd() * 0.11;
      const c =
        rnd() < 0.07 ? BOOK_BRASS : BOOK_COLORS[Math.floor(rnd() * BOOK_COLORS.length)];
      const lean = rnd() < 0.12 ? (rnd() - 0.5) * 0.3 : 0;
      out.push({ dx: x + w / 2, w, h, c, lean });
      covered += w;
      x += w + (rnd() < 0.72 ? 0.004 : 0.02 + rnd() * 0.035);
    }
    return out;
  }, [x0, x1, seed]);
  return (
    <group>
      {books.map((b, i) => (
        <mesh
          key={i}
          position={[b.dx, bottomY + b.h / 2, z]}
          rotation={[0, 0, b.lean]}
          castShadow
        >
          <boxGeometry args={[b.w, b.h, 0.16]} />
          <meshStandardMaterial color={b.c} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** One dressed bookcase pier: cornice, plinth, uprights, shelves, books. */
function PierBookcase({ x0, x1, seedBase }: { x0: number; x1: number; seedBase: number }) {
  const wood = useWoodMat(1);
  const ys = [0.42, 0.92, 1.42, 1.85];
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  return (
    <group>
      {/* cornice + plinth + uprights give the flat wall a case read */}
      <mesh position={[cx, 2.34, -1.9]} castShadow>
        <boxGeometry args={[w + 0.08, 0.07, 0.22]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      <mesh position={[cx, 0.07, -1.9]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.08, 0.14, 0.26]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {[x0 + 0.03, x1 - 0.03].map((x) => (
        <mesh key={x} position={[x, 1.36, -1.9]} castShadow>
          <boxGeometry args={[0.05, 2.62, 0.2]} />
          <meshStandardMaterial {...wood} />
        </mesh>
      ))}
      {ys.map((y, i) => (
        <group key={y}>
          <mesh position={[cx, y, -1.9]} castShadow receiveShadow>
            <boxGeometry args={[w - 0.04, 0.025, 0.2]} />
            <meshStandardMaterial {...wood} />
          </mesh>
          <BookRow
            x0={x0 + 0.06}
            x1={x1 - 0.06}
            bottomY={y + 0.013}
            z={-1.8}
            seed={seedBase + i * 13}
          />
        </group>
      ))}
    </group>
  );
}

/** Walnut bookcase wall on the north side with the single arch niche. */
function BookcaseWall() {
  const wood = useWoodMat(2);
  const indigo = useMemo(
    () => new THREE.MeshStandardMaterial({ color: INDIGO, roughness: 0.95 }),
    [],
  );
  // Wall runs x -2.3..0.9 on z=-2 (inner face -1.9). Arch niche centered x=-0.75.
  const SEG = [
    // [xCenter, width, height, yCenter]
    [-1.625, 1.35, WALL_H, WALL_H / 2], // left of niche
    [0.15, 1.5, WALL_H, WALL_H / 2], // right of niche
    [-0.75, 1.5, 0.85, 0.425], // below niche opening
    [-0.75, 1.5, 0.6, 2.4], // above niche opening (head 2.25 -> top 2.7)
  ];
  return (
    <group>
      {SEG.map(([x, w, h, y], i) => (
        <mesh key={i} position={[x, y, -1.94]} material={i === 2 || i === 3 ? indigo : undefined} castShadow receiveShadow>
          {i === 2 || i === 3 ? (
            <boxGeometry args={[w, h, INNER_T]} />
          ) : (
            <boxGeometry args={[w, h, INNER_T]} />
          )}
          {i !== 2 && i !== 3 ? <meshStandardMaterial {...wood} /> : null}
        </mesh>
      ))}
      {/* niche back panel — deep indigo */}
      <mesh position={[-0.75, 1.55, -2.02]} material={indigo} receiveShadow>
        <boxGeometry args={[1.5, 1.4, 0.04]} />
      </mesh>
      {/* arch trim — half-torus walnut around the niche opening */}
      <mesh position={[-0.75, 2.25, -1.88]} rotation={[0, 0, 0]} castShadow>
        <torusGeometry args={[0.75, 0.045, 10, 32, Math.PI]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* shelf boards inside the niche */}
      {[0.9, 1.35, 1.8].map((y) => (
        <mesh key={y} position={[-0.75, y, -1.93]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 0.025, 0.22]} />
          <meshStandardMaterial {...wood} />
        </mesh>
      ))}
      {/* books in the niche slot — the only stretch not backed by wall */}
      {[0.91, 1.36, 1.81].map((y, i) => (
        <BookRow key={y} x0={-0.92} x1={-0.62} bottomY={y} z={-1.85} seed={90 + i * 17} />
      ))}
      {/* dressed piers either side of the arch — the focal-wall density */}
      <PierBookcase x0={-2.22} x1={-1.62} seedBase={300} />
      <PierBookcase x0={-0.48} x1={0.85} seedBase={500} />
    </group>
  );
}

/** Window on the east wall — indigo night treatment. */
function NightWindow() {
  const night = useNightWindow();
  const wood = useWoodMat(1);
  const W = 1.2; // width along z
  const sill = 0.88;
  const head = 2.25;
  const h = head - sill;
  const z = 0.4;
  return (
    <group position={[2.5, 0, z]}>
      {/* opening: dark recess */}
      <mesh position={[-0.06, sill + h / 2, 0]}>
        <boxGeometry args={[0.12, h, W]} />
        <meshStandardMaterial color="#05060f" roughness={1} />
      </mesh>
      {/* night glass slightly proud of the recess */}
      <mesh position={[-0.1, sill + h / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[W - 0.1, h - 0.1]} />
        <meshStandardMaterial map={night} emissiveMap={night} emissive="#334" emissiveIntensity={0.35} roughness={0.15} metalness={0.4} />
      </mesh>
      {/* walnut frame + sill + jambs */}
      <mesh position={[-0.02, sill - 0.02, 0]} castShadow>
        <boxGeometry args={[0.1, 0.04, W + 0.12]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      <mesh position={[-0.02, head + 0.02, 0]}>
        <boxGeometry args={[0.1, 0.04, W + 0.12]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {[-W / 2, W / 2].map((zz) => (
        <mesh key={zz} position={[-0.02, sill + h / 2, zz]}>
          <boxGeometry args={[0.1, h, 0.04]} />
          <meshStandardMaterial {...wood} />
        </mesh>
      ))}
      {/* center mullion */}
      <mesh position={[-0.03, sill + h / 2, 0]}>
        <boxGeometry args={[0.06, h - 0.08, 0.03]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      <mesh position={[-0.03, sill + h / 2 + 0.35, 0]}>
        <boxGeometry args={[0.06, 0.03, W - 0.06]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* sill board inside */}
      <mesh position={[-0.16, sill - 0.03, 0]} castShadow>
        <boxGeometry args={[0.16, 0.04, W + 0.16]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* deep walnut sill stool inside */}
      <mesh position={[-0.34, sill - 0.12, 0]} castShadow>
        <boxGeometry args={[0.34, 0.05, W - 0.1]} />
        <meshStandardMaterial {...wood} />
      </mesh>
    </group>
  );
}

/** Door on the south wall, east of center — 0.90 x 2.10 with jambs. */
function Door() {
  const wood = useWoodMat(1);
  const x = 1.3;
  const z = 2.0; // inner face of south wall
  return (
    <group position={[x, 0, z]}>
      {/* recess */}
      <mesh position={[0, 1.05, -0.1]}>
        <boxGeometry args={[0.9, 2.1, 0.2]} />
        <meshStandardMaterial color="#171310" roughness={1} />
      </mesh>
      {/* door slab, slightly ajar look via offset */}
      <mesh position={[-0.05, 1.04, -0.16]} rotation={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[0.88, 2.08, 0.05]} />
        <meshStandardMaterial {...wood} />
      </mesh>
      {/* panels */}
      {[0.45, 1.35].map((y) => (
        <mesh key={y} position={[-0.05, y, -0.185]} rotation={[0, 0.06, 0]}>
          <boxGeometry args={[0.68, 0.72, 0.02]} />
          <meshStandardMaterial color="#3d2c1e" roughness={0.7} />
        </mesh>
      ))}
      {/* knob — brass */}
      <mesh position={[0.28, 1.02, -0.2]} rotation={[0, 0, Math.PI / 2]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial color="#B08D57" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* jambs */}
      {[-0.5, 0.5].map((dx) => (
        <mesh key={dx} position={[dx, 1.05, -0.05]} castShadow>
          <boxGeometry args={[0.08, 2.15, 0.24]} />
          <meshStandardMaterial {...wood} />
        </mesh>
      ))}
      <mesh position={[0, 2.12, -0.05]}>
        <boxGeometry args={[1.08, 0.08, 0.24]} />
        <meshStandardMaterial {...wood} />
      </mesh>
    </group>
  );
}

export function RoomShell() {
  const plaster = usePlaster();
  const floorMaps = useFloor(3);
  const rugTex = useRug();

  const floorMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: floorMaps.map,
        normalMap: floorMaps.normalMap,
        roughnessMap: floorMaps.roughnessMap,
        aoMap: floorMaps.aoMap,
        roughness: 0.6,
        metalness: 0.05,
        color: "#a68d68",
      }),
    [floorMaps],
  );

  const rugMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: rugTex,
        roughness: 0.98,
        color: "#b3a6cc",
      }),
    [rugTex],
  );

  const ceilMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: plaster,
        color: "#3a3630",
        roughness: 1,
      }),
    [plaster],
  );

  return (
    <group>
      {/* floor — herringbone parquet, extends under walls */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMat} receiveShadow>
        <planeGeometry args={[5.6, 4.6]} />
      </mesh>

      {/* rug 2.4 x 3.0 anchoring both seats' front legs */}
      <mesh position={[-0.1, 0.005, -0.25]} rotation={[-Math.PI / 2, 0, 0.06]} material={rugMat} receiveShadow>
        <planeGeometry args={[2.4, 3.0]} />
      </mesh>

      {/* north wall (bookcase side) — segments leave room for niche; the
          BookcaseWall draws its own face at z=-1.94; shell behind it */}
      <Wall position={[-0.7, WALL_H / 2, -2.1]} size={[5.6, WALL_H, WALL_T]} plaster={plaster} />
      {/* south wall with door opening handled by Door group */}
      <Wall position={[-0.35, WALL_H / 2, 2.1]} size={[4.3, WALL_H, WALL_T]} plaster={plaster} />
      <Wall position={[2.05, WALL_H / 2, 2.1]} size={[1.5, WALL_H, WALL_T]} plaster={plaster} />
      {/* west wall — rotated walls take size=[length, height, thickness]:
          local X is the length (maps to world Z after rotY), local Z the
          thickness (maps to world X). Getting this backwards stood the wall
          up as a fin across the room interior. */}
      <Wall position={[-2.6, WALL_H / 2, 0]} size={[4.6, WALL_H, WALL_T]} rotationY={Math.PI / 2} plaster={plaster} />
      {/* east wall — segments around the window opening (z 0.4 +/- 0.6) */}
      <Wall position={[2.6, WALL_H / 2, -1.15]} size={[1.7, WALL_H, WALL_T]} rotationY={Math.PI / 2} plaster={plaster} />
      <Wall position={[2.6, WALL_H / 2, 1.65]} size={[1.3, WALL_H, WALL_T]} rotationY={Math.PI / 2} plaster={plaster} />
      <Wall position={[2.6, 2.475, 0.4]} size={[1.3, 0.45, WALL_T]} rotationY={Math.PI / 2} plaster={plaster} />
      <Wall position={[2.6, 0.44, 0.4]} size={[1.3, 0.88, WALL_T]} rotationY={Math.PI / 2} plaster={plaster} />

      {/* ceiling — unlit, dark */}
      <mesh position={[0, WALL_H, 0]} rotation={[Math.PI / 2, 0, 0]} material={ceilMat}>
        <planeGeometry args={[5.6, 4.6]} />
      </mesh>

      {/* skirting boards 0.12 x 0.018 */}
      {[
        { p: [0, 0.06, -1.97] as const, s: [4.9, 0.12, 0.018] as const, r: 0 },
        { p: [0, 0.06, 1.97] as const, s: [4.9, 0.12, 0.018] as const, r: 0 },
        { p: [-2.47, 0.06, 0] as const, s: [0.018, 0.12, 3.9] as const, r: 0 },
        { p: [2.47, 0.06, 0] as const, s: [0.018, 0.12, 3.9] as const, r: 0 },
      ].map((k, i) => (
        <mesh key={i} position={k.p as unknown as [number, number, number]} rotation={[0, k.r, 0]} castShadow>
          <boxGeometry args={k.s as unknown as [number, number, number]} />
          <meshStandardMaterial color="#d9cdb4" roughness={0.8} />
        </mesh>
      ))}

      <BookcaseWall />
      <NightWindow />
      <Door />
    </group>
  );
}
