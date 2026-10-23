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
import uuid
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
from ..sse.handler import sse_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/music-gen", tags=["MusicGeneration"])

# LM planner service configuration
PLANNER_BASE_URL = "http://127.0.0.1:8201"
PLANNER_HEALTH_TIMEOUT = 5

# Output names become on-disk directory/file names and URL path segments on both
# the backend and the music-gen subprocess. Restrict to a safe charset to prevent
# path traversal (e.g. "..%2F..%2F" decoded into a path parameter).
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")

# ---------------------------------------------------------------------------
# Planner session management
# ---------------------------------------------------------------------------

PLANNER_SESSION_STORE: dict[str, dict] = {}

PLANNER_SAFE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _validate_planner_name(name: str) -> str:
    """Validate a planner/session name against a safe charset."""
    if not PLANNER_SAFE_RE.match(name):
        raise HTTPException(
            400,
            detail=(
                "Invalid planner name. Use 1-64 chars: letters, digits, '-', '_', "
                "'.', starting with a letter or digit."
            ),
        )
    return name


async def _emit_planner_event(session_id: str, event_type: str, data: dict) -> None:
    """Emit a planner SSE event to connected clients."""
    await sse_manager.broadcast(
        "planner_event",
        {"session_id": session_id, "event": event_type, **data},
        priority="medium",
    )


# ---------------------------------------------------------------------------
# Chain-of-Thought prompt templates for ACE-Step LM planner
# ---------------------------------------------------------------------------

STYLE_COT_TEMPLATES = {
    "init": (
        "You are an ACE-Step music style planner. Given a music description, "
        "create a comprehensive style blueprint using Chain-of-Thought reasoning. "
        "Consider: genre, sub-genre, instrumentation, mood, tempo, vocal style, "
        "production style, and artistic references. Output a structured JSON with "
        "keys: style_tags, description, mood, tempo_bpm, instrumentation, "
        "vocal_style, production_approach, artistic_references. Keep it concise "
        "but complete - this blueprint will guide subsequent development steps."
    ),
    "develop": (
        "You are an ACE-Step music style developer. Given the existing style blueprint "
        "and a development directive (e.g., 'add intro', 'build climax', 'add bridge'), "
        "expand the style with specific musical techniques, transition effects, "
        "automation ideas, and arrangement suggestions. Output a structured JSON with "
        "keys: added_elements, transition_techniques, arrangement_changes, "
        "automation_ideas, energy_direction. Reference the original blueprint keys "
        "where relevant."
    ),
    "finalize": (
        "You are an ACE-Step music style finalizer. Given the developed style blueprint, "
        "produce a complete style specification ready for music generation. Output a "
        "structured JSON with all keys from previous steps, plus: final_tempo, "
        "final_instrumentation, mix_approach, mastering_notes, generation_flags. "
        "Ensure consistency across all parameters and validate that the style "
        "specification is complete and coherent."
    ),
}

LYRICS_COT_TEMPLATES = {
    "init": (
        "You are an ACE-Step lyrics planner. Given a music description and optional "
        "theme, create a lyrical structure using Chain-of-Thought reasoning. Consider: "
        "theme, story arc, verse/chorus/bridge structure, syllable patterns, rhyme "
        "scheme, imagery, emotional progression. Output a structured JSON with keys: "
        "theme, structure (verse/chorus/bridge sections with counts), lyrical_notes, "
        "rhyme_approach, syllable_target, key_themes, imagery_guidance. Keep structure "
        "conceptual at this stage - detailed lyrics come in later steps."
    ),
    "add_verse": (
        "You are an ACE-Step lyrics developer. Given the existing lyrical structure and "
        "a directive to 'add verse 1', 'expand verse 2', or similar, write specific "
        "lyric content for the requested section. Output a structured JSON with keys: "
        "section_name (e.g., 'verse 1'), lyrics_text, rhyme_pattern, syllable_count, "
        "imagery, emotional_tone, continuity_notes. Reference the structural overview "
        "from the init step and maintain consistency with the overall theme."
    ),
    "add_chorus": (
        "You are an ACE-Step lyrics developer. Given the existing lyrical structure and "
        "a directive to 'add chorus' or similar, write the chorus lyric content. Output "
        "a structured JSON with keys: section_name (e.g., 'chorus'), lyrics_text, "
        "rhyme_pattern, syllable_count, melodic_guidance, emotional_peak, "
        "continuity_notes. The chorus should have a distinct melodic shape and "
        "emotional center - make it the emotional peak of the song."
    ),
    "finalize": (
        "You are an ACE-Step lyrics finalizer. Given all developed lyric sections "
        "(verses, chorus, bridge), produce a complete lyrical composition ready for "
        "music generation. Output a structured JSON with all keys from previous steps, "
        "plus: full_lyrics (complete song lyrics with section markers), pacing_guide, "
        "final_rhyme_scheme, lyrical_coherence_check, generation_flags. Validate that "
        "the lyrics flow coherently through the song structure and match the musical "
        "intent."
    ),
}


