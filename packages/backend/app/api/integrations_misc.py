"""
Integrations API - Miscellaneous routes (CUDA, Track Analysis, System Resources).
"""

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

logger = logging.getLogger(__name__)

# Router without prefix - included by main integrations.py with prefix "/api/integrations"
router = APIRouter(tags=["Integrations-Misc"])


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


class TrackAnalysisRequest(BaseModel):
    """Request for Ollama-powered track analysis"""
    track_name: str
    prompt: str
    lyrics: str
    bpm: int = 120


@router.post("/analyze-track-stream")
async def analyze_track_stream(request: TrackAnalysisRequest):
    """
    Stream Ollama analysis in real-time with progress updates.
    Generates visualization code that can be previewed.
    """
    import aiohttp
    import hashlib
    import json
    
    # Generate track hash for caching
    track_hash = hashlib.md5(f"{request.track_name}{request.prompt}".encode()).hexdigest()
    
    # Check for existing preset
    from ..core.database import (
        get_visualization_preset, save_visualization_preset,
        get_available_ollama_models, get_latest_system_resources
    )
    
    existing = get_visualization_preset(track_hash)
    if existing:
        yield {"type": "cached", "params": existing["params"], "html": existing.get("html", "")}
        return
    
    # Get available models
    resources = get_latest_system_resources()
    vram_free = resources.get("gpu_memory_free", 4000) if resources else 4000
    available_models = get_available_ollama_models(vram_free)
    
    if not available_models:
        yield {"type": "error", "message": "No Ollama models available with sufficient VRAM"}
        return
    
    model_name = available_models[0].get("model_name", "llama3.2:latest")
    
    # Build prompt that generates HTML visualization code
    analysis_prompt = f"""Create a complete standalone HTML visualization for this music track.
Track: {request.track_name}
BPM: {request.bpm}
Prompt: {request.prompt}
Lyrics theme: {request.lyrics}

Generate a complete HTML file with embedded CSS and JavaScript that creates an audio-reactive visualization.
Use Canvas API or Three.js from CDN. The visualization should:
- React to audio frequencies (bass, mid, treble)
- Match the mood and energy of the track
- Be visually stunning and unique
- Include animation loops and smooth transitions

Respond with ONLY the complete HTML code, no explanation."""
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "http://127.0.0.1:11434/api/generate",
                json={
                    "model": model_name,
                    "prompt": analysis_prompt,
                    "stream": True,
                    "options": {"temperature": 0.7}
                },
                timeout=aiohttp.ClientTimeout(total=120)
            ) as resp:
                if resp.status == 200:
                    full_response = ""
                    async for line in resp.content:
                        line_str = line.decode("utf-8").strip()
                        if line_str:
                            try:
                                data = json.loads(line_str)
                                chunk = data.get("response", "")
                                full_response += chunk
                                yield {"type": "streaming", "chunk": chunk, "done": data.get("done", False)}
                            except json.JSONDecodeError:
                                pass
                    
                    # Extract HTML from response
                    html_code = full_response
                    if "```html" in html_code:
                        html_code = html_code.split("```html")[1].split("```")[0]
                    elif "```" in html_code:
                        html_code = html_code.split("```")[1].split("```")[0]
                    
                    # Save to database
                    save_visualization_preset({
                        "track_name": request.track_name,
                        "track_hash": track_hash,
                        "preset_name": f"{request.track_name} (AI)",
                        "visualization_style": "custom",
                        "params": {},
                        "ollama_model": model_name,
                        "prompt": request.prompt,
                        "lyrics": request.lyrics,
                        "bpm": request.bpm,
                        "html": html_code,
                    })
                    
                    yield {"type": "complete", "html": html_code}
                else:
                    yield {"type": "error", "message": f"Ollama returned status {resp.status}"}
    except Exception as e:
        yield {"type": "error", "message": str(e)}
