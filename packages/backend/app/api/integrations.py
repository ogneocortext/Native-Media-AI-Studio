"""
Integrations API - for external service integration.
"""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT
from ..models.job import JobCreateRequest, JobType
from ..queue.manager import queue_manager

router = APIRouter(prefix="/api/integrations", tags=["Integrations"])


class ImageGenerationRequest(BaseModel):
    """Request for image generation"""

    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    backend: str = "comfyui"


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
    num_frames: int = 16  # Number of video frames
    fps: int = 8  # Frames per second
    motion_module: str = "mm_sd_v15_v2.safetensors"


@router.get("/")
async def list_integrations() -> dict:
    """List available integrations"""
    return {
        "integrations": [
            {"name": "comfyui", "type": "workflow", "display": "ComfyUI"},
            {"name": "ollama", "type": "llm", "display": "Ollama"},
        ]
    }


@router.get("/{service_name}")
async def get_integration(service_name: str) -> dict:
    """Get integration details"""
    adapter = adapter_registry.get(service_name)
    if not adapter:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")

    return {
        "name": adapter.name,
        "status": adapter.get_status().value,
        "url": adapter.base_url,
        "mock_mode": adapter.is_mock_mode(),
    }


@router.get("/config/mock-mode")
async def get_mock_mode() -> dict:
    """Get current mock mode status"""
    return {
        "mock_mode": adapter_registry.is_mock_mode(),
        "env_override": os.getenv("MOCK_GENERATION", "false").lower() == "true",
    }


@router.post("/config/mock-mode")
async def set_mock_mode(enabled: bool) -> dict:
    """Enable or disable mock mode for all adapters"""
    adapter_registry.set_mock_mode(enabled)
    return {
        "mock_mode": enabled,
        "message": f"Mock mode {'enabled' if enabled else 'disabled'}. Changes take effect on next health check."
    }


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


