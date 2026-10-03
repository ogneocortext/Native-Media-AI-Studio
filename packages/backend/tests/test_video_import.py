"""Tests for video -> .m4a extraction.

The ffmpeg-backed cases skip when ffmpeg is absent, so the suite still runs on a
machine without it. The real Suno files in output/audio/Suno-V6-Mini/ are mp4
with AAC audio, which is exactly the copy-first path these tests exercise.
"""

import shutil
import subprocess

import pytest
from app.services.video_import import (
    AUDIO_EXTENSIONS,
    VIDEO_EXTENSIONS,
    ExtractionResult,
    extract_audio,
    ffmpeg_path,
    is_audio_name,
    is_video_name,
    target_stem,
)

HAS_FFMPEG = ffmpeg_path() is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not on PATH")


class TestClassification:
    def test_video_extensions_include_mp4(self):
        assert ".mp4" in VIDEO_EXTENSIONS

    def test_is_video_name(self):
        assert is_video_name("SunoV6Mini-The Last-Original-V2.mp4")
        assert is_video_name("CLIP.MOV")
        assert not is_video_name("track.mp3")
        assert not is_video_name("track.m4a")

    def test_is_audio_name(self):
        assert is_audio_name("track.m4a")
        assert is_audio_name("track.wav")
        assert not is_audio_name("track.mp4")

    def test_audio_and_video_sets_do_not_overlap(self):
        # A format being in both sets would make the upload route ambiguous.
        assert not (AUDIO_EXTENSIONS & VIDEO_EXTENSIONS)

    def test_target_stem_drops_extension_only(self):
        assert target_stem("Song Final.mp4") == "Song Final"
        assert target_stem("no-extension") == "no-extension"


class TestExtractAudio:
    @needs_ffmpeg
    def test_converts_a_real_mp4_to_m4a_losslessly(self, tmp_path):
        src = tmp_path / "clip.mp4"
        dest = tmp_path / "clip.m4a"
        # 2s of video with a silent AAC track — same shape as the Suno drafts.
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
             "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
             "-shortest", "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k", str(src)],
            check=True, capture_output=True,
        )
        assert src.exists()

        result = extract_audio(src, dest)

        assert result.ok, result.detail
        assert dest.exists() and dest.stat().st_size > 0
        assert result.lossless, "AAC source should be a stream copy, not a re-encode"
        # No video stream survives into an .m4a.
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
             "stream=codec_type", "-of", "csv=p=0", str(dest)],
            capture_output=True, text=True,
        )
        assert probe.stdout.strip() == "", "video stream leaked into the m4a"

    def test_reports_failure_without_ffmpeg(self, tmp_path):
        src = tmp_path / "x.mp4"
        src.write_bytes(b"not really a video")
        result = extract_audio(src, tmp_path / "x.m4a", ffmpeg="")
        assert isinstance(result, ExtractionResult)
        assert not result.ok

    @needs_ffmpeg
    def test_garbage_input_fails_and_leaves_no_partial_file(self, tmp_path):
        src = tmp_path / "junk.mp4"
        src.write_bytes(b"\x00\x01\x02 not a video at all")
        dest = tmp_path / "junk.m4a"

        result = extract_audio(src, dest)

        assert not result.ok
        assert not dest.exists(), "failed conversion left a partial m4a behind"
        assert src.exists(), "the source must never be deleted"

    def test_result_reports_why_it_failed(self, tmp_path):
        src = tmp_path / "junk.mp4"
        src.write_bytes(b"nope")
        result = extract_audio(src, tmp_path / "junk.m4a")
        assert result.ok is False
        assert result.detail, "a failure must explain itself"

    @pytest.mark.skipif(HAS_FFMPEG, reason="only meaningful without ffmpeg")
    def test_missing_ffmpeg_is_reported_clearly(self, tmp_path):
        src = tmp_path / "x.mp4"
        src.write_bytes(b"x")
        result = extract_audio(src, tmp_path / "x.m4a", ffmpeg=None)
        assert not result.ok
        assert "ffmpeg" in result.detail.lower()


def test_ffmpeg_path_matches_shutil():
    assert ffmpeg_path() == shutil.which("ffmpeg")
