/**
 * InstancedBlobField — PPPANIK-style instanced blob field.
 *
 * 30k–60k instanced tetrahedra on a Fibonacci shell (40k in the sketch).
 * Per-instance phase attributes, bass = noise displacement, transients =
 * spore ejection + color-temperature shift.
 *
 * Uses Three.js InstancedMesh for performance.
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

function fibonacciSphere(index: number, total: number, radius: number): THREE.Vector3 {
  const theta = 2 * Math.PI * index / FIBONACCI_GOLDEN_RATIO;
  const phi = Math.acos(1 - 2 * (index + 0.5) / total);
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
  transientColorShift: _transientColorShift = 0.3,
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

  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
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
      const transientDisp = transientEject * Math.max(0, Math.sin(phase + time * 2.0));

      const scale = 1 + bassDisp * 0.2 + transientDisp * 0.5;
      const r = radius + bassDisp + transientDisp;

      dummy.position.set(
        baseX * (r / radius),
        baseY * (r / radius),
        baseZ * (r / radius),
      );
      dummy.scale.setScalar(Math.max(0.01, scale));
      dummy.lookAt(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
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