@router.post("/{service_name}/generate")
async def generate_image(service_name: str, request: ImageGenerationRequest) -> dict:
    """Generate an image using the specified backend"""
    adapter = adapter_registry.get(service_name)
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
        result = await adapter.generate(params)

        # Save image to output
        output_dir = PROJECT_ROOT / "output" / "images"
        output_dir.mkdir(parents=True, exist_ok=True)

        import base64
        import uuid
        from datetime import datetime

        filename = (
            f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
        )
        filepath = output_dir / filename

        # Decode and save image
        if isinstance(result.get("image"), str):
            img_data = base64.b64decode(result["image"])
            with open(filepath, "wb") as f:
                f.write(img_data)

        return {
            "success": True,
            "output_path": str(filepath),
            "seed": result.get("seed"),
            "info": result.get("info", ""),
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

        # Save video reference to output
        output_dir = PROJECT_ROOT / "output" / "video"
        output_dir.mkdir(parents=True, exist_ok=True)

        import uuid
        from datetime import datetime

        filename = (
            f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.mp4"
        )
        filepath = output_dir / filename

        return {
            "success": True,
            "output_path": str(filepath),
            "seed": result.get("seed"),
            "prompt_id": result.get("prompt_id"),
            "message": f"Video generation started. Frames: {request.num_frames}, FPS: {request.fps}",
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


@router.post("/ollama/generate")
async def ollama_generate(prompt: str, model: str = "llama2") -> dict:
    """Generate text using Ollama"""
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

class BeatMarker(BaseModel):
    """Beat marker for music video synchronization"""
    time: float
    intensity: str = "medium"  # low, medium, high
    type: str = "beat"  # beat, drop, break, transition
    note: str = ""


class MusicVideoStyle(BaseModel):
    """Visual style configuration for music video"""
    template_id: str
    name: str
    prompt: str
    negative_prompt: str = ""
    color_scheme: dict = {}
    motion_strength: float = 0.5
    complexity: float = 0.5
    beat_reactivity: float = 0.8


class MusicVideoRequest(BaseModel):
    """Request for music video generation with beat-synced visuals"""
    audio_path: str
    style: MusicVideoStyle
    beat_markers: list[BeatMarker] = []
    duration: str = "60s"  # 30s, 60s, 90s, full
    resolution: str = "1080p"  # 720p, 1080p, 4k
    fps: int = 30
    quality: str = "standard"  # draft, standard, high
    num_frames: int = 16
    motion_module: str = "mm_sd_v15_v2.safetensors"


class PreviewGenerationRequest(BaseModel):
    """Request for generating a short preview (5s draft)"""
    audio_path: str
    style: MusicVideoStyle
    beat_markers: list[BeatMarker] = []
    resolution: str = "240p"
    duration_seconds: float = 5.0


@router.get("/music-video/styles")
async def list_music_video_styles() -> dict:
    """List available visual styles for music video generation"""
    return {
        "styles": [
            {
                "id": "cyberpunk_neon",
                "name": "Cyberpunk Neon",
                "category": "energetic",
                "prompt": "cyberpunk cityscape, neon lights, synthwave aesthetic, glowing skyscrapers, purple and cyan colors, futuristic, 4k, highly detailed, cinematic lighting",
                "negative_prompt": "blurry, low quality, daytime, natural lighting",
                "params": {"motion_strength": 0.8, "complexity": 0.9, "beat_reactivity": 0.9},
            },
            {
                "id": "organic_flow",
                "name": "Organic Flow",
                "category": "organic",
                "prompt": "flowing organic forms, nature inspired, water waves, smoke trails, earth tones, peaceful, flowing energy, gentle colors, 4k, ethereal",
                "negative_prompt": "sharp edges, mechanical, geometric, harsh colors",
                "params": {"motion_strength": 0.4, "complexity": 0.6, "beat_reactivity": 0.5},
            },
            {
                "id": "geometric_pulse",
                "name": "Geometric Pulse",
                "category": "geometric",
                "prompt": "geometric shapes, triangles, squares, hexagons, pulsing to beat, sharp edges, minimal, black background, neon outlines, 4k, precise",
                "negative_prompt": "organic, blurry, soft edges, nature",
                "params": {"motion_strength": 0.7, "complexity": 0.8, "beat_reactivity": 1.0},
            },
            {
                "id": "particle_dance",
                "name": "Particle Dance",
                "category": "abstract",
                "prompt": "swirling particles, particle system, bokeh effect, depth of field, thousands of particles, golden ratio spiral, magical, 4k, volumetric lighting",
                "negative_prompt": "blurry, low resolution, noise",
                "params": {"motion_strength": 0.6, "complexity": 0.9, "beat_reactivity": 0.8},
            },
            {
                "id": "vinyl_retro",
                "name": "Vinyl Retro",
                "category": "atmospheric",
                "prompt": "vinyl record spinning, retro aesthetic, vintage colors, warm tones, analog feel, grain texture, 1970s style, 4k, nostalgic",
                "negative_prompt": "modern, digital, cold colors, futuristic",
                "params": {"motion_strength": 0.3, "complexity": 0.5, "beat_reactivity": 0.6},
            },
            {
                "id": "waveform_classic",
                "name": "Waveform Classic",
                "category": "geometric",
                "prompt": "oscilloscope waveform, green phosphor, crt monitor effect, retro tech, audio waveform, electronic, 4k, clean, minimal",
                "negative_prompt": "modern ui, touch screen, colorful",
                "params": {"motion_strength": 0.5, "complexity": 0.4, "beat_reactivity": 1.0},
            },
            {
                "id": "fire_energy",
                "name": "Fire Energy",
                "category": "energetic",
                "prompt": "dynamic flames, fire particles, heat distortion, orange and red colors, energy, intense, powerful, 4k, dramatic lighting",
                "negative_prompt": "cold, blue, calm, peaceful",
                "params": {"motion_strength": 0.9, "complexity": 0.8, "beat_reactivity": 0.9},
            },
        ]
    }


@router.post("/music-video/generate")
async def generate_music_video(request: MusicVideoRequest):
    """
    Generate a music video with beat-synced visuals using ComfyUI.
    Creates a video that reacts to audio beats and follows the specified visual style.
    """
    adapter = adapter_registry.get("comfyui")
    if not adapter:
        raise HTTPException(status_code=503, detail="ComfyUI adapter not available")

    # Build prompt with beat reactivity hints
    style = request.style
    enhanced_prompt = style.prompt
    if style.beat_reactivity > 0.7:
        enhanced_prompt += ", highly reactive to music, beat synchronized, dynamic motion"

    # Calculate video parameters based on duration
    duration_map = {"30s": 30, "60s": 60, "90s": 90, "full": 180}
    target_duration = duration_map.get(request.duration, 60)

    # Resolution mapping
    res_map = {
        "720p": (1280, 720),
        "1080p": (1920, 1080),
        "4k": (3840, 2160),
    }
    width, height = res_map.get(request.resolution, (1920, 1080))

    # Adjust steps based on quality
    steps = {"draft": 10, "standard": 20, "high": 30}.get(request.quality, 20)

    # Queue the job
    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.MUSIC_VIDEO,
            params={
                "audio_path": request.audio_path,
                "prompt": enhanced_prompt,
                "negative_prompt": style.negative_prompt,
                "width": width,
                "height": height,
                "steps": steps,
                "fps": request.fps,
                "duration": target_duration,
                "beat_markers": [m.dict() for m in request.beat_markers],
                "style_template": style.template_id,
                "motion_strength": style.motion_strength,
                "beat_reactivity": style.beat_reactivity,
                "num_frames": request.num_frames,
                "motion_module": request.motion_module,
            },
            max_retries=3,
        )
    )

    return {
        "job_id": job.id,
        "status": job.status.value,
        "message": f"Music video job queued with {len(request.beat_markers)} beat markers",
        "estimated_duration": target_duration,
    }


