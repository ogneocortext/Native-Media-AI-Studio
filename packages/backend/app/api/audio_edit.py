"""
Audio file editing endpoints, split out of app/api/audio.py.

Owns: /extract, /rename, /trim, /file/{filename}.

Split for size, not behaviour: paths, methods and operation ids are unchanged,
and main.py includes this router alongside audio.py, so /api/audio is
unchanged. tools/snapshot-audio-routes.py --check is the guard.

Like audio_stems.py, this module mirrors the handful of constants it shares
with audio.py rather than importing audio.py, which would be circular if audio.py
ever needs anything from here.

Note the snapshot cannot see a missing import: OpenAPI is built from decorators
and never runs a handler body, py_compile does not resolve free variables, and a
plain import only proves the module-level statements work. Exercise the
endpoints.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

# Mirrors audio.py - same values, same derivation. Must not drift.
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".wma", ".aac"}

router = APIRouter(prefix="/api/audio", tags=["Audio"])

class RenameAudioRequest(BaseModel):
    """Request model for renaming an audio file."""

    old_filename: str
    new_filename: str


class ExtractAudioRequest(BaseModel):
    """Extract the audio track from a video file into the audio library.

    Optional `start`/`end` (seconds) extract only that segment directly,
    saving a round-trip through the trim endpoint. Omit both for the full
    audio track.
    """
    source_path: str  # output-relative ("video/foo.mp4") or absolute under PROJECT_ROOT
    format: str = "original"  # "original" = lossless stream copy (best quality); "mp3" = re-encode
    bitrate: str = "192k"  # only used when format == "mp3": one of 128k, 192k, 320k
    start: float | None = None  # segment start in seconds (default 0)
    end: float | None = None    # segment end in seconds (default: end of stream)


def _find_ffmpeg() -> str | None:
    for name in ("ffmpeg", "ffmpeg.exe"):
        found = shutil.which(name)
        if found:
            return found
    return None


# Source audio codec -> container that supports a lossless stream copy.
_COPY_CONTAINER = {
    "aac": ".m4a",
    "alac": ".m4a",
    "mp3": ".mp3",
    "opus": ".opus",
    "vorbis": ".ogg",
    "flac": ".flac",
    "pcm_s16le": ".wav",
    "pcm_s24le": ".wav",
    "pcm_s32le": ".wav",
    "pcm_f32le": ".wav",
    "ac3": ".ac3",
    "eac3": ".eac3",
}


@router.post("/extract", response_model=dict)
async def extract_audio_from_video(body: ExtractAudioRequest) -> dict:
    """Extract a video's audio track to `output/audio/<name>.<ext>`.

    `format="original"` (default) probes the source audio codec first and
    remuxes it bit-for-bit into a matching container — no quality loss,
    near-instant, no wasted runs. `format="mp3"` re-encodes with libmp3lame
    at `bitrate`. Powers the Media Library "Extract Audio" panel — the result
    lands in the audio library so it can be analyzed on the Audio Analysis page.

    Optional `start`/`end` (seconds) extract only that segment in one ffmpeg
    pass, avoiding a second trim call.
    """
    from ..services.ffmpeg_tools import probe_media

    raw = (body.source_path or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="source_path is required")
    fmt = (body.format or "original").lower()
    if fmt not in ("original", "m4a", "mp3"):
        raise HTTPException(status_code=400, detail='format must be "original" or "mp3"')
    if fmt == "m4a":
        fmt = "original"  # legacy alias from the first iteration
    if fmt == "mp3" and body.bitrate not in ("128k", "192k", "320k"):
        raise HTTPException(status_code=400, detail="bitrate must be 128k, 192k or 320k")

    root = PROJECT_ROOT.resolve()
    candidate = Path(raw)
    src = (candidate if candidate.is_absolute() else (root / "output" / raw)).resolve()
    if not str(src).startswith(str(root)) or ".." in Path(raw).parts:
        raise HTTPException(status_code=400, detail="Invalid source_path")
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Source file not found: {body.source_path}")
    if src.suffix.lower() not in (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"):
        raise HTTPException(status_code=400, detail=f"Not a video file: {src.name}")

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="ffmpeg not found on PATH")

    # Segment bounds (None = full stream).
    seg_start: float | None = body.start if body.start is not None else None
    seg_end: float | None = body.end if body.end is not None else None
    if seg_start is not None and seg_start < 0:
        raise HTTPException(status_code=400, detail="start must be >= 0")
    if seg_start is not None and seg_end is not None and seg_end <= seg_start:
        raise HTTPException(status_code=400, detail="end must be > start")

    # Detect — don't guess: probe the actual audio codec before choosing a container.
    probe = await probe_media(src)
    audio_codec: str | None = None
    audio_rate: str | None = None
    for st in (probe.get("streams") or []):
        if st.get("codec_type") == "audio":
            audio_codec = (st.get("codec_name") or "").lower() or None
            sr = st.get("sample_rate")
            audio_rate = str(sr) if sr else None
            break
    if not audio_codec:
        raise HTTPException(status_code=400, detail=f"No audio track in {src.name}")

    def _fmt_ts(seconds: float | None) -> str:
        if seconds is None:
            return "end"
        m = int(seconds // 60)
        s = int(seconds % 60)
        return f"{m:02d}-{s:02d}"

    stem = re.sub(r"[^A-Za-z0-9_\- .()\[\]]", "", src.stem).strip() or "extracted"
    if seg_start is not None or seg_end is not None:
        stem = f"{stem}_{_fmt_ts(seg_start)}_to_{_fmt_ts(seg_end)}"
    lossless = False
    if fmt == "mp3":
        ext, cmd_mode = ".mp3", "encode"
    else:
        ext = _COPY_CONTAINER.get(audio_codec)
        cmd_mode = "copy" if ext else "encode-fallback"
        if not ext:
            ext = ".m4a"  # AAC-encode fallback below
    dst = AUDIO_DIR / f"{stem}{ext}"
    n = 1
    while dst.exists():
        n += 1
        dst = AUDIO_DIR / f"{stem}_{n}{ext}"

    def _cmd(mode: str) -> list[str]:
        # Segment flags go before -i for fast seek; for stream copy this is
        # accurate enough (cuts on packet boundaries). For re-encode we could
        # place -ss after -i for frame accuracy, but the current use cases
        # (music/voice) tolerate sub-frame drift at the edges.
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
        if seg_start is not None:
            cmd.extend(["-ss", str(seg_start)])
        cmd.extend(["-i", str(src)])
        if seg_end is not None:
            cmd.extend(["-to", str(seg_end)])
        cmd.extend(["-vn"])
        if mode == "copy":
            return [*cmd, "-c:a", "copy", str(dst)]
        if mode == "encode":
            return [*cmd, "-c:a", "libmp3lame", "-b:a", body.bitrate, str(dst)]
        return [*cmd, "-c:a", "aac", "-b:a", "192k", str(dst)]

    started = time.perf_counter()
    try:
        proc = await asyncio.to_thread(
            subprocess.run, _cmd(cmd_mode), capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Audio extraction timed out") from None
    if proc.returncode == 0:
        lossless = cmd_mode == "copy"
    elif cmd_mode == "copy":
        # Container rejected the codec despite the map (e.g. odd muxer limits) —
        # one AAC-encode fallback so the user still gets audio.
        try:
            proc = await asyncio.to_thread(
                subprocess.run, _cmd("encode-fallback"), capture_output=True, text=True, timeout=600,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Audio extraction timed out") from None
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-3:]
        detail = "; ".join(tail) if tail else "ffmpeg failed"
        raise HTTPException(status_code=400, detail=detail)
    if not dst.exists() or dst.stat().st_size == 0:
        raise HTTPException(status_code=400, detail=f"No audio track in {src.name}")

    # Best-effort segment duration: probe the output or derive from bounds.
    seg_duration: float | None = None
    try:
        out_probe = await probe_media(dst)
        seg_duration = float((out_probe.get("format") or {}).get("duration") or 0) or None
    except Exception:
        if seg_start is not None and seg_end is not None:
            seg_duration = max(0.0, seg_end - seg_start)
        elif seg_start is not None:
            src_dur = float((probe.get("format") or {}).get("duration") or 0)
            seg_duration = max(0.0, src_dur - seg_start)

    rel = dst.resolve().relative_to(root).as_posix()
    if rel.startswith("output/"):
        rel = rel[len("output/"):]  # output-relative, e.g. "audio/x.m4a" (getOutputUrl convention)
    return {
        "success": True,
        "filename": dst.name,
        "relative_path": rel,
        "stored_path": str(dst),
        "size_bytes": dst.stat().st_size,
        "render_s": round(time.perf_counter() - started, 1),
        "lossless": lossless,
        "source_codec": audio_codec,
        "source_sample_rate": audio_rate,
        "segment_start": seg_start,
        "segment_end": seg_end,
        "segment_duration": seg_duration,
        "message": f"Extracted {dst.name}",
    }


@router.post("/rename", response_model=dict)
async def rename_audio(body: RenameAudioRequest) -> dict:
    """Rename an audio file."""
    old_filename = body.old_filename
    new_filename = body.new_filename

    if not old_filename or not new_filename:
        raise HTTPException(status_code=400, detail="Both old_filename and new_filename are required")

    if ".." in old_filename or ".." in new_filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Security: resolve both paths and ensure they stay within AUDIO_DIR
    old_path = (AUDIO_DIR / old_filename).resolve()
    new_path = (AUDIO_DIR / new_filename).resolve()
    if not str(old_path).startswith(str(AUDIO_DIR.resolve())) or not old_path.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {old_filename}")
    if not str(new_path).startswith(str(AUDIO_DIR.resolve())):
        raise HTTPException(status_code=400, detail="New path escapes audio directory")

    if new_path.exists():
        raise HTTPException(status_code=409, detail=f"A file with that name already exists: {new_filename}")

    old_path.rename(new_path)

    return {"success": True, "old_filename": old_filename, "new_filename": new_filename}


class TrimRange(BaseModel):
    """One [start, end) interval in seconds."""
    start: float
    end: float


class TrimAudioRequest(BaseModel):
    """Cut or keep time ranges of an audio library file, saving the result as new file."""
    filename: str  # existing file in output/audio
    mode: str = "keep"  # "keep" = save only ranges[0]; "remove" = cut ranges out, keep the rest
    ranges: list[TrimRange]


def _clamp_merge_ranges(ranges: list[tuple[float, float]], duration: float) -> list[tuple[float, float]]:
    """Clamp intervals to [0, duration], drop empties, sort and merge overlaps."""
    cleaned: list[tuple[float, float]] = []
    for start, end in ranges:
        s = max(0.0, min(float(start), duration))
        e = max(0.0, min(float(end), duration))
        if e - s > 0.01:
            cleaned.append((s, e))
    cleaned.sort()
    merged: list[tuple[float, float]] = []
    for s, e in cleaned:
        if merged and s <= merged[-1][1] + 0.01:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


@router.post("/trim", response_model=dict)
async def trim_audio(body: TrimAudioRequest) -> dict:
    """Trim an audio library file and save the edit as a NEW file in `output/audio`.

    `mode="keep"` saves a single `[start, end)` interval; `mode="remove"` cuts
    the given intervals out and concatenates what remains. Same container/codec
    via stream copy (`-c:a copy`) — fast and lossless; cuts land on packet
    boundaries. Powers the Audio Analysis "Trim" editor — the result lands back
    in the audio library so it can be analyzed or sent to Kinetic Typography.
    """
    from ..services.ffmpeg_tools import probe_media

    mode = (body.mode or "keep").lower()
    if mode not in ("keep", "remove"):
        raise HTTPException(status_code=400, detail='mode must be "keep" or "remove"')
    if not body.ranges:
        raise HTTPException(status_code=400, detail="At least one range is required")
    if mode == "keep" and len(body.ranges) != 1:
        raise HTTPException(status_code=400, detail='mode "keep" needs exactly one range')
    for r in body.ranges:
        if r.end <= r.start:
            raise HTTPException(status_code=400, detail="Each range needs end > start")
        if r.start < 0:
            raise HTTPException(status_code=400, detail="Range start must be >= 0")

    if not body.filename or ".." in body.filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    src = (AUDIO_DIR / body.filename).resolve()
    if not str(src).startswith(str(AUDIO_DIR.resolve())) or not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {body.filename}")
    if src.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {src.suffix}")

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="ffmpeg not found on PATH")

    try:
        probe = await probe_media(src)
        duration = float((probe.get("format") or {}).get("duration") or 0)
    except Exception:
        duration = 0.0
    if duration <= 0:
        raise HTTPException(status_code=400, detail=f"Could not probe duration of {src.name}")

    merged = _clamp_merge_ranges([(r.start, r.end) for r in body.ranges], duration)
    if not merged:
        raise HTTPException(status_code=400, detail="Ranges fall outside the audio duration")
    if mode == "keep":
        kept = merged
    else:
        kept = []
        cursor = 0.0
        for s, e in merged:
            if s - cursor > 0.01:
                kept.append((cursor, s))
            cursor = max(cursor, e)
        if duration - cursor > 0.01:
            kept.append((cursor, duration))
        if not kept:
            raise HTTPException(status_code=400, detail="Removal covers the entire file — nothing left to save")
    if len(kept) == 1 and kept[0][0] <= 0.01 and kept[0][1] >= duration - 0.01:
        raise HTTPException(status_code=400, detail="Edit covers the full file — nothing to change")

    stem = re.sub(r"[^A-Za-z0-9_\- .()\[\]]", "", src.stem).strip() or "trimmed"
    ext = src.suffix.lower()
    dst = AUDIO_DIR / f"{stem}_trim{ext}"
    n = 1
    while dst.exists():
        n += 1
        dst = AUDIO_DIR / f"{stem}_trim_{n}{ext}"

    async def _run(cmd: list[str]) -> None:
        try:
            proc = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, text=True, timeout=600,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Audio trim timed out") from None
        if proc.returncode != 0:
            tail = (proc.stderr or "").strip().splitlines()[-3:]
            detail = "; ".join(tail) if tail else "ffmpeg failed"
            raise HTTPException(status_code=400, detail=detail)

    started = time.perf_counter()
    tmpdir: Path | None = None
    try:
        if len(kept) == 1:
            s, e = kept[0]
            await _run([
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(src), "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}",
                "-vn", "-c:a", "copy", str(dst),
            ])
        else:
            import tempfile
            tmpdir = Path(tempfile.mkdtemp(prefix="trim_"))
            parts: list[str] = []
            for i, (s, e) in enumerate(kept):
                part = tmpdir / f"part{i:03d}{ext}"
                await _run([
                    ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                    "-i", str(src), "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}",
                    "-vn", "-c:a", "copy", str(part),
                ])
                parts.append(str(part))
            lst = tmpdir / "concat.txt"
            lst.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
            await _run([
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "concat", "-safe", "0", "-i", str(lst),
                "-c", "copy", str(dst),
            ])
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)
    if not dst.exists() or dst.stat().st_size == 0:
        raise HTTPException(status_code=400, detail="Trim produced no audio")

    try:
        out_probe = await probe_media(dst)
        out_duration = float((out_probe.get("format") or {}).get("duration") or 0)
    except Exception:
        out_duration = 0.0

    return {
        "success": True,
        "filename": dst.name,
        "stored_path": str(dst),
        "relative_path": dst.relative_to(AUDIO_DIR).as_posix(),
        "size_bytes": dst.stat().st_size,
        "duration": round(out_duration, 2),
        "source_filename": src.name,
        "source_duration": round(duration, 2),
        "mode": mode,
        "kept": [{"start": round(s, 2), "end": round(e, 2)} for s, e in kept],
        "lossless": True,
        "render_s": round(time.perf_counter() - started, 1),
        "message": f"Saved {dst.name}",
    }


@router.get("/file/{filename:path}")
async def serve_audio_file(request: Request, filename: str):
    """Serve an audio file by filename."""
    import urllib.parse

    # Decode URL-encoded filename (handles spaces, special chars)
    filename = urllib.parse.unquote(filename)

    # Security: prevent directory traversal via resolve check
    candidate = (AUDIO_DIR / filename).resolve()
    allowed_dirs = [AUDIO_DIR.resolve(), (PROJECT_ROOT / "output" / "audio").resolve()]
    if not any(str(candidate).startswith(str(d)) for d in allowed_dirs) or ".." in Path(filename).parts:
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = candidate
    if not file_path.exists() or not file_path.is_file():
        alt_path = (PROJECT_ROOT / "output" / "audio" / filename).resolve()
        if str(alt_path).startswith(str(allowed_dirs[1])) and alt_path.exists() and alt_path.is_file():
            file_path = alt_path
        else:
            raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")

    # Determine media type based on extension
    ext = file_path.suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".m4a": "audio/mp4",
        ".wma": "audio/x-ms-wma",
        ".aac": "audio/aac",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    # CORS: allowlist local + public tunnel origins; omit ACAO for untrusted
    # origins. Use is_origin_allowed (not a raw get_all_origins lookup) so
    # randomized tunnel hostnames such as *.loca.lt are recognised.
    from ..core.cors import is_origin_allowed

    origin = request.headers.get("origin", "")
    cors_origin = origin if is_origin_allowed(origin) else ""
    headers: dict[str, str] = {
         "Accept-Ranges": "bytes",
         "Cache-Control": "public, max-age=3600",
    }
    if cors_origin:
        headers["Access-Control-Allow-Origin"] = cors_origin
    return FileResponse(
        str(file_path),
        media_type=media_type,
        filename=file_path.name,
        headers=headers,
    )
