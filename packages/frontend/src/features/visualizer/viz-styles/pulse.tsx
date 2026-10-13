import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { makeAudioReactiveMaterialTSL, updateAudioReactiveMaterialTSL } from "../VisualizationFX";
import { useDisposeOnUnmount, getStemEnergy } from "./helpers";
import { attackRelease, beatSnap, energyHue, gammaDrive, rolloff } from "./vizMotion";

// =============================================================================
// PULSE — Concentric rings emitting from center on beats
// =============================================================================
export function PulseRings({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringCount = 12;
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });
  const beatPulseRef = useRef(0);

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const ringMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#22d3ee",
            emissive: "#06b6d4",
            opacity: 0.55,
            roughness: 0.2,
            metalness: 0.7,
          })
        : null,
    [isWebGPU],
  );
  useDisposeOnUnmount(ringMat);

  useFrame((s, delta) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, beat, peak: beatPeak } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    const dt60 = Math.min(delta, 0.1) * 60;

    // Map stems to visual channels: drums → scale/pulse, other → palette shift
    stemEnergyRef.current = getStemEnergy(stems, audioElapsedRef?.current ?? 0);

    // Beat-quantized emission (2026): rings are born on the beat,
    // not continuously. The snap spikes the innermost ring on the
    // grid; the envelope carries the decay outward.
    const beatTarget = beat ? 1.0 : 0.0;
    beatPulseRef.current = attackRelease(beatPulseRef.current, beatTarget, 0.3, 0.9, dt60);
    const beatPulse = beatPulseRef.current;
    const snap =
      audioData.current.beatPhase != null
        ? beatSnap(audioData.current.beatPhase)
        : beatPulse;

    ringRefs.current.forEach((ring, i) => {
      if (!ring) return;
      const speed = 0.3 + i * 0.05;
      const offset = i * 0.08;
      const phase = (t * speed * speedMul + offset) % 1;
      const stemScale = 1 + stemEnergyRef.current.drums * 0.6;
      // Rings emit sharply on the beat, then drift out
      const emit = Math.max(0.1, phase * 8 * stemScale * (1 + snap * 0.6));
      ring.scale.setScalar(emit);
      if (isWebGPU && ringMat) {
        const glow = (1 - phase) * vizParams.glowIntensity * 2 * (1 + snap * 0.5);
        updateAudioReactiveMaterialTSL(ringMat, { bass, mid: 0, treble: 0, energy: 0.5 }, glow);
      } else {
        const m = ring.material as THREE.MeshStandardMaterial;
        m.opacity = (1 - phase) * (0.5 + bass * 0.4 + stemEnergyRef.current.drums * 0.3);
        m.emissiveIntensity =
          rolloff((1 - phase) * vizParams.glowIntensity * 2 + stemEnergyRef.current.drums, 1.0);
        // Energy-driven hue: cool at rest → warm when loud
        const hue = energyHue(bass * 0.5 + stemEnergyRef.current.other * 0.3) + bass * 0.3 + stemEnergyRef.current.other * 0.15;
        m.color.setHSL(hue, 0.8, 0.6);
      }
      if (beat && i === 0 && !isWebGPU) {
        const m = ring.material as THREE.MeshStandardMaterial;
        m.opacity = 0.9;
        m.emissiveIntensity = rolloff(2 + beatPeak * 3 + stemEnergyRef.current.drums * 2, 1.0);
      }
    });
    if (!sceneFrozen) groupRef.current.rotation.y = t * 0.02 * vizParams.rotationSpeed * speedMul;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: ringCount }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            ringRefs.current[i] = el;
          }}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.98, 1.0, 128]} />
          {isWebGPU && ringMat ? (
            <primitive object={ringMat} attach="material" />
          ) : (
            <meshStandardMaterial
              color={`hsl(${200 + i * 12},85%,60%)`}
              emissive={`hsl(${200 + i * 12},95%,50%)`}
              emissiveIntensity={0.5}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              roughness={0.2}
              metalness={0.8}
            />
          )}
        </mesh>
      ))}
    </group>
  );
}

