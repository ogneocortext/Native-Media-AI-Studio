"""Tests for content-addressed upload identity.

Regression guard for the duplicate-analysis bug: uploads used to be stored under
uuid4()[:8], so the same track uploaded ten times produced ten files, ten
database rows and ten index entries - and because every request arrived under a
new name, the analysis cache could never hit.
"""
import asyncio
import hashlib
import io
import os
import sys

import pytest
from fastapi import HTTPException, UploadFile

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))

def _audio():
    """Import the audio module lazily, inside the test.

    Importing it at module scope makes pytest collect and import app.api.audio -
    and its database dependency - before any test runs. That opens a connection
    early, which on Windows leaves studio.db locked and makes later tmpdir
    cleanup fail with WinError 32 ("used by another process") in unrelated
    tests. Deferring the import keeps this module free of import-time side
    effects.
    """
    import app.api.audio as audio_mod

    return audio_mod


def make_upload(data: bytes, name: str = "track.mp3") -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(data))


def run(coro):
    """Run a coroutine on a fresh loop.

    Deliberately not asyncio.get_event_loop(): this module must not depend on
    whether a previous test left a loop installed. Under the full suite an
    earlier test closes the loop, so get_event_loop() raises
    "There is no current event loop in thread 'MainThread'" and these tests
    fail only when run as part of the whole suite.
    """
    return asyncio.run(coro)


def _store(tmpdir, monkeypatch, data: bytes, name: str = "track.mp3") -> str:
    audio_mod = _audio()
    monkeypatch.setattr(audio_mod, "AUDIO_DIR", tmpdir)
    return run(audio_mod._store_upload(make_upload(data, name)))


def test_same_bytes_yield_same_id(tmp_path, monkeypatch):
    """The whole point: identical audio must resolve to one identity."""
    payload = b"the same audio bytes" * 100

    a = _store(tmp_path, monkeypatch, payload)
    b = _store(tmp_path, monkeypatch, payload)

    assert a == b, "identical content produced different ids"
    # And it really is the content hash, not a lucky coincidence.
    assert a == hashlib.sha256(payload).hexdigest()[:8]


def test_different_bytes_yield_different_ids(tmp_path, monkeypatch):
    a = _store(tmp_path, monkeypatch, b"one track")
    b = _store(tmp_path, monkeypatch, b"another track")
    assert a != b


def test_reupload_overwrites_in_place_and_leaves_no_temp_files(tmp_path, monkeypatch):
    """A repeat upload must not accumulate copies or .upload strays."""
    payload = b"repeat me" * 50

    first = _store(tmp_path, monkeypatch, payload, "song.mp3")
    second = _store(tmp_path, monkeypatch, payload, "song.mp3")

    assert first == second
    files = sorted(p.name for p in tmp_path.iterdir())
    assert files == [f"{first}_song.mp3"], files


def test_oversized_upload_raises_and_leaves_nothing_behind(tmp_path, monkeypatch):
    """A rejected upload must not leave a file under a real name."""
    audio_mod = _audio()

    monkeypatch.setattr(audio_mod, "AUDIO_DIR", tmp_path)
    monkeypatch.setattr(audio_mod, "MAX_FILE_SIZE", 10)

    with pytest.raises(HTTPException) as exc:
        run(audio_mod._store_upload(make_upload(b"x" * 500, "big.mp3")))

    assert exc.value.status_code == 413
    assert list(tmp_path.iterdir()) == [], "partial file left after rejection"


def test_temp_name_is_unique_before_rename(tmp_path, monkeypatch):
    """Repeated uploads of identical bytes must not collide mid-write."""
    ids = {
        _store(tmp_path, monkeypatch, b"concurrent payload", "c.mp3")
        for _ in range(3)
    }
    # Same content -> same final id every time, and no .upload residue.
    assert len(ids) == 1
    assert not [p for p in tmp_path.iterdir() if p.name.endswith(".upload")]
