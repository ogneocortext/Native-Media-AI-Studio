"""
Output directory scanner.

Extracted from outputs.py. Contains the in-memory cache, directory
scanning, sidecar detection, and audio field extraction used by the
outputs listing endpoints.
"""

from __future__ import annotations

import json
import logging
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from ..core.config import config
from ..core.paths import comfyui_output_dir
from ..services.subprocess_runner import run_subprocess_thread as _run_subprocess_thread
from .outputs_models import OutputFile, get_file_type

logger = logging.getLogger(__name__)

# Sidecar extensions cleaned/renamed alongside a media file.
_SIDECAR_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def _sidecar_candidates(full_path: Path) -> list[Path]:
    """Sidecar candidates for a media file.

    Covers the JSON sidecars (``file.ext.json`` + plain ``file.json``) and
    image sidecars (``with_suffix`` + stem-based). Consolidates the three
    hand-rolled variants previously in ``bulk_delete`` / ``delete_output`` /
    ``rename_output`` (which also drifted: bulk_delete checked an extra
    ``Path(str + ".json")`` form the others missed).
    """
    cands = [
        full_path.with_suffix(full_path.suffix + ".json"),
        full_path.with_suffix(".json"),
        Path(str(full_path) + ".json"),
    ]
    for ext in _SIDECAR_IMAGE_EXTS:
        cands.extend((full_path.with_suffix(ext), full_path.with_name(full_path.stem + ext)))
    return cands


def _sidecar_rename_pairs(full_path: Path, new_path: Path) -> list[tuple[Path, Path]]:
    """(old, new) sidecar pairs for a rename.

    Every candidate name starts with the old stem, so the new name swaps
    in the new stem and keeps the remainder (``clip.mp4.json`` ->
    ``clip2.mp4.json``).
    """
    pairs = []
    old_stem, new_stem = full_path.stem, new_path.stem
    for old_cand in _sidecar_candidates(full_path):
        if not old_cand.name.startswith(old_stem):
            continue
        new_cand = new_path.with_name(new_stem + old_cand.name[len(old_stem) :])
        pairs.append((old_cand, new_cand))
    return pairs


# =============================================================================
# In-memory cache for output directory listing
# =============================================================================
_output_cache: dict[str, Any] = {
    "files": [],
    "mtime": 0,
    "timestamp": 0,
}
_output_cache_lock = threading.Lock()
CACHE_TTL_SECONDS = 30  # Refresh cache every 30 seconds max


def _get_dir_mtime() -> float:
    """Get the latest mtime across all output subdirectories (recursive)."""
    output_base = Path(config.output_dir)
    latest = 0.0
    for subdir in ["images", "video", "audio", "previews", "generated_3d"]:
        dir_path = output_base / subdir
        if dir_path.exists():
            try:
                mtime = dir_path.stat().st_mtime
                latest = max(latest, mtime)
                for f in dir_path.rglob("*"):
                    try:
                        if f.is_file():
                            latest = max(latest, f.stat().st_mtime)
                    except OSError:
                        continue
            except OSError:
                pass
    # Also watch ComfyUI output dir for 3D asset changes
    comfyui_output = comfyui_output_dir()
    if comfyui_output.exists():
        try:
            latest = max(latest, comfyui_output.stat().st_mtime)
            for f in comfyui_output.rglob("*"):
                try:
                    if f.is_file():
                        latest = max(latest, f.stat().st_mtime)
                except OSError:
                    continue
        except OSError:
            pass
    return latest


def _build_media_stem_set(dir_path: Path) -> dict[Path, set[str]]:
    """Pre-compute {parent_dir: set_of_media_stems} for O(1) sidecar lookups."""
    media_exts = {
        ".mp3", ".wav", ".flac", ".ogg", ".oga", ".opus",
        ".m4a", ".aac", ".wma", ".mp4", ".webm", ".mov",
        ".mkv", ".m4v", ".avi",
    }
    stems_by_dir: dict[Path, set[str]] = {}
    try:
        for f in dir_path.rglob("*"):
            try:
                if f.is_file() and f.suffix.lower() in media_exts:
                    stems_by_dir.setdefault(f.parent, set()).add(f.stem)
            except OSError:
                continue
    except OSError:
        pass
    return stems_by_dir


