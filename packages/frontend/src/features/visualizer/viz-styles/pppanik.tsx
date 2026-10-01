/**
 * PPPANIK-style instanced blob field visualization.
 *
 * 30k–60k instanced tetrahedra on a Fibonacci shell, driven by audio:
 * - Bass → noise displacement
 * - Transients → spore ejection + color-temperature shift
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getStemEnergy } from "./helpers";
import { InstancedBlobField } from "../components/InstancedBlobField";

export function PpanikBlobField({ stems, audioElapsedRef }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    const elapsed = audioElapsedRef?.current ?? 0;

    const stemEnergy = getStemEnergy(stems, elapsed);

    // Scale the entire blob field with bass
    const bassScale = 1 + stemEnergy.bass * 0.5;
    groupRef.current.scale.setScalar(bassScale);

    // Rotate based on mid energy
    groupRef.current.rotation.y += 0.002 + stemEnergy.vocals * 0.01;
    groupRef.current.rotation.x += 0.001 + stemEnergy.other * 0.005;
  });

  return (
    <group ref={groupRef}>
      <InstancedBlobField
        count={40000}
        radius={2.5}
        bassDisplacement={0.3}
        transientEject={0.8}
        transientColorShift={0.3}
      />
    </group>
  );
}
