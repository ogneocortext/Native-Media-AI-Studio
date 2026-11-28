/**
 * State-driven object layer: renders every object in the room snapshot,
 * applies the dirty-set drag rule (scoping doc §12), and draws Maya's
 * presence marker at her seat (Q2 ruling — no avatar in v1).
 */

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";

import { useRoomStore } from "../roomStore";
import type { RoomObject } from "../types";
import { RoomObjectMesh } from "./objects";

/** Kinds that stand on the floor and may be dragged. Wall/tabletop items
 *  keep shared positions but aren't pointer-draggable in v1. */
const DRAGGABLE = new Set([
  "armchair-her",
  "armchair-cognac",
  "record-player",
  "side-table",
  "floor-lamp",
  "plant",
  "blanket",
]);

function DraggableObject({ obj }: { obj: RoomObject }) {
  const beginDrag = useRoomStore((s) => s.beginDrag);
  const updateDrag = useRoomStore((s) => s.updateDrag);
  const endDrag = useRoomStore((s) => s.endDrag);
  const cancelDrag = useRoomStore((s) => s.cancelDrag);
  const draggingId = useRoomStore((s) => s.draggingId);
  const { camera, gl } = useThree();
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hit = useRef(new THREE.Vector3());
  const dragging = draggingId === obj.id;

  const anchorY = obj.position[1];

  const screenToFloor = (e: ThreeEvent<PointerEvent>) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    plane.current.constant = -anchorY;
    return ray.ray.intersectPlane(plane.current, hit.current);
  };

  return (
    <group
      position={obj.position}
      rotation={[0, obj.rotationY ?? 0, 0]}
      onPointerDown={(e) => {
        if (!DRAGGABLE.has(obj.kind)) return;
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        beginDrag(obj.id);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        e.stopPropagation();
        if (screenToFloor(e)) {
          updateDrag(obj.id, [hit.current.x, anchorY, hit.current.z]);
        }
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        e.stopPropagation();
        void endDrag(obj.id);
      }}
      onPointerCancel={() => {
        if (dragging) cancelDrag(obj.id);
      }}
    >
      <RoomObjectMesh obj={obj} />
    </group>
  );
}

/** Maya's presence marker — a small floor ring at her seat whose glow
 *  follows her presence state. No body, no avatar (v1 ruling). */
function PresenceMarker() {
  const presence = useRoomStore((s) => s.presence);
  const state = useRoomStore((s) => s.state);
  const her = state?.objects["armchair-her"];
  const maya = presence?.maya.state ?? "away";

  const { color, intensity } = useMemo(() => {
    switch (maya) {
      case "present":
        return { color: "#ffd9a0", intensity: 1.5 };
      case "recently active":
        return { color: "#d8a86a", intensity: 0.9 };
      default:
        return { color: "#5a4a6a", intensity: 0.3 };
    }
  }, [maya]);

  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const m = ref.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = intensity * (0.85 + Math.sin(clock.elapsedTime * 1.7) * 0.15);
    }
  });

  if (!her) return null;
  // Marker sits just in front-left of her chair, on the rug.
  const [x, , z] = her.position;
  return (
    <group position={[x - 0.45, 0.012, z + 0.35]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ref}>
        <ringGeometry args={[0.09, 0.13, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={intensity}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export function RoomObjectsLayer() {
  const state = useRoomStore((s) => s.state);
  const objects = useMemo(
    () => Object.values(state?.objects ?? {}),
    [state?.objects],
  );
  return (
    <group>
      {objects.map((obj) => (
        <DraggableObject key={obj.id} obj={obj} />
      ))}
      <PresenceMarker />
    </group>
  );
}
