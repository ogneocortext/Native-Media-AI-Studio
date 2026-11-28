/**
 * The Room — zustand store.
 *
 * Holds the server snapshot, the "since you were gone" diary feed, the
 * dirty-set used while dragging (scoping doc §12: the drag wins locally
 * until release; on release the op goes against the then-current version;
 * on 409 the fresh state is surfaced and the human chooses again — never
 * blindly re-applied), and per-actor presence.
 */

import { create } from "zustand";

import {
  fetchPresence,
  fetchReplay,
  fetchRoomState,
  submitRoomOp,
} from "./roomApi";
import type {
  PresenceEntry,
  RoomActor,
  RoomEvent,
  RoomObject,
  RoomOp,
  RoomSnapshot,
} from "./types";

const LAST_SEEN_KEY = (actor: RoomActor) => `room:lastSeenVersion:${actor}`;
const FEED_LIMIT = 60;

interface DirtyEntry {
  position: [number, number, number];
}

interface RoomStore {
  /** null until the first snapshot arrives. */
  state: RoomSnapshot | null;
  /** "since you were gone" diary lines, oldest first. */
  sinceYouWereGone: RoomEvent[];
  /** Rolling diary tail for the feed panel. */
  recentEvents: RoomEvent[];
  presence: Record<RoomActor, PresenceEntry> | null;
  connected: boolean;
  actor: RoomActor;
  /** Local drag overrides: objectId -> local transform. Rendered in place
   *  of server state until the op resolves (dirty-set rule). */
  dirty: Partial<Record<string, DirtyEntry>>;
  draggingId: string | null;
  controlsEnabled: boolean;
  /** Set when a submitted op came back 409 — carries the fresh state the
   *  human must choose against. */
  conflict: { message: string; version: number } | null;
  notice: string | null;

  bootstrap: () => Promise<void>;
  connectStream: () => () => void;
  setActor: (actor: RoomActor) => void;
  applyServerState: (snap: RoomSnapshot) => void;
  applyServerEvent: (event: RoomEvent) => void;
  beginDrag: (id: string) => void;
  updateDrag: (id: string, position: [number, number, number]) => void;
  endDrag: (id: string) => Promise<void>;
  cancelDrag: (id: string) => void;
  submitOp: (op: RoomOp) => Promise<boolean>;
  setLightingState: (lightingState: string) => Promise<void>;
  dismissConflict: () => void;
  dismissNotice: () => void;
  refreshPresence: () => Promise<void>;
}

function readLastSeen(actor: RoomActor): number {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY(actor));
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeLastSeen(actor: RoomActor, version: number): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY(actor), String(version));
  } catch {
    /* private mode etc. */
  }
}

/** Merge a server snapshot over local dirty entries (drag wins until release). */
function mergeSnapshot(
  _prev: RoomSnapshot | null,
  snap: RoomSnapshot,
  dirty: Partial<Record<string, DirtyEntry>>,
): RoomSnapshot {
  const objects: Record<string, RoomObject> = {};
  for (const [id, obj] of Object.entries(snap.objects)) {
    const d = dirty[id];
    objects[id] = d ? { ...obj, position: d.position } : obj;
  }
  // Objects that exist only locally mid-drag can't happen (drag requires a
  // server object), but keep any dirty id that vanished server-side out.
  return { ...snap, objects };
}

/** Index-signature lookups report RoomObject (never undefined); this helper
 *  keeps the honest "may be absent" type for drag guards. */
