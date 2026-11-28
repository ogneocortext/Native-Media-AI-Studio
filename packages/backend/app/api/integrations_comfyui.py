"""
ComfyUI generation routes.

Image/video generation, model listing, result/progress/preview polling, and
input-file uploads for ComfyUI-backed services. Mounted under /api/integrations
by main.py.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, cast

import aiohttp
from fastapi import APIRouter, HTTPException, Request, UploadFile

from ..adapters.registry import adapter_registry
from ..core import comfyui_client as _cu
from ..core.config import config
from ..core.model_tiers import VRAM_REQUIREMENTS, classify_model_variant
from ..models.generation import ImageGenerationRequest, VideoGenerationRequest  # noqa: TC001
from ..models.job import JobCreateRequest, JobType
from ..queue.manager import queue_manager

logger = logging.getLogger(__name__)
# Router without prefix - included by main.py with prefix "/api/integrations"
router = APIRouter(tags=["Integrations-ComfyUI"])


@router.get("/models/status")
async def get_models_status() -> dict:
    """Get status of model availability for all image generation services"""
    from ..core.comfyui_client import resolve_models_dir

    # Resolve against the real ComfyUI install (sibling dir), not legacy
    # in-repo paths that no longer hold models.
    models_base = resolve_models_dir()
    ckpt_dir = models_base / "checkpoints" if models_base else None
    comfyui_models_list = []
    if ckpt_dir is not None and ckpt_dir.exists():
        comfyui_models_list = [
            f.name for f in ckpt_dir.iterdir() if f.suffix in (".safetensors", ".ckpt")
        ]
    return {
        "comfyui": {
            "models_directory": str(ckpt_dir or ""),
            "builtin_directory": str(ckpt_dir or ""),
            "models_found": len(comfyui_models_list),
            "model_list": comfyui_models_list[:10],  # Limit to first 10
            "has_models": len(comfyui_models_list) > 0,
        },
    }


@router.get("/comfyui/checkpoints")
async def list_comfyui_checkpoints() -> dict:
    """List available checkpoint models from ComfyUI's checkpoints folder.

    Returns ALL checkpoint files (image, 3D, video) so each frontend can
    filter as needed:
    - ImageGeneration.tsx filters to image models only
    - 3D generation page needs triposr / hunyuan3d / stable-fast
    - VideoGenerationPage.tsx uses /video-models instead
    """
    comfyui_models_dir = _cu.resolve_models_dir()
    ckpt_dir = comfyui_models_dir / "checkpoints" if comfyui_models_dir else None

    if ckpt_dir is not None and ckpt_dir.exists():
        checkpoints = sorted(
            f.name for f in ckpt_dir.iterdir() if f.suffix in (".safetensors", ".ckpt")
        )
        if checkpoints:
            return {"checkpoints": checkpoints, "directory": str(ckpt_dir)}

    return {"checkpoints": [], "directory": ""}


ANIMATEDIFF_DIRS = ("animatediff", "animatediff_models", "animatediff_motion_lora")
VIDEO_MODEL_SUFFIXES = (".safetensors", ".ckpt")
VIDEO_DIFFUSION_SUFFIXES = (".safetensors", ".ckpt", ".gguf")
VIDEO_DIFFUSION_KEYWORDS = ("wan", "video", "animate", "motion", "ti2v", "ltx", "i2v")
# Wan variants that fit in 8 GB, and those that need CPU offload.
WAN_SMALL_VARIANTS = (
    "wan2_1_t2v_1_3b",
    "wan2_1_fun_inp_1_3b",
    "wan_ti2v_5b_gguf_q4",
    "wan_ti2v_5b_gguf_q5",
)
WAN_OFFLOAD_VARIANTS = (
    "wan_ti2v_5b_gguf_q4",
    "wan_ti2v_5b_gguf_q5",
    "wan2_1_fun_inp_1_3b",
)
WAN_VARIANT_LABELS = {
    "wan_ti2v_5b_gguf_q4": "gguf_q4",
    "wan_ti2v_5b_gguf_q5": "gguf_q5",
    "wan2_1_t2v_1_3b": "1.3B",
    "wan2_1_fun_inp_1_3b": "1.3B",
}


def _wan_variant_fields(name: str) -> dict[str, Any]:
    """VRAM badges for a Wan model, via the shared tier classifier.
    Extracted from `get_video_models`, where the if/elif chain sat four levels
    deep inside two nested loops. The classifier (core/model_tiers.py) is the
    single source of truth, so the frontend 8 GB badges and the adapter workflow
    routing cannot disagree.
    """
    tier = classify_model_variant(name)
    vram = VRAM_REQUIREMENTS.get(tier, {})
    return {
        "variant": WAN_VARIANT_LABELS.get(tier, "fp16"),
        "supports_8gb": tier in WAN_SMALL_VARIANTS,
        "requires_cpu_offload": tier in WAN_OFFLOAD_VARIANTS,
        "vram_mb": vram.get("recommended_mb", 20000),
    }


def _scan_model_dir(
    directory,
    root,
    suffixes: tuple[str, ...],
    min_size: int,
    entry_type: str,
    *,
    keyword_filter: bool = False,
) -> list[dict[str, Any]]:
    """Collect model files under `directory`, one level of logic instead of five."""
    found: list[dict[str, Any]] = []
    if not directory.exists():
        return found
    for f in sorted(directory.rglob("*")):
        if f.suffix not in suffixes or f.stat().st_size <= min_size:
            continue
        name_lower = f.name.lower()
        if keyword_filter and not any(kw in name_lower for kw in VIDEO_DIFFUSION_KEYWORDS):
            continue
        entry: dict[str, Any] = {
            "name": f.name,
            "path": str(f.relative_to(root)),
            "type": entry_type,
            "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
        }
        if keyword_filter and "wan" in name_lower:
            entry.update(_wan_variant_fields(f.name))
        found.append(entry)
    return found


@router.get("/comfyui/video-models")
async def get_video_models() -> dict:
    """Get video generation models including motion modules and checkpoints."""
    comfyui_models_dir = _cu.resolve_models_dir()
    if not comfyui_models_dir:
        return {"video_models": []}
    video_models: list[dict[str, Any]] = []
    # AnimateDiff motion modules and LoRAs.
    for subdir in ANIMATEDIFF_DIRS:
        video_models.extend(
            _scan_model_dir(
                comfyui_models_dir / subdir,
                comfyui_models_dir,
                VIDEO_MODEL_SUFFIXES,
                1024,
                "motion_lora" if "lora" in subdir else "motion_module",
            )
        )
    # AnimateDiff-Evolved keeps its official camera-motion LoRA pack under
    # custom_nodes/, outside models/. Scan it too so all installed LoRAs are
    # selectable; paths are relative to the ComfyUI root for these entries.
    ade_lora_dir = (
        comfyui_models_dir.parent
        / "custom_nodes"
        / "ComfyUI-AnimateDiff-Evolved"
        / "motion_lora"
    )
    if ade_lora_dir.is_dir():
        video_models.extend(
            _scan_model_dir(
                ade_lora_dir,
                comfyui_models_dir.parent,
                VIDEO_MODEL_SUFFIXES,
                1024,
                "motion_lora",
            )
        )
    # Diffusion models that look video-related.
    video_models.extend(
        _scan_model_dir(
            comfyui_models_dir / "diffusion_models",
            comfyui_models_dir,
            VIDEO_DIFFUSION_SUFFIXES,
            1024 * 1024,
            "diffusion_model",
            keyword_filter=True,
        )
    )
    # Checkpoints that look video-related (kandinsky i2v, kandinsky checkpoints,
    # and other video checkpoints live here but are not SD-family image models).
    video_models.extend(
        _scan_model_dir(
            comfyui_models_dir / "checkpoints",
            comfyui_models_dir,
            VIDEO_DIFFUSION_SUFFIXES,
            1024 * 1024,
            "diffusion_model",
            keyword_filter=True,
        )
    )
    return {"video_models": video_models}


@router.post("/{service_name}/generate")
async def generate_image(service_name: str, request: ImageGenerationRequest) -> dict:
    """Generate an image using the specified backend"""
    logger.debug("generate_image called with service_name=%s", service_name)
    adapter = adapter_registry.get(service_name)
    logger.debug("adapter=%s", adapter)
    if not adapter:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")
    # Check health first
    if not await adapter.health_check():
        raise HTTPException(status_code=503, detail=f"Service {service_name} is not available")
    # Explicit LLM prompt enrichment -- only if user opts in via enrich_prompt=true
    if request.enrich_prompt and request.prompt and len(request.prompt.strip()) < 200:
        try:
            from ..core import ollama_client as _oc
            from ..core.text import strip_code_fences

            enrich_sys = (
                "You are a Stable Diffusion prompt engineer. Expand the user prompt into a "
                "detailed comma-separated style prompt under 180 characters and provide a negative_prompt. "
                "Use ONLY the input's visible subject and requested attributes. Do not invent brands, artists, "
                "logos, watermarks, or extra subjects. Return JSON with exactly two string fields: prompt and negative_prompt."
            )
            response_schema = {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "negative_prompt": {"type": "string"},
                },
                "required": ["prompt", "negative_prompt"],
                "additionalProperties": False,
            }
            c = await _oc.chat_content(
                [
                    {"role": "system", "content": enrich_sys},
                    {"role": "user", "content": request.prompt},
                ],
                model=config.default_model,
                timeout=15,
                think=False,
                extra={"format": response_schema, "options": {"temperature": 0.2, "num_ctx": 4096}},
            )
            if c:
                pj = json.loads(strip_code_fences(c))
                if pj.get("prompt"):
                    request.prompt = pj["prompt"][:300]
                if pj.get("negative_prompt"):
                    request.negative_prompt = pj["negative_prompt"][:500]
        except Exception:
            pass
    try:
        # Build params dict for adapter (single converter -- no drift)
        params = request.to_adapter_params()
        # Validate checkpoint - don't allow 3D/video models for image generation
        if request.ckpt_name:
            from ..adapters.comfyui import is_txt2img_checkpoint

            if not is_txt2img_checkpoint(request.ckpt_name):
                logger.warning(
                    f"Checkpoint '{request.ckpt_name}' is not suitable for image generation, ignoring"
                )
                params.pop("ckpt_name", None)

        # VRAM preflight: offload Ollama before ComfyUI generation to prevent OOM
        # on 8 GB cards where both models can't be resident simultaneously.
        from ..services.vram_manager import vram_manager

        vram_result = await vram_manager.begin_3d_generation()
        logger.debug("VRAM pre-ComfyUI generation: %s", vram_result)

        try:
            logger.debug("calling adapter.submit_only with params=%s", params)
            # Submit the prompt and get the prompt_id immediately
            prompt_id = await adapter.submit_only(params)
            logger.debug("prompt_id=%s", prompt_id)
            return {
                "success": True,
                "prompt_id": prompt_id,
                "status": "started",
                "message": f"Generation started. Poll /api/integrations/comfyui/progress/{prompt_id} for progress.",
            }
        finally:
            # VRAM postflight: reload Ollama after ComfyUI generation
            from ..services.vram_manager import vram_manager

            vram_cleanup = await vram_manager.end_3d_generation()
            logger.debug("VRAM post-ComfyUI generation: %s", vram_cleanup)
    except Exception as e:
        logger.debug("exception in generate_image: %s", e)
        logger.error("Generate endpoint error: %s", e, exc_info=True)
        # Ensure Ollama is reloaded even on error
        try:
            from ..services.vram_manager import vram_manager

            await vram_manager.end_3d_generation()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/comfyui/progress/{prompt_id}")
async def get_progress(prompt_id: str) -> dict:
    """Get generation progress for a prompt."""
    base_url = config.comfyui_url
    try:
        queue_data = await _cu.fetch_queue(base_url)
        if not queue_data:
            return {
                "status": "error",
                "prompt_id": prompt_id,
                "error": "Queue endpoint unavailable",
            }
        # Check if prompt is in running queue (both queue shapes)
        running = queue_data.get("queue_running", queue_data.get("running", []))
        for item in running:
            item_id = (
                item[1]
                if isinstance(item, (list, tuple)) and len(item) > 1
                else (
                    item.get("task_id", item.get("id", item.get("prompt_id")))
                    if isinstance(item, dict)
                    else None
                )
            )
            if item_id == prompt_id:
                hist_data = await _cu.fetch_history(base_url, prompt_id, timeout=3)
                step, total_steps = 0, 0
                if prompt_id in hist_data:
                    exec_meta = hist_data[prompt_id].get("execution_metadata", {})
                    step = exec_meta.get("step", 0)
                    total_steps = exec_meta.get("steps", 0)
                return {
                    "status": "running",
                    "prompt_id": prompt_id,
                    "step": step,
                    "total_steps": total_steps,
                }
        # Check if prompt is in pending queue
        pending = queue_data.get("queue_pending", queue_data.get("queued", []))
        for item in pending:
            item_id = (
                item[1]
                if isinstance(item, (list, tuple)) and len(item) > 1
                else (
                    item.get("task_id", item.get("id", item.get("prompt_id")))
                    if isinstance(item, dict)
                    else None
                )
            )
            if item_id == prompt_id:
                return {
                    "status": "pending",
                    "prompt_id": prompt_id,
                    "queue_position": item[0]
                    if isinstance(item, (list, tuple)) and len(item) > 0
                    else 0,
                }
        # Check history for completed
        history = await _cu.fetch_history(base_url, prompt_id)
        if prompt_id in history:
            entry = history[prompt_id]
            status_info = entry.get("status", {})
            if status_info.get("status_str") == "error":
                return {
                    "status": "error",
                    "prompt_id": prompt_id,
                    "error": status_info.get("message", "Unknown error"),
                }
            return {
                "status": "completed",
                "prompt_id": prompt_id,
                "outputs": list(entry.get("outputs", {}).keys()),
            }
        return {
            "status": "unknown",
            "prompt_id": prompt_id,
        }
    except Exception as e:
        return {
            "status": "error",
            "prompt_id": prompt_id,
            "error": str(e),
        }


@router.get("/comfyui/preview/{prompt_id}")
async def get_preview(prompt_id: str) -> dict:
    """Get the latest intermediate preview image for a running prompt."""
    base_url = config.comfyui_url
    try:
        history = await _cu.fetch_history(base_url, prompt_id)
        if not history:
            return {"error": "History not available"}
        if prompt_id not in history:
            return {"error": "Prompt not found in history"}
        entry = history[prompt_id]
        outputs = entry.get("outputs", {})
        # Find the latest preview image
        for node_id, output in outputs.items():
            if "images" in output:
                for img in output["images"]:
                    filename = img.get("filename")
                    if filename:
                        return {
                            "filename": filename,
                            "subfolder": img.get("subfolder", ""),
                            "node_id": node_id,
                        }
        return {"error": "No preview available"}
    except Exception as e:
        return {"error": str(e)}


@router.get("/comfyui/view/{prompt_id}/{filename}")
async def view_preview(request: Request, prompt_id: str, filename: str):
    """Proxy endpoint to serve preview images from ComfyUI."""
    from urllib.parse import unquote

    from fastapi.responses import StreamingResponse

    base_url = config.comfyui_url
    try:
        decoded_filename = _cu.sanitize_filename(unquote(filename))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        session = await _cu.get_shared_session()
        async with session.get(
            f"{base_url.rstrip('/')}/view",
            params=_cu.view_params(decoded_filename),
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status != 200:
                raise HTTPException(status_code=resp.status, detail="Image not found")
            origin = request.headers.get("origin", "*")
            content_type = resp.content_type or "image/png"
            chunks = [chunk async for chunk in resp.content.iter_any()]

        async def stream_generator():
            for chunk in chunks:
                yield chunk

        return StreamingResponse(
            stream_generator(),
            media_type=content_type,
            headers={"Access-Control-Allow-Origin": origin},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch image: {e}") from e


@router.post("/{service_name}/generate-video")
async def generate_video(service_name: str, request: VideoGenerationRequest) -> dict:
    """Generate a video using AnimateDiff via ComfyUI"""
    # Video generation only supported by ComfyUI
    if service_name != "comfyui":
        raise HTTPException(status_code=400, detail="Video generation is only supported by ComfyUI")
    adapter = adapter_registry.get(service_name)
    if not adapter:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")
    # Check health first
    if not await adapter.health_check():
        raise HTTPException(status_code=503, detail=f"Service {service_name} is not available")
    # Explicit LLM prompt enrichment -- only if user opts in via enrich_prompt=true
    if request.enrich_prompt and request.prompt and len(request.prompt.strip()) < 200:
        try:
            from ..core import ollama_client as _oc
            from ..core.text import strip_code_fences

            enrich_sys = (
                "You are a video prompt engineer. Expand the user prompt into a "
                "detailed comma-separated style prompt under 180 characters and provide a negative_prompt. "
                "Use ONLY the input's visible subject and requested attributes. Do not invent brands, artists, "
                "logos, watermarks, or extra subjects. Return JSON with exactly two string fields: prompt and negative_prompt."
            )
            response_schema = {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "negative_prompt": {"type": "string"},
                },
                "required": ["prompt", "negative_prompt"],
                "additionalProperties": False,
            }
            c = await _oc.chat_content(
                [
                    {"role": "system", "content": enrich_sys},
                    {"role": "user", "content": request.prompt},
                ],
                model=config.default_model,
                timeout=15,
                think=False,
                extra={"format": response_schema, "options": {"temperature": 0.2, "num_ctx": 4096}},
            )
            if c:
                pj = json.loads(strip_code_fences(c))
                if pj.get("prompt"):
                    request.prompt = pj["prompt"][:300]
                if pj.get("negative_prompt"):
                    request.negative_prompt = pj["negative_prompt"][:500]
        except Exception:
            pass
    try:
        # VRAM preflight: offload Ollama before ComfyUI video generation
        from ..services.vram_manager import vram_manager

        vram_result = await vram_manager.begin_3d_generation()
        logger.debug("VRAM pre-ComfyUI video generation: %s", vram_result)

        try:
            result = await adapter.generate(request.to_adapter_params())
            return {
                "success": True,
                "output_path": result.get("video_path"),
                "seed": result.get("seed"),
                "prompt_id": result.get("prompt_id"),
                "message": result.get(
                    "info", f"Video generated: {request.num_frames} frames @ {request.fps}fps"
                ),
            }
        finally:
            # VRAM postflight: reload Ollama after ComfyUI video generation
            from ..services.vram_manager import vram_manager

            vram_cleanup = await vram_manager.end_3d_generation()
            logger.debug("VRAM post-ComfyUI video generation: %s", vram_cleanup)
    except Exception as e:
        # Ensure Ollama is reloaded even on error
        try:
            from ..services.vram_manager import vram_manager

            await vram_manager.end_3d_generation()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/comfyui/upload-image")
async def upload_image_to_comfyui(request: Request) -> dict:
    """Upload an image to ComfyUI's ``input/`` directory for I2V workflows.

    Accepts multipart/form-data with an ``image`` field. Saves the file to
    ComfyUI's input/ directory via the /upload/image endpoint so that
    LoadImage nodes can reference it by filename.

    Returns the uploaded filename and ComfyUI's response.
    """
    form = await request.form()
    image_file = form.get("image")
    if image_file is None:
        raise HTTPException(status_code=400, detail="No image field in request")

    # Read the uploaded bytes
    upload_file = cast("UploadFile", image_file)
    image_bytes = await upload_file.read()
    filename = upload_file.filename or "uploaded.png"

    # Save to a temp file then upload via the shared client helper
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name

    try:
        base_url = config.comfyui_url
        try:
            result = await _cu.upload_image(base_url, tmp_path)
        except Exception as exc:
            # ComfyUI offline or upload rejected — plain 503, no stack trace.
            raise HTTPException(
                status_code=503,
                detail=f"ComfyUI upload unavailable: {exc}",
            ) from exc
        return {
            "success": True,
            "filename": result.get("name", filename),
            "comfyui_response": result,
            "message": f"Image uploaded to ComfyUI input directory: {result.get('name', filename)}",
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.post("/comfyui/upload-audio")
async def upload_audio_to_comfyui(request: Request) -> dict:
    """Upload an audio file to ComfyUI's ``input/`` directory for LoadAudio nodes.

    Accepts multipart/form-data with an ``audio`` field.
    """
    form = await request.form()
    audio_file = form.get("audio")
    if audio_file is None:
        raise HTTPException(status_code=400, detail="No audio field in request")

    upload_file = cast("UploadFile", audio_file)
    audio_bytes = await upload_file.read()
    filename = upload_file.filename or "uploaded_audio.wav"

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        base_url = config.comfyui_url
        try:
            result = await _cu.upload_audio(base_url, tmp_path)
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"ComfyUI upload unavailable: {exc}",
            ) from exc
        return {
            "success": True,
            "filename": result.get("name", filename),
            "comfyui_response": result,
            "message": f"Audio uploaded to ComfyUI input directory: {result.get('name', filename)}",
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.post("/comfyui/upload-video")
async def upload_video_to_comfyui(request: Request) -> dict:
    """Upload a video file to ComfyUI's ``input/`` directory for LoadVideo nodes.

    Accepts multipart/form-data with a ``video`` field.
    """
    form = await request.form()
    video_file = form.get("video")
    if video_file is None:
        raise HTTPException(status_code=400, detail="No video field in request")

    upload_file = cast("UploadFile", video_file)
    video_bytes = await upload_file.read()
    filename = upload_file.filename or "uploaded_video.mp4"

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        base_url = config.comfyui_url
        try:
            result = await _cu.upload_video(base_url, tmp_path)
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"ComfyUI upload unavailable: {exc}",
            ) from exc
        return {
            "success": True,
            "filename": result.get("name", filename),
            "comfyui_response": result,
            "message": f"Video uploaded to ComfyUI input directory: {result.get('name', filename)}",
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.post("/{service_name}/job")
async def queue_image_job(service_name: str, request: ImageGenerationRequest) -> dict:
    """Queue an image generation job"""
    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.IMAGE_GENERATION,
            params={
                "service": service_name,
                **request.to_adapter_params(),
            },
        )
    )
    return {"job_id": job.id, "status": job.status}
