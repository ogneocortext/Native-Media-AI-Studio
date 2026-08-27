"""
Integrations API - Generation routes (ComfyUI, Ollama, VRAM, Audio).
"""

import json
import os
import time
import logging
from pathlib import Path
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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


class VideoGenerationRequest(BaseModel):
    """Request for video generation using AnimateDiff"""

    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    num_frames: int = 16
    fps: int = 8
    motion_module: str = "mm_sd_v15_v2.safetensors"

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
    print(f"DEBUG: generate_image called with service_name={service_name}")
    adapter = adapter_registry.get(service_name)
    print(f"DEBUG: adapter={adapter}")
    if not adapter:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")

    # Check health first
    if not await adapter.health_check():
        raise HTTPException(
            status_code=503, detail=f"Service {service_name} is not available"
        )

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
        
        print(f"DEBUG: calling adapter.submit_only with params={params}")
        
        # Submit the prompt and get the prompt_id immediately
        prompt_id = await adapter.submit_only(params)
        
        print(f"DEBUG: prompt_id={prompt_id}")

        return {
            "success": True,
            "prompt_id": prompt_id,
            "status": "started",
            "message": f"Generation started. Poll /api/integrations/comfyui/progress/{prompt_id} for progress.",
        }

    except Exception as e:
        print(f"DEBUG: exception in generate_image: {e}")
        logger.error(f"Generate endpoint error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{service_name}/result/{prompt_id}")
async def get_result(service_name: str, prompt_id: str) -> dict:
    """Get the final result of a generation."""
    import urllib.request
    import json

    if service_name != "comfyui":
        raise HTTPException(status_code=400, detail="Only ComfyUI is supported")

    base_url = "http://127.0.0.1:8188"

    try:
        # Check history for the result
        req = urllib.request.Request(f"{base_url}/history/{prompt_id}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            history = json.loads(resp.read().decode())

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
                            
                            query = "&".join(f"{k}={v}" for k, v in params.items())
                            img_req = urllib.request.Request(f"{base_url}/view?{query}")
                            with urllib.request.urlopen(img_req, timeout=30) as img_resp:
                                img_data = img_resp.read()
                                
                                # Save to output directory
                                from ..core.config import PROJECT_ROOT
                                from datetime import datetime
                                import uuid
                                
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
    import urllib.request
    import json

    base_url = "http://127.0.0.1:8188"

    try:
        # Check queue for running status
        req = urllib.request.Request(f"{base_url}/queue")
        with urllib.request.urlopen(req, timeout=5) as resp:
            queue_data = json.loads(resp.read().decode())

        # Check if prompt is in running queue
        for item in queue_data.get("queue_running", []):
            if len(item) > 2 and item[1] == prompt_id:
                prompt_data = item[2] if len(item) > 2 else {}
                return {
                    "status": "running",
                    "prompt_id": prompt_id,
                    "step": prompt_data.get("step", 0),
                    "total_steps": prompt_data.get("steps", 20),
                    "progress": prompt_data.get("progress", 0),
                }

        # Check if prompt is in pending queue
        for item in queue_data.get("queue_pending", []):
            if len(item) > 2 and item[1] == prompt_id:
                return {
                    "status": "pending",
                    "prompt_id": prompt_id,
                    "step": 0,
                    "total_steps": 20,
                    "progress": 0,
                }

        # Check history for completed
        req = urllib.request.Request(f"{base_url}/history/{prompt_id}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            history = json.loads(resp.read().decode())

        if prompt_id in history:
            return {
                "status": "completed",
                "prompt_id": prompt_id,
                "step": 20,
                "total_steps": 20,
                "progress": 100,
            }

        return {
            "status": "unknown",
            "prompt_id": prompt_id,
            "step": 0,
            "total_steps": 20,
            "progress": 0,
        }

    except Exception as e:
        return {
            "status": "error",
            "prompt_id": prompt_id,
            "error": str(e),
            "step": 0,
            "total_steps": 20,
            "progress": 0,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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




@router.get("/ollama/models")
async def get_ollama_models() -> list:
    """Get available Ollama models"""
    adapter = adapter_registry.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")

    try:
        return await adapter.list_models()
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
    model = request.get("model", "qwen2.5:3b")
    history = request.get("history", [])
    tools = request.get("tools", [])
    think = request.get("think", None)
    stream = request.get("stream", False)
    max_tool_calls = request.get("max_tool_calls", 5)

    logger.info("Ollama chat request: model=%s, stream=%s, tools=%d, message_len=%d",
                model, stream, len(tools), len(message))

    # Build messages array
    messages = []
    for h in history:
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    messages.append({"role": "user", "content": message})

    try:
        if stream:
            # Streaming response with SSE
            from sse_starlette.sse import EventSourceResponse

            async def event_generator():
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

            return {
                "response": last_response,
                "model": model,
                "tool_calls": tool_call_count,
                "tool_details": tool_details,
            }

    except Exception as e:
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

