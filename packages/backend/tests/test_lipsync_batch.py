"""Tests for the lip-sync batch planning logic (D42 extension).

Covers the pure functions in services/lipsync/batch.py: chunk planning,
manifest round-trip, path resolution, and ffmpeg command construction.
No GPU, FastAPI, or ffmpeg binary needed.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.services.lipsync.batch import (  # noqa: E402
    Chunk,
    batch_dir,
    build_manifest,
    chunk_audio_path,
    chunk_output_path,
    chunk_video_path,
    concat_list_content,
    manifest_path,
    new_batch_id,
    plan_chunks,
    probe_duration_cmd,
    read_manifest,
    resolve_manifest_paths,
    split_audio_cmd,
    split_video_cmd,
    stitch_cmd,
    write_manifest,
)


def test_plan_chunks_even_split():
    chunks = plan_chunks(240.0, 20.0)
    assert len(chunks) == 12
    assert chunks[0] == Chunk(index=0, start=0.0, length=20.0)
    assert chunks[11] == Chunk(index=11, start=220.0, length=20.0)


def test_plan_chunks_remainder():
    chunks = plan_chunks(45.0, 20.0)
    assert len(chunks) == 3
    assert chunks[2].start == 40.0
    assert chunks[2].length == 5.0


def test_plan_chunks_shorter_than_chunk():
    chunks = plan_chunks(10.0, 20.0)
    assert len(chunks) == 1
    assert chunks[0].length == 10.0


def test_plan_chunks_cover_full_duration():
    chunks = plan_chunks(239.708, 20.0)
    total = sum(c.length for c in chunks)
    assert total == pytest.approx(239.708, abs=0.01)
    # Contiguous: each chunk starts where the previous ended
    for prev, cur in zip(chunks, chunks[1:], strict=False):
        assert cur.start == pytest.approx(prev.start + prev.length, abs=0.01)


def test_plan_chunks_rejects_bad_input():
    with pytest.raises(ValueError):
        plan_chunks(0, 20.0)
    with pytest.raises(ValueError):
        plan_chunks(60.0, 0)


def test_new_batch_id_shape():
    bid = new_batch_id()
    assert len(bid) == 12
    int(bid, 16)  # hex


def test_manifest_roundtrip(tmp_path):
    chunks = plan_chunks(40.0, 20.0)
    manifest = build_manifest(
        batch_id="abc123",
        source_kind="image",
        source_path="/img/portrait.png",
        audio_path="/audio/song.wav",
        chunk_seconds=20.0,
        duration_s=40.0,
        chunks=chunks,
        job_ids=["job-0", "job-1"],
        final_output="/out/final.mp4",
    )
    assert len(manifest["chunks"]) == 2
    assert manifest["chunks"][0]["job_id"] == "job-0"
    assert manifest["chunks"][1]["video_chunk"] is None  # image source: no video chunks
    assert manifest["stitched"] is False

    mpath = tmp_path / "manifest.json"
    write_manifest(mpath, manifest)
    assert json.loads(mpath.read_text())["batch_id"] == "abc123"
    assert read_manifest(mpath)["final_output"] == "/out/final.mp4"


def test_resolve_manifest_paths(tmp_path):
    chunks = plan_chunks(20.0, 20.0)
    manifest = build_manifest(
        batch_id="abc123",
        source_kind="video",
        source_path="/v/clip.mp4",
        audio_path="/a/song.wav",
        chunk_seconds=20.0,
        duration_s=20.0,
        chunks=chunks,
        job_ids=["job-0"],
        final_output="/out/final.mp4",
    )
    bdir = tmp_path / "batch"
    resolved = resolve_manifest_paths(manifest, bdir)
    c0 = resolved["chunks"][0]
    assert c0["audio_chunk"] == str(bdir / "audio_chunk_000.wav")
    assert c0["video_chunk"] == str(bdir / "video_chunk_000.mp4")
    assert c0["output_path"] == str(bdir / "chunk_000_lipsync.mp4")


def test_path_helpers(tmp_path):
    assert chunk_audio_path(tmp_path, 3).name == "audio_chunk_003.wav"
    assert chunk_video_path(tmp_path, 3).name == "video_chunk_003.mp4"
    assert chunk_output_path(tmp_path, 3).name == "chunk_003_lipsync.mp4"
    assert manifest_path(tmp_path, "bid").name == "manifest.json"
    assert batch_dir(tmp_path, "bid").name == "bid"


def test_concat_list_content():
    content = concat_list_content(["/a/1.mp4", "/a/2.mp4"])
    assert content == "file '/a/1.mp4'\nfile '/a/2.mp4'\n"


def test_split_audio_cmd_frame_accurate():
    cmd = split_audio_cmd("ffmpeg", "in.wav", 20.0, 20.0, "out.wav")
    # -ss AFTER -i: frame-accurate cuts (keyframe seeking would misalign A/V)
    assert cmd.index("-ss") > cmd.index("-i")
    assert "-c:a" in cmd and "pcm_s16le" in cmd


def test_split_video_cmd_drops_audio():
    cmd = split_video_cmd("ffmpeg", "in.mp4", 0.0, 20.0, "out.mp4")
    assert "-an" in cmd  # chunk audio is passed separately; halve the encode work
    assert "libx264" in cmd


def test_stitch_cmd_uses_concat_demuxer():
    cmd = stitch_cmd("ffmpeg", "list.txt", "final.mp4")
    assert "-f" in cmd and "concat" in cmd
    assert "-c" in cmd and "copy" in cmd  # same codec from one inference run


def test_probe_duration_cmd():
    cmd = probe_duration_cmd("ffprobe", "song.wav")
    assert cmd[0] == "ffprobe"
    assert "format=duration" in cmd