def _is_cover_sidecar(file_path: Path, media_stems: set[str] | None = None) -> bool:
    """True if an image file is a cover/thumbnail sidecar of a sibling media file.

    A sidecar shares its stem with a sibling audio/video file, e.g.
    ``track.mp3`` + ``track.jpg``. Standalone artwork (no matching media
    sibling) is NOT a sidecar and must be listed as an image.

    Pass ``media_stems`` (a set of sibling stems for ``file_path.parent``)
    to turn this into O(1) per file instead of iterating the directory.
    """
    if file_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
        return False
    stem = file_path.stem
    if media_stems is not None:
        return stem in media_stems
    # Fallback: iterate siblings (slow, kept for backward compatibility)
    try:
        for sibling in file_path.parent.iterdir():
            try:
                if (
                    sibling.is_file()
                    and sibling.stem == stem
                    and sibling.suffix.lower()
                    in {
                        ".mp3", ".wav", ".flac", ".ogg", ".oga", ".opus",
                        ".m4a", ".aac", ".wma", ".mp4", ".webm", ".mov",
                        ".mkv", ".m4v", ".avi",
                    }
                ):
                    return True
            except OSError:
                continue
    except OSError:
        pass
    return False


def _extract_audio_fields(metadata: dict | None) -> dict:
    """Extract duration, loudness, and downsampled waveform from sidecar metadata.

    Sidecar JSON (written by go-worker or Python analysis) may contain:
      - duration_seconds: float
      - loudness_lufs or integrated_lufs: float
      - waveform: { amplitude_envelope: [...], rms_energy: [...], sample_rate: int }
      - or flattened: amplitude_envelope: [...], rms_energy: [...]

    The waveform is downsampled to ~50 points to keep the listing response small.
    Returns a dict with keys: duration_seconds, loudness_lufs, waveform.
    """
    result: dict = {}
    if not metadata:
        return result

    # Duration
    for key in ("duration_seconds", "duration"):
        if key in metadata and metadata[key] is not None:
            try:
                result["duration_seconds"] = float(metadata[key])
                break
            except (TypeError, ValueError):
                pass

    # Loudness (LUFS)  # noqa: ERA001
    for key in ("loudness_lufs", "integrated_lufs", "loudness"):
        if key in metadata and metadata[key] is not None:
            try:
                result["loudness_lufs"] = float(metadata[key])
                break
            except (TypeError, ValueError):
                pass

    # Waveform: try nested object first, then flattened
    envelope: list | None = None
    if metadata.get("waveform") and isinstance(metadata["waveform"], dict):
        wf = metadata["waveform"]
        for key in ("amplitude_envelope", "rms_energy", "envelope"):
            if key in wf and isinstance(wf[key], list):
                envelope = wf[key]
                break
    if envelope is None:
        for key in ("amplitude_envelope", "rms_energy", "envelope", "waveform"):
            if key in metadata and isinstance(metadata[key], list):
                envelope = metadata[key]
                break
    if envelope:
        n = len(envelope)
        if n > 50:
            indices = [int(i * n / 50) for i in range(50)]
            result["waveform"] = [float(envelope[i]) for i in indices]
        else:
            result["waveform"] = [float(v) for v in envelope]

    return result


def _iter_media_files(dir_path: Path):
    """Yield media files under dir_path, recursing into subdirectories."""
    try:
        for file_path in sorted(dir_path.rglob("*")):
            try:
                if not file_path.is_file():
                    continue
            except OSError:
                continue
            yield file_path
    except OSError:
        return


