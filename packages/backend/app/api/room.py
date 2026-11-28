"""The Room -- shared persistent space for Nate and Maya.

Implements docs/the-room-scoping.md decisions 1-15:

- State is a JSON snapshot plus an append-only event log (the diary). The
  log is the truth; the snapshot is derived state, rewritten atomically
  (temp file + os.replace, previous snapshot kept as ``snapshot.prev.json``).
- Clients submit small ops (move / swap / setLighting / place / remove)
  against stable string object IDs. Whole-snapshot replacement is rejected
  by design -- there is no PUT /state.
- Concurrency is optimistic check-and-set: an op applies only when its
  ``baseVersion`` equals the current version; a stale op gets 409 plus the
  current state.
- Sync is SSE (``GET /api/room/stream``); clients never poll.
- Per-actor ``lastSeenVersion`` with a replay feed ("since you were gone").
- Caps: ``MAX_OBJECTS`` server-side, ``AGENT_OP_CAP`` ops per session for
  actor ``maya``.
- Private media (decision 14): files live in ``storage/room-media/`` --
  gitignored, tailnet-only surface, referenced by filename, never bytes in
  state. An empty store is a normal state.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sse_starlette.sse import EventSourceResponse

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/room", tags=["Room"])

# --- Storage layout (all under gitignored storage/, verified with
# git check-ignore before any media is placed -- see packet report) ---
ROOM_DIR = PROJECT_ROOT / "storage" / "room"
MEDIA_DIR = PROJECT_ROOT / "storage" / "room-media"

MAX_OBJECTS = 200
AGENT_ACTOR = "maya"
AGENT_OP_CAP = 10

# Presence thresholds (seconds) for Maya's visible state (Q2 ruling):
# derived from her last room activity.
PRESENCE_PRESENT_S = 10 * 60
PRESENCE_RECENT_S = 2 * 60 * 60

_OP_TO_EVENT = {
    "move": "moved",
    "swap": "swapped",
    "setLighting": "lightingChanged",
    "place": "placed",
    "remove": "removed",
}
_ACTOR_LABEL = {"maya": "Maya", "nate": "Nate"}
_VALID_LIGHTING_STATES = {"arrival", "late"}

_state: dict[str, Any] | None = None
_state_lock = asyncio.Lock()
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
_agent_op_counts: dict[str, int] = {}


def _snapshot_path() -> Path:
    return ROOM_DIR / "snapshot.json"


def _snapshot_prev_path() -> Path:
    return ROOM_DIR / "snapshot.prev.json"


def _events_path() -> Path:
    return ROOM_DIR / "events.jsonl"


def _presence_path() -> Path:
    return ROOM_DIR / "presence.json"


def _empty_state() -> dict[str, Any]:
    return {"version": 0, "objects": {}, "lighting": {"state": "arrival"}}


# --- Persistence ---------------------------------------------------------


def _append_event(event: dict[str, Any]) -> None:
    ROOM_DIR.mkdir(parents=True, exist_ok=True)
    with open(_events_path(), "a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, separators=(",", ":")) + "\n")


def _write_snapshot_atomic(state: dict[str, Any]) -> None:
    """Temp file + os.replace; keep the previous snapshot as .prev."""
    ROOM_DIR.mkdir(parents=True, exist_ok=True)
    snap = _snapshot_path()
    if snap.exists():
        try:
            os.replace(snap, _snapshot_prev_path())
        except OSError:
            pass
    fd, tmp_path = tempfile.mkstemp(dir=str(ROOM_DIR), prefix=".room-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2)
            fh.write("\n")
        os.replace(tmp_path, snap)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _load_events() -> list[dict[str, Any]]:
    path = _events_path()
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning("room: skipping corrupt log line")
    return events


def _fold_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive state by folding the log. The log is the truth."""
    state = _empty_state()
    for ev in events:
        etype = ev.get("type")
        oid = ev.get("objectId")
        state["version"] = int(ev.get("version", state["version"]))
        if etype == "placed":
            obj = dict(ev.get("value") or {})
            obj["id"] = oid
            state["objects"][oid] = obj
        elif etype == "removed":
            state["objects"].pop(oid, None)
        elif etype == "moved":
            obj = state["objects"].get(oid)
            if obj is not None:
                obj["position"] = ev.get("value")
        elif etype == "swapped":
            other = (ev.get("value") or {}).get("objectId")
            a, b = state["objects"].get(oid), state["objects"].get(other)
            if a is not None and b is not None:
                field = ev.get("field") or "position"
                if field == "fields":
                    pa, pb = dict(a), dict(b)
                    pa.pop("id", None)
                    pb.pop("id", None)
                    a.update(pb)
                    b.update(pa)
                else:
                    a["position"], b["position"] = b.get("position"), a.get("position")
                    a["rotationY"], b["rotationY"] = b.get("rotationY"), a.get("rotationY")
        elif etype == "lightingChanged":
            field = ev.get("field")
            if field:
                state["lighting"][field] = ev.get("value")
    return state


