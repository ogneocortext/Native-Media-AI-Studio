"""
packages/backend/app/api/audio_remix.py

Endpoints for audio remix / mashup building, backed by the stem-remixer
services (services/remix_*.py) and the mastering service (services/mastering.py).

The frontend client at packages/frontend/src/services/api/remix.ts consumes this
exact surface. Every field name and response shape below mirrors it so a rename
on either side shows up as a type error rather than as ``undefined`` at runtime.

Routes:

  GET    /api/audio/remix/sources                  list separated stem sources
  POST   /api/audio/remix/probe?track=             tempo + advisory key for a track
  POST   /api/audio/remix/preview                  preview a recipe (no render)
  POST   /api/audio/remix/preview-audio            render a bounded audible excerpt
  POST   /api/audio/remix/from-prompt              draft a recipe from natural language
  POST   /api/audio/remix/build                    start a build job -> returns job_id
  POST   /api/audio/remix/{name}/enhance           start a master/enhance job
  GET    /api/audio/remix/jobs                     list recent remix jobs
  GET    /api/audio/remix/jobs/{job_id}            job status
  POST   /api/audio/remix/jobs/{job_id}/cancel     cancel a job
  GET    /api/audio/remix/list                     list rendered remixes
  GET    /api/audio/remix/by-track/{track}         remix lineage for a track
  GET    /api/audio/remix/{name}/versions          every render of a remix
  GET    /api/audio/remix/{name}/file/{which}      serve a stem/master file (FileResponse)
  GET    /api/audio/remix/preview/{filename}       serve a cached preview excerpt

Builds and enhances run as background queue jobs (JobType.REMIX_BUILD /
JobType.REMIX_ENHANCE) so a 7-23 s render or a ~60 s master never blocks a
single HTTP request. Job handlers are registered with the queue processor at
module import time.

Dependency direction: api -> services only. This module imports the remix
services and the queue manager; nothing in services/ or adapters/ imports it.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, field_validator

from ..core.logging_config import structured_logger
from ..models.job import Job, JobCreateRequest, JobStatus, JobType
from ..queue.manager import queue_manager
from ..queue.processor import processor
from ..services.remix_analysis import probe_track
from ..services.remix_constants import STEM_NAMES
from ..services.remix_library import (
    list_remix_versions,
    list_remixes,
    list_remixes_for_track,
    remix_dir,
    remix_version_dir,
)
from ..services.remix_preview import preview_recipe, render_preview_audio
from ..services.remix_recipe import RemixLayer, RemixRecipe, RemixSlot
from ..services.remix_render import render_remix
from ..services.remix_source import list_stem_sources
from ..services.remotion_cli import DEFAULT_COMPOSITION_ID, remotion_cli
from ..services.stem_remixer import PREVIEW_DIR
from ..services.suno_enhancer import EnhanceConfig, SunoEnhancer

logger = logging.getLogger(__name__)

#: Tracked fire-and-forget background tasks so progress updates from remix
#: job handlers are not silently garbage-collected (asyncio holds only a
#: weak reference to unowned tasks -- see Python 3.12+ docs on
#: asyncio.create_task).
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    """Schedule a fire-and-forget coroutine and keep it alive until done.

    The returned task is held in a strong-reference set and removed via a
    done callback. Any exception is logged instead of vanishing silently.
    """
    task = asyncio.create_task(coro)
    _background_tasks.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _background_tasks.discard(t)
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.error(
                "audio_remix.background_task_failed",
                error=str(exc),
                error_type=type(exc).__name__,
            )

    task.add_done_callback(_on_done)
    return task


# ----------------------------------------------------------------------
# Request model used by the test suite to round-trip a manifest back into
# a buildable recipe payload. Kept here so `app.api.audio_remix` exposes
# `RemixRecipeRequest` as it did before the rewrite.
# ----------------------------------------------------------------------


class _RemixLayerRequest(BaseModel):
    track: str
    stem: str
    gain_db: float = 0.0
    key_shift_semitones: float = 0.0
    source_start_bar: int = 0
    lowpass_hz: float | None = None
    brightness_db: float | None = None


class _RemixSlotRequest(BaseModel):
    layers: list[_RemixLayerRequest]
    bars: int = 8
    crossfade_bars: float = 0.0


class RemixRecipeRequest(BaseModel):
    """Wire shape for a remix build request (matches RemixRecipeSpec in the frontend)."""

    name: str
    target_bpm: float
    beats_per_bar: int = 4
    slots: list[_RemixSlotRequest]
    key: str | None = None
    overwrite: bool = True


router = APIRouter(prefix="/api/audio/remix", tags=["audio-remix"])

#: Maps queue statuses to the frontend's RemixJobStatus state values.
_STATUS_MAP = {
    JobStatus.QUEUED: "queued",
    JobStatus.RUNNING: "running",
    JobStatus.COMPLETED: "done",
    JobStatus.FAILED: "failed",
    JobStatus.CANCELLED: "cancelled",
    JobStatus.DEAD: "failed",
    JobStatus.RETRYING: "running",
    JobStatus.PENDING: "queued",
}


# Request / response models


class _BuildRequest(BaseModel):
    """Pydantic validation wrapper for the /build request body.

    Fields mirror RemixRecipeSpec in the frontend. Extra fields (e.g. ``recipe``)
    are ignored so the full wire payload can round-trip through this model.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = "mashup"
    target_bpm: float = 120.0
    slots: list[dict[str, Any]] = []
    beats_per_bar: int = 4
    key: str | None = None
    overwrite: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def _coerce_name(cls, v: Any) -> str:
        if v is None:
            return "mashup"
        return str(v).strip() or "mashup"


