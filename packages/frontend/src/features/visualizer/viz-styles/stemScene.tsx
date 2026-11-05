import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getStemEnergy, useDisposeOnUnmount } from "./helpers";
import { beatSnap } from "./vizMotion";

// =============================================================================
// STEM SCENE (T-VIZ-22) — one visual agent per stem.
//
//   drums  → percussive blocks in an arc, striking on drum energy + onset
//   bass   → heavy ground mass heaving under the scene
//   vocals → central form breathing at the focus point
//   other  → atmosphere ring drifting at the edges
//
// Energies come from getStemEnergy(stems, elapsed) — the same precomputed
// per-stem curves instancedParticles/aurora/cosmic already consume. When the
// track has no stem analysis the agents degrade to the mixed-signal split
// (bass/mid/treble) rather than rendering an empty scene. All animation runs
// through refs in a single useFrame — no per-frame React state.
// =============================================================================

const DRUM_COUNT = 24;

export function StemScene({
  audioData,
  vizParams,
  audioElapsedRef,
  sceneFrozen,
  prefersReducedMotion,
  stems,
}: VizProps) {
  const bassRef = useRef<THREE.Mesh>(null);
  const vocalRef = useRef<THREE.Mesh>(null);
  const vocalWireRef = useRef<THREE.Mesh>(null);
  const otherRef = useRef<THREE.Group>(null);
  const drumsRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const mats = useMemo(
    () => ({
      bass: new THREE.MeshStandardMaterial({
        color: "#1e293b",
        roughness: 0.85,
        metalness: 0.25,
        emissive: new THREE.Color("#7c3aed"),
        emissiveIntensity: 0.15,
      }),
      vocal: new THREE.MeshStandardMaterial({
        color: "#f8fafc",
        roughness: 0.35,
        metalness: 0.1,
        emissive: new THREE.Color("#38bdf8"),
        emissiveIntensity: 0.35,
      }),
      drum: new THREE.MeshStandardMaterial({
        color: "#f97316",
        roughness: 0.5,
        metalness: 0.3,
        emissive: new THREE.Color("#f97316"),
        emissiveIntensity: 0.4,
      }),
      other: new THREE.MeshBasicMaterial({
        color: "#34d399",
        transparent: true,
        opacity: 0.35,
        wireframe: true,
      }),
    }),
    [],
  );
  useDisposeOnUnmount(mats.bass, mats.vocal, mats.drum, mats.other);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const d = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    const elapsed = audioElapsedRef?.current ?? 0;

    // Per-stem energies; absent stems degrade to the mixed-signal split so the
    // scene is never empty on an unseparated track.
    const stem = getStemEnergy(stems, elapsed);
    const hasStems =
      stems != null &&
      (stems.vocals ?? stems.drums ?? stems.bass ?? stems.other) != null;
    const eDrums = hasStems ? stem.drums : Math.min(1, d.treble * 0.8 + d.energy * 0.3);
    const eBass = hasStems ? stem.bass : d.bass;
    const eVocals = hasStems ? stem.vocals : d.mid;
    const eOther = hasStems ? stem.other : d.energy * 0.6;
    const onset = d.onset ?? 0;
    const snap = d.beatPhase != null ? beatSnap(d.beatPhase) : 0;

    // ── Bass: ground mass heaving ─────────────────────────────────────────
    if (bassRef.current) {
      const heave = 1 + eBass * 0.55 + onset * 0.15;
      bassRef.current.scale.set(1 + eBass * 0.15, heave * 0.55, 1 + eBass * 0.15);
      bassRef.current.position.y = -1.6 + eBass * 0.25;
      if (!sceneFrozen) bassRef.current.rotation.y = t * 0.05 * speedMul;
      mats.bass.emissiveIntensity = 0.1 + eBass * 0.5 + snap * 0.15;
    }

    // ── Vocals: central form breathing at the focus point ─────────────────
    if (vocalRef.current) {
      const breath = 1 + eVocals * 0.3 + snap * 0.05;
      vocalRef.current.scale.setScalar(breath * (1 + d.energy * 0.08));
      if (!sceneFrozen) {
        vocalRef.current.rotation.y = t * 0.12 * vizParams.rotationSpeed * speedMul;
        vocalRef.current.rotation.x = Math.sin(t * 0.2 * speedMul) * 0.15 * eVocals;
      }
      mats.vocal.emissiveIntensity = 0.2 + eVocals * 0.7;
    }
    if (vocalWireRef.current) {
      vocalWireRef.current.scale.copy(vocalRef.current?.scale ?? vocalWireRef.current.scale);
      vocalWireRef.current.rotation.copy(vocalRef.current?.rotation ?? vocalWireRef.current.rotation);
    }

    // ── Drums: percussive blocks striking in a staggered arc ──────────────
    const drums = drumsRef.current;
    if (drums) {
      const strike = Math.min(1, eDrums * 0.7 + onset * 0.9);
      for (let i = 0; i < DRUM_COUNT; i++) {
        const frac = i / DRUM_COUNT;
        const angle = (frac - 0.5) * Math.PI * 1.2;
        const radius = 2.4 + Math.sin(frac * Math.PI) * 0.4;
        const x = Math.sin(angle) * radius;
        const z = -Math.cos(angle) * radius * 0.6 - 0.6;
        // Staggered strike wave across the arc, quantised to the beat grid.
        const wave = (snap + frac * 0.15) % 1;
        const lift = Math.max(0, 1 - wave * 6) * strike;
        dummy.position.set(x, -0.4 + lift * 0.9, z);
        const s = 0.08 + strike * 0.05;
        dummy.scale.set(s, s * (1 + lift * 2.2), s);
        dummy.rotation.set(0, angle, 0);
        dummy.updateMatrix();
        drums.setMatrixAt(i, dummy.matrix);
      }
      drums.instanceMatrix.needsUpdate = true;
      mats.drum.emissiveIntensity = 0.3 + strike * 0.8;
    }

    // ── Other: atmosphere ring drifting at the edges ──────────────────────
    if (otherRef.current) {
      otherRef.current.rotation.y = sceneFrozen
        ? otherRef.current.rotation.y
        : t * 0.03 * vizParams.rotationSpeed * speedMul;
      otherRef.current.rotation.x = Math.sin(t * 0.11 * speedMul) * 0.2;
      const s = 1 + eOther * 0.25;
      otherRef.current.scale.setScalar(s);
      mats.other.opacity = 0.2 + eOther * 0.3;
    }
  });

  return (
    <group>
      {/* Bass — ground mass */}
      <mesh ref={bassRef} position={[0, -1.6, 0.4]} material={mats.bass}>
        <icosahedronGeometry args={[1.5, 1]} />
      </mesh>

      {/* Vocals — central form + wire shell */}
      <mesh ref={vocalRef} position={[0, 0.4, 0]} material={mats.vocal}>
        <torusKnotGeometry args={[0.55, 0.18, 96, 16]} />
      </mesh>
      <mesh ref={vocalWireRef} position={[0, 0.4, 0]} material={mats.other}>
        <torusKnotGeometry args={[0.85, 0.1, 64, 8]} />
      </mesh>

      {/* Drums — instanced percussive blocks (one draw call) */}
      <instancedMesh
        ref={drumsRef}
        args={[undefined, undefined, DRUM_COUNT]}
        material={mats.drum}
        frustumCulled={false}
      >
        <boxGeometry args={[0.16, 0.3, 0.16]} />
      </instancedMesh>

      {/* Other — atmosphere ring */}
      <group ref={otherRef} position={[0, 0.2, -2.2]}>
        <mesh material={mats.other}>
          <icosahedronGeometry args={[2.6, 1]} />
        </mesh>
        <mesh material={mats.other} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[3.1, 0.015, 8, 96]} />
        </mesh>
      </group>
    </group>
  );
}