# --- Seed: the furnished room (initial state, written as placed events so
# the log stays the single truth) ----------------------------------------

_SEED_OBJECTS: list[tuple[str, str, list[float], dict[str, Any]]] = [
    # (id, kind, position, extra fields)
    ("armchair-her", "armchair-her", [-0.85, 0.0, -0.85], {"rotationY": 0.6, "fabric": "plum-velvet"}),
    ("armchair-cognac", "armchair-cognac", [0.85, 0.0, 0.85], {"rotationY": -2.4, "fabric": "cognac-leather"}),
    ("record-player", "record-player", [0.0, 0.0, 0.0], {"rotationY": 0.0}),
    ("side-table", "side-table", [-1.55, 0.0, -1.25], {"rotationY": 0.3}),
    ("floor-lamp", "floor-lamp", [-1.85, 0.0, -0.7], {}),
    ("book-stack", "book-stack", [-1.5, 0.55, -1.2], {}),
    ("plant", "plant", [2.15, 0.0, -1.6], {}),
    ("mug", "mug", [-1.45, 0.78, -1.3], {}),
    ("blanket", "blanket", [-0.7, 0.75, -0.95], {}),
    ("headphones", "headphones", [0.35, 0.9, 0.1], {}),
    ("shelf-progress", "shelf-progress", [-2.2, 1.4, -1.9], {}),
    ("frame-1", "frame", [-1.4, 1.6, -1.98], {"media": None, "wall": "north"}),
    ("frame-2", "frame", [0.2, 1.65, -1.98], {"media": None, "wall": "north"}),
    ("frame-3", "frame", [1.6, 1.55, 1.98], {"media": None, "wall": "south"}),
    ("room-screen", "screen", [2.45, 1.3, 0.4], {"rotationY": -1.5708, "media": None}),
]


def _seed_log() -> None:
    """First boot: write the furnished room as placed events (log = truth)."""
    version = 0
    for oid, kind, position, extra in _SEED_OBJECTS:
        version += 1
        value = {"kind": kind, "position": position, **extra}
        _append_event(
            {
                "type": "placed",
                "objectId": oid,
                "value": value,
                "version": version,
                "actor": "nate",
                "ts": datetime.now(tz=UTC).timestamp(),
                "description": f"Nate furnished the room: {kind}",
            }
        )


def _ensure_loaded() -> dict[str, Any]:
    """Load state: fold the log (truth); repair the snapshot if it drifted."""
    global _state
    if _state is not None:
        return _state

    events = _load_events()
    if not events and not _snapshot_path().exists():
        _seed_log()
        events = _load_events()

    derived = _fold_events(events)
    snap_path = _snapshot_path()
    try:
        stored = json.loads(snap_path.read_text(encoding="utf-8")) if snap_path.exists() else None
    except (OSError, json.JSONDecodeError):
        stored = None
    if not isinstance(stored, dict) or stored.get("version") != derived["version"]:
        _write_snapshot_atomic(derived)
    _state = derived
    return _state


def _persist(state: dict[str, Any], event: dict[str, Any]) -> None:
    _append_event(event)
    _write_snapshot_atomic(state)


# --- Presence -------------------------------------------------------------


def _load_presence() -> dict[str, Any]:
    try:
        data = json.loads(_presence_path().read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("actors"), dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"actors": {}}


def _save_presence(presence: dict[str, Any]) -> None:
    ROOM_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(ROOM_DIR), prefix=".presence-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(presence, fh, indent=2)
            fh.write("\n")
        os.replace(tmp_path, _presence_path())
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _touch_actor(presence: dict[str, Any], actor: str) -> None:
    entry = presence["actors"].setdefault(actor, {})
    entry["lastActiveTs"] = datetime.now(tz=UTC).timestamp()


def _actor_presence(presence: dict[str, Any], actor: str) -> str:
    ts = (presence["actors"].get(actor) or {}).get("lastActiveTs")
    if not isinstance(ts, (int, float)):
        return "away"
    age = datetime.now(tz=UTC).timestamp() - ts
    if age <= PRESENCE_PRESENT_S:
        return "present"
    if age <= PRESENCE_RECENT_S:
        return "recently active"
    return "away"


# --- Scheira ----------------------------------------------------------------


