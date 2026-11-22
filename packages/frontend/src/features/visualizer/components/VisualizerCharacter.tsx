import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { getGLTFLoader } from "../../../utils/gltfLoader";
import type { AudioData } from "../types";

/**
 * VisualizerCharacter — the rigged hero_dj.glb (T-VIZ-55) as the 3D-lane
 * replacement for the 2D BuilderFigure silhouette.
 *
 * The GLB carries a 49-bone HouseRig skin and a single 4 s `idle` clip
 * that animates every joint, so audio offsets are applied *after*
 * `mixer.update()` each frame: the clip rewrites absolute pose, our
 * `rotateX/rotateZ` deltas compose on top for that frame only — no
 * accumulation, no fighting the animation.
 *
 * Reactivity stays subordinate to the idle performance (the environment
 * design rule: audio modulates the rig, never replaces it):
 *   - Hips/group: bass + beat-pulse bounce, slow energy-weighted sway
 *   - Spine/Head: section-energy lean, beat-synced nod
 *   - Arm.R: DJ-gesture lift on energy, extra punch on the beat
 * All offsets are zero under prefersReducedMotion and frozen under
 * sceneFrozen (the mixer itself pauses too).
 */

const CHARACTER_URL = "/models/characters/hero_dj.glb";
/** World-space height target — reads as a person next to the ~4 m stage kit. */
const TARGET_HEIGHT = 1.9;

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  /** Layer toggle — the same flag that gated BuilderFigure. */
  visible: boolean;
  prefersReducedMotion?: boolean;
  sceneFrozen?: boolean;
  /** World position of the feet. */
  position?: [number, number, number];
  rotationY?: number;
}

/** Bone names we offset — all confirmed animated by the idle clip.
 *  NOTE: GLTFLoader sanitizes node names for PropertyBinding (dots are
 *  track-path separators), so "Arm.L" arrives as "ArmL". */
const BONE_NAMES = ["Hips", "Spine", "Head", "ArmL", "ArmR", "ForeArmR"] as const;
type BoneName = (typeof BONE_NAMES)[number];