// =============================================================================
// SPECTRUM — Circular frequency bars with HSL mapping
// =============================================================================
export function SpectrumBars({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
}: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const barRefs = useRef<(THREE.Mesh | null)[]>([]);
  const barCount = 48;
  const rotRef = useRef(0);
  // Per-bar smoothed height for attack/release (2026): raw
  // frequency data is jittery; a smoothed height reads as
  // fluid energy instead of noise.
  const smoothH = useRef<Float32Array>(new Float32Array(48));

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const barMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#818cf8",
            emissive: "#6366f1",
            opacity: 0.9,
            roughness: 0.18,
            metalness: 0.7,
          })
        : null,
    [isWebGPU],
  );
  useDisposeOnUnmount(barMat);

  useFrame((_s, delta) => {
    if (!groupRef.current) return;
    const { bass, mid, treble, peak, beatPhase } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;
    const dt60 = Math.min(delta, 0.1) * 60;
    // Beat-quantized height kick (2026): bars jump on the grid
    const snap = beatPhase != null ? beatSnap(beatPhase) : 0;
    if (!sceneFrozen) rotRef.current += 0.004 * vizParams.rotationSpeed * speedMul * (1 + peak + snap * 0.5);

    barRefs.current.forEach((bar, i) => {
      if (!bar) return;
      const freq = i < barCount * 0.25 ? bass : i < barCount * 0.6 ? mid : treble;
      // Attack/release smoothed height + beat-quantized kick
      const target = 0.1 + freq * 4.5 + snap * 0.8;
      const rate = target > smoothH.current[i] ? 0.4 : 0.82;
      smoothH.current[i] += (target - smoothH.current[i]) * (1 - Math.pow(rate, dt60));
      const h = Math.max(0.01, smoothH.current[i]);
      bar.scale.set(1, h, 1);
      bar.position.y = h / 2 - 1.5;
      if (isWebGPU && barMat) {
        updateAudioReactiveMaterialTSL(
          barMat,
          { bass, mid, treble, energy: 0.5 },
          vizParams.glowIntensity,
        );
      } else {
        const m = bar.material as THREE.MeshPhysicalMaterial;
        // Frequency-range color mapping (2026): bass → warm red,
        // mid → green, treble → blue. Reads the spectrum at a
        // glance instead of a uniform hue sweep.
        const hue = i < barCount * 0.25 ? 0.02 : i < barCount * 0.6 ? 0.33 : 0.58;
        m.color.setHSL(hue, 0.8, 0.5);
        m.emissive.setHSL(hue, 0.9, 0.2 + gammaDrive(freq) * 0.6);
        m.emissiveIntensity = 0.2 + rolloff(freq * vizParams.glowIntensity * 1.5, 1.0);
        m.roughness = 0.3;
        m.metalness = 0.7;
      }
    });
    groupRef.current.rotation.y = rotRef.current;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: barCount }).map((_, i) => {
        const a = (i / barCount) * Math.PI * 2;
        return (
          <mesh
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            position={[Math.cos(a) * 2, -1.5, Math.sin(a) * 2]}
            rotation={[0, -a, 0]}
          >
            <capsuleGeometry args={[0.045, 1, 4, 12]} />
            {isWebGPU && barMat ? (
              <primitive object={barMat} attach="material" />
            ) : (
              <meshPhysicalMaterial
                color={`hsl(${220 + i * 3},80%,55%)`}
                emissive={`hsl(${220 + i * 3},90%,45%)`}
                emissiveIntensity={0.3}
                roughness={0.18}
                metalness={0.85}
                clearcoat={1}
                clearcoatRoughness={0.15}
              />
            )}
          </mesh>
        );
      })}
    </group>
  );
}
