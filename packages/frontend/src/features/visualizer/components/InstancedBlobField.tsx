/**
 * InstancedBlobField — PPPANIK-style instanced blob field.
 *
 * 30k–60k instanced tetrahedra on a Fibonacci shell (40k in the sketch).
 * All motion is driven by live audio:
 * - Bass → radial displacement
 * - Beats / loud treble → decaying spore-ejection transient
 * - Mid → overall swell, treble → fine shimmer
 * - Transients → color-temperature shift
 *
 * With no audio the field shows a gentle `idlePreview` shimmer so the style is
 * visible before playback, which fades out as soon as real audio energy arrives.
 *
 * Uses Three.js InstancedMesh for performance. Colors are written per instance
 * via `setColorAt`, so the field reads cold blue → magenta across the phase
 * range and flashes hot on transients (per the PPPANIK fragment shader).
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Live audio drivers, written every frame by the owning style's `useFrame` and
 * read here. Passed as a ref, not spread as props: R3F does not re-render per
 * frame, so props would freeze at the values from the last React render.
 */
export interface BlobFieldDrivers {
  bass: number;
  mid: number;
  treble: number;
  beat: boolean;
  /** Musical position in [0, 1) from `audioData.beatPhase`; undefined = no grid. */
  beatPhase?: number;
}

export interface InstancedBlobFieldProps {
  /** Instance count (default 40000). */
  count?: number;
  /** Shell radius (default 2.5). */
  radius?: number;
  /** Bass-driven displacement scale (default 0.3). */
  bassDisplacement?: number;
  /** Transient ejection strength (default 0.8). */
  transientEject?: number;
  /** Color temperature shift on transient (default 0.3). */
  transientColorShift?: number;
  /**
   * Per-frame audio drivers. Every movement in the field comes from these.
   *
   * Optional: when absent, or while the audio is silent, the field falls back to
   * a gentle `idlePreview` shimmer so the style is still visible before playback
   * starts. Idle motion always fades out once real audio energy arrives, so it
   * can never mask or impersonate a real reaction.
   */
  drivers?: React.RefObject<BlobFieldDrivers>;
  /**
   * Amplitude of the pre-playback preview shimmer (default 0.35, 0 disables).
   * Blended out by real bass/mid/treble energy.
   */
  idlePreview?: number;
}

const FIBONACCI_GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

/** Base gradient endpoints, linear-space, from the PPPANIK fragment shader. */
const COLOR_COLD = new THREE.Color(0.05, 0.1, 0.3);
const COLOR_MAGENTA = new THREE.Color(0.8, 0.1, 0.4);
/** Transient flash tint: hot orange. */
const COLOR_TRANSIENT = new THREE.Color(1.0, 0.6, 0.2);

// Reused across frames — allocating 40k Colors per frame would thrash the GC.
const scratchColor = new THREE.Color();