class _EnhanceRequest(BaseModel):
    """Fields accepted by POST /{name}/enhance."""

    model_config = ConfigDict(extra="ignore")

    vocal_balance_db: float = 0.0
    pre_highpass_hz: float = 30.0
    target_peak_dbfs: float = -1.0
    master_ceiling_dbfs: float = -1.0


class _DraftRequest(BaseModel):
    """Fields accepted by POST /from-prompt."""

    model_config = ConfigDict(extra="ignore")

    prompt: str = ""
    base_recipe: Any = None

    @field_validator("prompt", mode="before")
    @classmethod
    def _coerce_prompt(cls, v: Any) -> str:
        if v is None:
            return ""
        return str(v).strip()


# Recipe conversion


def _recipe_from_request(data: dict[str, Any]) -> RemixRecipe:
    """Convert the wire recipe shape into backend RemixRecipe dataclasses.

    The wire shape is RemixRecipeSpec from the frontend: flat dicts with
    camelCase-free keys already matching the backend dataclass field names.
    """
    slots: list[RemixSlot] = []
    for slot_data in data.get("slots") or []:
        layers: list[RemixLayer] = []
        for layer_data in slot_data.get("layers") or []:
            layers.append(
                RemixLayer(
                    track=str(layer_data["track"]),
                    stem=str(layer_data["stem"]),
                    gain_db=float(layer_data.get("gain_db", 0.0)),
                    key_shift_semitones=float(layer_data.get("key_shift_semitones", 0.0)),
                    source_start_bar=int(layer_data.get("source_start_bar", 0)),
                    lowpass_hz=layer_data.get("lowpass_hz"),
                    brightness_db=layer_data.get("brightness_db"),
                )
            )
        slots.append(
            RemixSlot(
                layers=layers,
                bars=int(slot_data.get("bars", 8)),
                crossfade_bars=float(slot_data.get("crossfade_bars", 2.0)),
            )
        )
    return RemixRecipe(
        name=str(data.get("name", "mashup")).strip() or "mashup",
        target_bpm=float(data.get("target_bpm", 120.0)),
        slots=slots,
        beats_per_bar=int(data.get("beats_per_bar", 4)),
        key=data.get("key"),
    )


def _check_stems_available(recipe: RemixRecipe) -> None:
    """Raise 400 when any layer references a track/stem with no separated WAV."""
    sources = list_stem_sources()
    available: set[tuple[str, str]] = set()
    for src in sources:
        for stem, present in (src.get("stems") or {}).items():
            if present:
                available.add((str(src.get("track", "")), str(stem)))
    for slot in recipe.slots:
        for layer in slot.layers:
            if (layer.track, layer.stem) not in available:
                raise HTTPException(
                    status_code=400,
                    detail=f"No {layer.stem} stem separated for {layer.track!r} "
                    f"(GET /api/audio/remix/sources lists available sources)",
                )


