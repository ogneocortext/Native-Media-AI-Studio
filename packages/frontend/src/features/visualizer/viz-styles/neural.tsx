import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";
import {
  makeAudioReactiveMaterialTSL,
  updateAudioReactiveMaterialTSL,
} from "../VisualizationFX";
import { setPositionAttribute, useDisposeOnUnmount } from "./helpers";

/** Link radius (world units) for the connection graph. */
const LINK_RANGE = 2.8;
const LINK_RANGE_SQ = LINK_RANGE * LINK_RANGE;

// =============================================================================
// NEURAL — Network nodes with connection lines, dramatic audio reactivity
// =============================================================================
export function FrequencyRings({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
  stems,
  audioElapsedRef,
}: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const nodeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lineRef = useRef<THREE.LineSegments>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const nodeCount = 48;
  const rotRef = useRef(0);
  const beatPulse = useRef(0);
  const stemEnergyRef = useRef({ vocals: 0, drums: 0, bass: 0, other: 0 });

  const { gl } = useThree();
  const isWebGPU = (gl as any)?.isWebGPURenderer === true;

  const nodeMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#06b6d4",
            emissive: "#6366f1",
            opacity: 0.95,
            roughness: 0.1,
            metalness: 0.8,
          })
        : null,
    [isWebGPU],
  );

  const shockMat = useMemo(
    () =>
      isWebGPU
        ? makeAudioReactiveMaterialTSL({
            color: "#a855f7",
            emissive: "#7c3aed",
            opacity: 0.4,
            roughness: 0.2,
            metalness: 0.1,
          })
        : null,
    [isWebGPU],
  );

  const nodePos = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const r = 1.2 + Math.random() * 2;
      arr.push(
        new THREE.Vector3(
          r * Math.sin(ph) * Math.cos(th),
          r * Math.sin(ph) * Math.sin(th),
          r * Math.cos(ph),
        ),
      );
    }
    return arr;
  }, []);

  // Preallocated link vertex buffer (nodeCount choose 2 pairs × 2 verts × xyz).
  // Rebuilt in place every frame: allocating a fresh Float32BufferAttribute per
  // frame orphaned a GPU buffer every 16 ms (three's attribute cache is a
  // WeakMap, so those buffers were never deleted).
  const maxLinkVerts = (nodeCount * (nodeCount - 1)) / 2 * 2;
  const linkPositions = useMemo(
    () => new Float32Array(maxLinkVerts * 3),
    [maxLinkVerts],
  );

  useDisposeOnUnmount(nodeMat, shockMat);

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    // Map stems to visual channels: bass → camera shake/rotation, drums → pulse,
    // vocals → color shift, other → palette modulation.
    if (stems) {
      const el = (audioElapsedRef?.current ?? 0);
      const dur = stems.drums.duration || 1;
      const idx = Math.min(stems.drums.energy_curve.length - 1, Math.max(0, Math.floor((el / dur) * stems.drums.energy_curve.length)));
      stemEnergyRef.current = {
        vocals: stems.vocals.energy_curve[idx] ?? 0,
        drums: stems.drums.energy_curve[idx] ?? 0,
        bass: stems.bass.energy_curve[idx] ?? 0,
        other: stems.other.energy_curve[idx] ?? 0,
      };
    }

    // Get track features (computed once per frame, shared across all visualizations)
    const features = getTrackFeatures();

    if (beat || features.onset > 0.5 || stemEnergyRef.current.drums > 0.6) beatPulse.current = 1.0;
    beatPulse.current *= 0.88;
    if (!sceneFrozen)
      rotRef.current +=
        0.004 * vizParams.rotationSpeed * speedMul * (1 + features.energy * 2 + stemEnergyRef.current.bass * 0.4);

    nodeRefs.current.forEach((node, i) => {
      if (!node) return;
      const b = nodePos[i];
      // Dramatic position oscillation driven by frequency bands + track energy + bass stem shake
      const freq = i % 3 === 0 ? bass : i % 3 === 1 ? mid : treble;
      const shake = stemEnergyRef.current.bass * 0.35;
      const oscillation =
        0.3 + freq * 1.2 + beatPulse.current * 0.5 + features.energy * 0.4 + shake;
      node.position.set(
        b.x + Math.sin(t * 3 * speedMul + i * 0.7) * oscillation,
        b.y + Math.cos(t * 2.5 * speedMul + i * 0.5) * oscillation,
        b.z + Math.sin(t * 2 * speedMul + i * 0.3) * oscillation,
      );
      // Scale pulses dramatically on beats + onset
      const baseScale = 0.06 + freq * 0.15;
      const beatScale = beatPulse.current * 0.4 + features.onset * 0.3 + stemEnergyRef.current.drums * 0.2;
      node.scale.setScalar(baseScale + beatScale);
      if (isWebGPU && nodeMat) {
        updateAudioReactiveMaterialTSL(
          nodeMat,
          { bass, mid, treble, energy: 0.5 },
          vizParams.glowIntensity,
        );
      } else {
        const m = node.material as THREE.MeshStandardMaterial;
        // Emissive flashes on beat + onset
        m.emissiveIntensity =
          0.3 +
          freq * vizParams.glowIntensity * 3 +
          beatPulse.current * 2 +
          features.onset * 2.5 +
          stemEnergyRef.current.drums * 1.5;
        // Color shifts with spectral brightness + vocal stem hue shift
        m.color.setHSL(
          0.55 + freq * 0.3 + beatPulse.current * 0.1 + features.brightness * 0.2 + stemEnergyRef.current.vocals * 0.12,
          0.9,
          0.5 + features.brightness * 0.2 + stemEnergyRef.current.other * 0.1,
        );
        m.emissive.setHSL(
          0.6 + freq * 0.2 + features.brightness * 0.15 + stemEnergyRef.current.vocals * 0.08,
          1.0,
          0.4 + beatPulse.current * 0.4,
        );
      }
    });

    // Connection lines with dynamic opacity.
    // Distances are measured between the *animated* node positions, not the
    // static spawn positions — otherwise links were drawn between nodes that
    // had drifted apart (and missed pairs that had drifted together).
    if (lineRef.current) {
      const nodes = nodeRefs.current;
      let vertex = 0;
      for (let i = 0; i < nodeCount; i++) {
        const ni = nodes[i];
        if (!ni) continue;
        const a = ni.position;
        for (let j = i + 1; j < nodeCount; j++) {
          const nj = nodes[j];
          if (!nj) continue;
          const b = nj.position;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dz = a.z - b.z;
          if (dx * dx + dy * dy + dz * dz > LINK_RANGE_SQ) continue;
          const o = vertex * 3;
          linkPositions[o] = a.x;
          linkPositions[o + 1] = a.y;
          linkPositions[o + 2] = a.z;
          linkPositions[o + 3] = b.x;
          linkPositions[o + 4] = b.y;
          linkPositions[o + 5] = b.z;
          vertex += 2;
        }
      }
      setPositionAttribute(lineRef.current.geometry, linkPositions, vertex);
      (lineRef.current.material as THREE.LineBasicMaterial).opacity =
        0.1 + features.brightness * 0.5 + beatPulse.current * 0.3 + stemEnergyRef.current.other * 0.2;
    }

    // Shockwave ring expands from center on beat
    if (shockRef.current) {
      const sScale = 0.3 + beatPulse.current * 4 + stemEnergyRef.current.bass * 0.5;
      shockRef.current.scale.setScalar(sScale);
      if (isWebGPU && shockMat) {
        updateAudioReactiveMaterialTSL(shockMat, { bass, mid, treble, energy: 0.5 }, vizParams.glowIntensity);
      } else {
        const sm = shockRef.current.material as THREE.MeshStandardMaterial;
        sm.opacity = (1 - beatPulse.current) * 0.4 + stemEnergyRef.current.drums * 0.2;
        sm.emissiveIntensity = (1 - beatPulse.current) * 3 + stemEnergyRef.current.drums * 2;
      }
    }

    groupRef.current.rotation.y = rotRef.current;
    groupRef.current.rotation.x = Math.sin(t * 0.2 * speedMul) * 0.1 * mid + stemEnergyRef.current.bass * 0.05;
  });

  return (
    <group ref={groupRef}>
      <lineSegments ref={lineRef}>
        <bufferGeometry />
        <lineBasicMaterial color="#818cf8" transparent opacity={0.25} />
      </lineSegments>
      {nodePos.map((_, i: number) => (
        <mesh
          key={i}
          ref={(el) => {
            nodeRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.1, 16, 16]} />
          {isWebGPU && nodeMat ? (
            <primitive object={nodeMat} attach="material" />
          ) : (
            <meshStandardMaterial
              color="#06b6d4"
              emissive="#6366f1"
              emissiveIntensity={0.6}
              roughness={0.1}
              metalness={0.95}
            />
          )}
        </mesh>
      ))}
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.98, 1.0, 64]} />
        {isWebGPU && shockMat ? (
          <primitive object={shockMat} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#a855f7"
            emissive="#7c3aed"
            emissiveIntensity={2}
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        )}
      </mesh>
    </group>
  );
}
