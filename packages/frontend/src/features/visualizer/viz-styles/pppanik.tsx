/**
 * PPPANIK-style instanced blob field visualization.
 *
 * 30k–60k instanced tetrahedra on a Fibonacci shell. Audio drivers are written
 * into a ref each frame and read by InstancedBlobField's own useFrame (props
 * would freeze — R3F does not re-render per frame):
 * - bass        → radial displacement
 * - beat, or loud treble → decaying spore-ejection transient
 * - mid / treble → overall swell and fine shimmer
 * - transients  → per-instance colour-temperature shift
 *
 * Bands come from audioData.current, falling back to the analysed stem curves
 * when stems have not been separated. See docs/architecture/visualizer.md for
 * the audio-vs-idle rule.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { VizProps } from "./types";
import { getStemEnergy } from "./helpers";
import { InstancedBlobField, type BlobFieldDrivers } from "../components/InstancedBlobField";
import { beatSnap, rolloff } from "./vizMotion";

export function PpanikBlobField({
  stems,
  audioElapsedRef,
  audioData,
  sceneFrozen,
  prefersReducedMotion,
}: VizProps) {
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
  // Reused per-frame so getStemEnergy doesn't allocate a fresh record at 60 fps.
  const stemScratch = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  useFrame((_, delta) => {
    // Freeze holds the last drivers and transform — same contract as
    // every other style's `if (!sceneFrozen)` gate.
    if (!groupRef.current || sceneFrozen) return;
    const dt60 = Math.min(delta, 0.1) * 60;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    const elapsed = audioElapsedRef?.current ?? 0;
    const live = audioData.current;
    const stemEnergy = getStemEnergy(stems, elapsed, stemScratch.current);

    // Prefer the real spectral bands; fall back to analysed stem curves when
    // stems haven't been separated yet. Both are real audio — never a clock.
    const d = drivers.current;
    // Live spectral bands can be absent before the first analysis frame even
    // though the shared audio data type declares them required.
    const liveBands: { bass?: number; mid?: number; treble?: number } = live;
    d.bass = liveBands.bass ?? stemEnergy.bass;
    d.mid = liveBands.mid ?? stemEnergy.vocals;
    d.treble = liveBands.treble ?? stemEnergy.drums;
    d.beat = live.beat;
    d.beatPhase = live.beatPhase ?? 0;

    // Beat-quantized radial displacement (2026): the field
    // swells ON the grid, so the blob thumps with the kick
    // instead of breathing smoothly.
    const snap = beatSnap(d.beatPhase);
    // Rolloff-capped displacement so loud frames keep
    // blob detail instead of blowing out the shell.
    const displace = rolloff(d.bass * 0.3 + snap * 0.25, 1.0);

    // Scale the entire blob field with bass
    const bassScale = 1 + displace;
    groupRef.current.scale.setScalar(bassScale);

    // Rotate based on vocal/mid energy. dt-scaled — the old per-frame
    // increment spun twice as fast on a 120 Hz display.
    groupRef.current.rotation.y += (0.002 + stemEnergy.vocals * 0.01) * dt60 * speedMul;
    groupRef.current.rotation.x += (0.001 + stemEnergy.other * 0.005) * dt60 * speedMul;
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
        frozen={sceneFrozen ?? false}
        speedScale={prefersReducedMotion ? 0.35 : 1}
      />
    </group>
  );
}