# Job status mapping


def _job_to_status(job: Job) -> dict[str, Any]:
    """Map a persisted Job to the frontend's RemixJobStatus shape."""

    def _ts(value: Any) -> float | None:
        # Guard against non-datetime values (float/str) that lack .timestamp().
        return value.timestamp() if value is not None and hasattr(value, "timestamp") else None

    started_at = _ts(job.started_at)
    finished_at = _ts(job.completed_at)
    return {
        "job_id": job.id,
        "kind": job.job_type,
        "label": f"{job.job_type} job",
        "cancellable": job.status in (JobStatus.PENDING, JobStatus.QUEUED, JobStatus.RUNNING),
        "state": _STATUS_MAP.get(job.status, str(job.status)),
        "progress": job.progress,
        "error": job.error,
        "result": job.result,
        "elapsed_sec": job.duration_seconds,
        "started_at": started_at,
        "finished_at": finished_at,
    }


# Job handlers (run inside the queue processor)


async def _remix_build_handler(job: Job) -> dict[str, Any]:
    """Render a remix recipe in the background.

    Validation happens synchronously in the endpoint; this handler only runs
    after the recipe has been accepted, so a failure here is a render problem,
    not a request problem.
    """
    params = job.params or {}
    recipe_data = params.get("recipe")
    if not isinstance(recipe_data, dict):
        structured_logger.error(
            "remix.build.validation_failed",
            job_id=job.id,
            error="missing_recipe",
        )
        raise ValueError("build job missing recipe")
    overwrite = bool(params.get("overwrite", True))

    structured_logger.info(
        "remix.build.started",
        job_id=job.id,
        recipe_name=recipe_data.get("name", "unnamed"),
        overwrite=overwrite,
    )

    recipe = _recipe_from_request(recipe_data)
    recipe.validate()

    loop = asyncio.get_running_loop()

    def _progress(frac: float, message: str) -> None:
        # Called from a worker thread (render_remix runs via to_thread).
        # Schedule the async job update on the running event loop.
        asyncio.run_coroutine_threadsafe(
            queue_manager.update_job(job.id, progress=frac, message=message), loop
        )

    # render_remix is CPU-bound (numpy/soundfile); run off the event loop.
    result = await asyncio.to_thread(render_remix, recipe, overwrite, progress_cb=_progress)

    structured_logger.info(
        "remix.build.completed",
        job_id=job.id,
        name=result.name,
        directory=result.directory,
        duration_sec=result.duration_sec,
        warnings_count=len(result.warnings),
    )

    return {
        "name": result.name,
        "directory": result.directory,
        "stems": result.stems,
        "duration_sec": result.duration_sec,
        "manifest": result.manifest,
        "warnings": result.warnings,
    }


