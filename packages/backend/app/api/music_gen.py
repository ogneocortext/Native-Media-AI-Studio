"""Music Generation API — YuE2 and ACE-Step integration endpoints.

Provides REST API for:
- Starting/stopping music generation services
- Generating songs with either engine
- Planning scores (YuE2 only)
- Rendering from edited ABC notation (YuE2 only)
- VRAM coordination with the main backend
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..adapters.music_gen import (
    MusicGenAdapter,
    get_music_gen_adapter,
    shutdown_music_gen_services,
)
from ..services.vram_manager import vram_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/music-gen", tags=["MusicGeneration"])


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class StartServiceRequest(BaseModel):
    engine: str = Field("yue2", description="Engine: yue2 or ace")
    port: Optional[int] = Field(None, description="Port override (default: 8200/8201)")
    vram_budget_mb: Optional[int] = Field(None, description="VRAM budget in MB")


class GenerateRequest(BaseModel):
    engine: str = Field("yue2", description="Engine: yue2 or ace")
    style: str = Field(..., min_length=1, max_length=2000,
                       description="Genre, instruments, mood, tempo, vocal type")
    lyrics: str = Field(..., min_length=1, max_length=10000,
                        description="Full lyrics with [Verse]/[Chorus]/[Bridge] tags")
    cot: str = Field("full", description="Chain-of-thought: full, melody, off")
    seed: Optional[int] = Field(None, description="Deterministic seed")
    abc: Optional[str] = Field(None, description="Pre-made ABC score for covers/edits")
    cfg_scale: float = Field(1.0, ge=0.5, le=3.0)
    max_new_tokens: int = Field(3000, ge=100, le=8000)
    output_name: Optional[str] = Field(None, description="Custom output filename")


class PlanRequest(BaseModel):
    style: str
    lyrics: str
    cot: str = "full"
    seed: Optional[int] = None


class EditScoreRequest(BaseModel):
    abc: str = Field(..., description="ABC notation score to render")
    style: str
    lyrics: str
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Service management endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def get_status() -> dict[str, Any]:
    """Get status of all music generation services."""
    adapters = {}
    for engine in ["yue2", "ace"]:
        adapter = get_music_gen_adapter(engine)
        adapters[engine] = {
            "running": adapter.is_running,
            "healthy": await adapter.health_check() if adapter.is_running else False,
            "port": adapter.port,
            "pid": adapter.pid,
        }

    vram = await vram_manager.get_vram_status()
    return {
        "services": adapters,
        "vram": vram,
        "current_workload": vram_manager.current_workload.value,
    }


@router.post("/start")
async def start_service(req: StartServiceRequest) -> dict[str, Any]:
    """Start a music generation service."""
    adapter = get_music_gen_adapter(req.engine, port=req.port)

    if adapter.is_running:
        return {
            "status": "already_running",
            "engine": req.engine,
            "port": adapter.port,
            "pid": adapter.pid,
        }

    # Coordinate with VRAM manager
    from ..adapters.music_gen import VRAM_BUDGETS
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
    except Exception as e:
        await vram_manager.end_music_generation()
        raise


@router.post("/stop")
async def stop_service(engine: str = "yue2") -> dict[str, Any]:
    """Stop a music generation service."""
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
        raise HTTPException(503, detail=f"Service not running. Start it first with POST /start")

    try:
        result = await adapter.generate({
            "style": req.style,
            "lyrics": req.lyrics,
            "cot": req.cot,
            "seed": req.seed,
            "abc": req.abc,
            "cfg_scale": req.cfg_scale,
            "max_new_tokens": req.max_new_tokens,
            "output_name": req.output_name,
        })
        return result
    except Exception as e:
        logger.error("Generation failed: %s", e, exc_info=True)
        raise HTTPException(500, detail=str(e))


@router.post("/plan")
async def plan_score(req: PlanRequest) -> dict[str, Any]:
    """Generate score only (YuE2 only, no audio)."""
    adapter = get_music_gen_adapter("yue2")

    if not adapter.is_running:
        raise HTTPException(503, detail="YuE2 service not running")

    try:
        return await adapter.plan_score(
            style=req.style,
            lyrics=req.lyrics,
            seed=req.seed,
        )
    except Exception as e:
        logger.error("Plan failed: %s", e, exc_info=True)
        raise HTTPException(500, detail=str(e))


@router.post("/render")
async def render_score(req: EditScoreRequest) -> dict[str, Any]:
    """Render audio from edited ABC score (YuE2 only)."""
    adapter = get_music_gen_adapter("yue2")

    if not adapter.is_running:
        raise HTTPException(503, detail="YuE2 service not running")

    try:
        return await adapter.render_from_score(
            abc=req.abc,
            style=req.style,
            lyrics=req.lyrics,
            seed=req.seed,
        )
    except Exception as e:
        logger.error("Render failed: %s", e, exc_info=True)
        raise HTTPException(500, detail=str(e))


# ---------------------------------------------------------------------------
# File download endpoints
# ---------------------------------------------------------------------------

@router.get("/audio/{engine}/{output_name}")
async def get_audio(engine: str, output_name: str):
    """Download generated audio file."""
    from pathlib import Path
    output_dir = Path("output/music") / output_name

    # Try flac first, then wav
    for ext in ["flac", "wav", "mp3"]:
        audio_path = output_dir / f"audio.{ext}"
        if audio_path.exists():
            media_type = {
                "flac": "audio/flac",
                "wav": "audio/wav",
                "mp3": "audio/mpeg",
            }.get(ext, "audio/octet-stream")
            return FileResponse(
                str(audio_path),
                media_type=media_type,
                filename=f"{output_name}.{ext}",
            )

    raise HTTPException(404, detail="Audio file not found")


@router.get("/score/{output_name}")
async def get_score(output_name: str):
    """Download ABC score file."""
    from pathlib import Path
    score_path = Path("output/music") / output_name / "score.abc"
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
async def unload_engine(engine: str = "yue2") -> dict[str, Any]:
    """Unload engine to free VRAM (for manual coordination)."""
    adapter = get_music_gen_adapter(engine)
    if adapter.is_running:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{adapter.base_url}/unload",
                timeout=aiohttp.ClientTimeout(total=10),
            ):
                pass
    return {"status": "unloaded", "engine": engine}


@router.post("/reload")
async def reload_engine(engine: str = "yue2") -> dict[str, Any]:
    """Reload engine after VRAM freed."""
    adapter = get_music_gen_adapter(engine)
    if adapter.is_running:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{adapter.base_url}/reload",
                timeout=aiohttp.ClientTimeout(total=60),
            ):
                pass
    return {"status": "reloaded", "engine": engine}