@router.post("/music-video/preview")
async def generate_preview(request: PreviewGenerationRequest):
    """
    Generate a short 5-second preview of the music video.
    Uses lower resolution and fewer steps for faster generation.
    """
    adapter = adapter_registry.get("comfyui")
    if not adapter:
        raise HTTPException(status_code=503, detail="ComfyUI adapter not available")

    # Build preview-optimized prompt
    style = request.style
    preview_prompt = style.prompt + ", preview, draft quality"

    # Low resolution for speed
    res_map = {
        "240p": (426, 240),
        "360p": (640, 360),
        "480p": (854, 480),
    }
    width, height = res_map.get(request.resolution, (426, 240))

    # Calculate frames for preview duration
    fps = 8
    num_frames = int(request.duration_seconds * fps)

    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.MUSIC_VIDEO_PREVIEW,
            params={
                "audio_path": request.audio_path,
                "prompt": preview_prompt,
                "negative_prompt": style.negative_prompt,
                "width": width,
                "height": height,
                "steps": 10,  # Fast preview
                "fps": fps,
                "duration": request.duration_seconds,
                "beat_markers": [m.model_dump() for m in request.beat_markers[:4]],  # Limit markers
                "style_template": style.template_id,
                "motion_strength": style.motion_strength,
                "beat_reactivity": style.beat_reactivity,
                "num_frames": num_frames,
                "is_preview": True,
            },
            max_retries=1,  # Previews are low priority
        )
    )

    return {
        "job_id": job.id,
        "status": job.status.value,
        "message": "Preview generation queued (5-second draft)",
        "preview_duration": request.duration_seconds,
    }