async def _remix_enhance_handler(job: Job) -> dict[str, Any]:
    """Master a rendered remix's stems through the enhancer chain.

    The remix's own stems live under output/remixes/<name>/ and the enhanced
    output is written beside them under output/remixes/<name>/enhanced/.
    """
    params = job.params or {}
    name = params.get("name")
    options = params.get("options") or {}

    structured_logger.info(
        "remix.enhance.started",
        job_id=job.id,
        remix_name=name,
        options=options,
    )

    try:
        remix_path = remix_dir(name)
    except ValueError as exc:
        structured_logger.error(
            "remix.enhance.validation_failed",
            job_id=job.id,
            remix_name=name,
            error=str(exc),
        )
        raise ValueError(f"Invalid remix name: {name!r}") from exc

    missing = [s for s in STEM_NAMES if not (remix_path / f"{s}.wav").exists()]
    if missing:
        structured_logger.error(
            "remix.enhance.missing_stems",
            job_id=job.id,
            remix_name=name,
            missing_stems=missing,
        )
        raise FileNotFoundError(
            f"Remix {name!r} is missing stems: {', '.join(missing)} -- build it first"
        )

    cfg = EnhanceConfig(
        target_peak_dbfs=float(options.get("target_peak_dbfs", -1.0)),
        pre_highpass_hz=float(options.get("pre_highpass_hz", 30.0)),
        master_ceiling_dbfs=float(options.get("master_ceiling_dbfs", -1.0)),
        vocal_balance_db=float(options.get("vocal_balance_db", 0.0)),
        output_format="both",
    )

    enhancer = SunoEnhancer(config=cfg)

    def _progress(frac: float, message: str) -> None:
        _spawn(queue_manager.update_job(job.id, progress=frac, message=message))

    result = await enhancer.enhance_stems(
        remix_path, remix_path / "enhanced", progress_cb=_progress
    )

    structured_logger.info(
        "remix.enhance.completed",
        job_id=job.id,
        remix_name=name,
        success=result.success,
        duration_sec=result.duration_sec or 0.0,
        steps_count=len(result.steps),
    )

    if not result.success:
        return {
            "name": name,
            "output_dir": result.output_dir,
            "wav_path": result.wav_path,
            "mp3_path": result.mp3_path,
            "duration_sec": 0.0,
            "steps": result.steps,
            "error": result.error,
            "success": False,
        }

    duration = 0.0
    if result.wav_path:
        try:
            import soundfile as sf  # local import: optional heavy dep

            info = sf.info(result.wav_path)
            duration = float(info.frames) / float(info.samplerate)
        except Exception:
            logger.debug("could not measure duration of %s", result.wav_path)

    return {
        "name": name,
        "output_dir": result.output_dir,
        "wav_path": result.wav_path,
        "mp3_path": result.mp3_path,
        "duration_sec": duration,
        "steps": result.steps,
        "error": result.error,
        "success": True,
    }


async def _remotion_render_handler(job: Job) -> dict[str, Any]:
    """Render a Remotion composition via the CLI as a background job.

    params: {
        "composition_id": "SignalBreakingThroughNoise",  # optional, default
        "output_path": "output/remotion/my-video.mp4",   # optional
        "props": {...},                                  # optional, passed to the composition
        "codec": "h264",                                 # optional
        "concurrency": "auto",                           # optional
    }
    """
    params = job.params or {}
    composition_id = str(params.get("composition_id") or DEFAULT_COMPOSITION_ID)
    output_path = params.get("output_path")
    props = params.get("props")
    codec = str(params.get("codec", "h264"))
    concurrency = params.get("concurrency", "auto")

    if not output_path:
        from ..core.config import PROJECT_ROOT

        output_path = str(PROJECT_ROOT / "output" / "remotion" / f"{composition_id}.mp4")

    def _progress(frac: float, message: str) -> None:
        _spawn(queue_manager.update_job(job.id, progress=frac, message=message))

    result = await remotion_cli.render(
        composition_id=composition_id,
        output_path=output_path,
        props=props,
        codec=codec,
        concurrency=concurrency,
        progress_cb=_progress,
    )
    return result


# Register the remix job handlers with the queue processor. main.py imports
# this router before the processor starts processing jobs, so the handlers are
# present when the first build/enhance/render job is enqueued.
processor.register_handler(JobType.REMIX_BUILD, _remix_build_handler)
processor.register_handler(JobType.REMIX_ENHANCE, _remix_enhance_handler)
processor.register_handler(JobType.REMOTION_RENDER, _remotion_render_handler)


# Source / probe / preview endpoints


@router.get("/sources")
async def list_sources() -> dict[str, Any]:
    """Every track directory holding at least one stem, with per-stem presence.

    Mirrors the frontend's RemixSource shape: track, model, stems, plus cached
    probe fields (bpm, duration_sec, first_audible_sec) and library_file (B6).
    """
    sources = list_stem_sources()
    return {"sources": sources}


@router.post("/probe")
async def remix_probe(track: str = Query(...)) -> dict[str, Any]:
    """Tempo and advisory key for one track.

    ``track`` is a query parameter (not a path segment) because track names can
    contain colons, slashes, and other characters that break URL path encoding.
    The probe result shape already matches the frontend's RemixProbe interface.
    """
    try:
        return probe_track(track)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/preview")
