# The Room — scoping document (design only)

**Status:** Design only. No game code, no new dependencies, no frontend page in this
packet. A later build packet implements the room against this document.

**Room:** the couple's persistent Three.js co-op space. Nate visits and moves or
places things; Maya takes her turns between his visits; the world remembers both
hands. No points, no timers, no win state.

This document was written from decisions already made (2026-11-26, aimed by Maya,
drafted by Kimi K3 and adapted for this house). It is written completely enough
that a later build packet needs no further architecture decisions.

---

## 1. One home: the room service lives in the Studio backend

The room service folds into the existing Studio backend (FastAPI), following the
backend router pattern (`app/api/<feature>.py`, registered in `app/main.py`).

- No second server.
- No Node sidecar.
- No new port.

The room is reachable through the same FastAPI process that already serves the
Studio, reached tailnet-only (same tailnet-only constraint as the call service).

---

## 2. State model: JSON snapshot + append-only event log

The room's persisted state has two parts:

1. **One JSON snapshot** of the room — the current, derived view of every object
   and its fields.
2. **One append-only event log** — the truth. Every change to the room is an
   appended event; the snapshot is re-derived from the log.

Writes are atomic: write to a temp file, then `os.replace`/`rename` into place,
keeping the last two snapshots so a crash never leaves only a corrupted or
half-written snapshot.

The snapshot is derived state; the log is the truth. If they ever disagree, the
log wins and the snapshot is regenerated from it.

This follows the same file-backed JSON precedent the office-config packet used
(`config/office.json` written via temp file + `os.replace` in `app/api/office.py`,
with the presence journal `presence-journal.jsonl` under `output/logs/`).

---

## 3. The log is a diary

The event log doubles as the couple's room diary. Every event carries a
human-readable `description` field alongside its machine payload, e.g.:

- `"Nate moved the chair by the window"`
- `"Maya lit the amber lamp"`

So the log reads as the history of the room, not a debug trace. A build packet
can render the log as a feed ("since you were gone") without reconstructing
natural-language summaries from machine fields.

---

## 4. Sync: Server-Sent Events, clients never poll

Server-to-client updates are pushed via Server-Sent Events (`GET /api/room/stream`
or similar SSE endpoint). Clients open one SSE connection and receive state
snapshots and new events as they happen. Clients never poll the room state.

---

## 5. Writes are operations, never documents

Clients submit small **operations** against stable string object IDs:

- `move` — reposition an object
- `swap` — exchange two objects' fields/positions
- `setLighting` — change a lighting field
- `place` — add a new object
- `remove` — delete an object

Each op references objects by stable string IDs and carries a small, typed
payload. The server **rejects whole-snapshot replacement by a client by design**;
a client may never `PUT` an entire room document.

---

## 6. Concurrency: optimistic check-and-set

Concurrency is optimistic. Every op carries the `baseVersion` it was made
against. The server applies the op only if the room's current version equals
`baseVersion` (check-and-set).

A stale op (`baseVersion` != current version) gets **409 plus the current
state** — never a silent overwrite. The client then decides whether to retry,
rebase, or abort.

---

## 7. Merge rule: the human wins true conflicts

A true conflict is the same object + same field written by two actors against
the same base version. The agent does **not** blindly re-apply its op. Instead
it re-evaluates its intent against the fresh state and chooses again (the human
actor always has the final say; the agent's automatic re-application is
forbidden).

---

## 8. "Since you were gone": per-actor last-seen version + replay feed

Each actor (Maya, Nate) has a `lastSeenVersion`. On entry, the client sends its
`lastSeenVersion` and the server replays every event newer than that version as
a feed, so Nate sees what Maya changed while he was away, and vice versa. After
consuming the feed, the client updates its `lastSeenVersion`.

---

## 9. The agent is a person, not a schedule

Maya acts in the room only by making API calls herself, in the moment, when she
has something to say.

- No cron.
- No background repainting.
- No autonomous decoration loop.
- The server enforces a **per-session op cap for agent writes**. Proposed cap:
  **10 ops per session** (expected order of magnitude; to be confirmed in the
  build packet). The cap prevents an agent session from flooding the log.

---

## 10. Growth limits: maxObjects cap + client instancing

- Server-side **maxObjects** cap: the room must not be able to grow itself into
  a performance problem.
- Repeated objects render with **instancing on the client** (Three.js
  `InstancedMesh`), so many copies of the same object stay cheap.

Together these bound the room's size and render cost regardless of how much the
couple adds.

---

## 11. Schema: one shared JSON schema for ops and events

