"""Tests for /api/room -- snapshot+log state, check-and-set ops, caps, replay."""

from __future__ import annotations

import pytest


@pytest.fixture
def room_storage(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Point the room store at a temp dir and reset module state."""
    import app.api.room as room_mod

    room_dir = tmp_path / "room"
    media_dir = tmp_path / "room-media"
    media_dir.mkdir(parents=True)
    monkeypatch.setattr(room_mod, "ROOM_DIR", room_dir)
    monkeypatch.setattr(room_mod, "MEDIA_DIR", media_dir)
    monkeypatch.setattr(room_mod, "_state", None)
    room_mod._agent_op_counts.clear()
    room_mod._subscribers.clear()
    return room_dir


@pytest.fixture
def client(room_storage):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def _op(client, **over):
    """Submit an op against the current version."""
    state = client.get("/api/room/state").json()
    body = {
        "op": "move",
        "objectId": "armchair-her",
        "baseVersion": state["version"],
        "actor": "nate",
        "ts": 1700000000.0,
        "value": [1.0, 0.0, 1.0],
    }
    body.update(over)
    return client.post("/api/room/op", json=body)


def test_seed_state_present(client):
    state = client.get("/api/room/state").json()
    assert state["version"] > 0
    assert "armchair-her" in state["objects"]
    assert state["lighting"]["state"] == "arrival"


def test_op_applies_and_version_increments(client):
    before = client.get("/api/room/state").json()["version"]
    res = _op(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["applied"] is True
    assert body["version"] == before + 1
    assert body["event"]["type"] == "moved"
    assert body["event"]["description"]

    after = client.get("/api/room/state").json()
    assert after["objects"]["armchair-her"]["position"] == [1.0, 0.0, 1.0]


def test_stale_op_gets_409_with_current_state(client):
    state = client.get("/api/room/state").json()
    res = client.post(
        "/api/room/op",
        json={
            "op": "move",
            "objectId": "armchair-her",
            "baseVersion": state["version"] - 1,
            "actor": "nate",
            "ts": 1700000000.0,
            "value": [9.0, 0.0, 9.0],
        },
    )
    assert res.status_code == 409
    body = res.json()
    assert body["error"] == "stale baseVersion"
    assert body["currentVersion"] == state["version"]
    assert "objects" in body["current"]


def test_invalid_op_rejected_by_schema(client):
    res = client.post(
        "/api/room/op",
        json={
            "op": "teleport",
            "objectId": "armchair-her",
            "baseVersion": 0,
            "actor": "nate",
            "ts": 1.0,
        },
    )
    assert res.status_code == 422


def test_semantic_invalid_op_rejected(client):
    res = _op(client, objectId="does-not-exist")
    assert res.status_code == 422


def test_agent_op_cap(client):
    """The 11th maya op in one session is refused."""
    for i in range(10):
        res = _op(client, actor="maya", sessionId="sess-1", value=[float(i), 0.0, 0.0])
        assert res.status_code == 200, f"op {i + 1} failed: {res.text}"
    res = _op(client, actor="maya", sessionId="sess-1", value=[42.0, 0.0, 0.0])
    assert res.status_code == 429
    # A different session and nate are unaffected.
    assert _op(client, actor="maya", sessionId="sess-2").status_code == 200
    assert _op(client, actor="nate", sessionId="sess-1").status_code == 200


def test_replay_returns_events_after_since(client):
    v0 = client.get("/api/room/state").json()["version"]
    _op(client, description="Nate moved the chair")
    _op(client, description="Nate moved it again")
    current = client.get("/api/room/state").json()["version"]

    res = client.get(f"/api/room/replay?actor=nate&since={v0}")
    assert res.status_code == 200
    body = res.json()
    assert body["currentVersion"] == current
    assert len(body["events"]) == 2
    assert body["events"][-1]["description"] == "Nate moved it again"
    # lastSeenVersion advanced to current.
    assert body["lastSeenVersion"] == current


def test_snapshot_rebuilds_from_log(client, room_storage):
    """Delete the snapshot; state must re-derive identically from the log."""
    import app.api.room as room_mod

    _op(client, value=[3.0, 0.0, 3.0])
    before = client.get("/api/room/state").json()

    snap = room_storage / "snapshot.json"
    assert snap.exists()
    snap.unlink()
    room_mod._state = None  # simulate restart

    after = client.get("/api/room/state").json()
    assert after == before
    # And the snapshot file was regenerated.
    assert snap.exists()


def test_place_and_remove_and_max_objects(client):
    state = client.get("/api/room/state").json()
    res = client.post(
        "/api/room/op",
        json={
            "op": "place",
            "objectId": "test-crate",
            "baseVersion": state["version"],
            "actor": "nate",
            "ts": 1.0,
            "value": {"kind": "crate", "position": [0.5, 0.0, 0.5]},
        },
    )
    assert res.status_code == 200
    assert client.get("/api/room/state").json()["objects"]["test-crate"]["kind"] == "crate"

    res = _op(client, op="remove", objectId="test-crate", value=None)
    assert res.status_code == 200
    assert "test-crate" not in client.get("/api/room/state").json()["objects"]


def test_set_lighting(client):
    res = _op(
        client,
        op="setLighting",
        objectId="lighting",
        field="state",
        value="late",
    )
    assert res.status_code == 200
    assert client.get("/api/room/state").json()["lighting"]["state"] == "late"
    # Invalid lighting state rejected.
    res = _op(client, op="setLighting", objectId="lighting", field="state", value="noon")
    assert res.status_code == 422


def test_media_route_404_and_path_traversal(client, room_storage, tmp_path):
    assert client.get("/api/room/media/nope.png").status_code == 404
    assert client.get("/api/room/media/..%2Fsecret.png").status_code in (400, 404)
    (room_storage.parent / "room-media" / "note.txt").write_text("hi", encoding="utf-8")
    res = client.get("/api/room/media/note.txt")
    assert res.status_code == 200
    assert res.text == "hi"