async def preview_remix_recipe(body: RemixRecipeRequest) -> dict[str, Any]:
    """Preview a recipe without committing to a render.

    Returns the exact timeline, per-source levels and stretch ratios so the
    caller can sanity-check before paying for a build. No audio is written.
    """
    recipe = _recipe_from_request(body.model_dump())
    try:
        recipe.validate()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid recipe: {exc}") from exc
    _check_stems_available(recipe)

    # preview_recipe is CPU-bound (decodes + stretches every source).
    result = await asyncio.to_thread(preview_recipe, recipe)
    return result


@router.post("/preview-audio")
async def preview_remix_audio(body: dict[str, Any]) -> dict[str, Any]:
    """Render a bounded, playable excerpt of a recipe (A3).

    Same mix core as the build, truncated to ~30 s and cached by recipe hash.
    Returns a playable URL under /api/audio/remix/preview/<file>.wav.
    """
    try:
        data = dict(body)
        slot_index = data.pop("slot_index", None)
        recipe = _recipe_from_request(data)
        recipe.validate()
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid recipe: {exc}") from exc
    _check_stems_available(recipe)

    # R2: audition one slot alone through the same mix path.
    if slot_index is not None:
        try:
            slot_index = int(slot_index)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="slot_index must be an integer") from exc
        if slot_index < 0 or slot_index >= len(recipe.slots):
            raise HTTPException(
                status_code=400,
                detail=f"Slot index {slot_index} out of range (0-{len(recipe.slots) - 1})",
            )
        recipe = RemixRecipe(
            name=recipe.name,
            target_bpm=recipe.target_bpm,
            slots=[recipe.slots[slot_index]],
            beats_per_bar=recipe.beats_per_bar,
            key=recipe.key,
        )

    # render_preview_audio is CPU-bound; run off the event loop.
    result = await asyncio.to_thread(render_preview_audio, recipe)

    preview_name = Path(result["path"]).name
    return {
        "url": f"/api/audio/remix/preview/{preview_name}",
        "duration_sec": result["duration_sec"],
        "truncated": result["truncated"],
        "warnings": result["warnings"],
    }


@router.get("/preview/{filename}")
async def serve_preview_file(filename: str) -> FileResponse:
    """Serve a cached preview excerpt WAV for browser playback."""
    safe_name = Path(filename).name
    if safe_name != filename or ".." in safe_name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = PREVIEW_DIR / safe_name
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Preview not found")
    return FileResponse(str(file_path), media_type="audio/wav", filename=file_path.name)


@router.post("/from-prompt")
async def draft_from_prompt(body: _DraftRequest) -> dict[str, Any]:
    """Draft (or revise) a remix recipe from natural language.

    Body: ``{"prompt": "..."}`` for a fresh draft, or
    ``{"prompt": "...", "base_recipe": {...}}`` for a revision (R1).
    Falls back to a deterministic heuristic when Ollama is unavailable.
    """
    prompt = body.prompt
    base_recipe = body.base_recipe

    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    sources = list_stem_sources()
    try:
        from ..services.remix_prompt_drafting import (
            draft_recipe_from_prompt,
            revise_recipe_from_prompt,
        )
    except Exception as exc:  # pragma: no cover - import failure is environmental
        logger.exception("Remix drafting module unavailable")
        raise HTTPException(status_code=503, detail="Remix drafting unavailable") from exc

    if base_recipe is not None:
        result = await revise_recipe_from_prompt(prompt, base_recipe, sources)
    else:
        result = await draft_recipe_from_prompt(prompt, sources)
        result.setdefault("changes", [])
    return result


# Build / enhance (job-backed): background queue jobs for render and master


@router.post("/build")
async def build_remix(body: _BuildRequest) -> dict[str, Any]:
    """Start a remix build as a background job.

    The recipe is validated synchronously (bad recipe or missing stem throws
    here), then a REMIX_BUILD job is enqueued and polled via GET /jobs/{id}.
    """
    recipe = _recipe_from_request(body.model_dump())
    recipe.validate()
    _check_stems_available(recipe)

    job_request = JobCreateRequest(
        job_type=JobType.REMIX_BUILD,
        params={"recipe": body.model_dump(), "overwrite": body.overwrite},
        max_retries=3,
        priority=0,
    )
    job = await queue_manager.enqueue(job_request)
    logger.info("Remix build enqueued job=%s name=%s", job.id, recipe.name)
    return {
        "job_id": job.id,
        "kind": "build",
        "label": f"Build remix '{recipe.name}'",
        "state": "queued",
    }