def _build_cot_prompt(step: str, section: str, user_input: str) -> str:
    """Build a Chain-of-Thought prompt for the LM planner.

    Args:
        step: The planning step (init, develop, finalize for style;
               init, add_verse, add_chorus, finalize for lyrics)
        section: The section being worked on (e.g., 'verse 1', 'chorus')
        user_input: The user's original description or directive

    Returns:
        A formatted CoT prompt string for the planner service
    """
    if section == "style":
        if step in STYLE_COT_TEMPLATES:
            return STYLE_COT_TEMPLATES[step]
        raise ValueError(f"Unknown style step: {step}")
    elif section == "lyrics":
        if step in LYRICS_COT_TEMPLATES:
            return LYRICS_COT_TEMPLATES[step]
        raise ValueError(f"Unknown lyrics step: {step}")
    else:
        raise ValueError(f"Unknown section: {section}")


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
    style: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Genre, instruments, mood, tempo, vocal type",
    )
    lyrics: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="Full lyrics with [Verse]/[Chorus]/[Bridge] tags",
    )
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
        result = await adapter.generate(
            {
                "style": req.style,
                "lyrics": req.lyrics,
                "seed": req.seed,
                "cfg_scale": req.cfg_scale,
                "inference_steps": req.inference_steps,
                "output_name": req.output_name,
            }
        )

        # Register generated audio in the media library so the frontend can find/play it.
        audio_path = result.get("audio_path")
        output_name = result.get("output_name") or req.output_name or ""
        if audio_path and output_name:
            # Validate before doing any file/DB work so invalid names surface as 400.
            output_name = _validate_output_name(output_name)
            try:
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
                            duration = (
                                float(info.frames) / float(info.samplerate)
                                if info.samplerate
                                else 0.0
                            )
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


