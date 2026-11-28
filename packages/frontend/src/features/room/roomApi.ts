/** Room API client — snapshot, ops, replay, presence. No polling anywhere. */

import type {
  PresenceEntry,
  RoomEvent,
  RoomOp,
  RoomPresence,
  RoomSnapshot,
} from "./types";

const BASE = "";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(`room api ${path} -> ${res.status}`) as Error & {
      status?: number;
      body?: unknown;
    };
    err.status = res.status;
    err.body = detail;
    throw err;
  }
  return (await res.json()) as T;
}

export async function fetchRoomState(): Promise<RoomSnapshot> {
  return jsonFetch<RoomSnapshot>("/api/room/state");
}

export interface OpAccepted {
  applied: boolean;
  version: number;
  event: RoomEvent;
}

/** Returns the parsed body on 2xx; throws {status, body} otherwise (409 carries current state). */
export async function submitRoomOp(op: RoomOp): Promise<OpAccepted> {
  const res = await fetch(`${BASE}/api/room/op`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(`room op -> ${res.status}`) as Error & {
      status?: number;
      body?: unknown;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as unknown as OpAccepted;
}

export interface ReplayResult {
  actor: string;
  since: number;
  currentVersion: number;
  lastSeenVersion: number;
  events: RoomEvent[];
}

export async function fetchReplay(actor: string, since: number): Promise<ReplayResult> {
  return jsonFetch<ReplayResult>(
    `/api/room/replay?actor=${encodeURIComponent(actor)}&since=${since}`,
  );
}

export async function fetchPresence(): Promise<RoomPresence> {
  return jsonFetch<RoomPresence>("/api/room/presence");
}

export function roomMediaUrl(filename: string): string {
  return `${BASE}/api/room/media/${encodeURIComponent(filename)}`;
}

export { PresenceEntry };
