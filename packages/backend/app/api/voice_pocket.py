"""Pocket TTS proxy -- ``/api/voice/pocket/*``.

Server-side proxy to the rig-local Pocket TTS server (see ``config/tts.json``).
The Pocket endpoint is tailnet-only and requires a per-launch Bearer token;
neither the URL nor the token ever reaches the browser -- the frontend only
ever sees these ``/api/voice/pocket/*`` routes.

Speak path confirmed in ``D:\\Tools\\streaming-tts\\pocket\\server\\server.py``:
``POST /speech`` with JSON ``{"text": ..., "voice": ...}`` returns audio
bytes; ``GET /health`` returns model / sample_rate / voices_cached /
preset_voices / busy and also requires the Bearer token.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import operator
import os
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..core import tts_settings
from ..core.logging_config import LOG_DIR
from .audio_common import AUDIO_DIR

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice/pocket", tags=["Voice Pocket"])

# Fallback voice lists used only when Pocket /health is unreachable, so the
# Voice Live page can still render its selector in degraded mode.
FALLBACK_CUSTOM_VOICES = ["alba", "maya", "maya-blend65"]
FALLBACK_PRESET_VOICES = [
    "alba", "anna", "azelma", "bill_boerst", "caro_davy", "charles",
    "cosette", "eponine", "eve", "fantine", "george", "jane", "jean",
    "javert", "marius", "mary", "michael", "paul", "peter_yearsley",
    "stuart_bell", "vera",
]

_NOT_CONFIGURED = (
    "Pocket TTS is not configured: {env} is not set -- see config/tts.json"
)
_UNREACHABLE = "Pocket TTS is unreachable -- is the server running?"

# Token file (pocket.token_file) is mtime-cached like tts_settings. The file
# lives outside the repo on the rig; the backend re-reads it on mtime change
# or on force_refresh (401 retry). Never log the token value.
_token_file_cache: str | None = None
_token_file_cache_mtime: float | None = None


def _cfg() -> dict[str, Any]:
    return tts_settings.pocket()


def _base_url() -> str:
    return str(_cfg().get("base_url") or "").rstrip("/")


def _timeout() -> float:
    try:
        return float(_cfg().get("timeout_s") or 30)
    except (TypeError, ValueError):
        return 30.0


def _token_env_name() -> str:
    return str(_cfg().get("token_env") or "POCKET_TTS_TOKEN")


def _token_file_path() -> str | None:
    """Return the configured token file path, or None if not configured."""
    path = _cfg().get("token_file") or ""
    return path.strip() or None


def _read_token_file(path: str, *, force_refresh: bool = False) -> str | None:
    """Read and trim the token file, mtime-cached.

    Returns None on any OSError or empty contents. Re-reads only when mtime
    changes (or force_refresh=True). Never logs the token value.
    """
    global _token_file_cache, _token_file_cache_mtime
    try:
        st = os.stat(path)
    except OSError:
        _token_file_cache = None
        _token_file_cache_mtime = None
        return None
    mtime = st.st_mtime
    if not force_refresh and _token_file_cache is not None and mtime == _token_file_cache_mtime:
        return _token_file_cache
    try:
        value = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        _token_file_cache = None
        _token_file_cache_mtime = None
        return None
    if not value:
        _token_file_cache = None
        _token_file_cache_mtime = None
        return None
    _token_file_cache = value
    _token_file_cache_mtime = mtime
    logger.info("token loaded from file")
    return value


def _token(*, force_refresh: bool = False) -> str | None:
    """Read the Bearer token: token file first (if configured), then env var.

    File wins because it is the live, per-launch source. With no token file
    configured and no env var, returns None (caller raises the 503).
    Never logs or returns the token value.
    """
    path = _token_file_path()
    if path is not None:
        file_value = _read_token_file(path, force_refresh=force_refresh)
        if file_value is not None:
            return file_value
    env = _token_env_name()
    value = os.environ.get(env)
    if not value or not value.strip():
        return None
    return value.strip()


def _require_token() -> str:
    token = _token()
    if token is None:
        raise HTTPException(
            status_code=503,
            detail=_NOT_CONFIGURED.format(env=_token_env_name()),
        )
    return token


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _fetch_health(token: str) -> dict[str, Any]:
    """GET Pocket /health. 503 when unreachable, 502 on upstream errors.

    On upstream 401, refreshes the token once (force_refresh) and retries
    exactly once if the token changed. A second 401 (or any other non-200)
    surfaces as 502.
    """
    base = _base_url()

    async def _get(tok: str):
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            return await client.get(f"{base}/health", headers=_auth_headers(tok))

    try:
        resp = await _get(token)
    except httpx.HTTPError as exc:
        logger.warning("Pocket TTS health unreachable: %s", exc)
        raise HTTPException(status_code=503, detail=_UNREACHABLE) from exc

    if resp.status_code == 401:
        refreshed = _token(force_refresh=True)
        if refreshed is not None and refreshed != token:
            try:
                resp = await _get(refreshed)
            except httpx.HTTPError as exc:
                logger.warning("Pocket TTS health unreachable on retry: %s", exc)
                raise HTTPException(status_code=503, detail=_UNREACHABLE) from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Pocket TTS health check failed (upstream {resp.status_code})",
        )
    try:
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Pocket TTS returned invalid health JSON") from exc
    return data if isinstance(data, dict) else {}


def _bare_voice_name(name: Any) -> str | None:
    """Keep only bare voice names -- absolute .safetensors paths cached by
    Pocket must never reach the frontend."""
    if not isinstance(name, str):
        return None
    n = name.strip()
    if not n or any(c in n for c in "/\\:"):
        return None
    return n


@router.get("/health")
async def pocket_health() -> dict[str, Any]:
    """Proxy Pocket GET /health with only the fields the UI needs."""
    token = _require_token()
    data = await _fetch_health(token)
    return {
        "model": data.get("model"),
        "sample_rate": data.get("sample_rate"),
        "voices_cached": data.get("voices_cached") or [],
        "preset_voices": data.get("preset_voices") or [],
        "busy": bool(data.get("busy")),
    }


@router.get("/voices")
async def pocket_voices() -> dict[str, Any]:
    """One deduped voice list: custom (voices_cached) first, then presets.

    ``alba`` appears in both upstream lists -- custom wins. If /health is
    unreachable the response falls back to the built-in lists with
    ``degraded: true`` so the selector still renders.
    """
    default_voice = str(_cfg().get("default_voice") or "maya-blend65")
    health: dict[str, Any] | None = None
    token = _token()
    if token is not None:
        try:
            health = await _fetch_health(token)
        except HTTPException:
            health = None

    voices: list[dict[str, str]] = []
    seen: set[str] = set()

    if health is None:
        degraded = True
        custom, presets = FALLBACK_CUSTOM_VOICES, FALLBACK_PRESET_VOICES
    else:
        degraded = False
        custom = [
            n for n in (_bare_voice_name(v) for v in (health.get("voices_cached") or []))
            if n is not None
        ]
        presets = [
            n for n in (_bare_voice_name(v) for v in (health.get("preset_voices") or []))
            if n is not None
        ]

    for name in custom:
        if name not in seen:
            seen.add(name)
            voices.append({"name": name, "kind": "custom"})
    for name in presets:
        if name not in seen:
            seen.add(name)
            voices.append({"name": name, "kind": "preset"})

    bare_default = _bare_voice_name(default_voice)
    if bare_default and bare_default not in seen:
        voices.insert(0, {"name": bare_default, "kind": "custom"})
        seen.add(bare_default)

    return {
        "voices": voices,
        "default_voice": bare_default or default_voice,
        "degraded": degraded,
    }


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str = Field(..., min_length=1)


@router.post("/speak")
async def pocket_speak(req: SpeakRequest) -> StreamingResponse:
    """Forward one speak chunk to Pocket POST /speech and stream the audio.

    The upstream body is streamed through untouched so time-to-first-byte
    stays at the Pocket server's native latency instead of paying a full
    buffer-and-forward penalty.

    On upstream 401, refreshes the token once (force_refresh) and retries
    exactly once before streaming begins if the token changed. A second 401
    (or any other non-200) surfaces as 502.
    """
    token = _require_token()
    base = _base_url()

    async def _send(tok: str):
        client = httpx.AsyncClient(timeout=_timeout())
        try:
            upstream_req = client.build_request(
                "POST",
                f"{base}/speech",
                json={"text": req.text, "voice": req.voice},
                headers=_auth_headers(tok),
            )
            resp = await client.send(upstream_req, stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            logger.warning("Pocket TTS speak unreachable: %s", exc)
            raise HTTPException(status_code=503, detail=_UNREACHABLE) from exc
        return client, resp

    client, resp = await _send(token)

    if resp.status_code == 401:
        refreshed = _token(force_refresh=True)
        if refreshed is not None and refreshed != token:
            await client.aclose()
            client, resp = await _send(refreshed)

    if resp.status_code != 200:
        await resp.aclose()
        await client.aclose()
        # Plain 502 carrying the upstream status -- no plumbing details.
        raise HTTPException(
            status_code=502,
            detail=f"Pocket TTS speak failed (upstream {resp.status_code})",
        )

    content_type = (resp.headers.get("content-type") or "application/octet-stream").split(";")[0].strip()

    async def stream_audio():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(stream_audio(), media_type=content_type)


# ---------------------------------------------------------------------------
# Maya inbox -- file-backed queue of lines posted from outside the page.
#
# The Voice Live page polls ``/inbox/pending`` while its "Listen for Maya"
# toggle is on and speaks each entry through the same Pocket speak path. The
# queue lives in ``output/logs/voice-inbox.json`` (LOG_DIR, gitignored) so
# lines survive backend restarts; ``played`` entries are pruned first once
# the file grows past _INBOX_MAX_ENTRIES.
# ---------------------------------------------------------------------------

_INBOX_FILE = LOG_DIR / "voice-inbox.json"
_INBOX_MAX_ENTRIES = 200
_INBOX_MAX_CHARS = 1200  # same cap as the speak-aloud path (useSpeakAloud)
_INBOX_DEFAULT_VOICE = "maya-blend65"
_inbox_lock = threading.Lock()


def _load_inbox() -> list[dict[str, Any]]:
    """Read the inbox file fresh on every call; missing/corrupt -> empty."""
    try:
        data = json.loads(_INBOX_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _prune_inbox(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep at most _INBOX_MAX_ENTRIES, dropping played entries first."""
    overflow = len(entries) - _INBOX_MAX_ENTRIES
    if overflow <= 0:
        return entries
    # Entries are in append (oldest-first) order; drop the oldest played
    # entries first, then the oldest remaining if still over capacity.
    played_oldest = [e for e in entries if e.get("played")]
    drop = {id(e) for e in played_oldest[:overflow]}
    kept = [e for e in entries if id(e) not in drop]
    still_over = len(kept) - _INBOX_MAX_ENTRIES
    return kept[still_over:] if still_over > 0 else kept


