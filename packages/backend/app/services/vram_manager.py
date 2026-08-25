"""
VRAM Manager - GPU Memory Orchestration Service

Manages GPU memory by coordinating between Ollama (LLM inference) and ComfyUI (3D generation).
Prevents OOM errors by offloading Ollama models when ComfyUI needs VRAM for rendering.

Strategy:
- Ollama models stay loaded for fast inference
- When 3D generation starts, Ollama models are offloaded to CPU
- When 3D generation completes, Ollama models are reloaded to GPU
- VRAM threshold checks prevent OOM by triggering early offload
"""

from __future__ import annotations

import asyncio
import logging
import time
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class GPUWorkload(str, Enum):
    """Types of GPU workloads"""
    IDLE = "idle"
    LLM_INFERENCE = "llm_inference"
    RENDER_3D = "render_3d"
    IMAGE_GENERATION = "image_generation"


class GPUState(str, Enum):
    """States of GPU resource allocation"""
    AVAILABLE = "available"
    BUSY = "busy"
    CRITICAL = "critical"


class VRAMManager:
    """
    Manages GPU VRAM allocation between competing workloads.
    
    Coordinates Ollama and ComfyUI to prevent OOM errors by:
    1. Monitoring VRAM usage in real-time
    2. Offloading Ollama models when 3D rendering starts
    3. Reloading Ollama models when rendering completes
    """

    def __init__(self):
        self._current_workload: GPUWorkload = GPUWorkload.IDLE
        self._ollama_loaded: bool = True
        self._comfyui_busy: bool = False
        self._lock = asyncio.Lock()
        self._nvml_available = False
        self._gpustat_available = False

        # Thresholds for GTX 1070 Ti (8GB VRAM)
        self.thresholds = {
            "vram_warning": 85.0,      # Start considering offload
            "vram_critical": 92.0,     # Must offload immediately
            "vram_available": 50.0,    # Safe to reload Ollama
        }

        # Minimum free VRAM needed for 3D generation (in MB)
        self.MIN_VRAM_FOR_3D = 4000  # 4GB for Hunyuan3D-2mini

        self._init_gpu_monitoring()

    def _init_gpu_monitoring(self):
        """Initialize GPU monitoring libraries."""
        try:
            import gpustat
            self._gpustat_available = True
            logger.info("VRAM Manager: GPU monitoring enabled via gpustat")
        except ImportError:
            pass

        try:
            import pynvml
            pynvml.nvmlInit()
            self._nvml_available = True
            if not self._gpustat_available:
                logger.info("VRAM Manager: GPU monitoring enabled via pynvml")
        except (ImportError, Exception) as e:
            if not self._gpustat_available:
                logger.warning("VRAM Manager: GPU monitoring not available: %s", e)

    @property
    def current_workload(self) -> GPUWorkload:
        """Get current GPU workload type."""
        return self._current_workload

    @property
    def ollama_loaded(self) -> bool:
        """Check if Ollama models are currently loaded on GPU."""
        return self._ollama_loaded

    async def get_vram_status(self) -> dict[str, Any]:
        """Get current VRAM usage statistics."""
        if not self._gpustat_available and not self._nvml_available:
            return {"available": False}

        try:
            if self._gpustat_available:
                return await self._get_vram_gpustat()
            elif self._nvml_available:
                return await self._get_vram_nvml()
        except Exception as e:
            logger.warning("Failed to get VRAM status: %s", e)

        return {"available": False}

    async def _get_vram_gpustat(self) -> dict[str, Any]:
        """Get VRAM stats via gpustat."""
        import gpustat
        stats = gpustat.new_query()
        if not stats.gpus:
            return {"available": False}

        gpu = stats.gpus[0]
        total_mb = gpu.memory.total
        used_mb = gpu.memory.used
        free_mb = gpu.memory.free
        percent = (used_mb / total_mb) * 100 if total_mb > 0 else 0

        return {
            "available": True,
            "total_mb": total_mb,
            "used_mb": used_mb,
            "free_mb": free_mb,
            "percent": round(percent, 1),
            "gpu_utilization": gpu.utilization,
            "temperature": gpu.temperature,
            "state": self._determine_state(percent),
        }

    async def _get_vram_nvml(self) -> dict[str, Any]:
        """Get VRAM stats via pynvml."""
        import pynvml
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)

        total_mb = info.total / (1024 * 1024)
        used_mb = info.used / (1024 * 1024)
        free_mb = info.free / (1024 * 1024)
        percent = (used_mb / total_mb) * 100 if total_mb > 0 else 0

        return {
            "available": True,
            "total_mb": int(total_mb),
            "used_mb": int(used_mb),
            "free_mb": int(free_mb),
            "percent": round(percent, 1),
            "gpu_utilization": util.gpu,
            "temperature": int(temp),
            "state": self._determine_state(percent),
        }

    def _determine_state(self, percent: float) -> str:
        """Determine GPU state based on VRAM usage percentage."""
        if percent >= self.thresholds["vram_critical"]:
            return GPUState.CRITICAL.value
        elif percent >= self.thresholds["vram_warning"]:
            return GPUState.BUSY.value
        return GPUState.AVAILABLE.value

    async def begin_3d_generation(self) -> dict[str, Any]:
        """
        Signal that 3D generation is starting.
        Offloads Ollama models if necessary to free VRAM.
        
        Returns:
            Dict with status and actions taken
        """
        async with self._lock:
            logger.info("VRAM Manager: 3D generation starting")
            self._current_workload = GPUWorkload.RENDER_3D
            self._comfyui_busy = True

            vram = await self.get_vram_status()
            actions = []

            # Check if we need to offload Ollama
            if self._ollama_loaded:
                free_mb = vram.get("free_mb", 0)
                if free_mb < self.MIN_VRAM_FOR_3D:
                    logger.info("VRAM Manager: Freeing VRAM by offloading Ollama models "
                                "(free=%dMB, need=%dMB)", free_mb, self.MIN_VRAM_FOR_3D)
                    offload_result = await self._unload_ollama_models()
                    actions.append(offload_result)

            return {
                "success": True,
                "vram_before": vram,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
            }

    async def end_3d_generation(self) -> dict[str, Any]:
        """
        Signal that 3D generation is complete.
        Reloads Ollama models if they were offloaded.
        
        Returns:
            Dict with status and actions taken
        """
        async with self._lock:
            logger.info("VRAM Manager: 3D generation complete")
            self._current_workload = GPUWorkload.IDLE
            self._comfyui_busy = False

            vram = await self.get_vram_status()
            actions = []

            # Reload Ollama if it was offloaded
            if not self._ollama_loaded:
                free_mb = vram.get("free_mb", 0)
                if free_mb > self.MIN_VRAM_FOR_3D:
                    logger.info("VRAM Manager: Reloading Ollama models (free=%dMB)", free_mb)
                    reload_result = await self._reload_ollama_models()
                    actions.append(reload_result)
                else:
                    logger.warning("VRAM Manager: Not enough VRAM to reload Ollama "
                                   "(free=%dMB, need=%dMB)", free_mb, self.MIN_VRAM_FOR_3D)

            return {
                "success": True,
                "vram_after": vram,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
            }

    async def _unload_ollama_models(self) -> dict[str, Any]:
        """
        Unload Ollama models from GPU to free VRAM.
        This sends a request to Ollama to unload the model.
        """
        try:
            import urllib.request
            # Ollama API: POST /api/generate with keep_alive=0 unloads the model
            req = urllib.request.Request(
                "http://127.0.0.1:11434/api/generate",
                data=b'{"model":"","prompt":"","keep_alive":0}',
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            # Don't wait for response - just trigger unload
            # Use a short timeout since we don't need the response
            try:
                with urllib.request.urlopen(req, timeout=5):
                    pass
            except Exception:
                pass  # Timeout is expected since we're unloading

            self._ollama_loaded = False
            logger.info("VRAM Manager: Ollama models offloaded from GPU")
            return {"action": "offload_ollama", "success": True}

        except Exception as e:
            logger.error("VRAM Manager: Failed to offload Ollama: %s", e)
            return {"action": "offload_ollama", "success": False, "error": str(e)}

    async def _reload_ollama_models(self) -> dict[str, Any]:
        """
        Reload Ollama models to GPU.
        This sends a request to Ollama to load the model back.
        """
        try:
            import urllib.request
            import json

            # Get the last used model from Ollama adapter
            from ..adapters.ollama import ollama_adapter
            last_model = getattr(ollama_adapter, '_last_model', 'qwen3.5:4b')

            # Ollama API: POST /api/generate with keep_alive=-1 loads model permanently
            data = json.dumps({
                "model": last_model,
                "prompt": " ",
                "keep_alive": -1
            }).encode()

            req = urllib.request.Request(
                "http://127.0.0.1:11434/api/generate",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urllib.request.urlopen(req, timeout=120) as resp:
                # Read the response to ensure model is loaded
                resp.read()

            self._ollama_loaded = True
            logger.info("VRAM Manager: Ollama models reloaded to GPU (model=%s)", last_model)
            return {"action": "reload_ollama", "success": True, "model": last_model}

        except Exception as e:
            logger.error("VRAM Manager: Failed to reload Ollama: %s", e)
            return {"action": "reload_ollama", "success": False, "error": str(e)}

    async def check_and_prevent_oom(self) -> dict[str, Any] | None:
        """
        Check VRAM and take action if OOM is imminent.
        Called periodically by resource monitor.
        
        Returns:
            Action dict if intervention needed, None if OK
        """
        vram = await self.get_vram_status()
        if not vram.get("available"):
            return None

        percent = vram.get("percent", 0)
        state = vram.get("state", GPUState.AVAILABLE.value)

        if state == GPUState.CRITICAL.value and self._ollama_loaded:
            # Critical VRAM - offload Ollama immediately
            logger.warning("VRAM Manager: CRITICAL VRAM (%.1f%%) - emergency offload", percent)
            result = await self._unload_ollama_models()
            return {
                "action": "emergency_offload",
                "vram_percent": percent,
                "result": result,
            }

        return None

    def get_status(self) -> dict[str, Any]:
        """Get VRAM manager status."""
        return {
            "current_workload": self._current_workload.value,
            "ollama_loaded": self._ollama_loaded,
            "comfyui_busy": self._comfyui_busy,
            "nvml_available": self._nvml_available,
            "gpustat_available": self._gpustat_available,
            "thresholds": self.thresholds,
            "min_vram_for_3d_mb": self.MIN_VRAM_FOR_3D,
        }


# Global VRAM manager singleton
vram_manager = VRAMManager()