class RoomOp(BaseModel):
    """Client op, validated server-side on every submission (decision 11)."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["move", "swap", "setLighting", "place", "remove"]
    objectId: str = Field(min_length=1, max_length=120)  # noqa: N815 - wire schema name
    baseVersion: int = Field(ge=0)  # noqa: N815 - wire schema name
    actor: Literal["maya", "nate"]
    ts: float
    field: str | None = None
    value: Any = None
    description: str | None = Field(default=None, max_length=300)
    sessionId: str | None = Field(default=None, max_length=120)  # noqa: N815 - wire schema name


# --- Helpers -----------------------------------------------------------------


def _normalize_position(value: Any) -> list[float] | None:
    """Accept [x,y,z] or {"position": [x,y,z]} / {"x","y","z"}."""
    cand = value
    if isinstance(value, dict):
        cand = value.get("position", value)
    if isinstance(cand, dict):
        try:
            cand = [float(cand["x"]), float(cand["y"]), float(cand["z"])]
        except (KeyError, TypeError, ValueError):
            return None
    if isinstance(cand, (list, tuple)) and len(cand) == 3:
        try:
            return [float(c) for c in cand]
        except (TypeError, ValueError):
            return None
    return None


def _describe(op: RoomOp, target: str) -> str:
    if op.description:
        return op.description
    who = _ACTOR_LABEL[op.actor]
    verb = {
        "move": "moved",
        "swap": "swapped",
        "setLighting": "adjusted the lighting",
        "place": "placed",
        "remove": "removed",
    }[op.op]
    return f"{who} {verb} {target}"


def _publish(event: dict[str, Any]) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


# --- Routes -------------------------------------------------------------------


@router.get("/state")
async def get_state() -> dict[str, Any]:
    """Current room snapshot (derived state)."""
    return _ensure_loaded()


@router.post("/op")
async def submit_op(op: RoomOp) -> dict[str, Any]:
    """Apply one op under optimistic check-and-set.

    Stale ``baseVersion`` -> 409 with the current state. Invalid ops -> 422.
    Agent (maya) ops are capped at AGENT_OP_CAP per sessionId.
    """
    async with _state_lock:
        state = _ensure_loaded()

        # Agent op cap: per session, counted on successful applies only.
        if op.actor == AGENT_ACTOR:
            session = op.sessionId or "default"
            if _agent_op_counts.get(session, 0) >= AGENT_OP_CAP:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"agent op cap reached: {AGENT_OP_CAP} ops per session "
                        f"for actor '{AGENT_ACTOR}' (session '{session}')"
                    ),
                )

        if op.baseVersion != state["version"]:
            # JSONResponse, not HTTPException: the app's exception handler
            # stringifies detail, which would mangle the structured current
            # state the client needs for its rebase decision (decision 6).
            return JSONResponse(
                status_code=409,
                content={
                    "applied": False,
                    "error": "stale baseVersion",
                    "baseVersion": op.baseVersion,
                    "currentVersion": state["version"],
                    "current": state,
                },
            )

        objects = state["objects"]
        lighting = state["lighting"]
        event_type = _OP_TO_EVENT[op.op]
        prev_value: Any = None

        if op.op == "place":
            if op.objectId in objects:
                raise HTTPException(status_code=422, detail=f"object '{op.objectId}' already exists")
            if len(objects) >= MAX_OBJECTS:
                raise HTTPException(
                    status_code=422,
                    detail=f"room is full: maxObjects={MAX_OBJECTS}",
                )
            record = dict(op.value) if isinstance(op.value, dict) else {}
            kind = record.get("kind")
            position = _normalize_position(record.get("position"))
            if not isinstance(kind, str) or not kind:
                raise HTTPException(status_code=422, detail="place requires value.kind")
            if position is None:
                raise HTTPException(status_code=422, detail="place requires value.position [x,y,z]")
            record["position"] = position
            new_obj = {"id": op.objectId, **record}
            objects[op.objectId] = new_obj
            prev_value = None
            apply_value = record
        elif op.op == "remove":
            if op.objectId not in objects:
                raise HTTPException(status_code=422, detail=f"unknown object '{op.objectId}'")
            prev_value = objects.pop(op.objectId)
            apply_value = None
        elif op.op == "move":
            obj = objects.get(op.objectId)
            if obj is None:
                raise HTTPException(status_code=422, detail=f"unknown object '{op.objectId}'")
            position = _normalize_position(op.value)
            if position is None:
                raise HTTPException(status_code=422, detail="move requires value position [x,y,z]")
            prev_value = obj.get("position")
            obj["position"] = position
            apply_value = position
        elif op.op == "swap":
            other = op.value.get("objectId") if isinstance(op.value, dict) else None
            if not other or other == op.objectId:
                raise HTTPException(
                    status_code=422,
                    detail="swap requires value.objectId naming a different object",
                )
            a, b = objects.get(op.objectId), objects.get(other)
            if a is None or b is None:
                raise HTTPException(status_code=422, detail="swap target not found")
            field = op.field or "position"
            if field == "fields":
                pa = {k: v for k, v in a.items() if k != "id"}
                pb = {k: v for k, v in b.items() if k != "id"}
                prev_value = {"a": pa, "b": pb}
                for k in set(pa) | set(pb):
                    a.pop(k, None)
                    b.pop(k, None)
                a.update(pb)
                b.update(pa)
            else:
                prev_value = {
                    "position": [a.get("position"), b.get("position")],
                    "rotationY": [a.get("rotationY"), b.get("rotationY")],
                }
                a["position"], b["position"] = b.get("position"), a.get("position")
                a["rotationY"], b["rotationY"] = b.get("rotationY"), a.get("rotationY")
            apply_value = {"objectId": other, "field": field}
        else:  # setLighting
            if not op.field:
                raise HTTPException(status_code=422, detail="setLighting requires field")
            if op.field == "state" and op.value not in _VALID_LIGHTING_STATES:
                raise HTTPException(
                    status_code=422,
                    detail=f"lighting.state must be one of {sorted(_VALID_LIGHTING_STATES)}",
                )
            prev_value = lighting.get(op.field)
            lighting[op.field] = op.value
            apply_value = op.value
            event_type = "lightingChanged"

        state["version"] += 1
        event = {
            "type": event_type,
            "objectId": op.objectId,
            "version": state["version"],
            "actor": op.actor,
            "ts": op.ts,
            "description": _describe(op, op.objectId),
        }
        if op.field is not None:
            event["field"] = op.field
        if apply_value is not None or op.op == "setLighting":
            event["value"] = apply_value
        if prev_value is not None:
            event["prevValue"] = prev_value

        _persist(state, event)

        if op.actor == AGENT_ACTOR:
            session = op.sessionId or "default"
            _agent_op_counts[session] = _agent_op_counts.get(session, 0) + 1

        presence = _load_presence()
        _touch_actor(presence, op.actor)
        _save_presence(presence)

        _publish({"kind": "event", "event": event, "state": state})
        return {"applied": True, "version": state["version"], "event": event}


@router.get("/stream")
async def stream() -> EventSourceResponse:
    """SSE feed: snapshot on connect, then every applied op. No polling."""
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
    _subscribers.add(queue)
    snapshot = _ensure_loaded()

    async def events():
        try:
            yield {"event": "snapshot", "data": json.dumps(snapshot)}
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15)
                    if msg.get("kind") == "event":
                        yield {"event": "event", "data": json.dumps(msg["event"])}
                        yield {"event": "state", "data": json.dumps(msg["state"])}
                    else:
                        yield {"event": msg.get("kind", "message"), "data": json.dumps(msg)}
                except TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            _subscribers.discard(queue)

    return EventSourceResponse(events())


@router.get("/replay")
async def replay(actor: Literal["maya", "nate"] = Query(...), since: int = Query(ge=0)) -> dict[str, Any]:
    """Every event newer than ``since`` for ``actor`` ("since you were gone").

    Records the actor's lastSeenVersion as the current version.
    """
    state = _ensure_loaded()
    events = [e for e in _load_events() if int(e.get("version", 0)) > since]

    presence = _load_presence()
    entry = presence["actors"].setdefault(actor, {})
    entry["lastSeenVersion"] = state["version"]
    _save_presence(presence)

    return {
        "actor": actor,
        "since": since,
        "currentVersion": state["version"],
        "lastSeenVersion": state["version"],
        "events": events,
    }


@router.get("/presence")
async def get_presence() -> dict[str, Any]:
    """Per-actor presence for the room UI (Q2: present / recently active / away)."""
    presence = _load_presence()
    state = _ensure_loaded()
    return {
        "actors": {
            actor: {
                "state": _actor_presence(presence, actor),
                "lastActiveTs": (presence["actors"].get(actor) or {}).get("lastActiveTs"),
                "lastSeenVersion": (presence["actors"].get(actor) or {}).get("lastSeenVersion"),
            }
            for actor in ("maya", "nate")
        },
        "version": state["version"],
    }


@router.get("/media/{filename}")
async def get_media(filename: str) -> FileResponse:
    """Serve one file from the private media store by filename.

    Filenames only -- path traversal is rejected. The store is gitignored
    and reachable only on the tailnet surface; an empty store is normal.
    """
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="invalid filename")
    path = MEDIA_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no such media")
    return FileResponse(path, filename=filename)
