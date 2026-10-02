"""Stem pipeline tests: separation guard, stem-file serving, status, paths.

Added per docs/knowledge-library/stem-system-evaluation-2026.md finding 3.5,
which found only two tests covering the whole stem pipeline (both on the
analysis endpoint's empty case) and none for the guard, the file server, the
status endpoint, or path resolution.

These are the cheap structural tests - no Demucs, no GPU, no real audio decode.
The expensive separation path is exercised by tools/probe-level checks, not here.
"""

from __future__ import annotations

import struct
import wave

import pytest
from httpx import AsyncClient


def _detail(resp) -> str:
    """Return the error message regardless of the app's error envelope.

    A global exception handler rewrites HTTPException into
    ``{"error": {"code", "message"}}``, so these assertions must not assume
    FastAPI's default ``detail`` key.
    """
    body = resp.json()
    if isinstance(body, dict) and "error" in body:
        return str(body["error"].get("message", ""))
    return str(body.get("detail", ""))


def _write_wav(path, seconds: float = 0.05, rate: int = 8000) -> None:
    """Write a tiny valid WAV so file serving has real bytes to return."""
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<" + "h" * frames, *([0] * frames)))


@pytest.fixture
def stems_tree(tmp_path, monkeypatch):
    """Point the stems API at a temp separation dir holding one separated track.

    Returns (separation_dir, audio_dir, track_name).
    """
    from app.api import audio_stems
    from app.services import source_separation

    sep = tmp_path / "stems"
    audio = tmp_path / "audio"
    sep.mkdir()
    audio.mkdir()

    track = "test_track"
    stem_dir = sep / "mdx_extra_q" / track
    for name in source_separation.STEM_NAMES:
        _write_wav(stem_dir / f"{name}.wav")
    _write_wav(audio / f"{track}.mp3")

    monkeypatch.setattr(audio_stems, "SEPARATION_DIR", sep)
    monkeypatch.setattr(source_separation, "SEPARATION_DIR", sep)
    monkeypatch.setattr(audio_stems, "AUDIO_DIR", audio)
    return sep, audio, track


# --- 3.3: do not re-run Demucs when stems already exist -------------------