export function VisualizerCharacter({
  audioData,
  visible,
  prefersReducedMotion = false,
  sceneFrozen = false,
  // Right-third mark, feet above the bottom frame edge — the stage floor
  // sits at y=-3 which is the frame's lower border from the z=7 camera.
  position = [1.5, -1.7, 0.8],
  rotationY = -0.35,
}: Props) {
  const { gl, camera } = useThree();
  const loggedRef = useRef(false);
  const gltf = useLoader(getGLTFLoader(gl), CHARACTER_URL);
  const groupRef = useRef<THREE.Group>(null);
  const bonesRef = useRef<Partial<Record<BoneName, THREE.Object3D>>>({});
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const calmRef = useRef(prefersReducedMotion);
  calmRef.current = prefersReducedMotion;

  const model = useMemo(() => {
    // SkeletonUtils.clone (not Object3D.clone) — plain clone leaves the
    // SkinnedMesh bound to the source skeleton's bones, so the mixer would
    // animate orphaned joints while the mesh stays frozen in bind pose.
    const clone = cloneSkinned(gltf.scene);
    // The GLB ships a demo Floor plane as a second scene root — drop it so
    // it doesn't render (or skew the bounds) inside the viz stage. Removed
    // by name lookup, not inside traverse(): mutating children mid-traversal
    // corrupts the iterator and throws on the next sibling.
    clone.getObjectByName("Floor")?.removeFromParent();
    // Normalize height and rest the feet at local y=0, centered on XZ —
    // the source is authored in arbitrary Blender units.
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 1e-6) clone.scale.multiplyScalar(TARGET_HEIGHT / size.y);
    const box2 = new THREE.Box3().setFromObject(clone);
    const c = box2.getCenter(new THREE.Vector3());
    clone.position.set(-c.x, -box2.min.y, -c.z);

    const bones: Partial<Record<BoneName, THREE.Object3D>> = {};
    clone.traverse((o) => {
      if ((BONE_NAMES as readonly string[]).includes(o.name)) {
        bones[o.name as BoneName] = o;
      }
    });
    bonesRef.current = bones;
    if (import.meta.env.DEV) {
      const box = new THREE.Box3().setFromObject(clone);
      const size = box.getSize(new THREE.Vector3());
      const names: string[] = [];
      clone.traverse((o) => { if (/Arm|Hips|Spine|Head|ForeArm/.test(o.name)) names.push(o.name); });
      console.info(
        `[viz-character] loaded: ${Object.keys(bones).length}/${BONE_NAMES.length} bones [${Object.keys(bones).join(",")}], ` +
          `size=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}, ` +
          `meshes=${(() => { let n = 0; clone.traverse((o) => { if (o instanceof THREE.Mesh) n++; }); return n; })()}, ` +
          `all=[${names.join("|")}]`,
      );
    }
    return clone;
  }, [gltf]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find((a) => a.name === "idle");
    if (clip) mixer.clipAction(clip).play();
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      mixerRef.current = null;
    };
  }, [model, gltf]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const mixer = mixerRef.current;
    if (mixer && !sceneFrozen) mixer.update(dt);
    const group = groupRef.current;
    if (!group) return;

    if (import.meta.env.DEV && !loggedRef.current && visible) {
      loggedRef.current = true;
      group.updateMatrixWorld(true);
      const wb = new THREE.Box3().setFromObject(group);
      const c = wb.getCenter(new THREE.Vector3());
      const proj = c.clone().project(camera);
      console.info(
        `[viz-character] world center=(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}) ` +
          `size=${wb.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join("x")} ` +
          `ndc=(${proj.x.toFixed(2)},${proj.y.toFixed(2)},${proj.z.toFixed(2)})`,
      );
    }

    const d = audioData.current;
    const calm = calmRef.current;
    const energy = calm ? 0 : d.energy;
    const bass = calm ? 0 : d.bass;
    const mid = calm ? 0 : d.mid;

    // Beat-quantized strike-decay pulse — same idiom as vizMotion/BuilderFigure.
    const phase =
      typeof d.beatPhase === "number" && Number.isFinite(d.beatPhase)
        ? Math.min(1, Math.max(0, d.beatPhase))
        : 1;
    const pulse = calm ? 0 : Math.exp(-4 * phase);

    const t = performance.now() / 1000;

    // Group-level: kick bounce + slow weight-shift sway. Y stays above the
    // feet line — bass lifts, never plants through the floor.
    group.position.y = position[1] + bass * 0.045 + pulse * 0.035;
    group.rotation.z =
      Math.sin(t * Math.PI * 2 * 0.09) * (0.02 + energy * 0.035) +
      Math.sin(t * Math.PI * 2 * 0.23 + 1.1) * 0.008;
    group.rotation.x = energy * 0.02 + pulse * 0.015;

    // Bone offsets — post-mixer deltas, all zero when calm.
    const b = bonesRef.current;
    if (b.Hips) {
      b.Hips.rotateZ(Math.sin(t * Math.PI * 2 * 0.11) * 0.02 * (0.5 + energy));
    }
    if (b.Spine) {
      b.Spine.rotateX(energy * 0.05 + pulse * 0.04 + mid * 0.02);
    }
    if (b.Head) {
      // Nod dips forward on the beat, recovers through the interval.
      b.Head.rotateX(pulse * 0.1 - energy * 0.02);
    }
    if (b.ArmR) {
      // Right arm lifts with energy; beat adds a punch. DJ-gesture, not wave.
      b.ArmR.rotateX(-(energy * 0.18 + pulse * 0.22));
      b.ArmR.rotateZ(-energy * 0.06);
    }
    if (b.ArmL) {
      b.ArmL.rotateX(-(energy * 0.1 + pulse * 0.12));
    }
    if (b.ForeArmR) {
      b.ForeArmR.rotateX(-(energy * 0.12 + pulse * 0.15));
    }
  });

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, rotationY, 0]}
      visible={visible}
    >
      <primitive object={model} />
    </group>
  );
}