def _save_inbox(entries: list[dict[str, Any]]) -> None:
    """Atomic write (temp file + replace) under the module lock."""
    _INBOX_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _INBOX_FILE.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(_prune_inbox(entries), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, _INBOX_FILE)


class InboxPostRequest(BaseModel):
    text: str = Field(..., max_length=_INBOX_MAX_CHARS)
    voice: str | None = None

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("text must be non-empty")
        return stripped


@router.post("/inbox", status_code=201)
async def inbox_post(req: InboxPostRequest) -> dict[str, Any]:
    """Append a line for the Voice Live page to speak. Returns the entry."""
    voice = (req.voice or "").strip() or _INBOX_DEFAULT_VOICE
    entry = {
        "id": uuid.uuid4().hex,
        "text": req.text,
        "voice": voice,
        "created_at": datetime.now(UTC).isoformat(),
        "played": False,
    }
    with _inbox_lock:
        entries = _load_inbox()
        entries.append(entry)
        _save_inbox(entries)
    return entry


@router.get("/inbox/pending")
async def inbox_pending() -> dict[str, Any]:
    """All unplayed entries, oldest first."""
    entries = [e for e in _load_inbox() if not e.get("played")]
    return {"entries": entries}


@router.post("/inbox/{entry_id}/played")
async def inbox_mark_played(entry_id: str) -> dict[str, Any]:
    """Mark an entry played and persist. Unknown id -> 404."""
    with _inbox_lock:
        entries = _load_inbox()
        for entry in entries:
            if entry.get("id") == entry_id:
                entry["played"] = True
                _save_inbox(entries)
                return entry
    raise HTTPException(status_code=404, detail=f"Unknown inbox entry: {entry_id}")


