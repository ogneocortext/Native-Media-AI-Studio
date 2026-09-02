"""
Integrations API - Generation routes (ComfyUI, Ollama, VRAM, Audio).
"""

import json
import os
import time
import logging
from pathlib import Path
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT, config
from ..models.job import JobCreateRequest, JobType
from ..queue.manager import queue_manager


class ImageGenerationRequest(BaseModel):
    """Request for image generation via ComfyUI or other backends"""

    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    backend: str = "comfyui"
    ckpt_name: str = ""
    enrich_prompt: bool = False  # Explicit opt-in for LLM prompt enrichment (was auto, now manual)

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v: int) -> int:
        if v < 1 or v > 150:
            raise ValueError("steps must be between 1 and 150")
        return v

    @field_validator("cfg_scale")
    @classmethod
    def validate_cfg(cls, v: float) -> float:
        if v < 0.0 or v > 30.0:
            raise ValueError("cfg_scale must be between 0.0 and 30.0")
        return v

    @field_validator("width", "height")
    @classmethod
    def validate_dimension(cls, v: int) -> int:
        if v < 64 or v > 4096 or v % 8 != 0:
            raise ValueError("dimensions must be between 64 and 4096 and divisible by 8")
        return v


class VideoGenerationRequest(BaseModel):
    """Request for video generation using AnimateDiff"""

    prompt: str
    negative_prompt: str = ""
    steps: int = 15
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    num_frames: int = 16
    fps: int = 8
    motion_module: str = "mm_sd_v15_v2.safetensors"

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v: int) -> int:
        if v < 1 or v > 150:
            raise ValueError("steps must be between 1 and 150")
        return v

    @field_validator("cfg_scale")
    @classmethod
    def validate_cfg(cls, v: float) -> float:
        if v < 0.0 or v > 30.0:
            raise ValueError("cfg_scale must be between 0.0 and 30.0")
        return v

    @field_validator("width", "height")
    @classmethod
    def validate_dimension(cls, v: int) -> int:
        if v < 64 or v > 4096 or v % 8 != 0:
            raise ValueError("dimensions must be between 64 and 4096 and divisible by 8")
        return v

    @field_validator("num_frames")
    @classmethod
    def validate_frames(cls, v: int) -> int:
        if v < 1 or v > 256:
            raise ValueError("num_frames must be between 1 and 256")
        return v

    @field_validator("fps")
    @classmethod
    def validate_fps(cls, v: int) -> int:
        if v < 1 or v > 60:
            raise ValueError("fps must be between 1 and 60")
        return v

logger = logging.getLogger(__name__)

# Router without prefix - included by main integrations.py with prefix "/api/integrations"
router = APIRouter(tags=["Integrations-Generation"])


@router.get("/models/status")
async def get_models_status() -> dict:
    """Get status of model availability for all image generation services"""
    # PROJECT_ROOT is backend/, so project root is parent
    NATIVE_MEDIA_ROOT = PROJECT_ROOT.parent

    # Check ComfyUI model paths
    comfyui_models = NATIVE_MEDIA_ROOT / "stable-diffusion" / "models" / "checkpoints"
    comfyui_builtin = NATIVE_MEDIA_ROOT / "third_party" / "ComfyUI" / "models" / "checkpoints"

    comfyui_models_list = []
    if comfyui_models.exists():
        comfyui_models_list = [f.name for f in comfyui_models.iterdir() if f.suffix in (".safetensors", ".ckpt")]
    if comfyui_builtin.exists():
        comfyui_models_list.extend([f.name for f in comfyui_builtin.iterdir() if f.suffix in (".safetensors", ".ckpt")])

    return {
        "comfyui": {
            "models_directory": str(comfyui_models),
            "builtin_directory": str(comfyui_builtin),
            "models_found": len(comfyui_models_list),
            "model_list": comfyui_models_list[:10],  # Limit to first 10
            "has_models": len(comfyui_models_list) > 0,
        },
    }


@router.get("/comfyui/checkpoints")
async def list_comfyui_checkpoints() -> dict:
    """List available checkpoint models from ComfyUI's checkpoints folder."""
    # Look for ComfyUI installation
    search_paths = [
        PROJECT_ROOT.parent.parent / "ComfyUI" / "models" / "checkpoints",
        Path("D:/Backup of Important Data for Windows 11 Upgrade/ComfyUI/models/checkpoints"),
    ]

    for ckpt_dir in search_paths:
        if ckpt_dir.exists():
            checkpoints = sorted([
                f.name for f in ckpt_dir.iterdir()
                if f.suffix in (".safetensors", ".ckpt")
            ])
            if checkpoints:
                return {"checkpoints": checkpoints, "directory": str(ckpt_dir)}

    return {"checkpoints": [], "directory": ""}


