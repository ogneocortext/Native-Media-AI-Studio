"""Regression tests for basename fallback in /api/audio/file/{filename}.

Library entries carry `filename` as a basename, but most tracks live in
subdirectories (mastered/, Suno-V6-Mini/, ...). The direct lookup 404s, so
serve_audio_file falls back to a unique recursive match — only when exactly
one file matches, since an ambiguous basename has no right answer.
"""

from pathlib import Path

import pytest

from app.api import audio_edit


@pytest.fixture()
def audio_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(audio_edit, "AUDIO_DIR", tmp_path)
    return tmp_path


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"audio")
    return path


def test_unique_subdir_basename_resolves(audio_dir: Path):
    expected = _touch(audio_dir / "mastered" / "Song_mastered.mp3")
    assert audio_edit._resolve_unique_audio_basename("Song_mastered.mp3") == expected


def test_top_level_basename_resolves(audio_dir: Path):
    expected = _touch(audio_dir / "Song.mp3")
    assert audio_edit._resolve_unique_audio_basename("Song.mp3") == expected


def test_ambiguous_basename_returns_none(audio_dir: Path):
    _touch(audio_dir / "a" / "Song.mp3")
    _touch(audio_dir / "b" / "Song.mp3")
    assert audio_edit._resolve_unique_audio_basename("Song.mp3") is None


def test_missing_basename_returns_none(audio_dir: Path):
    assert audio_edit._resolve_unique_audio_basename("Nope.mp3") is None


def test_non_audio_extension_ignored(audio_dir: Path):
    _touch(audio_dir / "art" / "cover.png")
    assert audio_edit._resolve_unique_audio_basename("cover.png") is None


def test_paths_are_not_resolved_by_basename_fallback(audio_dir: Path):
    _touch(audio_dir / "mastered" / "Song.mp3")
    # A caller passing a path must go through the direct lookup, not the scan.
    assert audio_edit._resolve_unique_audio_basename("mastered/Song.mp3") is None
    assert audio_edit._resolve_unique_audio_basename("..\\Song.mp3") is None


def test_case_insensitive_match(audio_dir: Path):
    expected = _touch(audio_dir / "mastered" / "Song_MP3.mp3")
    # Filesystems are case-insensitive on Windows; the scan lowercases both sides.
    assert audio_edit._resolve_unique_audio_basename("song_mp3.mp3") == expected
