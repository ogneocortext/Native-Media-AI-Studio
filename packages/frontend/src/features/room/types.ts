/** The Room — shared state types (mirrors app/api/room.py + scoping doc §11). */

export type RoomActor = "maya" | "nate";
export type RoomOpKind = "move" | "swap" | "setLighting" | "place" | "remove";
export type RoomEventType =
  | "moved"
  | "swapped"
  | "lightingChanged"
  | "placed"
  | "removed";

export interface RoomObject {
  id: string;
  kind: string;
  position: [number, number, number];
  rotationY?: number;
  /** Private-media filename for frame/screen kinds; null = placeholder. */
  media?: string | null;
  [key: string]: unknown;
}

export interface RoomLighting {
  state?: string;
  [key: string]: unknown;
}

export interface RoomSnapshot {
  version: number;
  objects: Record<string, RoomObject>;
  lighting: RoomLighting;
}

export interface RoomEvent {
  type: RoomEventType;
  objectId: string;
  field?: string;
  value?: unknown;
  prevValue?: unknown;
  version: number;
  actor: RoomActor;
  ts: number;
  description: string;
}

export interface RoomOp {
  op: RoomOpKind;
  objectId: string;
  baseVersion: number;
  actor: RoomActor;
  ts: number;
  field?: string;
  value?: unknown;
  description?: string;
  sessionId?: string;
}

export interface PresenceEntry {
  state: string;
  lastActiveTs: number | null;
  lastSeenVersion: number | null;
}

export interface RoomPresence {
  actors: Record<RoomActor, PresenceEntry>;
  version: number;
}

/** Kinds the scene knows how to draw. Unknown kinds get a crate fallback. */
export const ROOM_KINDS = [
  "armchair-her",
  "armchair-cognac",
  "record-player",
  "side-table",
  "floor-lamp",
  "book-stack",
  "plant",
  "mug",
  "blanket",
  "headphones",
  "shelf-progress",
  "frame",
  "screen",
] as const;
