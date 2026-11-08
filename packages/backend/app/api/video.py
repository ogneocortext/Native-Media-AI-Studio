"""
Video generation API routes.
Handles music video generation per section, cost estimation (A2), and
Spotify Canvas loop extraction (A4).
"""

import asyncio
import logging
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video", tags=["Video"])


def _check_steps(v: int) -> int:
    if v < 1 or v > 150:
        raise ValueError("steps must be between 1 and 150")
    return v


def _check_cfg(v: float) -> float:
    if v < 0.0 or v > 30.0:
        raise ValueError("cfg_scale must be between 0.0 and 30.0")
    return v


def _check_dimension(v: int) -> int:
    if v < 64 or v > 4096 or v % 8 != 0:
        raise ValueError("dimensions must be between 64 and 4096 and divisible by 8")
    return v


class VideoGenerateRequest(BaseModel):
    """Request model for video section generation -- real queue, no mock"""

    prompt: str
    negative_prompt: str = ""
    steps: int = Field(default=25, ge=1, le=150)
    cfg_scale: float = Field(default=5.0, ge=0.0, le=30.0)
    seed: int = -1
    section: str = "full"
    duration: float = Field(default=10.0, gt=0, le=3600)
    vertical_first: bool = False
    audio_path: str | None = None
    audio_filename: str | None = None
    method: str = "visualization"
    model: str = ""
    visualization: dict[str, Any] | None = None
    width: int = Field(default=768, ge=64, le=4096)
    height: int = Field(default=512, ge=64, le=4096)
    scheduler: str = "normal"
    enrich_prompt: bool = False

    @field_validator("width", "height")
    @classmethod
    def validate_dimension(cls, v: int) -> int:
        return _check_dimension(v)


class VideoGenerateResponse(BaseModel):
    """Response model for video generation -- now returns real job for polling"""

    success: bool
    job_id: str | None = None
    output_path: str | None = None
    section: str
    error: str | None = None
    message: str | None = None


# ---------------------------------------------------------------------------
# Render engine abstraction (stack-extensions-2026.md Phase 2)
# ---------------------------------------------------------------------------


class RenderRequest(BaseModel):
    """Engine-agnostic render request.

    kind: "color" (solid test/underlay clip), "frames" (image sequence),
          "image" (still held for duration).
    engine: "auto" | "coreflux" | "movielite" | "ffmpeg" | "moviepy"
    output_path: relative paths resolve against the project root
                 (defaults into output/video/).
    """

    kind: str = "color"
    engine: str = "auto"
    width: int = Field(default=1280, ge=16, le=7680)
    height: int = Field(default=720, ge=16, le=4320)
    duration: float = Field(default=5.0, gt=0, le=3600)
    fps: int = Field(default=24, ge=1, le=120)
    output_path: str | None = None
    color: str = "#000000"
    frames_dir: str | None = None
    frame_pattern: str = "frame_%04d.png"
    image_path: str | None = None
    audio_path: str | None = None