function roomObject(snap: RoomSnapshot, id: string): RoomObject | undefined {
  return snap.objects[id];
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  state: null,
  sinceYouWereGone: [],
  recentEvents: [],
  presence: null,
  connected: false,
  actor: "nate",
  dirty: {},
  draggingId: null,
  controlsEnabled: true,
  conflict: null,
  notice: null,

  bootstrap: async () => {
    const actor = get().actor;
    const [snap, presence] = await Promise.all([
      fetchRoomState(),
      fetchPresence().catch(() => null),
    ]);
    const since = readLastSeen(actor);
    let feed: RoomEvent[] = [];
    let lastSeen = snap.version;
    try {
      const replay = await fetchReplay(actor, since);
      feed = replay.events;
      lastSeen = replay.lastSeenVersion;
    } catch {
      /* replay is best-effort; the snapshot still renders */
    }
    writeLastSeen(actor, lastSeen);
    set((s) => ({
      state: mergeSnapshot(s.state, snap, s.dirty),
      presence: presence?.actors ?? s.presence,
      sinceYouWereGone: feed,
      recentEvents: [...s.recentEvents, ...feed].slice(-FEED_LIMIT),
    }));
  },

  connectStream: () => {
    const es = new EventSource("/api/room/stream");
    es.addEventListener("snapshot", (e) => {
      try {
        const snap = JSON.parse((e as MessageEvent<string>).data) as RoomSnapshot;
        set((s) => ({
          state: mergeSnapshot(s.state, snap, s.dirty),
          connected: true,
        }));
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener("event", (e) => {
      try {
        const event = JSON.parse((e as MessageEvent<string>).data) as RoomEvent;
        get().applyServerEvent(event);
        // Presence is event-driven (ops are the only activity), never polled.
        void get().refreshPresence();
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("state", (e) => {
      try {
        const snap = JSON.parse((e as MessageEvent<string>).data) as RoomSnapshot;
        set((s) => ({ state: mergeSnapshot(s.state, snap, s.dirty) }));
      } catch {
        /* ignore */
      }
    });
    es.onopen = () => set({ connected: true });
    es.onerror = () => set({ connected: false });
    return () => es.close();
  },

  setActor: (actor) => {
    set({ actor });
    writeLastSeen(actor, get().state?.version ?? 0);
    void get().bootstrap();
  },

  applyServerState: (snap) =>
    set((s) => ({ state: mergeSnapshot(s.state, snap, s.dirty) })),

  applyServerEvent: (event) =>
    set((s) => ({
      recentEvents: [...s.recentEvents, event].slice(-FEED_LIMIT),
    })),

  beginDrag: (id) =>
    set({ draggingId: id, controlsEnabled: false }),

  updateDrag: (id, position) => {
    // Drag plane is infinite; keep the object inside the room footprint.
    const clamped: [number, number, number] = [
      Math.min(2.3, Math.max(-2.3, position[0])),
      position[1],
      Math.min(1.9, Math.max(-1.9, position[2])),
    ];
    return set((s) => ({
      dirty: { ...s.dirty, [id]: { position: clamped } },
      // Keep merged state visually in sync while dragging.
      state: s.state
        ? {
            ...s.state,
            objects: {
              ...s.state.objects,
              ...(s.state.objects[id] as RoomObject | undefined
                ? { [id]: { ...s.state.objects[id], position: clamped } }
                : {}),
            },
          }
        : s.state,
    }));
  },

  endDrag: async (id) => {
    const s = get();
    const entry = s.dirty[id];
    const base = s.state;
    const serverObj = base ? roomObject(base, id) : undefined;
    set({ draggingId: null, controlsEnabled: true });
    if (!entry || !base || !serverObj) {
      set((st) => {
        const dirty = { ...st.dirty };
        delete dirty[id];
        return { dirty };
      });
      return;
    }
    const version = base.version;
    const ok = await get().submitOp({
      op: "move",
      objectId: id,
      baseVersion: version,
      actor: get().actor,
      ts: Date.now() / 1000,
      value: entry.position,
      description: `${get().actor === "maya" ? "Maya" : "Nate"} moved ${id}`,
    });
    // On 409 the fresh state already arrived via SSE/state message; the
    // conflict banner tells the human to choose again (never auto-reapply).
    if (!ok) {
      // keep dirty cleared; server state wins
    }
    set((st) => {
      const dirty = { ...st.dirty };
      delete dirty[id];
      return { dirty };
    });
  },

  cancelDrag: (id) =>
    set((s) => {
      const dirty = { ...s.dirty };
      delete dirty[id];
      // Restore server position for the object.
      const serverObj = s.state?.objects[id];
      const state =
        s.state && serverObj
          ? {
              ...s.state,
              objects: { ...s.state.objects, [id]: serverObj },
            }
          : s.state;
      return { dirty, state, draggingId: null, controlsEnabled: true };
    }),

  submitOp: async (op) => {
    try {
      const res = await submitRoomOp(op);
      if (res.applied) {
        get().applyServerEvent(res.event);
        return true;
      }
      return false;
    } catch (err) {
      const e = err as Error & { status?: number; body?: { currentVersion?: number } };
      if (e.status === 409) {
        set({
          conflict: {
            message: "The room changed while you were acting — review the fresh state and choose again.",
            version: e.body?.currentVersion ?? -1,
          },
        });
      } else {
        set({ notice: e.message });
      }
      return false;
    }
  },

  setLightingState: async (lightingState) => {
    const s = get();
    if (!s.state) return;
    await s.submitOp({
      op: "setLighting",
      objectId: "lighting",
      field: "state",
      baseVersion: s.state.version,
      actor: s.actor,
      ts: Date.now() / 1000,
      value: lightingState,
      description: `${s.actor === "maya" ? "Maya" : "Nate"} set the room to ${lightingState === "late" ? "Late" : "Arrival"}`,
    });
  },

  dismissConflict: () => set({ conflict: null }),
  dismissNotice: () => set({ notice: null }),

  refreshPresence: async () => {
    try {
      const p = await fetchPresence();
      set({ presence: p.actors });
    } catch {
      /* presence is decorative; keep last known */
    }
  },
}));