@router.get("/comfyui/video-models")
async def get_video_models() -> dict:
    """Get video generation models including motion modules and checkpoints."""
    search_paths = [
        PROJECT_ROOT.parent.parent / "ComfyUI" / "models",
        Path("D:/Backup of Important Data for Windows 11 Upgrade/ComfyUI/models"),
    ]

    comfyui_models_dir = None
    for base_path in search_paths:
        if base_path.exists():
            comfyui_models_dir = base_path
            break

    if not comfyui_models_dir:
        return {"video_models": []}

    video_models = []

    # Scan animatediff directories
    animatediff_dirs = [
        "animatediff",
        "animatediff_models",
        "animatediff_motion_lora",
    ]

    for subdir in animatediff_dirs:
        dir_path = comfyui_models_dir / subdir
        if dir_path.exists():
            for f in dir_path.rglob("*"):
                if f.suffix in (".safetensors", ".ckpt") and f.stat().st_size > 1024:
                    video_models.append({
                        "name": f.name,
                        "path": str(f.relative_to(comfyui_models_dir)),
                        "type": "motion_lora" if "lora" in subdir else "motion_module",
                        "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
                    })

    # Also include diffusion_models that might be video-related
    diffusion_dir = comfyui_models_dir / "diffusion_models"
    if diffusion_dir.exists():
        for f in diffusion_dir.rglob("*"):
            if f.suffix in (".safetensors", ".ckpt") and f.stat().st_size > 1024 * 1024:
                name_lower = f.name.lower()
                if any(kw in name_lower for kw in ["wan", "video", "animate", "motion"]):
                    video_models.append({
                        "name": f.name,
                        "path": str(f.relative_to(comfyui_models_dir)),
                        "type": "diffusion_model",
                        "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
                    })

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
        raise HTTPException(
            status_code=503, detail=f"Service {service_name} is not available"
        )

    # Explicit LLM prompt enrichment — only if user opts in via enrich_prompt=true
    if request.enrich_prompt and request.prompt and len(request.prompt.strip()) < 200:
        try:
            import aiohttp as _aio
            enrich_sys = "You are a Stable Diffusion prompt engineer. Expand the user prompt into a detailed, comma-separated style prompt (keep <180 chars) and provide a negative_prompt. Respond ONLY JSON: {\"prompt\":\"...\",\"negative_prompt\":\"...\"}"
            async with _aio.ClientSession() as s:
                async with s.post(
                    f"{config.ollama_url}/api/chat",
                    json={"model": config.default_model, "messages": [{"role":"system","content":enrich_sys},{"role":"user","content":request.prompt}], "stream": False, "format":"json", "think": False, "options":{"temperature":0.7,"num_ctx":4096}},
                    timeout=_aio.ClientTimeout(total=15),
                ) as r:
                    if r.status == 200:
                        d = await r.json()
                        c = (d.get("message",{}).get("content") or "").strip()
                        if c:
                            import json as _json
                            if "```" in c:
                                c = c.split("```")[1].split("```")[0].strip().lstrip("json").strip()
                            pj = _json.loads(c)
                            if pj.get("prompt"):
                                request.prompt = pj["prompt"][:300]
                            if pj.get("negative_prompt"):
                                request.negative_prompt = pj["negative_prompt"][:500]
        except Exception:
            pass

    try:
        # Build params dict for adapter
        params = {
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "steps": request.steps,
            "cfg_scale": request.cfg_scale,
            "width": request.width,
            "height": request.height,
            "seed": request.seed,
            "sampler_name": request.sampler,
        }
        # Validate checkpoint - don't allow 3D/video models for image generation
        if request.ckpt_name:
            name_lower = request.ckpt_name.lower()
            invalid_keywords = ["hunyuan", "wan", "animate", "motion", "3d", "kandinsky"]
            if any(kw in name_lower for kw in invalid_keywords):
                logger.warning(f"Checkpoint '{request.ckpt_name}' is not suitable for image generation, ignoring")
                request.ckpt_name = ""
            else:
                params["ckpt_name"] = request.ckpt_name
        
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

    except Exception as e:
        logger.debug("exception in generate_image: %s", e)
        logger.error("Generate endpoint error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{service_name}/result/{prompt_id}")