@router.post("/generate-section", response_model=VideoGenerateResponse)
async def generate_section(request: VideoGenerateRequest) -> VideoGenerateResponse:
    """Generate a video section -- queues real MUSIC_VIDEO job, no mock fallback."""
    try:
        from ..models.job import JobType
        from ..queue.manager import queue_manager

        # Validate prompt
        if not request.prompt or not request.prompt.strip():
            raise ValueError("prompt is required")

        # Use the real MUSIC_VIDEO job type (VIDEO_GENERATE does not exist in JobType)
        # Resolve audio_path from audio_filename when not provided directly
        if not request.audio_path:
            from ..core.config import PROJECT_ROOT as _PR

            audio_dir = _PR / "output" / "audio"
            if request.audio_filename and audio_dir.exists():
                # Same traversal guard as _resolve_lipsync_audio: rglob treats
                # ".." as a real component, so reject it up front.
                name = Path(request.audio_filename)
                if name.is_absolute() or ".." in name.parts:
                    raise ValueError("audio_filename must name a file inside output/audio")
                audio_root = audio_dir.resolve()
                candidate = (audio_dir / request.audio_filename).resolve()
                if candidate.is_relative_to(audio_root) and candidate.exists():
                    request.audio_path = str(candidate)
                else:
                    # Search subdirectories for the audio file
                    matches = sorted(
                        (
                            m.resolve()
                            for m in audio_dir.rglob(request.audio_filename)
                            if m.is_file() and m.resolve().is_relative_to(audio_root)
                        ),
                        key=lambda p: len(p.parts),
                    )
                    if matches:
                        request.audio_path = str(matches[0])
            if not request.audio_path:
                # Fallback: most recent uploaded audio
                candidates = (
                    sorted(audio_dir.rglob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
                    if audio_dir.exists()
                    else []
                )
                candidates = [c for c in candidates if c.is_file()]
                fallback = str(candidates[0]) if candidates else None
                if not fallback:
                    raise ValueError(
                        "audio_path is required -- upload audio first via /api/audio/upload or /api/audio/analyze"
                    )
                request.audio_path = fallback

        viz_config = (request.visualization or {}).copy()
        viz_config.setdefault("style", "abstract")
        viz_config.setdefault(
            "duration", f"{int(request.duration)}s" if request.duration < 60 else "full"
        )
        viz_config.setdefault("resolution", "1080p")
        viz_config.setdefault("fps", 30)

        job_request = {
            "job_type": JobType.MUSIC_VIDEO,
            "params": {
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
                "steps": request.steps,
                "cfg_scale": request.cfg_scale,
                "seed": request.seed if request.seed >= 0 else None,
                "section": request.section,
                "duration": request.duration,
                "duration_seconds": request.duration,
                "audio_path": request.audio_path,
                "audio_filename": request.audio_filename or Path(request.audio_path).name
                if request.audio_path
                else "track.mp3",
                "visualization": viz_config,
                "method": request.method,
                "vertical_first": request.vertical_first,
                "width": request.width,
                "height": request.height,
                "scheduler": request.scheduler,
                "enrich_prompt": request.enrich_prompt,
            },
            "max_retries": 1,
        }
        # queue_manager.enqueue expects JobCreateRequest; use create_job convenience
        from ..models.job import JobCreateRequest

        jcr = JobCreateRequest(
            job_type=JobType.MUSIC_VIDEO, params=job_request["params"], max_retries=1
        )
        job = await queue_manager.enqueue(jcr)

        return VideoGenerateResponse(
            success=True,
            job_id=job.id,
            output_path=f"output/video/{request.section}_{job.id}.mp4",
            section=request.section,
            message=f"Queued section {request.section} as job {job.id[:8]}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


class ExportMatrixRequest(BaseModel):
    """Export Matrix request -- one master video -> publishing derivatives.

    source_path: absolute or project-relative path to a master video
                 (typically output/video/*.mp4).
    beat_times / sections: optional audio-analysis data for beat-aligned
                 loop starts (from POST /api/audio/analyze).
    loop_seconds: Spotify Canvas range 3-8s (default 4.0).
    """

    source_path: str
    beat_times: list[float] | None = None
    sections: list[dict] | None = None
    loop_seconds: float = Field(default=4.0, ge=2.0, le=8.0)


class EstimateCostRequest(BaseModel):
    """Request model for render cost estimation (A2: plan/render cost split)."""

    steps: int = 20
    width: int = 1920
    height: int = 1080
    fps: int = 24
    duration_seconds: float = Field(default=10.0, gt=0)
    model: str = "wan2.2-5b"
    cloud_price_per_second: float | None = None
    # Optional per-shot manifest for per-shot breakdown
    shot_manifest: list[dict[str, Any]] | None = None
    default_model: str = "wan2.2-5b"


class EstimateCostResponse(BaseModel):
    """Response model for render cost estimation.

    Local runs cost nothing -- ``cloud_cost_usd`` is only populated when an
    explicit ``cloud_price_per_second`` was requested (cloud pricing is
    opt-in per request, D9). For a local-only estimate the cost fields are
    absent (frontend shows "Free").
    """

    estimated_seconds: float
    estimated_minutes: float
    estimated_end_time: str
    sec_per_frame: float
    total_frames: int
    vram_estimate_mb: int
    vram_estimate_gb: float
    cloud_cost_usd: float | None = None
    cloud_price_per_second: float | None = None
    # Per-shot breakdown fields
    total_shots: int | None = None
    total_duration_seconds: float | None = None
    vram_peak_mb: int | None = None
    vram_peak_gb: float | None = None
    shots: list[dict[str, Any]] | None = None
    factors: dict[str, Any] | None = None


@router.get("/render/engines")
async def list_render_engines() -> dict:
    """List available video render engines with live availability."""
    from ..services.video import available_engines

    return {"engines": available_engines()}


@router.post("/render")
async def render_video(request: RenderRequest) -> dict:
    """Render a clip with the selected engine (VideoRenderer abstraction).

    Unlike /generate-section (full music-video queue jobs), this is the direct
    render path for quick composites -- matches stack-extensions-2026.md:
    `/api/video/render?engine=moviepy|coreflux|movielite`.
    """
    from ..core.config import PROJECT_ROOT
    from ..services.video import RenderSpec, get_renderer

    try:
        renderer = get_renderer(request.engine)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    output_path = (
        request.output_path or f"output/video/render_{request.kind}_{renderer.engine_id}.mp4"
    )
    if not Path(output_path).is_absolute():
        # Anchor on project root (the API process runs with CWD=packages/backend)
        output_path = str(Path(PROJECT_ROOT) / output_path)
    spec = RenderSpec(
        kind=request.kind,
        width=request.width,
        height=request.height,
        duration=request.duration,
        fps=request.fps,
        output_path=output_path,
        color=request.color,
        frames_dir=request.frames_dir or "",
        frame_pattern=request.frame_pattern,
        image_path=request.image_path or "",
        audio_path=request.audio_path,
    )
    try:
        result = await renderer.render(spec)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    rel = None
    try:
        rel = (
            Path(result.output_path).resolve().relative_to(Path(PROJECT_ROOT).resolve()).as_posix()
        )
    except ValueError:
        pass
    return {
        "success": result.success,
        "engine": result.engine,
        "output_path": result.output_path,
        "relative_path": rel,
        "render_s": result.render_s,
        "size_bytes": result.size_bytes,
        "error": result.error,
        "notes": result.notes,
    }


@router.post("/export-matrix")
async def export_matrix(request: ExportMatrixRequest) -> dict:
    """Build the Export Matrix for one master video (ai-video-trends-2026 Trend 5).

    Derives: 1080x1920 vertical master, 3-8s beat-aligned Canvas loop,
    3 thumbnail variants (A/B/C), and a manifest sidecar. Artifacts land in
    output/video and output/images so they appear in the Media Library.
    """
    from ..services.export_matrix import build_export_matrix

    try:
        result = await build_export_matrix(
            request.source_path,
            beat_times=request.beat_times,
            sections=request.sections,
            loop_seconds=request.loop_seconds,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "success": bool(result.artifacts) and not result.errors,
        "source": result.source,
        "artifacts": [a.__dict__ for a in result.artifacts],
        "errors": result.errors,
        "render_s": result.render_s,
        "manifest_path": result.manifest_path,
        "message": f"Export matrix built: {len(result.artifacts)} artifact(s)"
        + (f", {len(result.errors)} error(s)" if result.errors else ""),
    }


@router.post("/estimate-cost", response_model=EstimateCostResponse)
async def estimate_cost(request: EstimateCostRequest) -> EstimateCostResponse:
    """Estimate render cost and time before queuing (A2: plan/render cost split).

    Returns local compute estimate (time + VRAM) and optional cloud-burst USD
    cost when `cloud_price_per_second` is provided. When `shot_manifest` is
    supplied, returns a per-shot breakdown instead of a single aggregate.
    """
    from ..services.generation_estimator import (
        estimate_cost_from_manifest,
        estimate_render_cost,
    )

    try:
        if request.shot_manifest:
            # Per-shot breakdown against the manifest (A2)
            breakdown = estimate_cost_from_manifest(
                manifest=request.shot_manifest,
                default_model=request.default_model or request.model,
                fps=request.fps,
                steps=request.steps,
                width=request.width,
                height=request.height,
                cloud_price_per_second=request.cloud_price_per_second,
            )
            # Build a synthetic aggregate for the top-level scalar fields
            agg = estimate_render_cost(
                steps=request.steps,
                width=request.width,
                height=request.height,
                num_frames=breakdown["total_frames"],
                fps=request.fps,
                model_name=request.model,
                cloud_price_per_second=request.cloud_price_per_second,
            )
            return EstimateCostResponse(
                **agg,
                total_shots=breakdown["total_shots"],
                total_duration_seconds=breakdown["total_duration_seconds"],
                vram_peak_mb=breakdown["vram_peak_mb"],
                vram_peak_gb=breakdown["vram_peak_gb"],
                shots=breakdown["shots"],
            )

        num_frames = max(1, int(request.duration_seconds * request.fps))
        estimate = estimate_render_cost(
            steps=request.steps,
            width=request.width,
            height=request.height,
            num_frames=num_frames,
            fps=request.fps,
            model_name=request.model,
            cloud_price_per_second=request.cloud_price_per_second,
        )
        return EstimateCostResponse(**estimate)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# A4 -- Spotify Canvas recipe (9:16, 720px, 3--8s seamless loop)
# ---------------------------------------------------------------------------


class CanvasLoopRequest(BaseModel):
    """Request model for Spotify Canvas loop extraction."""

    source_path: str = Field(description="Absolute path to the source video file")
    start: float | None = Field(
        default=None, description="Loop start time in seconds (auto-selected if omitted)"
    )
    duration: float = Field(
        default=5.0, ge=3.0, le=8.0, description="Loop duration in seconds (3--8)"
    )
    width: int = Field(default=720, description="Canvas width in pixels (720)")
    height: int = Field(default=1280, description="Canvas height in pixels (1280 = 9:16)")
    output_path: str | None = Field(
        default=None, description="Output path (defaults into output/video/)"
    )
    crossfade: float = Field(
        default=0.3, description="Crossfade duration at loop point for seamlessness"
    )


class CanvasLoopResponse(BaseModel):
    """Response model for Canvas loop extraction."""

    success: bool
    output_path: str | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    error: str | None = None
    message: str | None = None


# ---------------------------------------------------------------------------
# A6 -- Per-scene model routing
# ---------------------------------------------------------------------------


class RouteSceneRequest(BaseModel):
    """Request model for per-scene model routing (A6)."""

    section_type: str = Field(
        description="Scene/section type: intro|verse|pre_chorus|chorus|drop|bridge|outro"
    )
    energy: float | None = Field(
        default=None, description="Normalised energy 0--1 from audio analysis"
    )
    duration: float | None = Field(default=None, description="Scene duration in seconds")
    vram_available_mb: int | None = Field(
        default=None, description="Free VRAM at routing time (MB)"
    )


class RouteSceneResponse(BaseModel):
    """Response model for per-scene model routing."""

    model: str
    tier: str
    reason: str
    vram_required_mb: int | None = None
    cloud_fallback: str | None = None
    routing_note: str | None = None


@router.post("/route-scene", response_model=RouteSceneResponse)
async def route_scene(request: RouteSceneRequest) -> RouteSceneResponse:
    """Pick the best model for a scene based on its tags (A6).

    Reads ``config/model_routing.json`` and matches against the scene's
    ``section_type`` and ``energy``. Falls back to the config's fallback
    rule when nothing matches.
    """
    try:
        from ..core.config import PROJECT_ROOT

        routing_path = PROJECT_ROOT / "config" / "model_routing.json"
        routing: dict[str, Any] = {}
        if routing_path.is_file():
            import json

            routing = json.loads(routing_path.read_text(encoding="utf-8"))

        rules = routing.get("rules", [])
        fallback = routing.get(
            "fallback", {"model": "wan2.2-5b", "tier": "balanced", "reason": "Default"}
        )

        section = (request.section_type or "").lower().replace(" ", "_")
        energy = request.energy if request.energy is not None else 0.5

        matched = None
        for rule in rules:
            m = rule.get("match", {})
            # section_type must match
            rule_type = m.get("section_type", "").lower()
            if rule_type and rule_type != section:
                continue
            # energy bounds
            emin = m.get("energy_min")
            emax = m.get("energy_max")
            if emin is not None and energy < emin:
                continue
            if emax is not None and energy > emax:
                continue
            matched = rule
            break

        choice = matched or fallback
        model = choice.get("model", fallback["model"])
        tier = choice.get("tier", fallback["tier"])
        reason = choice.get("reason", fallback["reason"])

        # VRAM lookup
        from ..core.model_tiers import estimate_vram_requirement

        vram_info = estimate_vram_requirement(model)
        vram_required = vram_info.get("recommended_mb")

        return RouteSceneResponse(
            model=model,
            tier=tier,
            reason=reason,
            vram_required_mb=vram_required,
            cloud_fallback=None,
            routing_note=None,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/canvas-loop", response_model=CanvasLoopResponse)
async def create_canvas_loop(request: CanvasLoopRequest) -> CanvasLoopResponse:
    """Create a Spotify Canvas loop from a video.

    Recipe (A4):
    - 9:16 vertical (720x1280)
    - 3--8s seamless loop
    - center-crop from source, with optional crossfade at the seam
    """
    try:
        from ..core.config import PROJECT_ROOT

        src = Path(request.source_path)
        if not src.is_file():
            raise ValueError(f"Source video not found: {request.source_path}")

        # Determine output path
        if request.output_path:
            out = Path(request.output_path)
        else:
            out_dir = PROJECT_ROOT / "output" / "video"
            out_dir.mkdir(parents=True, exist_ok=True)
            safe = src.stem.replace(" ", "_")
            out = out_dir / f"{safe}_canvas_{int(request.width)}x{int(request.height)}.mp4"

        # Clamp duration
        duration = max(3.0, min(8.0, request.duration))
        crossfade = max(0.0, min(0.5, request.crossfade))

        # Build FFmpeg command for center-crop 9:16 + optional crossfade loop
        # 1. Get source duration to auto-select start point
        probe_cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(src),
        ]
        proc = await asyncio.create_subprocess_exec(
            *probe_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        probe_stdout, _ = await proc.communicate()
        src_duration = float(probe_stdout.decode().strip() or "0")

        if request.start is not None:
            start = max(0, min(request.start, src_duration - duration))
        else:
            # Auto: pick a visually-active midpoint
            start = max(0, (src_duration / 2) - (duration / 2))

        # Build crossfade loop: two copies of the segment with xfade at the seam
        # When crossfade > 0, we generate a slightly longer segment and xfade the ends
        if crossfade > 0 and duration > crossfade * 2:
            loop_duration = duration + crossfade
            # Filter: take segment, split, xfade
            filter_graph = (
                f"[0:v]trim=start={start}:duration={loop_duration},"
                f"format=yuv420p,"
                f"split=2[pre][post];"
                f"[pre][post]xfade=transition=fade:duration={crossfade}:offset={duration},"
                f"scale={request.width}:{request.height}:force_original_aspect_ratio=increase,"
                f"crop={request.width}:{request.height},"
                f"setsar=1"
            )
            audio_filter = (
                f"[0:a]atrim=start={start}:duration={loop_duration},"
                f"afade=t=out:st={duration}:d={crossfade},"
                f"afade=t=in:st=0:d={crossfade},"
                f"atrim=start=0:duration={duration},"
                f"asetpts=PTS-STARTPTS"
            )
        else:
            filter_graph = (
                f"[0:v]trim=start={start}:duration={duration},"
                f"format=yuv420p,"
                f"scale={request.width}:{request.height}:force_original_aspect_ratio=increase,"
                f"crop={request.width}:{request.height},"
                f"setsar=1"
            )
            audio_filter = f"[0:a]atrim=start={start}:duration={duration},asetpts=PTS-STARTPTS"

        # Use raw FFmpeg for the xfade filter_graph (Renderer abstraction doesn't
        # yet expose complex filter chains); fall back to the engine's subprocess
        # path directly.
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found on PATH")

        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            str(start),
            "-i",
            str(src),
            "-t",
            str(duration),
            "-vf",
            filter_graph,
            "-af",
            audio_filter,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ]

        t0 = time.perf_counter()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        except NotImplementedError:

            def _run() -> tuple[int, bytes, bytes]:
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    return p.communicate(timeout=120)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait(timeout=10)
                    return -1, b"", b"FFmpeg timed out"

            returncode, stdout, stderr = await asyncio.wait_for(
                asyncio.to_thread(_run), timeout=130
            )
            proc = None  # type: ignore[assignment]
        except TimeoutError:
            logger.error("Canvas loop FFmpeg timed out for %s", src)
            return CanvasLoopResponse(
                success=False,
                error="FFmpeg timed out after 120s",
                message="Try a shorter duration or lower resolution",
            )

        render_s = round(time.perf_counter() - t0, 2)
        if proc is not None and proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace")[-500:] if stderr else "FFmpeg failed"
            logger.error("Canvas loop failed: %s", err_msg)
            return CanvasLoopResponse(
                success=False, error=err_msg, message="FFmpeg filter graph failed"
            )

        size_bytes = out.stat().st_size if out.exists() else 0
        return CanvasLoopResponse(
            success=True,
            output_path=str(out),
            duration=duration,
            width=request.width,
            height=request.height,
            message=f"Canvas loop created in {render_s}s ({size_bytes // 1024} KB)",
        )
    except Exception as exc:
        logger.exception("Canvas loop endpoint error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# A3 -- Beat-quantized assembler
# ---------------------------------------------------------------------------


class AssembleRequest(BaseModel):
    """Request model for beat-quantized assembly (A3)."""

    shot_manifest: list[dict[str, Any]] = Field(description="A1 shot plan with rendered clip paths")
    output_path: str | None = None
    audio_path: str | None = None
    engine: str = Field(default="auto", description="Render engine: auto|coreflux|movielite|ffmpeg")
    transition: str = Field(default="xfade", description="Transition type: xfade|fade|dissolve")
    transition_duration: float = Field(default=0.3, ge=0.0, le=1.0)
    beat_times: list[float] | None = None


class AssembleResponse(BaseModel):
    """Response model for beat-quantized assembly."""

    success: bool
    output_path: str | None = None
    duration: float | None = None
    shots_used: int | None = None
    render_s: float | None = None
    error: str | None = None
    message: str | None = None
    engine: str | None = None


@router.post("/assemble", response_model=AssembleResponse)
async def assemble_beat_quantized(request: AssembleRequest) -> AssembleResponse:
    """Assemble a beat-quantized music video from rendered section clips (A3).

    Cuts land on the beat grid supplied by the A1 planner. No subtitle
    burn-in is applied (excluded per request). The assembled master is
    written to ``output/video/assembled_<ts>.mp4`` when ``output_path``
    is omitted.
    """
    try:
        from ..services.beat_assembler import assemble_beat_quantized as _assemble

        result = await _assemble(
            shot_manifest=request.shot_manifest,
            audio_path=request.audio_path,
            output_path=request.output_path,
            engine=request.engine,
            transition=request.transition,
            transition_duration=request.transition_duration,
            beat_times=request.beat_times,
        )
        return AssembleResponse(
            success=result.get("success", False),
            output_path=result.get("output_path"),
            duration=result.get("duration"),
            shots_used=result.get("shots_used"),
            render_s=result.get("render_s"),
            error=result.get("error"),
            message=result.get("message"),
            engine=result.get("engine"),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Beat assembly endpoint error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Lip-sync (D42) -- local MuseTalk only. No API calls anywhere in this path.
# ---------------------------------------------------------------------------


class LipSyncRequest(BaseModel):
    """Request model for lip-syncing a clip to an audio track.

    Exactly one of video_path / image_path is required. For songs, pass the
    isolated vocals stem as audio_path (POST /api/audio/separate) -- the full
    mix syncs markedly worse. Scoped to close-ups/chorus per the knowledge
    library ("lip-sync only where it matters").
    """

    video_path: str | None = Field(default=None, description="Existing clip to lip-sync")
    image_path: str | None = Field(default=None, description="Still portrait to animate + lip-sync")
    audio_path: str | None = None
    audio_filename: str | None = None
    section: str = Field(default="chorus", description="Song section being synced")
    output_path: str | None = None


class LipSyncResponse(BaseModel):
    """Response model for lip-sync -- returns the queued job for polling."""

    success: bool
    job_id: str | None = None
    output_path: str | None = None
    section: str | None = None
    error: str | None = None
    message: str | None = None


#: Upload staging for POST /lipsync-upload. Lives under output/uploads/ —
#: the outputs scanner excludes "uploads" so staged inputs never appear in
#: the media library (same reason batch intermediates live in output/runtime).
_LIPSYNC_UPLOAD_DIR_NAME = ("output", "uploads", "lipsync")
_LIPSYNC_UPLOAD_AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".flac"}
_LIPSYNC_UPLOAD_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
_LIPSYNC_UPLOAD_MAX_BYTES = 50 * 1024 * 1024  # 50 MB


async def _store_lipsync_upload(
    file: UploadFile, allowed_exts: set[str], kind: str
) -> Path:
    """Stream an upload to a collision-proof path; return the staged file.

    The client-supplied filename is used for its extension only — the stored
    name is a fresh uuid, so no field can traverse or overwrite. Writes to a
    temp file first so a rejected/oversized upload leaves nothing behind.
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported {kind} type {ext or '(none)'!r} — "
                f"allowed: {', '.join(sorted(allowed_exts))}"
            ),
        )
    from ..core.config import PROJECT_ROOT as _PR

    upload_dir = _PR.joinpath(*_LIPSYNC_UPLOAD_DIR_NAME)
    upload_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4().hex}.upload"
    size = 0
    try:
        with open(tmp_path, "wb") as buffer:
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > _LIPSYNC_UPLOAD_MAX_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"{kind} too large. Maximum size: "
                            f"{_LIPSYNC_UPLOAD_MAX_BYTES // (1024 * 1024)} MB"
                        ),
                    )
                buffer.write(chunk)
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {exc}") from exc
    dest = upload_dir / f"{uuid.uuid4().hex}{ext}"
    # shutil.move, not Path.replace: temp dir and output/ can sit on
    # different drives (os.replace fails cross-volume on Windows).
    shutil.move(str(tmp_path), str(dest))
    return dest


async def _enqueue_lipsync(
    *,
    video_path: str | None,
    image_path: str | None,
    audio_path: str | None = None,
    audio_filename: str | None = None,
    section: str,
    output_path: str | None,
) -> LipSyncResponse:
    """Shared submit path for /lipsync and /lipsync-upload.

    Enqueue a local lip-sync job (MuseTalk, D42). Fails fast with 503 +
    guidance when the local install is incomplete; poll via
    GET /api/jobs/{job_id}.
    """
    try:
        from ..models.job import JobCreateRequest, JobType
        from ..queue.manager import queue_manager
        from ..services.lipsync import MuseTalkAdapter

        source = video_path or image_path
        if not source:
            raise ValueError("video_path or image_path is required")
        if not Path(source).is_file():
            raise FileNotFoundError(f"Source not found: {source}")

        # Preflight the local install before queueing (fail-open with guidance)
        status = MuseTalkAdapter().check_installation()
        if not status["installed"]:
            raise RuntimeError(
                "MuseTalk is not ready on this machine: "
                + status["message"]
                + " -- see config/lipsync.json"
            )

        resolved_audio = _resolve_lipsync_audio(audio_path, audio_filename)

        params = {
            "video_path": video_path,
            "image_path": image_path,
            "audio_path": resolved_audio,
            "section": section,
            "output_path": output_path,
        }
        jcr = JobCreateRequest(job_type=JobType.LIPSYNC, params=params, max_retries=1)
        job = await queue_manager.enqueue(jcr)

        # Mirror the handler's output-path resolution (services/lipsync_handler.py)
        # so this field names a real file: request.output_path wins, otherwise
        # the handler defaults to output/video/<source-stem>_lipsync_<job8>.mp4.
        if output_path:
            resolved_output = output_path
        else:
            from ..core.config import PROJECT_ROOT as _PR

            stem = Path(source).stem.replace(" ", "_")
            resolved_output = str(
                _PR / "output" / "video" / f"{stem}_lipsync_{job.id[:8]}.mp4"
            )

        return LipSyncResponse(
            success=True,
            job_id=job.id,
            output_path=resolved_output,
            section=section,
            message=f"Queued lip-sync for section '{section}' as job {job.id[:8]}",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Not-configured and VRAM-shortfall both surface here as 503
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Lip-sync endpoint error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/lipsync", response_model=LipSyncResponse)
async def lipsync_clip(request: LipSyncRequest) -> LipSyncResponse:
    """Enqueue a local lip-sync job (MuseTalk, D42)."""
    return await _enqueue_lipsync(
        video_path=request.video_path,
        image_path=request.image_path,
        audio_path=request.audio_path,
        audio_filename=request.audio_filename,
        section=request.section,
        output_path=request.output_path,
    )


@router.post("/lipsync-upload", response_model=LipSyncResponse)
async def lipsync_upload(
    audio: UploadFile = File(...),
    image: UploadFile | None = File(default=None),
    video_path: str | None = Form(default=None),
    image_path: str | None = Form(default=None),
    section: str = Form(default="chorus"),
    output_path: str | None = Form(default=None),
) -> LipSyncResponse:
    """Lip-sync job with uploaded inputs — the remote-caller path (Maya).

    multipart/form-data: ``audio`` file is required (staged under
    output/uploads/lipsync/ with a uuid name, extension-allowlisted,
    50 MB cap). ``image`` file is an optional still to animate; when
    absent, ``image_path`` names a rig-local still, and ``video_path``
    names a rig-local clip — same rules as POST /lipsync (never both an
    image source and a video source). Response shape and polling are
    identical to /lipsync.
    """
    if image is not None and (video_path or image_path):
        raise HTTPException(
            status_code=400,
            detail="Provide either an image upload or image_path/video_path, not both",
        )
    staged_audio = await _store_lipsync_upload(
        audio, _LIPSYNC_UPLOAD_AUDIO_EXTS, "audio"
    )
    staged_image = (
        await _store_lipsync_upload(image, _LIPSYNC_UPLOAD_IMAGE_EXTS, "image")
        if image is not None
        else None
    )
    return await _enqueue_lipsync(
        video_path=video_path,
        image_path=str(staged_image) if staged_image else image_path,
        audio_path=str(staged_audio),
        section=section,
        output_path=output_path,
    )


# ---------------------------------------------------------------------------
# Lip-sync batch (D42 extension) -- long audio -> chunks -> LIPSYNC jobs -> stitch
# ---------------------------------------------------------------------------


def _resolve_lipsync_audio(audio_path: str | None, audio_filename: str | None) -> str:
    """Resolve an audio path from a direct path or a library filename."""
    if audio_path:
        if not Path(audio_path).is_file():
            raise FileNotFoundError(f"Audio not found: {audio_path}")
        return audio_path
    from ..core.config import PROJECT_ROOT as _PR

    audio_dir = _PR / "output" / "audio"
    if audio_filename and audio_dir.exists():
        # rglob treats ".." as a real path component, so a crafted filename
        # could resolve outside output/audio -- reject it up front, then keep
        # only matches that still resolve inside the audio dir.
        name = Path(audio_filename)
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("audio_filename must name a file inside output/audio")
        audio_root = audio_dir.resolve()
        matches = [
            m
            for m in audio_dir.rglob(audio_filename)
            if m.is_file() and m.resolve().is_relative_to(audio_root)
        ]
        if matches:
            # Deterministic pick when several stems share a filename:
            # shallowest match wins (top-level before nested stem dirs).
            matches.sort(key=lambda m: len(m.resolve().relative_to(audio_root).parts))
            return str(matches[0])
    raise ValueError(
        "audio_path is required -- pass the isolated vocals stem "
        "(POST /api/audio/separate) for best results"
    )


async def _enqueue_lipsync_chunk_jobs(
    *,
    request: "LipSyncBatchRequest",
    chunks: list[Any],
    bdir: Path,
    batch_id: str,
    source: str,
    source_kind: str,
    audio_path: str,
    ffmpeg: str | None,
) -> list[str]:
    """Split audio/video into per-chunk files and enqueue one LIPSYNC job each.

    On any mid-loop failure the already-enqueued jobs are cancelled so they
    cannot burn GPU with no manifest to stitch them.
    """
    from ..models.job import JobCreateRequest, JobType
    from ..queue.manager import queue_manager
    from ..services.lipsync import batch as lipbatch

    job_ids: list[str] = []
    try:
        for chunk in chunks:
            audio_chunk = lipbatch.chunk_audio_path(bdir, chunk.index)
            await _run_cmd(
                lipbatch.split_audio_cmd(
                    ffmpeg, audio_path, chunk.start, chunk.length, str(audio_chunk)
                ),
                timeout=300,
            )
            video_chunk: str | None = None
            if source_kind == "video":
                video_chunk = str(lipbatch.chunk_video_path(bdir, chunk.index))
                await _run_cmd(
                    lipbatch.split_video_cmd(
                        ffmpeg, source, chunk.start, chunk.length, video_chunk
                    ),
                    timeout=600,
                )
            params = {
                "video_path": video_chunk,
                "image_path": request.image_path,
                "audio_path": str(audio_chunk),
                "section": f"{request.section}-chunk-{chunk.index:03d}",
                "output_path": str(lipbatch.chunk_output_path(bdir, chunk.index)),
                "batch_id": batch_id,
                "chunk_index": chunk.index,
            }
            jcr = JobCreateRequest(job_type=JobType.LIPSYNC, params=params, max_retries=1)
            job = await queue_manager.enqueue(jcr)
            job_ids.append(job.id)
    except Exception:
        await _cancel_orphaned_lipsync_jobs(job_ids, bdir)
        raise
    return job_ids


def _cleanup_stitched_batch(bdir: Path) -> None:
    """Remove per-chunk media after a successful stitch.

    Chunk wavs/mp4s are the bulk of a batch's disk usage and are dead weight
    once concatenated into the final output. The manifest and concat list
    stay so batch status remains queryable.
    """
    for pattern in ("audio_chunk_*.wav", "video_chunk_*.mp4", "chunk_*_lipsync.mp4"):
        for f in bdir.glob(pattern):
            try:
                f.unlink()
            except OSError:
                logger.debug("Failed to remove stitched batch chunk %s", f)


async def _cancel_orphaned_lipsync_jobs(job_ids: list[str], bdir: Path) -> None:
    """Cancel already-enqueued chunk jobs after a batch enqueue failure.

    When nothing was enqueued the working dir is unreferenced and removed;
    otherwise chunk files must stay for the surviving jobs' cleanup path.
    """
    from ..queue.manager import queue_manager

    for jid in job_ids:
        try:
            await queue_manager.cancel_job(jid)
        except Exception:
            logger.debug("Failed to cancel orphaned lip-sync job %s", jid)
    if not job_ids:
        shutil.rmtree(bdir, ignore_errors=True)


def _lipsync_batch_dir(project_root: Path, batch_id: str) -> Path:
    """Working dir for a lip-sync batch, outside the scanned media tree.

    ``services.lipsync.batch.batch_dir`` places chunk wavs/mp4s under
    ``output/video/.lipsync_batches`` -- the outputs scanner recurses into
    it, so every intermediate would surface in the media library. ``output/
    runtime`` is on the scanner's exclude list, so chunks and manifests stay
    invisible while the stitched master in ``output/video`` is discovered
    normally.
    """
    return project_root / "output" / "runtime" / "lipsync_batches" / batch_id


def _lipsync_batch_state(project_root: Path, batch_id: str) -> tuple[Path, Path]:
    """Locate a batch's ``(batch_dir, manifest_path)`` for status/stitch.

    Prefers the scanner-excluded runtime dir; falls back to the legacy
    ``output/video/.lipsync_batches`` location so batches created before the
    move remain readable.
    """
    from ..services.lipsync import batch as lipbatch

    bdir = _lipsync_batch_dir(project_root, batch_id)
    mpath = bdir / "manifest.json"
    if not mpath.is_file():
        legacy = lipbatch.batch_dir(project_root, batch_id)
        legacy_mpath = legacy / "manifest.json"
        if legacy_mpath.is_file():
            return legacy, legacy_mpath
    return bdir, mpath


async def _run_cmd(cmd: list[str], timeout: int) -> None:
    """Run a subprocess in a worker thread; raise RuntimeError on failure."""
    from ..services.subprocess_runner import run_subprocess_thread

    proc = await run_subprocess_thread(
        cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed (rc={proc.returncode}): {(proc.stderr or '')[-500:]}")


async def _probe_duration(ffprobe: str, media_path: str) -> float:
    """Return media duration in seconds via ffprobe."""
    from ..services.lipsync import batch as lipbatch
    from ..services.subprocess_runner import run_subprocess_thread

    proc = await run_subprocess_thread(
        lipbatch.probe_duration_cmd(ffprobe, media_path),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {(proc.stderr or '')[-300:]}")
    return float((proc.stdout or "0").strip())


class LipSyncBatchRequest(BaseModel):
    """Request model for a batch lip-sync run.

    Exactly one of video_path / image_path is required. The audio is split
    into chunk_seconds pieces; each chunk becomes one queued LIPSYNC job
    (flat VRAM per chunk), then POST .../stitch concatenates the results.
    """

    video_path: str | None = None
    image_path: str | None = None
    audio_path: str | None = None
    audio_filename: str | None = None
    chunk_seconds: float = Field(default=20.0, gt=0, le=120)
    section: str = "full"
    output_path: str | None = None


class LipSyncBatchResponse(BaseModel):
    success: bool
    batch_id: str | None = None
    job_ids: list[str] = []
    chunk_count: int | None = None
    final_output: str | None = None
    error: str | None = None
    message: str | None = None


class LipSyncBatchStatusResponse(BaseModel):
    batch_id: str
    total: int
    completed: int
    failed: int
    stitched: bool
    final_output: str | None = None
    chunks: list[dict[str, Any]] = []


@router.post("/lipsync-batch", response_model=LipSyncBatchResponse)
async def lipsync_batch(request: LipSyncBatchRequest) -> LipSyncBatchResponse:
    """Split long audio into chunks and queue one LIPSYNC job per chunk.

    Each chunk keeps VRAM flat (default 20s, mirroring the FreeLipSync-style
    workflow). Poll per-chunk jobs via GET /api/jobs/{id} or the batch status
    endpoint, then POST .../stitch to concatenate.
    """
    try:
        from ..core.config import PROJECT_ROOT as _PR
        from ..services.lipsync import MuseTalkAdapter
        from ..services.lipsync import batch as lipbatch

        source = request.video_path or request.image_path
        if not source:
            raise ValueError("video_path or image_path is required")
        if not Path(source).is_file():
            raise FileNotFoundError(f"Source not found: {source}")
        source_kind = "video" if request.video_path else "image"

        status = MuseTalkAdapter().check_installation()
        if not status["installed"]:
            raise RuntimeError(
                "MuseTalk is not ready on this machine: "
                + status["message"]
                + " -- see config/lipsync.json"
            )

        audio_path = _resolve_lipsync_audio(request.audio_path, request.audio_filename)
        ffmpeg, ffprobe = lipbatch.find_ffmpeg()
        duration = await _probe_duration(ffprobe, audio_path)
        if duration <= 0:
            raise ValueError(f"Could not determine audio duration for {audio_path}")

        chunks = lipbatch.plan_chunks(duration, request.chunk_seconds)
        batch_id = lipbatch.new_batch_id()
        bdir = _lipsync_batch_dir(_PR, batch_id)
        bdir.mkdir(parents=True, exist_ok=True)

        job_ids = await _enqueue_lipsync_chunk_jobs(
            request=request,
            chunks=chunks,
            bdir=bdir,
            batch_id=batch_id,
            source=source,
            source_kind=source_kind,
            audio_path=audio_path,
            ffmpeg=ffmpeg,
        )

        final_output = request.output_path or str(
            _PR / "output" / "video" / f"lipsync_batch_{batch_id}.mp4"
        )
        manifest = lipbatch.build_manifest(
            batch_id=batch_id,
            source_kind=source_kind,
            source_path=source,
            audio_path=audio_path,
            chunk_seconds=request.chunk_seconds,
            duration_s=duration,
            chunks=chunks,
            job_ids=job_ids,
            final_output=final_output,
        )
        manifest = lipbatch.resolve_manifest_paths(manifest, bdir)
        lipbatch.write_manifest(bdir / "manifest.json", manifest)

        return LipSyncBatchResponse(
            success=True,
            batch_id=batch_id,
            job_ids=job_ids,
            chunk_count=len(chunks),
            final_output=final_output,
            message=f"Queued {len(chunks)} lip-sync chunk(s) as batch {batch_id}",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Lip-sync batch endpoint error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/lipsync-batch/{batch_id}", response_model=LipSyncBatchStatusResponse)
async def lipsync_batch_status(batch_id: str) -> LipSyncBatchStatusResponse:
    """Report per-chunk job status for a lip-sync batch."""
    try:
        from ..core.config import PROJECT_ROOT as _PR
        from ..queue.manager import queue_manager
        from ..services.lipsync import batch as lipbatch

        bdir, mpath = _lipsync_batch_state(_PR, batch_id)
        if not mpath.is_file():
            raise FileNotFoundError(f"Batch not found: {batch_id}")
        manifest = lipbatch.resolve_manifest_paths(
            lipbatch.read_manifest(mpath), bdir
        )
        chunks: list[dict[str, Any]] = []
        completed = 0
        failed = 0
        for chunk in manifest["chunks"]:
            job = await queue_manager.get_job(chunk["job_id"])
            st = job.status if job is not None else "unknown"
            st = getattr(st, "value", st)
            if st == "completed":
                completed += 1
            elif st == "failed":
                failed += 1
            chunks.append(
                {
                    "index": chunk["index"],
                    "job_id": chunk["job_id"],
                    "status": st,
                    "output_path": chunk["output_path"],
                }
            )
        return LipSyncBatchStatusResponse(
            batch_id=batch_id,
            total=len(chunks),
            completed=completed,
            failed=failed,
            stitched=bool(manifest.get("stitched")),
            final_output=manifest.get("final_output"),
            chunks=chunks,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Lip-sync batch status error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/lipsync-batch/{batch_id}/stitch")
async def lipsync_batch_stitch(batch_id: str) -> dict:
    """Concatenate completed chunk outputs into the final video.

    Refuses with 409 while any chunk is incomplete or failed, naming the
    unfinished chunks. Idempotent: an already-stitched batch returns its
    final output without re-running ffmpeg.
    """
    try:
        from ..core.config import PROJECT_ROOT as _PR
        from ..queue.manager import queue_manager
        from ..services.lipsync import batch as lipbatch

        bdir, mpath = _lipsync_batch_state(_PR, batch_id)
        if not mpath.is_file():
            raise FileNotFoundError(f"Batch not found: {batch_id}")
        manifest = lipbatch.resolve_manifest_paths(lipbatch.read_manifest(mpath), bdir)

        if manifest.get("stitched") and Path(str(manifest["final_output"])).is_file():
            return {
                "success": True,
                "batch_id": batch_id,
                "final_output": manifest["final_output"],
                "message": "Batch already stitched",
            }

        pending: list[dict[str, Any]] = []
        outputs: list[str] = []
        for chunk in manifest["chunks"]:
            job = await queue_manager.get_job(chunk["job_id"])
            st = getattr(job.status if job is not None else "unknown", "value", "unknown")
            if st != "completed":
                pending.append({"index": chunk["index"], "job_id": chunk["job_id"], "status": st})
            elif not Path(chunk["output_path"]).is_file():
                pending.append(
                    {"index": chunk["index"], "job_id": chunk["job_id"], "status": "missing_output"}
                )
            else:
                outputs.append(chunk["output_path"])
        if pending:
            raise RuntimeError(
                f"{len(pending)} chunk(s) not ready: "
                + ", ".join(f"#{p['index']} ({p['status']})" for p in pending)
            )

        ffmpeg, _ = lipbatch.find_ffmpeg()
        list_file = bdir / "concat.txt"
        list_file.write_text(lipbatch.concat_list_content(outputs), encoding="utf-8")
        final = Path(str(manifest["final_output"]))
        final.parent.mkdir(parents=True, exist_ok=True)
        # Mux the source audio back: chunks are video-only by design.
        await _run_cmd(
            lipbatch.stitch_cmd(
                ffmpeg, str(list_file), str(final), audio_in=str(manifest["audio_path"])
            ),
            timeout=600,
        )
        if not final.is_file() or final.stat().st_size == 0:
            raise RuntimeError(f"Stitch produced no output at {final}")

        manifest["stitched"] = True
        lipbatch.write_manifest(mpath, manifest)
        _cleanup_stitched_batch(bdir)
        return {
            "success": True,
            "batch_id": batch_id,
            "final_output": str(final),
            "chunks": len(outputs),
            "message": f"Stitched {len(outputs)} chunk(s) into {final.name}",
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Lip-sync batch stitch error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/lipsync-batch/{batch_id}")
async def lipsync_batch_delete(batch_id: str) -> dict:
    """Delete a lip-sync batch's working directory and manifest.

    Refuses with 409 while any chunk job is still active (pending, queued,
    running, retrying) — deleting underneath a live job would orphan its
    output writes. Cancel the jobs first via the queue API.
    """
    try:
        from ..core.config import PROJECT_ROOT as _PR
        from ..queue.manager import queue_manager
        from ..services.lipsync import batch as lipbatch

        bdir, mpath = _lipsync_batch_state(_PR, batch_id)
        if not mpath.is_file():
            raise FileNotFoundError(f"Batch not found: {batch_id}")
        manifest = lipbatch.read_manifest(mpath)

        active_states = {"pending", "queued", "running", "retrying"}
        active: list[dict[str, Any]] = []
        for chunk in manifest.get("chunks", []):
            job = await queue_manager.get_job(chunk["job_id"])
            st = getattr(job.status if job is not None else "unknown", "value", "unknown")
            if st in active_states:
                active.append(
                    {"index": chunk["index"], "job_id": chunk["job_id"], "status": st}
                )
        if active:
            raise RuntimeError(
                f"Batch has {len(active)} active chunk job(s): "
                + ", ".join(f"#{c['index']} ({c['status']})" for c in active)
            )

        shutil.rmtree(bdir, ignore_errors=True)
        return {
            "success": True,
            "batch_id": batch_id,
            "deleted": str(bdir),
            "message": f"Deleted lip-sync batch {batch_id}",
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Lip-sync batch delete error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