async def analyze_track_with_ollama(request: TrackAnalysisRequest) -> dict:
    """
    Use Ollama to analyze track data and generate visualization parameters.
    Creates dynamic visuals synced with CSV track details for improved pattern matching.
    Includes caching and VRAM-aware model selection.
    """
    import aiohttp
    import hashlib
    
    # Generate track hash for caching
    track_hash = hashlib.md5(f"{request.track_name}{request.prompt}".encode()).hexdigest()
    
    # Check for existing preset in database
    from ..core.database import (
        get_visualization_preset, find_similar_preset, save_visualization_preset,
        get_available_ollama_models, get_latest_system_resources
    )
    
    existing = get_visualization_preset(track_hash)
    if existing:
        return {
            "success": True,
            "source": "cache",
            "params": existing["params"],
            "cached": True,
        }
    
    # Find similar preset to recycle
    similar = find_similar_preset(request.track_name, [], [])
    if similar and similar.get("usage_count", 0) > 2:
        return {
            "success": True,
            "source": "similar",
            "params": similar["params"],
            "cached": True,
        }
    
    # Build analysis prompt for Ollama
    analysis_prompt = f"""Analyze this music track and generate visualization parameters.
Track: {request.track_name}
BPM: {request.bpm}
Prompt: {request.prompt}
Lyrics theme: {request.lyrics}

Based on the mood, genre, energy, and themes, provide visualization parameters as JSON:
{{
  "visualization_style": "geometric|waveform|particles|neural|cosmic|fractal|pulse|storm",
  "scale": 0.5-3.0,
  "scale_boost": 0.5-3.0,
  "rotation_speed": 0.1-5.0,
  "color_shift": 0.0-2.0,
  "glow_intensity": 0.0-1.0,
  "lerp_speed": 0.1-1.0,
  "material_type": "standard|metallic|glass|neon|matte",
  "wireframe": true|false,
  "opacity": 0.1-1.0,
  "shadow_enabled": true|false,
  "reflection_enabled": true|false,
  "particle_count": 0-1000,
  "particle_size": 0.01-0.2,
  "light_intensity": 0.2-3.0,
  "fog_enabled": true|false,
  "fog_density": 0.01-0.1,
  "show_ground": true|false,
  "show_floating_shapes": true|false,
  "show_light_rays": true|false,
  "mood_description": "brief description of detected mood",
  "visual_concept": "description of the visual concept"
}}

Respond with ONLY the JSON object, no explanation."""
    
    try:
        # Get available models with sufficient VRAM
        resources = get_latest_system_resources()
        vram_free = resources.get("gpu_memory_free", 4000) if resources else 4000
        
        available_models = get_available_ollama_models(vram_free)
        
        if not available_models:
            return {
                "success": False,
                "error": "No Ollama models available with sufficient VRAM",
                "source": "fallback",
                "vram_free": vram_free,
            }
        
        # Prefer tool-capable models
        model_name = available_models[0].get("model_name", "llama3.2:latest")
        
        # Call Ollama API
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "http://127.0.0.1:11434/api/generate",
                json={
                    "model": model_name,
                    "prompt": analysis_prompt,
                    "stream": False,
                    "options": {"temperature": 0.7}
                },
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    response_text = result.get("response", "")
                    
                    # Parse JSON from response
                    import json
                    json_str = response_text
                    if "```json" in json_str:
                        json_str = json_str.split("```json")[1].split("```")[0]
                    elif "```" in json_str:
                        json_str = json_str.split("```")[1].split("```")[0]
                    
                    params = json.loads(json_str.strip())
                    
                    # Save to database for future reuse
                    save_visualization_preset({
                        "track_name": request.track_name,
                        "track_hash": track_hash,
                        "preset_name": f"{request.track_name} (AI)",
                        "visualization_style": params.get("visualization_style", "geometric"),
                        "params": params,
                        "ollama_model": model_name,
                        "prompt": request.prompt,
                        "lyrics": request.lyrics,
                        "bpm": request.bpm,
                    })
                    
                    return {
                        "success": True,
                        "source": "ollama",
                        "params": params,
                        "model_used": model_name,
                        "cached": False,
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Ollama returned status {resp.status}",
                        "source": "fallback"
                    }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "source": "fallback"
        }

@router.get("/ollama-models")
async def get_ollama_models_misc() -> dict:
    """List Ollama models via adapter (fixes decorator bug where GET /ollama-models was bound to cuda_analyze)."""
    from ..adapters.registry import adapter_registry as _reg
    adapter = _reg.get("ollama")
    if not adapter:
        raise HTTPException(status_code=404, detail="Ollama not available")
    models = await adapter.list_models()
    return {"models": models}

@router.post("/cuda/analyze-audio")
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
        import urllib.request
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
