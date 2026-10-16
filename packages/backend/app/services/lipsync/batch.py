"""Batch lip-sync planning: chunk long audio/video into per-chunk jobs, then stitch.

This is the FreeLipSync-style workflow made local: a 4-minute song becomes
twelve 20-second LIPSYNC jobs (each with flat VRAM), concatenated afterwards.

Pure planning logic lives here so it is unit-testable without a GPU, FastAPI,
or ffmpeg (D23 precedent). The actual ffmpeg/ffprobe invocations are thin
async helpers at the bottom, called by the routes in api/video.py.
"""

import json
import logging
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: Manifests live beside the outputs they describe (D21: file-based state).
BATCH_DIRNAME = ".lipsync_batches"


@dataclass
class Chunk:
    index: int
    start: float  # seconds into the source
    length: float  # seconds


def plan_chunks(duration_s: float, chunk_seconds: float) -> list[Chunk]:
    """Split a duration into (start, length) chunks; the last takes the remainder."""
    if duration_s <= 0:
        raise ValueError(f"duration must be positive, got {duration_s}")
    if chunk_seconds <= 0:
        raise ValueError(f"chunk_seconds must be positive, got {chunk_seconds}")
    chunks: list[Chunk] = []
    index = 0
    start = 0.0
    # Round to 3 decimals to keep ffmpeg args clean; the last chunk absorbs drift.
    while start < duration_s:
        length = min(chunk_seconds, duration_s - start)
        chunks.append(Chunk(index=index, start=round(start, 3), length=round(length, 3)))
        start += chunk_seconds
        index += 1
    return chunks


def new_batch_id() -> str:
    return uuid.uuid4().hex[:12]


def batch_dir(project_root: Path, batch_id: str) -> Path:
    return project_root / "output" / "video" / BATCH_DIRNAME / batch_id


def manifest_path(project_root: Path, batch_id: str) -> Path:
    return batch_dir(project_root, batch_id) / "manifest.json"


def chunk_audio_path(batch_path: Path, index: int) -> Path:
    return batch_path / f"audio_chunk_{index:03d}.wav"


def chunk_video_path(batch_path: Path, index: int) -> Path:
    return batch_path / f"video_chunk_{index:03d}.mp4"


def chunk_output_path(batch_path: Path, index: int) -> Path:
    return batch_path / f"chunk_{index:03d}_lipsync.mp4"


def build_manifest(
    *,
    batch_id: str,
    source_kind: str,  # "video" | "image"
    source_path: str,
    audio_path: str,
    chunk_seconds: float,
    duration_s: float,
    chunks: list[Chunk],
    job_ids: list[str],
    final_output: str,
) -> dict:
    """Assemble the batch manifest dict (JSON-serializable)."""
    return {
        "batch_id": batch_id,
        "source_kind": source_kind,
        "source_path": source_path,
        "audio_path": audio_path,
        "chunk_seconds": chunk_seconds,
        "duration_s": duration_s,
        "final_output": final_output,
        "stitched": False,
        "chunks": [
            {
                "index": c.index,
                "start": c.start,
                "length": c.length,
                "job_id": job_ids[c.index],
                "audio_chunk": str(chunk_audio_path(Path(), c.index)),
                "video_chunk": (
                    str(chunk_video_path(Path(), c.index)) if source_kind == "video" else None
                ),
                "output_path": str(chunk_output_path(Path(), c.index)),
            }
            for c in chunks
        ],
    }


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def read_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_manifest_paths(manifest: dict, batch_path: Path) -> dict:
    """Rewrite the relative chunk paths in a manifest against its batch dir."""
    out = dict(manifest)
    out["chunks"] = [
        {
            **c,
            "audio_chunk": str(batch_path / Path(c["audio_chunk"]).name),
            "video_chunk": (
                str(batch_path / Path(c["video_chunk"]).name) if c["video_chunk"] else None
            ),
            "output_path": str(batch_path / Path(c["output_path"]).name),
        }
        for c in manifest["chunks"]
    ]
    return out


def concat_list_content(output_paths: list[str]) -> str:
    """Build the ffmpeg concat-demuxer file list. Paths are single-quoted."""
    lines = [
        f"file '{p.replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'" for p in output_paths
    ]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# ffmpeg command builders (pure: return argv, never execute)
# ---------------------------------------------------------------------------


def probe_duration_cmd(ffprobe: str, media_path: str) -> list[str]:
    return [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        media_path,
    ]


def split_audio_cmd(ffmpeg: str, src: str, start: float, length: float, dest: str) -> list[str]:
    # -ss after -i: frame-accurate cuts (keyframe seeking would misalign A/V).
    return [
        ffmpeg,
        "-y",
        "-v",
        "error",
        "-i",
        src,
        "-ss",
        str(start),
        "-t",
        str(length),
        "-c:a",
        "pcm_s16le",
        dest,
    ]


def split_video_cmd(ffmpeg: str, src: str, start: float, length: float, dest: str) -> list[str]:
    # Video chunk is only the visual source; the chunk audio is passed
    # separately, so drop the audio stream (-an) to halve the encode work.
    return [
        ffmpeg,
        "-y",
        "-v",
        "error",
        "-i",
        src,
        "-ss",
        str(start),
        "-t",
        str(length),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-an",
        dest,
    ]


def stitch_cmd(ffmpeg: str, list_file: str, dest: str) -> list[str]:
    # All chunks share codec/container from the same inference run: -c copy.
    return [
        ffmpeg,
        "-y",
        "-v",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list_file,
        "-c",
        "copy",
        dest,
    ]


def find_ffmpeg() -> tuple[str, str]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not on PATH")
    if not ffprobe:
        raise RuntimeError("ffprobe not on PATH")
    return ffmpeg, ffprobe