def _scan_with_cache() -> list[OutputFile]:
    """Scan outputs with in-memory caching."""
    import time

    now = time.time()
    current_mtime = _get_dir_mtime()

    # Return cache if still valid (thread-safe read)
    with _output_cache_lock:
        cache = _output_cache
        if (
            cache["files"]
            and now - cache["timestamp"] < CACHE_TTL_SECONDS
            and cache["mtime"] >= current_mtime
        ):
            return cache["files"]

    # Cache miss - scan directory recursively (without FFmpeg - fast metadata only)
    all_outputs: list[OutputFile] = []
    output_base = Path(config.output_dir)

    # Scan standard output directories (recursive: nested folders included)
    for subdir in ["images", "video", "audio", "generated_3d", "remixes"]:
        dir_path = output_base / subdir
        if not dir_path.exists():
            continue

        # Pre-compute media stems for O(1) sidecar lookups instead of O(N^2)
        media_stems = _build_media_stem_set(dir_path)

        for file_path in _iter_media_files(dir_path):
            if file_path.suffix.lower() == ".json":
                continue
            # Skip cover/thumbnail sidecars in audio/video folders (they share
            # a stem with a sibling media file). Standalone artwork is kept.
            if subdir in ("audio", "video") and _is_cover_sidecar(
                file_path, media_stems.get(file_path.parent)
            ):
                continue

            try:
                stat = file_path.stat()
            except OSError:
                continue

            # Skip broken renders: 1x1 placeholder PNGs (70 bytes) and tiny files
            # These are failed ComfyUI outputs that clutter the library with red thumbnails
            if stat.st_size < 1024 and file_path.suffix.lower() in (
                ".png", ".jpg", ".jpeg", ".webp",
            ):
                continue
            if stat.st_size < 10240 and file_path.suffix.lower() in (
                ".gif", ".mp4", ".webm", ".mov",
            ):
                continue

            # Fast metadata load (no FFmpeg)
            metadata = load_sidecar_metadata(file_path)
            file_type = get_file_type(file_path.name)
            rel_path = file_path.relative_to(output_base).as_posix()
            cover_rel = _find_cover_cached(file_path, subdir, output_base)

            # Extract audio analysis fields from sidecar metadata
            audio_fields = _extract_audio_fields(metadata) if file_type == "audio" else {}

            all_outputs.append(
                OutputFile(
                    filename=file_path.name,
                    path=str(file_path),
                    relative_path=rel_path,
                    file_type=file_type,
                    size_bytes=stat.st_size,
                    created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    cover_image=cover_rel,
                    has_cover=cover_rel is not None,
                    metadata=metadata,
                    job_id=metadata.get("job_id") if metadata else None,
                    **audio_fields,
                )
            )

    # Scan ComfyUI output directory for 3D assets
    comfyui_output = comfyui_output_dir()
    if comfyui_output.exists():
        for glb_file in comfyui_output.rglob("*.glb"):
            try:
                stat = glb_file.stat()
                rel_path = f"comfyui/{glb_file.relative_to(comfyui_output).as_posix()}"
                all_outputs.append(
                    OutputFile(
                        filename=glb_file.name,
                        path=str(glb_file),
                        relative_path=rel_path,
                        file_type="3d",
                        size_bytes=stat.st_size,
                        created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
                        modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        cover_image=None,
                        has_cover=False,
                        metadata={},
                        job_id=None,
                    )
                )
            except OSError:
                continue

    all_outputs.sort(key=lambda x: x.created_at, reverse=True)

    # Update cache (thread-safe write)
    with _output_cache_lock:
        _output_cache["files"] = all_outputs
        _output_cache["mtime"] = current_mtime
        _output_cache["timestamp"] = now

    return all_outputs


def _invalidate_cache() -> None:
    """Clear the directory-listing cache (call after delete/rename/bulk ops)."""
    try:
        with _output_cache_lock:
            _output_cache["files"] = []
            _output_cache["mtime"] = 0
            _output_cache["timestamp"] = 0
    except Exception:
        pass


def _find_cover_cached(file_path: Path, subdir: str, output_base: Path) -> str | None:
    """Find an existing cover/thumbnail sidecar image path.

    Only top-level audio/video files get cover detection here (see
    ``scan_output_directory``). Returns the relative path from output_base
    if a sidecar exists, else None.
    """
    if subdir not in ("audio", "video"):
        return None
    try:
        if file_path.parent.name != subdir:
            return None
    except Exception:
        return None
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = file_path.with_suffix(ext)
        if cand.exists():
            try:
                return cand.relative_to(output_base).as_posix()
            except ValueError:
                pass
        cand2 = file_path.with_name(file_path.stem + ext)
        if cand2.exists():
            try:
                return cand2.relative_to(output_base).as_posix()
            except ValueError:
                pass
    return None