function fibonacciSphere(index: number, total: number, radius: number): THREE.Vector3 {
  const theta = (2 * Math.PI * index) / FIBONACCI_GOLDEN_RATIO;
  const phi = Math.acos(1 - (2 * (index + 0.5)) / total);
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.sin(phi) * Math.sin(theta);
  const z = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

export function InstancedBlobField({
  count = 40000,
  radius = 2.5,
  bassDisplacement = 0.3,
  transientEject = 0.8,
  transientColorShift = 0.3,
  drivers,
  idlePreview = 0.35,
}: InstancedBlobFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const phases = useMemo(() => {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = Math.random() * Math.PI * 2;
    }
    return arr;
  }, [count]);

  const basePositions = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const pos = fibonacciSphere(i, count, radius);
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
    }
    return positions;
  }, [count, radius]);

  /**
   * Resting colour per instance, spread across the cold→magenta gradient by
   * phase. Written once; the per-frame loop only adds the transient tint.
   */
  const baseColors = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.copy(COLOR_COLD).lerp(COLOR_MAGENTA, phases[i] / (Math.PI * 2));
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [count, phases]);

  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      // White base: MeshBasicMaterial multiplies material.color into the
      // per-instance color, so a non-white base would tint every instance.
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });
  }, []);

  /**
   * Decaying transient envelope, 0..1. Beat frames inject 1; each frame it
   * falls off, so a hit visibly throws the spores and they settle back rather
   * than switching on and off. This is what replaced the old `Math.sin`
   * "transient", which fired on a timer whether or not music was playing.
   */
  const transientEnv = useRef(0);
  /** Free-running phase used only when the backend supplies no beat grid. */
  const freePhase = useRef(0);

  useFrame((_frame, delta) => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    const dt = Math.min(0.1, delta); // clamp so a backgrounded tab can't spike the decay

    const d = drivers?.current;
    const bass = d?.bass ?? 0;
    const mid = d?.mid ?? 0;
    const treble = d?.treble ?? 0;

    // Beat → transient impulse. Also let loud treble re-trigger spore ejection,
    // so hats and cymbals read as transients too, not just the kick grid.
    if (d?.beat || treble > 0.82) transientEnv.current = 1;
    transientEnv.current = Math.max(0, transientEnv.current - dt * 3.2);

    // Idle preview: let the style be seen before playback, but fade it out in
    // proportion to real audio energy so it can never mask a real reaction.
    // `1 - maxBand` means silence previews fully and any real band cancels it.
    const realEnergy = Math.max(bass, mid, treble);
    const idleMix = idlePreview * Math.max(0, 1 - realEnergy * 1.6);

    // Prefer the analysed musical grid; fall back to a slow free phase so an
    // un-analysed track still has gentle motion instead of a dead field.
    let phase01 = d?.beatPhase;
    if (phase01 === undefined || !Number.isFinite(phase01)) {
      freePhase.current = (freePhase.current + dt * 0.25) % 1;
      phase01 = freePhase.current;
    }
    const gridPhase = phase01 * Math.PI * 2;

    for (let i = 0; i < count; i++) {
      const baseX = basePositions[i * 3];
      const baseY = basePositions[i * 3 + 1];
      const baseZ = basePositions[i * 3 + 2];

      const phase = phases[i];
      // Preview/idle shimmer. `idleMix` is ~0.35 while silent and ~0 the moment
      // real audio energy appears, so motion tracks the music rather than a clock.
      const shimmer = Math.sin(phase + gridPhase) * Math.cos(phase * 1.3 + gridPhase * 0.6);
      const idleDisp = idleMix;

      // Bass-driven radial displacement
      const bassDisp = (bassDisplacement * bass + idleDisp) * shimmer;

      // Transient spore ejection (along normal = radial direction). The envelope
      // is shared, but each instance's own phase staggers when it launches, so
      // the burst sweeps across the shell instead of moving as one block.
      const launch = Math.max(0, Math.sin(phase * 1.7 - gridPhase * 2.0));
      const transientNorm = transientEnv.current * launch;
      const transientDisp = transientEject * transientNorm;

      // Mid energy swells the overall scale; treble adds a fine shimmer scale.
      const midScale = mid * 0.25 * (0.5 + 0.5 * Math.sin(gridPhase * 2));
      const trebleScale = (treble + idleMix * 0.5) * 0.12 * shimmer;

      const scale = 1 + bassDisp * 0.2 + transientDisp * 0.5 + midScale + trebleScale;
      const r = radius + bassDisp + transientDisp;

      dummy.position.set(baseX * (r / radius), baseY * (r / radius), baseZ * (r / radius));
      dummy.scale.setScalar(Math.max(0.01, scale));
      dummy.lookAt(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color-temperature shift: lerp the instance's resting colour toward the
      // hot transient tint. Reuses `transientNorm` so colour and motion agree.
      // `setColorAt` lazily allocates `instanceColor`, so no pre-init needed.
      if (transientColorShift > 0) {
        scratchColor.setRGB(baseColors[i * 3], baseColors[i * 3 + 1], baseColors[i * 3 + 2]);
        scratchColor.lerp(COLOR_TRANSIENT, transientColorShift * transientNorm);
        mesh.setColorAt(i, scratchColor);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      material={material}
      frustumCulled={false}
    >
      <tetrahedronGeometry args={[0.03, 0]} />
    </instancedMesh>
  );
}
