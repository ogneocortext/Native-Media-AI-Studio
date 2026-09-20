"""Music Generation API — ACE-Step integration endpoints.

Provides REST API for:
- Starting/stopping music generation services
- Generating songs
- VRAM coordination with the main backend
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any

import aiohttp
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from ..adapters.music_gen import (
    VRAM_BUDGETS,
    _get_shared_session,
    get_music_gen_adapter,
    reset_music_gen_adapter,
    shutdown_music_gen_services,
)
from ..core import database
from ..core.config import PROJECT_ROOT
from ..services.vram_manager import vram_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/music-gen", tags=["MusicGeneration"])

# Output names become on-disk directory/file names and URL path segments on both
# the backend and the music-gen subprocess. Restrict to a safe charset to prevent
# path traversal (e.g. "..%2F..%2F" decoded into a path parameter).
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def _validate_output_name(name: str) -> str:
    """Validate a user-supplied output name against a strict safe charset."""
    if not _SAFE_NAME_RE.match(name):
        raise HTTPException(
            400,
            detail=(
                "Invalid output_name. Use 1-100 chars: letters, digits, "
                "'-', '_', '.', starting with a letter or digit."
            ),
        )
    return name


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class StartServiceRequest(BaseModel):
    engine: str = Field("ace", description="Engine: ace")
    port: int | None = Field(None, description="Port override (default: 8201)")
    vram_budget_mb: int | None = Field(None, description="VRAM budget in MB")


class GenerateRequest(BaseModel):
    engine: str = Field("ace", description="Engine: ace")
    style: str = Field(..., min_length=1, max_length=2000,
                       description="Genre, instruments, mood, tempo, vocal type")
    lyrics: str = Field(..., min_length=1, max_length=10000,
                        description="Full lyrics with [Verse]/[Chorus]/[Bridge] tags")
    seed: int | None = Field(None, description="Deterministic seed")
    cfg_scale: float = Field(7.0, ge=0.5, le=20.0, description="Classifier-free guidance")
    inference_steps: int = Field(8, ge=1, le=200, description="Diffusion steps")
    output_name: str | None = Field(None, description="Custom output filename")

    @field_validator("output_name")
    @classmethod
    def _check_output_name(cls, v: str | None) -> str | None:
        if v is not None and not _SAFE_NAME_RE.match(v):
            raise ValueError(
                "output_name must be 1-100 chars: letters, digits, '-', '_', '.', "
                "starting with a letter or digit"
            )
        return v


# ---------------------------------------------------------------------------
# Service management endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def get_status() -> dict[str, Any]:
    """Get status of the music generation service."""
    adapter = get_music_gen_adapter("ace")
    healthy = False
    if adapter.is_running:
        healthy = await adapter.health_check()
    adapters = {
        "ace": {
            "running": adapter.is_running,
            "healthy": healthy,
            "port": adapter.port,
            "pid": adapter.pid,
        }
    }

    vram = await vram_manager.get_vram_status()
    return {
        "services": adapters,
        "vram": vram,
        "current_workload": vram_manager.current_workload.value,
    }


@router.post("/start")
async def start_service(req: StartServiceRequest) -> dict[str, Any]:
    """Start the music generation service."""
    if req.engine != "ace":
        raise HTTPException(400, detail=f"Unknown engine: {req.engine!r}. Supported: 'ace'")

    adapter = get_music_gen_adapter(req.engine)

    # A port override can only be honored by recreating the adapter (the base
    # URL is derived from the port at construction time).
    if req.port is not None and req.port != adapter.port:
        if adapter.is_running:
            raise HTTPException(
                409,
                detail=(
                    f"Service already running on port {adapter.port}. "
                    "Stop it before starting with a different port."
                ),
            )
        reset_music_gen_adapter(req.engine)
        adapter = get_music_gen_adapter(req.engine, port=req.port)

    if adapter.is_running:
        return {
            "status": "already_running",
            "engine": req.engine,
            "port": adapter.port,
            "pid": adapter.pid,
        }

    # Coordinate with VRAM manager
    budget = req.vram_budget_mb or VRAM_BUDGETS.get(req.engine, 6144)

    vram_result = await vram_manager.begin_music_generation(
        engine=req.engine,
        vram_budget_mb=budget,
    )
    if not vram_result.get("success"):
        raise HTTPException(507, detail=vram_result.get("error", "Insufficient VRAM"))

    try:
        started = await adapter.start_service(vram_budget_mb=budget)
        if not started:
            await vram_manager.end_music_generation()
            raise HTTPException(500, detail="Service failed to start")
        return {
            "status": "started",
            "engine": req.engine,
            "port": adapter.port,
            "pid": adapter.pid,
            "vram": vram_result,
        }
    except Exception:
        await vram_manager.end_music_generation()
        raise


@router.post("/stop")
async def stop_service(engine: str = "ace") -> dict[str, Any]:
    """Stop the music generation service."""
    if engine != "ace":
        raise HTTPException(400, detail=f"Unknown engine: {engine!r}. Supported: 'ace'")
    adapter = get_music_gen_adapter(engine)
    stopped = await adapter.stop_service()
    await vram_manager.end_music_generation()
    return {
        "status": "stopped" if stopped else "already_stopped",
        "engine": engine,
    }


@router.post("/stop-all")
async def stop_all() -> dict[str, Any]:
    """Stop all music generation services."""
    await shutdown_music_gen_services()
    await vram_manager.end_music_generation()
    return {"status": "all_stopped"}


# ---------------------------------------------------------------------------
# Generation endpoints
# ---------------------------------------------------------------------------

@router.post("/generate")
async def generate(req: GenerateRequest) -> dict[str, Any]:
    """Generate a complete song."""
    adapter = get_music_gen_adapter(req.engine)

    if not adapter.is_running:
        raise HTTPException(503, detail="Service not running. Start it first with POST /start")

    try:
        result = await adapter.generate({
            "style": req.style,
            "lyrics": req.lyrics,
            "seed": req.seed,
            "cfg_scale": req.cfg_scale,
            "inference_steps": req.inference_steps,
            "output_name": req.output_name,
        })

        # Register generated audio in the media library so the frontend can find/play it.
        audio_path = result.get("audio_path")
        output_name = result.get("output_name") or req.output_name or ""
        if audio_path and output_name:
            try:
                output_name = _validate_output_name(output_name)
                src = Path(audio_path)
                if src.exists():
                    dst_name = f"{output_name}.wav"
                    dst = PROJECT_ROOT / "output" / "audio" / dst_name
                    audio_dir = PROJECT_ROOT / "output" / "audio"
                    if not str(dst.resolve()).startswith(str(audio_dir.resolve())):
                        raise HTTPException(status_code=400, detail="Invalid output path")
                    dst.parent.mkdir(parents=True, exist_ok=True)

                    # Copy to a temp path first so we can clean up on DB failure
                    # and avoid leaving half-registered files when metadata read
                    # or save_audio_file raises.
                    temp_path = dst.with_suffix(".tmp")
                    created_temp = False
                    try:
                        if not dst.exists():
                            shutil.copy2(str(src), str(temp_path))
                            created_temp = True

                        file_size = temp_path.stat().st_size
                        sample_rate = result.get("sample_rate", 48000)
                        duration = 0.0
                        channels = 2
                        try:
                            import soundfile as sf
                            info = sf.info(str(temp_path))
                            duration = float(info.frames) / float(info.samplerate) if info.samplerate else 0.0
                            channels = int(info.channels)
                            sample_rate = int(info.samplerate) or sample_rate
                        except Exception:
                            pass

                        database.save_audio_file(
                            filename=dst_name,
                            original_name=dst_name,
                            stored_path=f"output/audio/{dst_name}",
                            file_size=file_size,
                            duration=duration,
                            sample_rate=sample_rate,
                            channels=channels,
                            format="wav",
                        )
                        # Atomic rename so the file appears only after DB registration.
                        if created_temp:
                            temp_path.replace(dst)
                        result["relative_path"] = f"audio/{dst_name}"
                    except Exception:
                        if created_temp and temp_path.exists():
                            try:
                                temp_path.unlink()
                            except Exception:
                                pass
                        raise
            except Exception as exc:
                logger.warning("Failed to register generated audio in media library: %s", exc)

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Generation failed: %s", e, exc_info=True)
        raise HTTPException(500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# File download endpoints
# ---------------------------------------------------------------------------

@router.get("/audio/{output_name}")
async def get_audio(output_name: str):
    """Download generated audio file."""
    output_name = _validate_output_name(output_name)
    output_dir = PROJECT_ROOT / "output" / "music" / output_name

    # Try flac first, then wav, then mp3
    for ext, media_type in [
        ("flac", "audio/flac"),
        ("wav", "audio/wav"),
        ("mp3", "audio/mpeg"),
    ]:
        audio_path = output_dir / f"audio.{ext}"
        if audio_path.exists():
            return FileResponse(
                str(audio_path),
                media_type=media_type,
                filename=f"{output_name}.{ext}",
            )

    raise HTTPException(404, detail="Audio file not found")


@router.get("/score/{output_name}")
async def get_score(output_name: str):
    """Download ABC score file."""
    output_name = _validate_output_name(output_name)
    score_path = PROJECT_ROOT / "output" / "music" / output_name / "score.abc"
    if not score_path.exists():
        raise HTTPException(404, detail="Score file not found")
    return FileResponse(
        str(score_path),
        media_type="text/plain",
        filename=f"{output_name}.abc",
    )


# ---------------------------------------------------------------------------
# VRAM coordination endpoints
# ---------------------------------------------------------------------------

@router.get("/vram")
async def get_vram() -> dict[str, Any]:
    """Get current VRAM usage."""
    return await vram_manager.get_vram_status()


@router.post("/unload")
async def unload_engine(engine: str = "ace") -> dict[str, Any]:
    """Unload engine to free VRAM (for manual coordination)."""
    adapter = get_music_gen_adapter(engine)
    if adapter.is_running:
        try:
            session = await _get_shared_session()
            async with session.post(
                f"{adapter.base_url}/unload",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status not in (200, 204):
                    text = await resp.text()
                    raise RuntimeError(f"Unload failed ({resp.status}): {text}")
        except Exception as e:
            logger.warning("Unload %s failed: %s", engine, e)
            return {"status": "error", "engine": engine, "detail": str(e)}
    return {"status": "unloaded", "engine": engine}


@router.post("/reload")
async def reload_engine(engine: str = "ace") -> dict[str, Any]:
    """Reload engine after VRAM freed."""
    adapter = get_music_gen_adapter(engine)
    if adapter.is_running:
        try:
            session = await _get_shared_session()
            async with session.post(
                f"{adapter.base_url}/reload",
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status not in (200, 204):
                    text = await resp.text()
                    raise RuntimeError(f"Reload failed ({resp.status}): {text}")
        except Exception as e:
            logger.warning("Reload %s failed: %s", engine, e)
            return {"status": "error", "engine": engine, "detail": str(e)}
    return {"status": "reloaded", "engine": engine}