@router.post("/plan-style")
async def plan_style(request: dict[str, Any]) -> dict[str, Any]:
    """Draft style text incrementally using Chain-of-Thought LM planner.

    Incremental style drafting with steps: init, develop, finalize.
    - init: Create a comprehensive style blueprint from a music description
    - develop: Expand the style with specific musical techniques and arrangement
    - finalize: Produce a complete style specification ready for generation

    Accepts JSON with "step" (init/develop/finalize), "session_id" (optional),
    "description" (music style description), and optional "port" (planner service port).
    Returns the planner's enhanced style specification with session tracking.

    Example:
        - POST /api/music-gen/plan-style { "step": "init", "description": "upbeat pop song" }
        - POST /api/music-gen/plan-style { "step": "develop", "session_id": "s1", "description": "add bridge" }
        - POST /api/music-gen/plan-style { "step": "finalize", "session_id": "s1" }
    """
    step = request.get("step", "init")
    session_id = request.get("session_id")
    user_description = request.get("description", "")

    if step not in ("init", "develop", "finalize"):
        raise HTTPException(
            400,
            detail=f"Invalid step '{step}'. Must be one of: init, develop, finalize",
        )

    # Validate session name if provided
    if session_id and not _validate_planner_name(session_id):
        raise HTTPException(400, detail="Invalid session_id format")

    # Use or create session
    if session_id:
        if session_id not in PLANNER_SESSION_STORE:
            PLANNER_SESSION_STORE[session_id] = {"blueprint": {}, "steps_completed": []}
        session = PLANNER_SESSION_STORE[session_id]
    else:
        # Generate a session ID
        session_id = f"style_{uuid.uuid4().hex[:8]}"
        session = {"blueprint": {}, "steps_completed": []}
        PLANNER_SESSION_STORE[session_id] = session

    try:
        # Build Chain-of-Thought prompt for the step
        cot_prompt = _build_cot_prompt(step, "style", user_description)

        # Call LM planner service
        planner_url = PLANNER_BASE_URL
        if request.get("port"):
            planner_url = f"http://127.0.0.1:{request['port']}"

        async with aiohttp.ClientSession() as http_session:
            async with http_session.post(
                f"{planner_url}/planning/style",
                json={"step": step, "description": user_description, "cot_prompt": cot_prompt},
                timeout=aiohttp.ClientTimeout(total=PLANNER_HEALTH_TIMEOUT),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                else:
                    text = await resp.text()
                    logger.warning("Planner style request failed (%s): %s", resp.status, text)
                    result = {
                        "style_tags": user_description[:50] if user_description else "pop",
                        "mood": "neutral",
                        "tempo_bpm": 120,
                        "instrumentation": "synth, drums, bass",
                        "vocal_style": "clean",
                    }

        # Store result in session
        if step == "init":
            session["blueprint"] = result
            session["steps_completed"].append("init")
        elif step == "develop":
            if "blueprint" not in session:
                session["blueprint"] = {}
            if isinstance(result, dict):
                session["blueprint"].update(result)
            session["steps_completed"].append("develop")
            # Emit SSE event for development progress
            if "sse_queue" in session:
                await _emit_planner_event(
                    session_id,
                    "plan_develop",
                    {
                        "session_id": session_id,
                        "step": "develop",
                        "blueprint": session["blueprint"],
                        "steps_completed": session["steps_completed"],
                    },
                )
        elif step == "finalize":
            session["final_spec"] = result
            session["steps_completed"].append("finalize")
            # Emit SSE event for plan completion
            await _emit_planner_event(
                session_id,
                "plan_finalize",
                {
                    "session_id": session_id,
                    "steps": session["steps_completed"],
                    "final_spec": result,
                },
            )

        return {
            "session_id": session_id,
            "step": step,
            "result": result,
            "blueprint": session.get("blueprint", {}),
            "steps_completed": session.get("steps_completed", []),
            "fallback": False,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Planner style step {step} failed: {e}")
        # Return fallback result
        fallback_result = {
            "style_tags": user_description[:50] if user_description else "pop",
            "mood": "neutral",
            "tempo_bpm": 120,
            "instrumentation": "synth, drums, bass",
            "vocal_style": "clean",
        }
        return {
            "session_id": session_id or "unknown",
            "step": step,
            "result": fallback_result,
            "error": str(e),
            "fallback": True,
            "blueprint": {},
            "steps_completed": [],
        }


@router.post("/plan-lyrics")
async def plan_lyrics(request: dict[str, Any]) -> dict[str, Any]:
    """Draft lyrics incrementally via the LM planner. Similar to plan-style but
    for the lyrics section. Allows building up verses, choruses, bridges step by step.

    Request fields:
        - partial: str | None  Current partial lyrics (may include [Verse], [Chorus] tags)
        - step: str            Planning step: "init", "add_verse", "add_chorus", "finalize"
        - context: str | None    Additional context (theme, story, etc.)

    Response:
        - lyrics: str            Enhanced/planned lyrics section
        - confidence: float      Planning confidence (0-1)
        - needs_more: bool       Whether more planning steps are needed
    """
    step = request.get("step", "init")
    context = request.get("context") or ""
    partial_lyrics = request.get("partial_lyrics", "")
    session_id = request.get("session_id")

    if step not in ("init", "add_verse", "add_chorus", "add_bridge", "finalize"):
        raise HTTPException(
            400,
            detail=f"Invalid step '{step}'. Must be one of: init, add_verse, add_chorus, add_bridge, finalize",
        )

    # Validate session name if provided
    if session_id and not _validate_planner_name(session_id):
        raise HTTPException(400, detail="Invalid session_id format")

    # Use or create session
    if session_id:
        if session_id not in PLANNER_SESSION_STORE:
            PLANNER_SESSION_STORE[session_id] = {"blueprint": {}, "steps_completed": [], "sections": {}}
        session = PLANNER_SESSION_STORE[session_id]
    else:
        session_id = f"lyrics_{uuid.uuid4().hex[:8]}"
        session = {"blueprint": {}, "steps_completed": [], "sections": {}}
        PLANNER_SESSION_STORE[session_id] = session

    # Build Chain-of-Thought prompt for the step
    cot_prompt = _build_cot_prompt(step, "lyrics", context)

    # Call LM planner service
    planner_url = PLANNER_BASE_URL
    if request.get("port"):
        planner_url = f"http://127.0.0.1:{request['port']}"

    payload = {
        "step": step,
        "context": context,
        "partial_lyrics": partial_lyrics,
        "cot_prompt": cot_prompt,
    }
    if session.get("sections"):
        payload["sections"] = session["sections"]

    try:
        async with aiohttp.ClientSession() as http_session:
            async with http_session.post(
                f"{planner_url}/planning/lyrics",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=PLANNER_HEALTH_TIMEOUT),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                else:
                    text = await resp.text()
                    logger.warning("Planner lyrics request failed (%s): %s", resp.status, text)
                    result = {
                        "lyrics": partial_lyrics or context[:200] if partial_lyrics or context else "[Verse]\n",
                        "confidence": 0.5,
                        "needs_more": True,
                    }
    except Exception as exc:
        logger.error("Planner lyrics step %s failed: %s", step, exc)
        result = {
            "lyrics": partial_lyrics or context[:200] if partial_lyrics or context else "[Verse]\n",
            "confidence": 0.0,
            "needs_more": True,
            "error": str(exc),
            "fallback": True,
        }

    # Track section in session
    sections = session.setdefault("sections", {})
    section_name = result.get("section_name") or step
    sections[section_name] = result
    if step not in session["steps_completed"]:
        session["steps_completed"].append(step)

    # Emit SSE event for planning progress
    await _emit_planner_event(
        session_id,
        f"plan_{step}",
        {
            "session_id": session_id,
            "step": step,
            "result": result,
            "sections": sections,
            "steps_completed": session["steps_completed"],
        },
    )

    return {
        "session_id": session_id,
        "step": step,
        "lyrics": result.get("lyrics", ""),
        "confidence": result.get("confidence", 0.5),
        "needs_more": result.get("needs_more", True),
        "section_name": result.get("section_name", section_name),
        "result": result,
        "blueprint": session.get("blueprint", {}),
        "steps_completed": session.get("steps_completed", []),
        "fallback": result.get("fallback", False),
    }


# ---------------------------------------------------------------------------
# Planner endpoints – incremental style/lyrics drafting
# The LM planner drafts style/lyrics without requiring finished strings upfront.
# This surface exposes planning before generation.
# ---------------------------------------------------------------------------
# File download endpoints
# ---------------------------------------------------------------------------


@router.get("/audio/{output_name}")
async def get_audio(output_name: str):
    """Download generated audio file."""
    output_name = _validate_output_name(output_name)
    output_dir = PROJECT_ROOT / "output" / "audio"

    # Generated songs are written by POST /generate to output/audio/<name>.wav.
    audio_path = output_dir / f"{output_name}.wav"
    if audio_path.exists():
        return FileResponse(
            str(audio_path),
            media_type="audio/wav",
            filename=f"{output_name}.wav",
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