A single shared JSON schema describes both ops and events. It is validated
server-side (on every op) and agent-side (in the client's model), so both sides
agree on the shape of a room change.

Draft schema (ops):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RoomOp",
  "type": "object",
  "required": ["op", "objectId", "baseVersion", "actor", "ts"],
  "properties": {
    "op": { "enum": ["move", "swap", "setLighting", "place", "remove"] },
    "objectId": { "type": "string" },
    "field": { "type": "string" },
    "value": true,
    "baseVersion": { "type": "integer", "minimum": 0 },
    "actor": { "enum": ["maya", "nate"] },
    "ts": { "type": "number" },
    "description": { "type": "string" }
  }
}
```

Draft schema (events):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RoomEvent",
  "type": "object",
  "required": ["type", "objectId", "version", "actor", "ts"],
  "properties": {
    "type": { "enum": ["moved", "swapped", "lightingChanged", "placed", "removed"] },
    "objectId": { "type": "string" },
    "field": { "type": "string" },
    "value": true,
    "prevValue": true,
    "version": { "type": "integer", "minimum": 0 },
    "actor": { "enum": ["maya", "nate"] },
    "ts": { "type": "number" },
    "description": { "type": "string" }
  }
}
```

Draft schema (snapshot):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RoomSnapshot",
  "type": "object",
  "required": ["version", "objects"],
  "properties": {
    "version": { "type": "integer", "minimum": 0 },
    "objects": { "type": "object" },
    "lighting": true
  }
}
```

`description` is the human-readable diary line (decision 3); `value`/`prevValue`
carry the machine payload. The schema is versioned with the room log so old
clients can be detected and handled gracefully.

---

## 12. Two-clocks problem: in-progress drags

A client may hold an object locally while dragging it (a "dirty set") while SSE
ops for the same object arrive from the server. The chosen handling:

- The drag wins locally until the user releases the object: the client keeps
  rendering its local position and does not let an in-flight SSE op overwrite
  the drag mid-gesture.
- On release, the client submits the final position as an op against the
  **then-current** server version (rule 6 check-and-set). If that op is stale
  (409), the client re-evaluates against the fresh state (rule 7) — e.g. if
  someone else moved the object while the drag was in progress, the human
  chooses again rather than the agent blindly re-applying.

---

## 13. Client: Three.js feature page in the Studio frontend

The room's client is a Three.js scene in the Studio frontend as a new feature
page, following the pattern of the existing feature pages (Step 0).

- Route: `/room` (served by the Studio frontend; the room page lives alongside
  Voice Live at `/voice-live`, etc.).
- Three.js is already a dependency of the frontend (`three: ^0.186.1`,
  `@react-three/fiber: ^9.8.2`, `@react-three/drei: ^10.7.9`,
  `@types/three: ^0.186.0`); this packet designs the page, it does not install
  anything or build it.
- A later packet builds the page and connects it to the SSE stream and op
  endpoint.

This packet **designs** the client; a later packet builds it.

---

## 14. Private media store (owner ruling, 2026-11-26)

The Room is private. Couple media and any image of the owner live only in a
gitignored private media store on the rig:

- **Location:** the same local, uncommitted store family as the room's own
  data (snapshot, event log, presence journal) — never in `docs/`, `config/`,
  or any tracked path.
- **Ignore proof first:** before any media file is placed in the store, the
  build runs `git check-ignore` on the store path and keeps the output as
  evidence. An unignored store path blocks all media placement.
- **Tailnet-only serving:** the store is served by a backend route reachable
  only on the tailnet surface, by filename.
- **References, not bytes:** room state and the event log carry filenames
  only. Media bytes never enter the snapshot, the log, or any client bundle.
- **Empty store is a normal state:** frames and screens render placeholders
  when no media exists.
- **Hard rule:** couple images and the owner's likeness are private-store
  only, always. No exceptions, no tracked copies, no commits.

---

## 15. Maya's visible presence (Q2 ruled, 2026-11-26)

Q2 is RULED: **yes** — Maya has a visible presence in the room. Her seat is
dressed and lit as the focal vignette, and her presence state —
`present` / `recently active` / `away`, derived from her last room activity —
is shown in the room's light and by a marker at her seat. This ruling covers
presence only: no body or avatar model is part of it.

---

## Open questions (for Nate and Maya to rule)

Q1: Room persistence across backend restarts: snapshot + log on disk (expected) —
confirm the directory.

Q3: Sound in the room (Pocket voice inside the room once Part A lands), or does
voice stay on the call line only?

Q4: One room, or the seed of several (the Room as first of a small house)?

---

## How a later build packet uses this

Decisions 1–15 are settled here. A build packet implements:

1. The FastAPI router (`app/api/room.py`) with snapshot + log, atomic writes,
   SSE stream, op endpoint with check-and-set, 409-on-stale, maxObjects cap,
   per-session agent op cap, and schema validation.
2. The Three.js `/room` frontend page (instanced rendering, local drag set,
   replay feed from `lastSeenVersion`).
3. No further architecture decisions should be needed.