# ---------------------------------------------------------------------------
# Maya inbox -- audio drops.
#
# Maya can POST an audio file to ``/inbox/audio`` (multipart) OR drop a file
# straight into ``output/voice-inbox/`` (tailnet/SMB); either way the Voice
# Live page's "Listen for Maya" poll finds it and plays it once, then marks
# it played. Played state lives in ``played.json`` next to the files so
# drops survive backend restarts and reloads.
# ---------------------------------------------------------------------------

# Drops live under output/audio/voice-inbox/ so they sit inside AUDIO_DIR:
# the existing /api/audio/file/* route can serve them and, once registered
# in the audio_files table, they show up in the media library permanently.
_AUDIO_DIR = AUDIO_DIR / "voice-inbox"
_AUDIO_STATE_FILE = "played.json"
_AUDIO_MAX_BYTES = 100 * 1024 * 1024
_AUDIO_EXTS = {
    ".wav", ".mp3", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus", ".wma",
}
_audio_lock = threading.Lock()
# Filenames already registered in audio_files this process -- avoids a
# SELECT per file on every 2 s inbox poll.
_audio_registered: set[str] = set()


def _probe_audio_meta(path: Path) -> dict[str, Any]:
    meta: dict[str, Any] = {"duration": 0.0, "sample_rate": 0, "channels": 0}
    try:
        import soundfile as sf

        info = sf.info(str(path))
        meta["duration"] = (
            float(info.frames) / float(info.samplerate) if info.samplerate else 0.0
        )
        meta["sample_rate"] = int(info.samplerate or 0)
        meta["channels"] = int(info.channels or 0)
    except Exception:  # noqa: BLE001 - probe is best-effort (mp3 etc.)
        pass
    return meta