@router.get("/music-video/templates")
async def get_workflow_templates() -> dict:
    """Get available ComfyUI workflow templates for music video generation"""
    return {
        "templates": [
            {
                "id": "animatediff_simple",
                "name": "AnimateDiff Simple",
                "description": "Basic AnimateDiff workflow with motion module",
                "models_required": ["mm_sd_v15_v2.safetensors"],
            },
            {
                "id": "animatediff_advanced",
                "name": "AnimateDiff Advanced",
                "description": "Advanced AnimateDiff with controlnet and IP-adapter",
                "models_required": ["mm_sd_v15_v2.safetensors", "controlnet_openpose"],
            },
            {
                "id": "comfy_video_basic",
                "name": "ComfyUI Video Basic",
                "description": "Standard video generation with KSampler",
                "models_required": [],
            },
        ]
    }


@router.get("/cuda/status")
async def get_cuda_status() -> dict:
    """Get CUDA toolkit status and capabilities"""
    import subprocess
    
    cuda_available = False
    cuda_version = ""
    gpu_name = ""
    error = ""
    
    try:
        # Check nvidia-smi for GPU info
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(", ")
            gpu_name = parts[0] if len(parts) > 0 else ""
            cuda_available = True
        
        # Check CUDA toolkit version
        result = subprocess.run(
            ["nvcc", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            for line in result.stdout.split("\n"):
                if "release" in line.lower():
                    cuda_version = line.strip()
                    break
    except FileNotFoundError:
        error = "CUDA toolkit not found. Install from https://developer.nvidia.com/cuda-downloads"
    except Exception as e:
        error = str(e)
    
    return {
        "available": cuda_available,
        "gpu_name": gpu_name,
        "cuda_version": cuda_version,
        "error": error,
    }


@router.post("/cuda/analyze")
async def cuda_analyze_audio(request: dict) -> dict:
    """
    Perform CUDA-accelerated audio frequency analysis.
    Returns enhanced frequency data for visualization.
    """
    import numpy as np
    
    audio_url = request.get("audio_url", "")
    if not audio_url:
        raise HTTPException(status_code=400, detail="audio_url required")
    
    try:
        # Try to use CUDA-accelerated FFT via cupy if available
        import cupy as cp
        
        # Download audio data
        import urllib.response
        audio_data = urllib.request.urlopen(audio_url).read()
        
        # Convert to numpy array (simplified - real implementation would decode audio)
        samples = np.frombuffer(audio_data, dtype=np.float32)
        
        # Use CUDA for FFT
        samples_gpu = cp.asarray(samples)
        fft_result = cp.fft.rfft(samples_gpu)
        magnitudes = cp.abs(fft_result)
        
        # Convert back to CPU for response
        magnitudes_cpu = cp.asnumpy(magnitudes)
        
        # Calculate frequency bands
        sample_rate = request.get("sample_rate", 44100)
        freqs = np.fft.rfftfreq(len(samples), 1.0 / sample_rate)
        
        bass_mask = freqs < 250
        mid_mask = (freqs >= 250) & (freqs < 2000)
        treble_mask = freqs >= 2000
        
        bass = float(np.mean(magnitudes_cpu[bass_mask])) if bass_mask.any() else 0
        mid = float(np.mean(magnitudes_cpu[mid_mask])) if mid_mask.any() else 0
        treble = float(np.mean(magnitudes_cpu[treble_mask])) if treble_mask.any() else 0
        
        # Normalize
        max_val = max(bass, mid, treble, 1e-10)
        bass /= max_val
        mid /= max_val
        treble /= max_val
        
        return {
            "source": "cuda",
            "bass": bass,
            "mid": mid,
            "treble": treble,
            "overall": (bass * 0.4 + mid * 0.35 + treble * 0.25),
            "gpu_used": True,
        }
    except ImportError:
        # Fallback to CPU-based analysis
        return {
            "source": "cpu_fallback",
            "bass": 0,
            "mid": 0,
            "treble": 0,
            "overall": 0,
            "gpu_used": False,
            "note": "CUDA not available. Install cupy for GPU acceleration.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CUDA analysis failed: {str(e)}")