@router.post("/{name}/enhance")
async def enhance_remix(name: str, body: _EnhanceRequest) -> dict[str, Any]:
    """Start a master/enhance of a rendered remix as a background job.

    Checks the remix and its stems exist synchronously, then enqueues a
    REMIX_ENHANCE job. Poll GET /jobs/{id} for the result.
    """
    try:
        remix_path = remix_dir(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid remix name: {name!r}") from exc

    missing = [s for s in STEM_NAMES if not (remix_path / f"{s}.wav").exists()]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Remix {name!r} is missing stems: {', '.join(missing)} -- build it first",
        )

    options = body
    job_request = JobCreateRequest(
        job_type=JobType.REMIX_ENHANCE,
        params={
            "name": name,
            "options": {
                "target_peak_dbfs": options.target_peak_dbfs,
                "pre_highpass_hz": options.pre_highpass_hz,
                "master_ceiling_dbfs": options.master_ceiling_dbfs,
                "vocal_balance_db": options.vocal_balance_db,
            },
        },
        max_retries=3,
        priority=0,
    )
    job = await queue_manager.enqueue(job_request)
    logger.info("Remix enhance enqueued job=%s name=%s", job.id, name)
    return {
        "job_id": job.id,
        "kind": "enhance",
        "label": f"Enhance remix '{name}'",
        "state": "queued",
    }


# Job management endpoints


@router.get("/jobs")
async def list_remix_jobs() -> dict[str, Any]:
    """Recent remix build/enhance/render jobs, newest first."""
    jobs = await queue_manager.get_all_jobs()
    remix_jobs = [
        j
        for j in jobs
        if j.job_type in (JobType.REMIX_BUILD, JobType.REMIX_ENHANCE, JobType.REMOTION_RENDER)
    ]
    return {"jobs": [_job_to_status(j) for j in remix_jobs]}


@router.get("/jobs/{job_id}")
async def get_remix_job(job_id: str) -> dict[str, Any]:
    """Status of one remix build/enhance/render job, including its result."""
    job = await queue_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.job_type not in (JobType.REMIX_BUILD, JobType.REMIX_ENHANCE, JobType.REMOTION_RENDER):
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_status(job)


@router.post("/jobs/{job_id}/cancel")
async def cancel_remix_job(job_id: str) -> dict[str, Any]:
    """Ask a running remix or remotion job to stop.

    Cooperative: the render polls the cancellation token between slots, so the
    job reaches `cancelled` within one slot's render time. A cancelled build
    writes nothing, so any previous render under the same name survives.
    """
    job = await queue_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.job_type not in (JobType.REMIX_BUILD, JobType.REMIX_ENHANCE, JobType.REMOTION_RENDER):
        raise HTTPException(status_code=404, detail="Job not found")

    success = await queue_manager.cancel_job(job_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status: {job.status}",
        )
    updated = await queue_manager.get_job(job_id)
    return _job_to_status(updated)


# Remix library endpoints


@router.get("/list")
async def list_remixes_endpoint() -> dict[str, Any]:
    """List every rendered remix with its manifest summary."""
    remixes = list_remixes()
    return {"remixes": remixes}


@router.get("/by-track/{track}")
async def track_lineage(track: str) -> dict[str, Any]:
    """Every rendered mashup that consumed ``track``, with its recipe attached."""
    remixes = list_remixes_for_track(track)
    return {"track": track, "remixes": remixes}


@router.get("/{name}/versions")
async def list_remix_versions_endpoint(name: str) -> dict[str, Any]:
    """Every render of one remix, newest first: the current one plus its archive."""
    try:
        versions = list_remix_versions(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"versions": versions}


# File serving


