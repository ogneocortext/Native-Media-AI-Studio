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
import { InstancedBlobField, type BlobFieldDrivers } from "../components/InstancedBlobField";

export function PpanikBlobField({ stems, audioElapsedRef, audioData }: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  /**
   * Live driver values. This ref is read by InstancedBlobField inside its own
   * useFrame — deliberately NOT passed as props, which would freeze them at
   * whatever React last rendered (R3F does not re-render per frame).
   */
  const drivers = useRef<BlobFieldDrivers>({
    bass: 0,
    mid: 0,
    treble: 0,
    beat: false,
    beatPhase: 0,
  });

  useFrame(() => {
    if (!groupRef.current) return;
    const elapsed = audioElapsedRef?.current ?? 0;
    const live = audioData?.current;
    const stemEnergy = getStemEnergy(stems, elapsed);

    // Prefer the real spectral bands; fall back to analysed stem curves when
    // stems haven't been separated yet. Both are real audio — never a clock.
    const d = drivers.current;
    d.bass = live?.bass ?? stemEnergy.bass;
    d.mid = live?.mid ?? stemEnergy.vocals;
    d.treble = live?.treble ?? stemEnergy.drums;
    d.beat = live?.beat ?? false;
    d.beatPhase = live?.beatPhase ?? 0;

    // Scale the entire blob field with bass
    const bassScale = 1 + d.bass * 0.5;
    groupRef.current.scale.setScalar(bassScale);

    // Rotate based on vocal/mid energy
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
        drivers={drivers}
      />
    </group>
  );
}