async def get_result(service_name: str, prompt_id: str) -> dict:
    """Get the final result of a generation."""
    import aiohttp

    if service_name != "comfyui":
        raise HTTPException(status_code=400, detail="Only ComfyUI is supported")

    base_url = config.comfyui_url

    try:
        async with aiohttp.ClientSession() as session:
            # Check history for the result
            async with session.get(
                f"{base_url}/history/{prompt_id}",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    return {"status": "error", "error": f"History endpoint returned {resp.status}", "prompt_id": prompt_id}
                history = await resp.json()

            if prompt_id in history:
                entry = history[prompt_id]
                outputs = entry.get("outputs", {})
                
                # Find the image output
                for node_id, output in outputs.items():
                    if "images" in output:
                        for img in output["images"]:
                            filename = img.get("filename")
                            subfolder = img.get("subfolder", "")
                            if filename:
                                # Download the image
                                params = {"filename": filename}
                                if subfolder:
                                    params["subfolder"] = subfolder
                                
                                async with session.get(
                                    f"{base_url}/view",
                                    params=params,
                                    timeout=aiohttp.ClientTimeout(total=30),
                                ) as img_resp:
                                    if img_resp.status == 200:
                                        img_data = await img_resp.read()
                                        
                                        # Save to output directory
                                        output_dir = PROJECT_ROOT / "output" / "images"
                                        output_dir.mkdir(parents=True, exist_ok=True)
                                        
                                        filepath = output_dir / filename
                                        with open(filepath, "wb") as f:
                                            f.write(img_data)
                                        
                                        return {
                                            "status": "completed",
                                            "success": True,
                                            "output_path": str(filepath),
                                            "prompt_id": prompt_id,
                                        }

                return {"status": "error", "error": "No images found in output", "prompt_id": prompt_id}
            
            return {"status": "pending", "prompt_id": prompt_id}

    except Exception as e:
        return {"status": "error", "error": str(e), "prompt_id": prompt_id}


@router.get("/comfyui/progress/{prompt_id}")
async def get_progress(prompt_id: str) -> dict:
    """Get generation progress for a prompt."""
    import aiohttp

    base_url = config.comfyui_url

    try:
        async with aiohttp.ClientSession() as session:
            # Check queue for running/pending status
            async with session.get(
                f"{base_url}/queue",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status != 200:
                    return {
                        "status": "error",
                        "prompt_id": prompt_id,
                        "error": f"Queue endpoint returned {resp.status}",
                    }
                queue_data = await resp.json()

            # Check if prompt is in running queue
            # ComfyUI queue items are lists: [number, prompt_id, prompt_data, ...]
            for item in queue_data.get("queue_running", []):
                if isinstance(item, list) and len(item) > 1 and item[1] == prompt_id:
                    # Also check history for step info
                    async with session.get(
                        f"{base_url}/history/{prompt_id}",
                        timeout=aiohttp.ClientTimeout(total=3),
                    ) as hist_resp:
                        step = 0
                        total_steps = 0
                        if hist_resp.status == 200:
                            hist_data = await hist_resp.json()
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
            for item in queue_data.get("queue_pending", []):
                if isinstance(item, list) and len(item) > 1 and item[1] == prompt_id:
                    return {
                        "status": "pending",
                        "prompt_id": prompt_id,
                        "queue_position": item[0] if len(item) > 0 else 0,
                    }

            # Check history for completed
            async with session.get(
                f"{base_url}/history/{prompt_id}",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    history = await resp.json()
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
    import aiohttp

    base_url = config.comfyui_url

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{base_url}/history/{prompt_id}",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status != 200:
                    return {"error": "History not available"}
                history = await resp.json()

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
    import aiohttp
    from fastapi.responses import StreamingResponse
    from urllib.parse import unquote

    base_url = config.comfyui_url
    decoded_filename = unquote(filename)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{base_url}/view",
                params={"filename": decoded_filename},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=resp.status, detail="Image not found")

                origin = request.headers.get("origin", "*")

                async def stream_generator():
                    async for chunk in resp.content.iter_any():
                        yield chunk

                return StreamingResponse(
                    stream_generator(),
                    media_type=resp.content_type or "image/png",
                    headers={"Access-Control-Allow-Origin": origin},
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch image: {e}")


@router.post("/{service_name}/generate-video")
async def generate_video(service_name: str, request: VideoGenerationRequest) -> dict:
    """Generate a video using AnimateDiff via ComfyUI"""
    # Video generation only supported by ComfyUI
    if service_name != "comfyui":
        raise HTTPException(
            status_code=400,
            detail="Video generation is only supported by ComfyUI"
        )

    adapter = adapter_registry.get(service_name)
    if not adapter:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")

    # Check health first
    if not await adapter.health_check():
        raise HTTPException(
            status_code=503, detail=f"Service {service_name} is not available"
        )

    try:
        # Build video params
        params = {
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "steps": request.steps,
            "cfg_scale": request.cfg_scale,
            "width": request.width,
            "height": request.height,
            "seed": request.seed,
            "sampler_name": request.sampler,
            "video": True,
            "num_frames": request.num_frames,
            "fps": request.fps,
            "motion_module": request.motion_module,
        }
        result = await adapter.generate(params)

        return {
            "success": True,
            "output_path": result.get("video_path"),
            "seed": result.get("seed"),
            "prompt_id": result.get("prompt_id"),
            "message": result.get("info", f"Video generated: {request.num_frames} frames @ {request.fps}fps"),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{service_name}/job")
async def queue_image_job(service_name: str, request: ImageGenerationRequest) -> dict:
    """Queue an image generation job"""
    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.IMAGE_GENERATION,
            params={
                "service": service_name,
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
                "steps": request.steps,
                "cfg_scale": request.cfg_scale,
                "width": request.width,
                "height": request.height,
                "seed": request.seed,
                "sampler": request.sampler,
            },
        )
    )
    return {"job_id": job.id, "status": job.status}




@router.post("/ollama/embed")
async def ollama_embed(request: dict) -> dict:
    """Generate embedding via nomic-embed-text. Uses config.embedding_model by default."""
    import aiohttp
    text = (request.get("text") or request.get("input") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text/input required")
    model = request.get("model") or config.embedding_model
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{config.ollama_url}/api/embed",
                json={"model": model, "input": text},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    err = await resp.text()
                    raise HTTPException(status_code=resp.status, detail=err[:500])
                data = await resp.json()
                emb = data.get("embeddings", [data.get("embedding")])[0] if "embeddings" in data else data.get("embedding")
                if emb is None:
                    raise HTTPException(status_code=502, detail="No embedding in response")
                return {"model": model, "embedding": emb, "dimensions": len(emb)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ollama/search")
async def ollama_semantic_search(request: dict) -> dict:
    """Semantic search over tracks/visuals using nomic embeddings. Body: {query, limit?}"""
    import aiohttp, math
    query = (request.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query required")
    limit = min(int(request.get("limit", 10)), 20)
    model = request.get("model") or config.embedding_model
    # Embed query
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{config.ollama_url}/api/embed",
            json={"model": model, "input": query},
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status != 200:
                raise HTTPException(status_code=502, detail="Embedding failed")
            qdata = await resp.json()
            qemb = (qdata.get("embeddings") or [qdata.get("embedding")])[0]
    # Fetch candidates from DB (tracks)
    from ..core import database as db
    candidates = []
    try:
        tracks = db.get_all_tracks() if hasattr(db, "get_all_tracks") else []
        for t in (tracks or [])[:200]:
            text = f"{t.get('title','')} {t.get('artist','')} {t.get('music_prompt','')} {t.get('lyrics','')[:200]}"
            candidates.append({"type": "track", "id": t.get("id"), "text": text, "meta": t})
    except Exception:
        pass
    if not candidates:
        return {"query": query, "results": [], "model": model}
    # Embed candidates with concurrency limit (was sequential 200*15s = 50min)
    import asyncio as _asyncio
    candidates = candidates[: min(len(candidates), limit * 5)]  # cap to 5x limit before embedding
    sem = _asyncio.Semaphore(5)
    async def _embed_one(c):
        async with sem:
            try:
                async with aiohttp.ClientSession() as s:
                    async with s.post(
                        f"{config.ollama_url}/api/embed",
                        json={"model": model, "input": c["text"][:800]},
                        timeout=aiohttp.ClientTimeout(total=15),
                    ) as r:
                        if r.status != 200:
                            return None
                        d = await r.json()
                        emb = (d.get("embeddings") or [d.get("embedding")])[0]
                        dot = sum(a*b for a,b in zip(qemb, emb))
                        nq = math.sqrt(sum(a*a for a in qemb))
                        nb = math.sqrt(sum(a*a for a in emb))
                        sim = dot / (nq*nb) if nq and nb else 0
                        return {**c, "score": round(sim, 4)}
            except Exception:
                return None
    results = [r for r in await _asyncio.gather(*[_embed_one(c) for c in candidates]) if r is not None]
    results.sort(key=lambda x: x["score"], reverse=True)
    return {"query": query, "model": model, "results": results[:limit]}


@router.get("/ollama/models")
async def get_ollama_models() -> list:
    """Get available Ollama models, enriched with benchmark scores if available."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")

    try:
        models = await adapter.list_models()
        # Enrich with benchmark data if present
        try:
            from ..services.ollama_benchmark import get_all_results

            bench = get_all_results()
            bench_map = bench.get("results", {}) if bench else {}
            for m in models:
                name = m.get("name")
                if name in bench_map:
                    r = bench_map[name]
                    m["benchmark"] = {
                        "score": r.get("validation", {}).get("score", 0),
                        "latency_ms": r.get("latency_ms"),
                        "success": r.get("success"),
                        "timestamp": r.get("timestamp"),
                    }
        except Exception:
            pass
        return models
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ollama/benchmark/results")
async def get_benchmark_results() -> dict:
    """Get stored Three.js benchmark results."""
    try:
        from ..services.ollama_benchmark import get_all_results

        return get_all_results()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ollama/benchmark/run")
async def run_benchmark(request: dict = None) -> dict:
    """Run Three.js generation benchmark against Ollama models.

    Body: { "models": ["qwen2.5:3b", ...] } or {} to benchmark all.
    """
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    if not await adapter.health_check():
        raise HTTPException(status_code=503, detail="Ollama is not available")

    body = request or {}
    models = body.get("models") if isinstance(body, dict) else None
    max_models = body.get("max_models", 8) if isinstance(body, dict) else 8

    try:
        from ..services.ollama_benchmark import run_benchmark

        result = await run_benchmark(models, adapter, max_models=max_models)
        return result
    except Exception as e:
        logger.error(f"Benchmark run failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ollama/benchmark/best")
async def get_best_benchmark_model() -> dict:
    """Get the best model according to benchmark scores."""
    try:
        from ..services.ollama_benchmark import get_best_model, get_all_results

        best = get_best_model()
        all_results = get_all_results()
        if not best:
            return {"best": None, "results": all_results}
        return {"best": best, "result": all_results.get("results", {}).get(best), "results": all_results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vram/status")
async def get_vram_status() -> dict:
    """Get current VRAM status and GPU workload information"""
    from ..services.vram_manager import vram_manager
    vram = await vram_manager.get_vram_status()
    status = vram_manager.get_status()
    return {
        "vram": vram,
        "manager": status,
    }


@router.post("/vram/offload-ollama")
async def offload_ollama() -> dict:
    """Manually offload Ollama models from GPU to free VRAM"""
    from ..services.vram_manager import vram_manager
    result = await vram_manager._unload_ollama_models()
    return result


@router.post("/vram/reload-ollama")
async def reload_ollama() -> dict:
    """Manually reload Ollama models to GPU"""
    from ..services.vram_manager import vram_manager
    result = await vram_manager._reload_ollama_models()
    return result


@router.post("/ollama/chat")
async def ollama_chat(request: dict) -> dict:
    """
    Chat with Ollama using the /api/chat endpoint with tool calling support.

    Request body:
    - message: User message
    - model: Model name (optional)
    - history: Previous messages (optional)
    - tools: Tool definitions (optional)
    - think: Enable thinking mode (optional)
    - stream: Enable streaming (optional, default false)
    - max_tool_calls: Maximum tool call iterations (optional, default 5)
    """
    import logging
    logger = logging.getLogger(__name__)

    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")

    message = request.get("message", "")
    model = request.get("model", config.default_model)
    history = request.get("history", [])
    think = request.get("think", None)
    stream = request.get("stream", False)
    max_tool_calls = request.get("max_tool_calls", 5)
    ollama_options = request.get("options", {}) or {}
    # Also allow system to be passed via request
    system_prompt = request.get("system")

    # Track activity for this model
    adapter.set_activity(model, "chat", message[:80])

    # Normalize tools: can be boolean (True/False) or list
    tools_raw = request.get("tools", [])
    if tools_raw is True:
        tools = adapter.get_tool_definitions() if adapter else []
    elif tools_raw is False or tools_raw is None:
        tools = []
    else:
        tools = tools_raw

    logger.info("Ollama chat request: model=%s, stream=%s, tools=%d, message_len=%d, system_len=%d, options=%s",
                model, stream, len(tools), len(message), len(system_prompt or ""), ollama_options)

    # Build messages array (system first, then history, then user)
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for h in history:
        # Support system role in history as well
        role = h.get("role", "user")
        if role not in ("user", "assistant", "system", "tool"):
            role = "user"
        messages.append({"role": role, "content": h.get("content", "")})
    messages.append({"role": "user", "content": message})

    try:
        if stream:
            # Streaming response with SSE
            from sse_starlette.sse import EventSourceResponse

            async def event_generator():
                try:
                    # Send initial event to confirm connection
                    yield {"event": "connected", "data": json.dumps({"status": "streaming"})}

                    tool_call_count = 0
                    current_messages = messages[:]

                    while tool_call_count < max_tool_calls:
                        async for chunk in await adapter.chat(
                            messages=current_messages,
                            model=model,
                            tools=tools,
                            stream=True,
                            think=think,
                            **ollama_options,
                        ):
                            if chunk.get("done"):
                                msg = chunk.get("message", {})
                                tool_calls = msg.get("tool_calls", [])

                                if tool_calls and tool_call_count < max_tool_calls:
                                    tool_call_count += 1
                                    yield {
                                        "event": "tool_calls",
                                        "data": json.dumps({
                                            "tool_calls": [{"name": tc["function"]["name"], "arguments": tc["function"]["arguments"]} for tc in tool_calls]
                                        }),
                                    }

                                    current_messages.append({
                                        "role": "assistant",
                                        "content": msg.get("content", ""),
                                        "tool_calls": tool_calls,
                                    })

                                    for tc in tool_calls:
                                        result = await adapter.execute_tool_call(
                                            tc["function"]["name"],
                                            tc["function"]["arguments"],
                                            {},
                                        )
                                        current_messages.append({
                                            "role": "tool",
                                            "tool_name": tc["function"]["name"],
                                            "content": result,
                                        })
                                    break
                                else:
                                    yield {
                                        "event": "done",
                                        "data": json.dumps({
                                            "content": msg.get("content", ""),
                                            "model": chunk.get("model", model),
                                            "tool_calls": tool_call_count,
                                        }),
                                    }
                                    return
                            else:
                                content = chunk.get("message", {}).get("content", "")
                                thinking = chunk.get("message", {}).get("thinking", "")
                                if content or thinking:
                                    yield {
                                        "event": "content",
                                        "data": json.dumps({"content": content, "thinking": thinking}),
                                    }

                    # Send done event to properly close the stream
                    yield {"event": "done", "data": json.dumps({"status": "complete"})}
                finally:
                    adapter.clear_activity(model)

            return EventSourceResponse(event_generator())
        else:
            # Non-streaming response with agent loop
            tool_call_count = 0
            current_messages = messages[:]
            last_response = ""
            tool_details = []

            while tool_call_count < max_tool_calls:
                result = await adapter.chat(
                    messages=current_messages,
                    model=model,
                    tools=tools,
                    stream=False,
                    think=think,
                    **ollama_options,
                )

                msg = result.get("message", {})
                tool_calls = msg.get("tool_calls", [])
                content = msg.get("content", "")

                if tool_calls and tool_call_count < max_tool_calls:
                    tool_call_count += 1

                    # Add assistant message with tool calls
                    current_messages.append({
                        "role": "assistant",
                        "content": content,
                        "tool_calls": tool_calls,
                    })

                    # Execute each tool and add results
                    for tc in tool_calls:
                        tool_result = await adapter.execute_tool_call(
                            tc["function"]["name"],
                            tc["function"]["arguments"],
                            {},
                        )
                        tool_details.append({
                            "name": tc["function"]["name"],
                            "arguments": tc["function"]["arguments"],
                            "result": tool_result,
                        })
                        current_messages.append({
                            "role": "tool",
                            "tool_name": tc["function"]["name"],
                            "content": tool_result,
                         })
                else:
                    last_response = content
                    break

            adapter.clear_activity(model)
            return {
                "response": last_response,
                "model": model,
                "tool_calls": tool_call_count,
                "tool_details": tool_details,
            }

    except Exception as e:
        adapter.clear_activity(model)
        logger.error("Ollama chat error: %s", str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ollama/generate")
async def ollama_generate(prompt: str, model: str = "llama2") -> dict:
    """Generate text using Ollama (legacy endpoint)"""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    try:
        result = await adapter.generate(prompt=prompt, model=model)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Audio Analysis (Librosa)
# ============================================================================


class AudioAnalysisRequest(BaseModel):
    """Request for immediate audio analysis"""

    audio_path: str
    hop_length: int = 512
    frame_length: int = 1024


class AudioAnalysisJobRequest(BaseModel):
    """Request to queue an audio analysis job"""

    audio_path: str
    hop_length: int = 512
    frame_length: int = 1024
    max_retries: int = 3


@router.post("/audio/analyze")
async def analyze_audio(request: AudioAnalysisRequest):
    """
    Analyze an audio file and extract waveform + beat features.
    Uses librosa to extract amplitude envelope, beat markers, tempo, and spectral features.
    """
    from ..services.audio_analyzer import LIBROSA_AVAILABLE, AudioAnalyzer

    if not LIBROSA_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Audio analysis not available. Install: pip install librosa soundfile",
        )

    audio_path = Path(request.audio_path)
    if not audio_path.is_absolute():
        audio_path = PROJECT_ROOT / audio_path

    if not audio_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Audio file not found: {audio_path}"
        )

    try:
        analyzer = AudioAnalyzer(
            hop_length=request.hop_length, frame_length=request.frame_length
        )
        result, json_path = analyzer.analyze_and_save(str(audio_path))

        return {
            "success": True,
            "analysis_path": json_path,
            "duration_seconds": result.waveform.duration_seconds,
            "sample_rate": result.waveform.sample_rate,
            "tempo_bpm": result.beats.tempo_bpm,
            "num_beats": len(result.beats.beat_times),
            "num_onsets": len(result.beats.onset_times),
            "amplitude_points": len(result.waveform.amplitude_envelope),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/audio/analyze/job")
async def create_audio_analysis_job(request: AudioAnalysisJobRequest):
    """Queue an audio analysis job to extract beat markers and waveform features."""
    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.AUDIO_FEATURE_EXTRACTION,
            params={
                "audio_path": request.audio_path,
                "hop_length": request.hop_length,
                "frame_length": request.frame_length,
            },
            max_retries=request.max_retries,
        )
    )
    return {"job_id": job.id, "status": job.status.value}


# ============== Music Video Generation ==============


@router.get("/ollama/scene-state")
async def get_scene_state() -> dict:
    """Get the current AI-generated scene state."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    return adapter._scene_state


@router.post("/ollama/scene-clear")
async def clear_scene() -> dict:
    """Clear the AI-generated scene state."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    adapter._scene_state = {
        "objects": [],
        "lights": [],
        "particles": {"count": 300, "color": "#8b5cf6", "speed": 0.5},
        "camera": "orbit",
        "bloom": 0.8,
        "duration": 30,
        "keyframes": [],
    }
    return {"status": "cleared"}


# ============== AI Visualizer Preset Generation ==============

VISUALIZER_PRESET_SCHEMA = {
    "version": "1.0",
    "id": "string - unique preset id (kebab-case)",
    "name": "string - short display name",
    "description": "string - one sentence describing the look",
    "tags": ["string - mood/genre tags"],
    "theme": {
        "primary": "hex color - main mesh/particle color",
        "secondary": "hex color - accent color",
        "accent": "hex color - highlight color",
        "background": "hex color - scene background",
        "text": "hex color - lyric text color",
        "glow": "hex color - glow/emissive color"
    },
    "visualizer": {
        "style": "one of: particles, waveform, pulse, bars, galaxy, terrain",
        "colors": "one of: neon, fire, ocean, forest, sunset, monochrome, custom",
        "intensity": "number 0-1 - overall effect intensity",
        "particleCount": "number 0-2000 - particle count",
        "speed": "number 0-3 - animation speed multiplier",
        "scale": "number 0.1-3 - base scale",
        "glow": "boolean - enable glow effects",
        "rotation": "boolean - enable auto-rotation"
    },
    "camera": {
        "keyframes": [{"at": "number - seconds", "position": [0, 0, 0], "target": [0, 0, 0], "easing": "linear|easeIn|easeOut|easeInOut"}],
        "mode": "orbit|fixed|flythrough|handheld",
        "fov": "number 30-90 - field of view"
    },
    "postfx": {
        "bloom": "number 0-3 - bloom intensity",
        "bloomRadius": "number 0-1",
        "bloomThreshold": "number 0-1",
        "chromaticAberration": "number 0-0.01",
        "filmGrain": "number 0-1",
        "vignetteRadius": "number 0-3",
        "vignetteStrength": "number 0-1",
        "glitch": "number 0-1",
        "sharpen": "number 0-1"
    },
    "lyrics": {
        "style": "kinetic|fade|typewriter|glitch|neon|bounce",
        "glowIntensity": "number 0-1",
        "fontSize": "number 24-96",
        "fontWeight": "number 100-900",
        "letterSpacing": "number 0-0.2",
        "beatReact": "boolean",
        "enterAnimation": "string",
        "exitAnimation": "string"
    },
    "audioReactivity": {
        "bass": "none|scale|glow|shake|pulse|zoom",
        "mid": "none|scale|glow|shake|pulse|zoom",
        "treble": "none|scale|glow|shake|pulse|zoom",
        "beat": "none|pulse|shake|flash|zoom",
        "beatDecay": "number 0-1",
        "smoothing": "number 0-1"
    }
}

VISUALIZER_SYSTEM_PROMPT = """You are a music visualizer preset generator. Given a natural language description of a visual style, generate a JSON preset for a 3D audio-reactive visualizer.

RULES:
- Output ONLY valid JSON matching the schema below
- All hex colors must be 6-digit format like #ff0040
- Choose visualization styles that match the mood described
- For dark/moody: use particles, waveform, cosmic with low intensity
- For energetic/aggressive: use bars, pulse, galaxy with high intensity
- For calm/peaceful: use waveform, terrain with low speed
- Match audio reactivity to the described energy level

SCHEMA:
{schema}

Respond with ONLY the JSON object, no markdown fences, no explanation."""


@router.post("/ollama/visualizer")
async def generate_visualizer_preset(request: dict) -> dict:
    """Generate a visualizer preset from a natural language description using Ollama."""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")

    description = request.get("description", "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="Description is required")

    model = request.get("model", config.default_model)
    temperature = request.get("temperature", 0.7)
    # Optional track metadata for alignment
    track_meta = request.get("track") or {}
    bpm = track_meta.get("bpm")
    energy = track_meta.get("energy")
    duration = track_meta.get("duration_seconds")
    genre = track_meta.get("genre", "")

    # Track activity
    adapter.set_activity(model, "visualizer", description[:80])

    # Build track context for the prompt
    track_context = ""
    if bpm or energy or duration or genre:
        parts = []
        if genre:
            parts.append(f"genre: {genre}")
        if bpm:
            parts.append(f"tempo: {bpm} BPM")
        if energy is not None:
            energy_label = "high" if energy > 0.6 else "low" if energy < 0.35 else "medium"
            parts.append(f"energy: {energy_label} ({energy:.2f})")
        if duration:
            parts.append(f"duration: {duration:.0f}s")
        track_context = "\n\nTRACK CONTEXT (adapt the preset to match this music):\n" + "\n".join(f"- {p}" for p in parts)
        track_context += "\n\n- Scale animation speed to the BPM (faster tempo → quicker transitions)"
        track_context += "\n- Match intensity to the energy level (high energy → more particles, faster motion)"
        track_context += "\n- Set camera keyframe 'at' times to fit within the track duration"
        if energy is not None:
            if energy > 0.6:
                track_context += "\n- Use high-intensity audio reactivity (shake, flash, zoom on beat)"
            elif energy < 0.35:
                track_context += "\n- Use gentle reactivity (slow pulse, glow, no shake)"

    system_prompt = VISUALIZER_SYSTEM_PROMPT.format(
        schema=json.dumps(VISUALIZER_PRESET_SCHEMA, indent=2)
    )

    logger.info("Generating visualizer preset: model=%s, desc_len=%d, track=%s",
                model, len(description), bool(track_context))

    try:
        result = await adapter.generate({
            "prompt": f"Generate a visualizer preset for: {description}{track_context}",
            "model": model,
            "system": system_prompt,
            "format": "json",
            "think": False,  # Disable thinking for structured JSON output
            "options": {
                "temperature": temperature,
                "num_ctx": 8192,
            },
        })

        response_text = result.get("response", "")
        if not response_text:
            raise HTTPException(status_code=502, detail="Ollama returned empty response")

        # Parse the JSON response
        try:
            preset = json.loads(response_text)
        except json.JSONDecodeError as e:
            # Try to extract JSON from markdown fences if present
            cleaned = response_text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]
                cleaned = cleaned.strip()
                # Remove language identifier
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()
            preset = json.loads(cleaned)

        # Ensure required top-level fields exist
        preset.setdefault("version", "1.0")
        if not preset.get("id"):
            preset["id"] = "ai-generated"
        if not preset.get("name"):
            preset["name"] = "AI Generated"
        preset.setdefault("tags", [])
        preset.setdefault("description", description)

        # Persist to DB + file for retrieval after restart (storage/visualizer_presets/{hash}.json)
        try:
            import hashlib
            from pathlib import Path
            from ..core.database import save_visualization_preset
            track_hash = hashlib.md5(f"{description}{bpm}{energy}{genre}".encode()).hexdigest()[:16]
            track_name = request.get("track_name") or description[:60]
            save_visualization_preset({
                "track_name": track_name,
                "track_hash": track_hash,
                "preset_name": preset.get("name", "AI Generated"),
                "visualization_style": preset.get("visualizer", {}).get("style", preset.get("style", "geometric")),
                "params": preset,
                "ollama_model": result.get("model", model),
                "prompt": description,
                "lyrics": request.get("lyrics", ""),
                "bpm": bpm or 120,
                "energy_level": ("high" if (energy or 0) > 0.6 else "low" if (energy or 0) < 0.35 else "medium"),
                "mood_tags": preset.get("tags", []),
                "genre_tags": [genre] if genre else [],
            })
            # Also write JSON file for direct retrieval
            out_dir = Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets"
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{track_hash}.json").write_text(json.dumps(preset, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to persist visualizer preset: {e}")

        return {
            "success": True,
            "preset": preset,
            "model": result.get("model", model),
            "persisted": True,
        }
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Ollama JSON response: %s (raw: %s)", e, response_text[:200])
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Visualizer preset generation failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        adapter.clear_activity(model)


@router.get("/ollama/visualizer/presets")
async def list_visualizer_presets() -> dict:
    """List persisted visualizer presets (DB + file)."""
    from pathlib import Path
    from ..core.database import get_all_visualization_presets
    presets = get_all_visualization_presets()
    # Also include file-based presets not yet in DB
    file_dir = Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets"
    files = [p.name for p in file_dir.glob("*.json")] if file_dir.exists() else []
    return {"presets": presets, "files": files, "count": len(presets)}


@router.get("/ollama/visualizer/preset/{track_hash}")
async def get_visualizer_preset(track_hash: str) -> dict:
    """Retrieve a persisted preset by track_hash."""
    import json as _json
    from pathlib import Path
    from ..core.database import get_visualization_preset
    preset = get_visualization_preset(track_hash)
    if preset:
        return {"preset": preset["params"], "meta": preset}
    # Fallback to file
    file_path = Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets" / f"{track_hash}.json"
    if file_path.exists():
        return {"preset": _json.loads(file_path.read_text(encoding="utf-8")), "meta": {"source": "file"}}
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Preset not found")


@router.delete("/ollama/visualizer/preset/{preset_id}")
async def delete_visualizer_preset(preset_id: str) -> dict:
    """Delete a saved preset by id."""
    from pathlib import Path
    from ..core.database import get_db
    with get_db() as conn:
        cur = conn.execute("DELETE FROM visualization_presets WHERE id = ?", (preset_id,))
        if cur.rowcount == 0:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Preset not found")
    # Also remove file if exists (by id or hash)
    file_dir = Path(__file__).resolve().parents[4] / "storage" / "visualizer_presets"
    for f in file_dir.glob(f"{preset_id[:16]}*.json"):
        try: f.unlink()
        except: pass
    return {"deleted": preset_id}

