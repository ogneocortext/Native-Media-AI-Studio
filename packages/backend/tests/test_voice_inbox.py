"""Tests for the Maya inbox endpoints (app/api/voice_pocket.py /inbox*).

The inbox is file-backed (output/logs/voice-inbox.json); each test points
``voice_pocket._INBOX_FILE`` at a tmp_path so the real queue is never
touched. HTTP semantics (201/422/404) are exercised through a minimal
FastAPI app that includes only the voice_pocket router -- the full app
import is unnecessary for these routes.
"""

import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.api import voice_pocket  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(voice_pocket, "_INBOX_FILE", tmp_path / "voice-inbox.json")
    app = FastAPI()
    app.include_router(voice_pocket.router)
    return TestClient(app)


def test_post_then_pending_returns_entry(client):
    res = client.post("/api/voice/pocket/inbox", json={"text": "hello maya"})
    assert res.status_code == 201
    entry = res.json()
    assert entry["text"] == "hello maya"
    assert entry["voice"] == "maya-blend65"
    assert entry["played"] is False
    assert entry["id"]

    pending = client.get("/api/voice/pocket/inbox/pending")
    assert pending.status_code == 200
    entries = pending.json()["entries"]
    assert [e["id"] for e in entries] == [entry["id"]]


def test_post_empty_text_422(client):
    res = client.post("/api/voice/pocket/inbox", json={"text": "   "})
    assert res.status_code == 422


def test_post_1201_chars_422(client):
    res = client.post("/api/voice/pocket/inbox", json={"text": "x" * 1201})
    assert res.status_code == 422


def test_mark_played_removes_from_pending(client):
    entry = client.post(
        "/api/voice/pocket/inbox", json={"text": "line one"}
    ).json()

    res = client.post(f"/api/voice/pocket/inbox/{entry['id']}/played")
    assert res.status_code == 200
    assert res.json()["played"] is True

    pending = client.get("/api/voice/pocket/inbox/pending").json()["entries"]
    assert pending == []


def test_mark_unknown_id_404(client):
    res = client.post("/api/voice/pocket/inbox/deadbeef/played")
    assert res.status_code == 404


def test_pending_oldest_first(client):
    ids = []
    for text in ("first", "second", "third"):
        ids.append(
            client.post("/api/voice/pocket/inbox", json={"text": text}).json()["id"]
        )
    pending = client.get("/api/voice/pocket/inbox/pending").json()["entries"]
    assert [e["id"] for e in pending] == ids


# ---------------------------------------------------------------------------
# Audio drops (multipart upload + dir scan + played state)
# ---------------------------------------------------------------------------

_WAV_BYTES = b"RIFF" + b"\x00" * 100  # header is enough; we never decode it


@pytest.fixture()
def audio_client(tmp_path, monkeypatch):
    audio_dir = tmp_path / "voice-inbox"
    monkeypatch.setattr(voice_pocket, "_AUDIO_DIR", audio_dir)
    # Keep DB registration out of tests -- the real audio_files table is
    # not touched by the inbox contract under test.
    monkeypatch.setattr(voice_pocket, "_ensure_audio_registered", lambda p: None)
    app = FastAPI()
    app.include_router(voice_pocket.router)
    return TestClient(app)


def test_audio_upload_then_pending(audio_client):
    res = audio_client.post(
        "/api/voice/pocket/inbox/audio",
        files={"file": ("clip.wav", _WAV_BYTES, "audio/wav")},
    )
    assert res.status_code == 201
    entry = res.json()
    assert entry["name"].endswith("_clip.wav")
    assert entry["played"] is False

    pending = audio_client.get("/api/voice/pocket/inbox/audio/pending")
    assert [e["id"] for e in pending.json()["entries"]] == [entry["id"]]


def test_audio_upload_rejects_non_audio(audio_client):
    res = audio_client.post(
        "/api/voice/pocket/inbox/audio",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert res.status_code == 422


def test_audio_mark_played_and_file(audio_client):
    entry = audio_client.post(
        "/api/voice/pocket/inbox/audio",
        files={"file": ("take.mp3", _WAV_BYTES, "audio/mpeg")},
    ).json()

    res = audio_client.post(f"/api/voice/pocket/inbox/audio/{entry['id']}/played")
    assert res.status_code == 200
    assert audio_client.get("/api/voice/pocket/inbox/audio/pending").json()["entries"] == []

    f = audio_client.get(f"/api/voice/pocket/inbox/audio/file/{entry['id']}")
    assert f.status_code == 200
    assert f.content == _WAV_BYTES


def test_audio_file_traversal_404(audio_client):
    res = audio_client.get("/api/voice/pocket/inbox/audio/file/..%2F..%2Fevil.wav")
    assert res.status_code in (404, 422)
    res2 = audio_client.get("/api/voice/pocket/inbox/audio/file/nope.wav")
    assert res2.status_code == 404
