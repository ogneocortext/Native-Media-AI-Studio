import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { VizProps } from "./types";
import { getTrackFeatures } from "../trackFeatures";

// =============================================================================
// NEURAL — Network nodes with connection lines, dramatic audio reactivity
// =============================================================================
export function FrequencyRings({
  audioData,
  vizParams,
  sceneFrozen,
  prefersReducedMotion,
}: VizProps) {
  const groupRef = useRef<THREE.Group>(null);
  const nodeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lineRef = useRef<THREE.LineSegments>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const nodeCount = 48;
  const rotRef = useRef(0);
  const beatPulse = useRef(0);

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

  useFrame((s) => {
    if (!groupRef.current) return;
    const t = s.clock.elapsedTime;
    const { bass, mid, treble, beat } = audioData.current;
    const speedMul = prefersReducedMotion ? 0.35 : 1;

    // Get track features (computed once per frame, shared across all visualizations)
    const features = getTrackFeatures();

    if (beat || features.onset > 0.5) beatPulse.current = 1.0;
    beatPulse.current *= 0.88;
    if (!sceneFrozen)
      rotRef.current +=
        0.004 * vizParams.rotationSpeed * speedMul * (1 + features.energy * 2);

    nodeRefs.current.forEach((node, i) => {
      if (!node) return;
      const b = nodePos[i];
      // Dramatic position oscillation driven by frequency bands + track energy
      const freq = i % 3 === 0 ? bass : i % 3 === 1 ? mid : treble;
      const oscillation =
        0.3 + freq * 1.2 + beatPulse.current * 0.5 + features.energy * 0.4;
      node.position.set(
        b.x + Math.sin(t * 3 * speedMul + i * 0.7) * oscillation,
        b.y + Math.cos(t * 2.5 * speedMul + i * 0.5) * oscillation,
        b.z + Math.sin(t * 2 * speedMul + i * 0.3) * oscillation,
      );
      // Scale pulses dramatically on beats + onset
      const baseScale = 0.06 + freq * 0.15;
      const beatScale = beatPulse.current * 0.4 + features.onset * 0.3;
      node.scale.setScalar(baseScale + beatScale);
      const m = node.material as THREE.MeshStandardMaterial;
      // Emissive flashes on beat + onset
      m.emissiveIntensity =
        0.3 +
        freq * vizParams.glowIntensity * 3 +
        beatPulse.current * 2 +
        features.onset * 2.5;
      // Color shifts with spectral brightness from analysis
      m.color.setHSL(
        0.55 + freq * 0.3 + beatPulse.current * 0.1 + features.brightness * 0.2,
        0.9,
        0.5 + features.brightness * 0.2,
      );
      m.emissive.setHSL(
        0.6 + freq * 0.2 + features.brightness * 0.15,
        1.0,
        0.4 + beatPulse.current * 0.4,
      );
    });

    // Connection lines with dynamic opacity
    if (lineRef.current) {
      const pos: number[] = [];
      for (let i = 0; i < nodeCount; i++) {
        for (let j = i + 1; j < nodeCount; j++) {
          if (nodePos[i].distanceTo(nodePos[j]) < 2.8) {
            const ni = nodeRefs.current[i],
              nj = nodeRefs.current[j];
            if (ni && nj) {
              pos.push(
                ni.position.x,
                ni.position.y,
                ni.position.z,
                nj.position.x,
                nj.position.y,
                nj.position.z,
              );
            }
          }
        }
      }
      const geo = lineRef.current.geometry;
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.attributes.position.needsUpdate = true;
      (lineRef.current.material as THREE.LineBasicMaterial).opacity =
        0.1 + features.brightness * 0.5 + beatPulse.current * 0.3;
    }

    // Shockwave ring expands from center on beat
    if (shockRef.current) {
      const sScale = 0.3 + beatPulse.current * 4;
      shockRef.current.scale.setScalar(sScale);
      const sm = shockRef.current.material as THREE.MeshStandardMaterial;
      sm.opacity = (1 - beatPulse.current) * 0.4;
      sm.emissiveIntensity = (1 - beatPulse.current) * 3;
    }

    groupRef.current.rotation.y = rotRef.current;
    groupRef.current.rotation.x = Math.sin(t * 0.2 * speedMul) * 0.1 * mid;
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
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#6366f1"
            emissiveIntensity={0.6}
            roughness={0.1}
            metalness={0.95}
          />
        </mesh>
      ))}
      <mesh ref={shockRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.98, 1.0, 64]} />
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
      </mesh>
    </group>
  );
}