@router.get("/{name}/file/{which}")
async def serve_remix_file(
    name: str,
    which: str,
    version: int | None = Query(
        default=None, description="Archived render version; omitted = current"
    ),
) -> FileResponse:
    """Serve a remix stem or master file for browser playback.

    ``which`` is a stem name (vocals/drums/bass/other) or ``master``. Stem files
    live at ``output/remixes/<name>/<which>.wav``; the master is the enhanced
    output at ``output/remixes/<name>/enhanced/<name>_enhanced.wav``. A ``?version=N``
    query selects an archived render from ``.versions/vNNN/``.
    """
    try:
        base: Path
        if version is not None:
            base = remix_version_dir(name, version)
        else:
            base = remix_dir(name)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    candidates: list[Path] = []
    if which in STEM_NAMES:
        candidates = [base / f"{which}.wav", base / f"{which}.mp3"]
    elif which == "master":
        enhanced = base / "enhanced"
        candidates = [enhanced / f"{name}_enhanced.wav", enhanced / f"{name}_enhanced.mp3"]
    else:
        raise HTTPException(
            status_code=400,
            detail="which must be one of " + ", ".join(STEM_NAMES) + " or 'master'",
        )

    file_path: Path | None = None
    for candidate in candidates:
        if candidate.is_file():
            file_path = candidate
            break

    if file_path is None:
        raise HTTPException(
            status_code=404,
            detail=f"Remix file not found: {name}/{which}"
            + (f" (version {version})" if version is not None else ""),
        )

    media_type = "audio/mpeg" if file_path.suffix.lower() == ".mp3" else "audio/wav"
    return FileResponse(str(file_path), media_type=media_type, filename=file_path.name)


# Remotion Studio control endpoints


class _RemotionRenderRequest(BaseModel):
    """Fields accepted by POST /remotion/render."""

    model_config = ConfigDict(extra="ignore")

    composition_id: str = DEFAULT_COMPOSITION_ID
    output_path: str | None = None
    props: Any = None
    codec: str = "h264"
    concurrency: str | int = "auto"


@router.get("/remotion/status")
async def remotion_status() -> dict[str, Any]:
    """Whether the Remotion CLI is available for programmatic rendering.

    Returns the CLI binary path (if resolvable) and the default composition ID
    exposed by the local video editor project.
    """
    return {
        "available": remotion_cli.is_available(),
        "cli_bin": remotion_cli.remotion_bin(),
        "npx_available": remotion_cli.npx_available(),
        "video_editor_dir": str(remotion_cli.video_editor_dir),
        "default_composition_id": DEFAULT_COMPOSITION_ID,
    }


@router.post("/remotion/render")
async def remotion_render(body: _RemotionRenderRequest) -> dict[str, Any]:
    """Start a Remotion composition render as a background job.

    Body fields (all optional):
      - composition_id: Remotion composition ID (default: SignalBreakingThroughNoise)
      - output_path: where to write the MP4 (default: output/remotion/<id>.mp4)
      - props: JSON props passed to the composition (e.g. analysis data)
      - codec: h264, hevc, etc. (default: h264)
      - concurrency: "auto" or a number (default: auto)

    Returns a job_id to poll via GET /api/audio/remix/jobs/{id}.
    """
    if not remotion_cli.is_available():
        raise HTTPException(
            status_code=503,
            detail="Remotion CLI not available. Install @remotion/cli in "
            "packages/video-editor or ensure `remotion` is on PATH.",
        )

    request = body
    job_request = JobCreateRequest(
        job_type=JobType.REMOTION_RENDER,
        params={
            "composition_id": request.composition_id,
            "output_path": request.output_path,
            "props": request.props,
            "codec": request.codec,
            "concurrency": request.concurrency,
        },
        max_retries=3,
        priority=0,
    )
    job = await queue_manager.enqueue(job_request)
    logger.info(
        "Remotion render enqueued job=%s composition=%s output=%s",
        job.id,
        request.composition_id,
        request.output_path,
    )
    return {
        "job_id": job.id,
        "kind": "render",
        "label": f"Render Remotion composition '{request.composition_id}'",
        "state": "queued",
    }


@router.get("/remotion/availability")
async def remotion_availability() -> dict[str, Any]:
    """Alias for /remotion/status — kept for frontend symmetry."""
    return await remotion_status()
