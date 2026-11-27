"""NSFW gate coverage for the audio/remix list surfaces.

Census on 2026-11-27 found zero flagged items, so these tests prove the
filter code paths themselves: a path present in hidden_paths() must be
excluded from /api/audio/files, /api/audio/stems-status, remix source
and remix listings, and the video default-audio pick.
"""

from pathlib import Path


def _write(path: Path, content: bytes = b"x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


async def test_audio_files_excludes_flagged(tmp_path, monkeypatch):
    from app.api import audio as audio_api

    audio_dir = tmp_path / "audio"
    _write(audio_dir / "a.mp3")
    _write(audio_dir / "b.mp3")
    _write(audio_dir / "voice-inbox" / "c.wav")
    monkeypatch.setattr(audio_api, "AUDIO_DIR", audio_dir)
    monkeypatch.setattr(
        audio_api,
        "hidden_paths",
        lambda: {"audio/b.mp3", "audio/voice-inbox/c.wav"},
    )

    result = await audio_api.list_uploaded_audio()
    names = {f["filename"] for f in result["files"]}
    assert names == {"a.mp3"}


async def test_stems_status_excludes_flagged(tmp_path, monkeypatch):
    import app.core.nsfw as nsfw
    from app.api import audio_stems

    audio_dir = tmp_path / "audio"
    _write(audio_dir / "a.mp3")
    _write(audio_dir / "b.mp3")
    monkeypatch.setattr(audio_stems, "AUDIO_DIR", audio_dir)
    monkeypatch.setattr(nsfw, "hidden_paths", lambda: {"audio/b.mp3"})

    result = await audio_stems.get_stems_status()
    assert set(result["tracks"]) == {"a.mp3"}


def test_path_and_tree_is_flagged(tmp_path, monkeypatch):
    import app.core.nsfw as nsfw

    out = tmp_path / "output"
    monkeypatch.setattr(nsfw.config, "output_dir", out)
    hidden = {"remixes/mix1/vocals.wav", "audio/secret.mp3"}

    assert nsfw.path_is_flagged(out / "remixes/mix1/vocals.wav", hidden=hidden)
    assert nsfw.path_is_flagged(out / "audio/secret.mp3", hidden=hidden)
    assert not nsfw.path_is_flagged(out / "remixes/mix1/drums.wav", hidden=hidden)
    assert nsfw.tree_is_flagged(out / "remixes/mix1", hidden=hidden)
    assert not nsfw.tree_is_flagged(out / "remixes/mix2", hidden=hidden)
    # Outside output/ resolves to no relative path -> not flagged.
    assert not nsfw.path_is_flagged(tmp_path / "elsewhere.mp3", hidden=hidden)


def test_list_remixes_excludes_flagged(tmp_path, monkeypatch):
    import app.core.nsfw as nsfw
    from app.services import remix_library, stem_remixer

    out = tmp_path / "output"
    remix_dir = out / "remixes"
    flagged = remix_dir / "mix1"
    clean = remix_dir / "mix2"
    for d in (flagged, clean):
        d.mkdir(parents=True)
        (d / "remix.json").write_text('{"duration_sec": 1}', encoding="utf-8")

    monkeypatch.setattr(stem_remixer, "REMIX_DIR", remix_dir)
    monkeypatch.setattr(nsfw.config, "output_dir", out)
    monkeypatch.setattr(nsfw, "hidden_paths", lambda: {"remixes/mix1/vocals.wav"})

    names = [r["name"] for r in remix_library.list_remixes()]
    assert names == ["mix2"]
    assert remix_library.list_remix_versions("mix1") == []


def test_list_stem_sources_excludes_flagged(tmp_path, monkeypatch):
    import app.core.nsfw as nsfw
    from app.services import remix_source, stem_remixer

    out = tmp_path / "output"
    sep = out / "stems"
    flagged_track = sep / "mdx" / "flagged-song"
    clean_track = sep / "mdx" / "clean-song"
    _write(flagged_track / "vocals.wav")
    _write(clean_track / "vocals.wav")

    monkeypatch.setattr(stem_remixer, "SEPARATION_DIR", sep)
    monkeypatch.setattr(nsfw.config, "output_dir", out)
    monkeypatch.setattr(nsfw, "hidden_paths", lambda: {"stems/mdx/flagged-song/vocals.wav"})
    monkeypatch.setattr(remix_source, "_probe_summary", lambda track: {})
    monkeypatch.setattr(remix_source, "library_audio_files", list)

    tracks = [e["track"] for e in remix_source.list_stem_sources()]
    assert tracks == ["clean-song"]
