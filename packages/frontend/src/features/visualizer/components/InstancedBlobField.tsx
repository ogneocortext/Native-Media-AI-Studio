/**
 * InstancedBlobField — PPPANIK-style instanced blob field.
 *
 * 30k–60k instanced tetrahedra on a Fibonacci shell (40k in the sketch).
 * Per-instance phase attributes, bass = noise displacement, transients =
 * spore ejection + color-temperature shift.
 *
 * Uses Three.js InstancedMesh for performance. Colors are written per instance
 * via `setColorAt`, so the field reads cold blue → magenta across the phase
 * range and flashes hot on transients (per the PPPANIK fragment shader).
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

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

  useFrame((_frame) => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    const time = performance.now() * 0.001;

    for (let i = 0; i < count; i++) {
      const baseX = basePositions[i * 3];
      const baseY = basePositions[i * 3 + 1];
      const baseZ = basePositions[i * 3 + 2];

      const phase = phases[i];
      const noise = Math.sin(phase + time * 0.5) * Math.cos(phase * 1.3 + time * 0.3);

      // Bass-driven radial displacement
      const bassDisp = bassDisplacement * noise;

      // Transient spore ejection (along normal = radial direction)
      const transientNorm = Math.max(0, Math.sin(phase + time * 2.0));
      const transientDisp = transientEject * transientNorm;

      const scale = 1 + bassDisp * 0.2 + transientDisp * 0.5;
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