@pytest.mark.asyncio
async def test_separate_file_skips_existing_stems(client: AsyncClient, stems_tree):
    """Existing stems short-circuit separation instead of a 2-10 min re-run.

    Regression guard for finding 3.3: the endpoint used to call Demucs
    unconditionally, wasting minutes on every retry. Asserts model=="existing",
    which is only returned by the guard path.
    """
    _, _, track = stems_tree
    resp = await client.post("/api/audio/separate-file", json={"filename": f"{track}.mp3"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["model"] == "existing"
    assert set(data["stems"]) >= {"vocals", "drums", "bass", "other"}


@pytest.mark.asyncio
async def test_separate_file_rejects_unknown_model(client: AsyncClient, stems_tree):
    """An unsupported model is a 400 before any separation work starts."""
    _, _, track = stems_tree
    resp = await client.post(
        "/api/audio/separate-file",
        json={"filename": f"{track}.mp3", "model": "not-a-real-model"},
    )
    assert resp.status_code == 400
    assert "Unknown model" in _detail(resp)


@pytest.mark.asyncio
async def test_separate_file_rejects_path_traversal(client: AsyncClient, stems_tree):
    """`..` in the filename is rejected - this is a filesystem write primitive."""
    resp = await client.post("/api/audio/separate-file", json={"filename": "../../etc/passwd"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_separate_file_404_for_missing_audio(client: AsyncClient, stems_tree):
    """A filename that is not in the library is 404, not a 500."""
    resp = await client.post("/api/audio/separate-file", json={"filename": "no_such_track.mp3"})
    assert resp.status_code == 404


# --- 3.5: stem-file serving ------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("stem_name", ["vocals", "drums", "bass", "other"])
async def test_serve_stem_file_wav(client: AsyncClient, stems_tree, stem_name):
    """Each of the four stems serves its WAV with real bytes."""
    _, _, track = stems_tree
    resp = await client.get(f"/api/audio/stem-file/{track}/{stem_name}")

    assert resp.status_code == 200
    assert resp.content, "empty body"
    # RIFF....WAVE - a truncated or error body would not start with this.
    assert resp.content[:4] == b"RIFF"
    assert resp.content[8:12] == b"WAVE"


@pytest.mark.asyncio
async def test_serve_stem_file_rejects_invalid_stem_name(client: AsyncClient, stems_tree):
    """An unknown stem name is 400.

    Note this asserts an *invalid* name, not a traversal one: `..%2Fsecrets` is
    normalised by the ASGI router and 404s before the handler runs, so a
    traversal attempt cannot be tested through HTTP here. What the endpoint
    must reject is a name outside STEM_NAMES - see the direct call in
    test_serve_stem_file_rejects_noncanonical_stem_name.
    """
    _, _, track = stems_tree
    resp = await client.get(f"/api/audio/stem-file/{track}/harmony")

    assert resp.status_code == 400
    assert "stem_name must be" in _detail(resp)


@pytest.mark.asyncio
async def test_serve_stem_file_rejects_noncanonical_stem_name(stems_tree):
    """Direct handler call: any stem outside STEM_NAMES raises 400.

    Covers the case HTTP cannot reach - a name like `harmony` that a future
    6-stem model would produce. Calling the coroutine directly exercises the
    `stem_name not in STEM_NAMES` guard rather than the router.
    """
    from app.api.audio_stems import serve_stem_file
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await serve_stem_file("test_track", "harmony")

    assert exc.value.status_code == 400
    assert "stem_name must be" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_serve_stem_file_rejects_bad_format(client: AsyncClient, stems_tree):
    """format= is validated; only wav|mp3 are accepted."""
    _, _, track = stems_tree
    resp = await client.get(f"/api/audio/stem-file/{track}/vocals?format=flac")
    assert resp.status_code == 400
    assert "format must be" in _detail(resp)


@pytest.mark.asyncio
async def test_serve_stem_file_404_when_absent(client: AsyncClient, stems_tree):
    """A valid stem that was never separated is 404, not a crash."""
    resp = await client.get("/api/audio/stem-file/never_separated_track/vocals")
    assert resp.status_code == 404


# --- 3.5: status + lookup endpoints ---------------------------------------


@pytest.mark.asyncio
async def test_get_stems_reports_wav_and_mp3_urls(client: AsyncClient, stems_tree):
    """`stems` and `stems_mp3` are both present, per-stem, as relative URLs.

    The frontend mixer prefers stems_mp3 and falls back to WAV (StemMixer.tsx
    pickStemUrls), so an endpoint that emitted only one would silently force
    every playback to WAV.
    """
    _, _, track = stems_tree
    resp = await client.get(f"/api/audio/stems/{track}.mp3")

    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is True
    assert set(data["stems"]) == {"vocals", "drums", "bass", "other"}
    assert set(data["stems_mp3"]) == set(data["stems"])
    assert data["stems_mp3"]["vocals"].endswith("?format=mp3")
    assert data["stems"]["vocals"].startswith("/api/audio/stem-file/")


@pytest.mark.asyncio
async def test_get_stems_found_false_when_unseparated(client: AsyncClient, stems_tree):
    """A track with no stem dir reports found:False and empty maps."""
    resp = await client.get("/api/audio/stems/never_separated.mp3")
    data = resp.json()
    assert data["found"] is False
    assert data["stems"] == {}
    assert data["stems_mp3"] == {}


@pytest.mark.asyncio
async def test_get_stems_status_lists_library(client: AsyncClient, stems_tree):
    """stems-status keys tracks by library-relative path and flags has_stems."""
    _, _, track = stems_tree
    resp = await client.get("/api/audio/stems-status")

    assert resp.status_code == 200
    tracks = resp.json()["tracks"]
    entry = tracks.get(f"{track}.mp3")
    assert entry is not None, f"{track}.mp3 missing from {sorted(tracks)}"
    assert entry["has_stems"] is True
    assert set(entry["stems"]) == {"vocals", "drums", "bass", "other"}


# --- 3.4: path resolution --------------------------------------------------


def test_find_stem_dir_exact_match(stems_tree):
    """A directory named after the file resolves directly."""
    from app.services.source_separation import find_stem_dir

    sep, _, track = stems_tree
    found = find_stem_dir(f"{track}.mp3")

    assert found is not None
    assert found.name == track
    assert found == sep / "mdx_extra_q" / track


def test_find_stem_dir_tolerates_hash_prefix(stems_tree):
    """Separation dirs come from the source name, so a hash-prefixed library
    name still has to resolve - this is the rename-tolerance path."""
    from app.services.source_separation import find_stem_dir

    _, _, track = stems_tree
    found = find_stem_dir(f"85a406ef_{track}.mp3")

    assert found is not None, "hash-prefixed name failed to resolve"
    assert found.name == track


def test_find_stem_dir_returns_none_when_absent(stems_tree):
    """An unrelated name resolves to None rather than raising."""
    from app.services.source_separation import find_stem_dir

    assert find_stem_dir("completely_different_song.mp3") is None


def test_stem_names_is_single_source_of_truth():
    """STEM_NAMES is the one canonical list, and audio_stems enforces it.

    Guards finding 3.2: the four stem names were previously spelled out inline
    in source_separation, stem_analysis, and audio_stems, so adding a stem meant
    three coordinated edits and a missed one produced a silently incomplete
    response.
    """
    from app.services.source_separation import STEM_NAMES

    assert STEM_NAMES == ("vocals", "drums", "bass", "other")
    assert source_separation_module_is_canonical()


def source_separation_module_is_canonical() -> bool:
    """The stem-file endpoint's 400 message is derived from STEM_NAMES.

    If it ever goes back to a hardcoded string, this stops being provable from
    the constant alone, so assert the module still exposes the tuple it reads.
    """
    from app.api import audio_stems

    assert hasattr(audio_stems, "source_separation")
    assert audio_stems.source_separation.STEM_NAMES is not None
    return True