def _ensure_audio_registered(path: Path) -> None:
    """Idempotently register a drop in the audio_files table so it persists
    in the media library (dedup by filename inside save_audio_file)."""
    if path.name in _audio_registered:
        return
    try:
        from ..core import database

        meta = _probe_audio_meta(path)
        database.save_audio_file(
            filename=path.name,
            original_name=path.name,
            stored_path=str(path.resolve()),
            file_size=path.stat().st_size,
            duration=meta["duration"],
            sample_rate=meta["sample_rate"] or 44100,
            channels=meta["channels"] or 2,
            format=path.suffix.lstrip(".").lower(),
            display_name=path.name,
        )
        _audio_registered.add(path.name)
    except Exception as exc:  # noqa: BLE001 - registration must not break the inbox
        logger.warning("inbox audio DB registration failed for %s: %s", path.name, exc)


def _audio_dir() -> Path:
    _AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    return _AUDIO_DIR


def _audio_state_path() -> Path:
    return _audio_dir() / _AUDIO_STATE_FILE


def _load_audio_played() -> dict[str, bool]:
    try:
        data = json.loads(_audio_state_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_audio_played(played: dict[str, bool]) -> None:
    path = _audio_state_path()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(played, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _audio_ext_ok(name: str) -> bool:
    return Path(name).suffix.lower() in _AUDIO_EXTS


def _audio_entries() -> list[dict[str, Any]]:
    """All audio files in the drop dir, oldest first (by mtime)."""
    played = _load_audio_played()
    out: list[dict[str, Any]] = []
    try:
        files = [p for p in _audio_dir().iterdir() if p.is_file() and _audio_ext_ok(p.name)]
    except OSError:
        return []
    for p in files:
        try:
            st = p.stat()
        except OSError:
            continue
        _ensure_audio_registered(p)
        out.append(
            {
                "id": p.name,
                "name": p.name,
                "size": st.st_size,
                "created_at": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
                "played": bool(played.get(p.name)),
            }
        )
    out.sort(key=operator.itemgetter("created_at"))
    return out


def _resolve_audio_file(entry_id: str) -> Path | None:
    """Map an entry id (filename) to a real file inside the drop dir."""
    if not entry_id or "/" in entry_id or "\\" in entry_id or ".." in entry_id:
        return None
    if not _audio_ext_ok(entry_id):
        return None
    path = (_audio_dir() / entry_id).resolve()
    if path.parent != _audio_dir().resolve() or not path.is_file():
        return None
    return path


@router.post("/inbox/audio", status_code=201)
async def inbox_audio_upload(file: UploadFile = File(...)) -> dict[str, Any]:
    """Accept an audio file drop. Streams to temp, then renames into place."""
    original = Path(file.filename or "").name
    if not original or not _audio_ext_ok(original):
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported audio file type (allowed: {', '.join(sorted(_AUDIO_EXTS))})",
        )
    digest = uuid.uuid4().hex[:8]
    safe_name = f"{digest}_{original}"
    dest = _audio_dir() / safe_name
    if dest.exists():
        safe_name = f"{uuid.uuid4().hex[:12]}_{original}"
        dest = _audio_dir() / safe_name

    # Stage inside the drop dir: os.replace is atomic only within one
    # volume, and system temp lives on a different drive on this rig.
    # The .upload suffix keeps staged files out of _audio_entries().
    tmp_path = _audio_dir() / (f".{uuid.uuid4().hex}.upload")
    size = 0
    try:
        with open(tmp_path, "wb") as buffer:
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > _AUDIO_MAX_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size: {_AUDIO_MAX_BYTES // (1024 * 1024)} MB",
                    )
                buffer.write(chunk)
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to store upload") from exc
    os.replace(tmp_path, dest)
    _ensure_audio_registered(dest)

    st = dest.stat()
    return {
        "id": dest.name,
        "name": dest.name,
        "size": st.st_size,
        "created_at": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
        "played": False,
    }


@router.get("/inbox/audio/pending")
async def inbox_audio_pending() -> dict[str, Any]:
    """Unplayed audio drops, oldest first."""
    entries = [e for e in _audio_entries() if not e["played"]]
    return {"entries": entries}


@router.post("/inbox/audio/{entry_id}/played")
async def inbox_audio_mark_played(entry_id: str) -> dict[str, Any]:
    """Mark an audio drop played. Unknown id -> 404."""
    if _resolve_audio_file(entry_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown inbox audio: {entry_id}")
    with _audio_lock:
        played = _load_audio_played()
        played[entry_id] = True
        _save_audio_played(played)
    for entry in _audio_entries():
        if entry["id"] == entry_id:
            return entry
    raise HTTPException(status_code=404, detail=f"Unknown inbox audio: {entry_id}")


@router.get("/inbox/audio/file/{entry_id}")
async def inbox_audio_file(entry_id: str) -> FileResponse:
    """Stream an audio drop for playback. Path traversal -> 404."""
    path = _resolve_audio_file(entry_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Unknown inbox audio: {entry_id}")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name)