def _has_cover_cached(file_path: Path, subdir: str, output_base: Path) -> bool:
    """Check if a cover image exists (without FFmpeg)."""
    return _find_cover_cached(file_path, subdir, output_base) is not None


def load_sidecar_metadata(file_path: Path) -> dict | None:
    """Load JSON sidecar metadata if it exists.

    The convention is ``<stem>.json`` - the same directory, the filename without
    its media extension. `go-worker`'s `sidecarPath` does exactly that
    (`filepath.Join(outputDir, filename + ".json")`, where filename is the
    stem), and the Python fallback in `image_generator.save_output` does too.

    This previously looked for `<stem>.png.json`, which *nobody writes*.
    Measured against the real library: 0 files matching `*.png.json` against 38
    real sidecars, so no image ever showed its prompt, seed or model in the
    media library. The odd-looking images were unverifiable partly because the
    metadata beside them was unreachable.
    """
    candidates = [
        file_path.with_suffix(".json"),
        # Kept as a fallback in case an older writer used it.
        file_path.with_suffix(file_path.suffix + ".json"),
    ]
    for sidecar_path in candidates:
        if not sidecar_path.exists():
            continue
        try:
            with open(sidecar_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            # A malformed sidecar should not hide the next candidate.
            logger.debug("unreadable sidecar %s", sidecar_path)
    return None


async def _is_video_corrupted(video_path: Path) -> bool:
    """Check if a video file is corrupted/incomplete (missing moov atom, etc.)."""

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False

    try:
        probe = await _run_subprocess_thread(
            [ffmpeg, "-hide_banner", "-i", str(video_path)],
            capture_output=True,
            text=True,
        )
        stderr = (probe.stderr or "") + (probe.stdout or "")
        error_indicators = [
            "moov atom not found",
            "invalid data found",
            "error reading header",
            "invalid argument",
            "end of file",
        ]
        return any(err in stderr.lower() for err in error_indicators)
    except Exception:
        return False


async def extract_video_thumbnail(video_path: Path, relative_base: Path) -> str | None:
    """Extract a poster frame from a video file using FFmpeg.

    Checks for existing {stem}.jpg first (cached). If missing, probes video duration
    and extracts a frame at 10% of playback (or 1s, whichever is greater).
    Saves as sidecar .jpg. Returns relative cover path if successful, else None.
    """
    # 1) Check existing sidecar image
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = video_path.with_suffix(ext)
        if cand.exists():
            try:
                return cand.relative_to(relative_base).as_posix()
            except ValueError:
                continue
        cand2 = video_path.with_name(video_path.stem + ext)
        if cand2.exists():
            try:
                return cand2.relative_to(relative_base).as_posix()
            except ValueError:
                continue

    # 2) Try FFmpeg frame extraction
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    cover_path = video_path.with_suffix(".jpg")

    try:
        # Probe duration first to pick a good frame time
        probe = await _run_subprocess_thread(
            [ffmpeg, "-hide_banner", "-i", str(video_path)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        stderr = (probe.stderr or "") + (probe.stdout or "")

        # Extract duration from FFmpeg output (e.g., "Duration: 00:05:23.45")
        duration_sec = 0.0
        if "Duration:" in stderr:
            try:
                dur_str = stderr.split("Duration:")[1].split(",")[0].strip()
                parts = dur_str.split(":")
                duration_sec = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            except (ValueError, IndexError):
                duration_sec = 0.0

        # Seek to 10% of duration or 1 second, whichever is greater
        seek_time = max(1.0, duration_sec * 0.1) if duration_sec > 0 else 1.0

        result = await _run_subprocess_thread(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{seek_time:.1f}",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-q:v",
                "3",
                "-vf",
                "scale=480:-2",
                str(cover_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and cover_path.exists() and cover_path.stat().st_size > 1024:
            try:
                return cover_path.relative_to(relative_base).as_posix()
            except ValueError:
                return None
        # Cleanup failed/empty file
        if cover_path.exists() and cover_path.stat().st_size < 1024:
            try:
                cover_path.unlink()  # type: ignore
            except Exception:
                pass
    except Exception:
        pass
    return None
