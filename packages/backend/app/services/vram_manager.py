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
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from enum import Enum
from typing import Any

from ..core.urls import comfyui_url, ollama_url

logger = logging.getLogger(__name__)


class GPUWorkload(str, Enum):
    """Types of GPU workloads"""
    IDLE = "idle"
    LLM_INFERENCE = "llm_inference"
    RENDER_3D = "render_3d"
    IMAGE_GENERATION = "image_generation"
    MUSIC_GENERATION = "music_generation"
    AUDIO_ANALYSIS = "audio_analysis"
    LIPSYNC = "lipsync"


class GPUState(str, Enum):
    """States of GPU resource allocation"""
    AVAILABLE = "available"
    BUSY = "busy"
    CRITICAL = "critical"


#: Set by `set_last_model_provider`. Answers "which model did Ollama last
#: load?" without this module importing `adapters.ollama` - that import closed
#: the last cycle in the codebase:
#:   services.vram_manager -> adapters.ollama -> queue.manager
#:   -> diagnostics.resources -> services.vram_manager
#: It was open 4 times as a deferred import, each also re-reading a *private*
#: attribute (`_last_model`) across a module boundary and re-implementing the
#: same "llama" sanitisation. Wired once in `main.py`.
_LAST_MODEL_PROVIDER: Callable[[], str | None] | None = None


def set_last_model_provider(provider: Callable[[], str | None] | None) -> None:
    """Register the source of "last loaded Ollama model"."""
    global _LAST_MODEL_PROVIDER
    _LAST_MODEL_PROVIDER = provider


#: Set by `set_last_atomic_chat_model_provider`. Answers "which model did
#: Atomic Chat last load into VRAM?" Atomic Chat is a separate desktop app
#: that wraps Ollama on port 1337; it loads its own model (e.g. qwen3.5) into
#: the same 8 GB VRAM that Ollama uses. Without tracking this, the VRAM
#: manager can offload Ollama's model while Atomic Chat's qwen3.5 stays
#: resident, then reload Ollama's model on top -- OOM on an 8 GB card.
#: Wired once in `main.py`, same composition-root pattern as above.
_LAST_ATOMIC_CHAT_MODEL_PROVIDER: Callable[[], str | None] | None = None


#: Cache of what Ollama's /api/ps actually reports as resident, refreshed on
#: every verification.  The boolean flags (_ollama_loaded, _atomic_chat_loaded)
#: can drift from reality (e.g. startup unloads Ollama but never flips the flag,
#: or an external process unloads a model).  Always verify against /api/ps
#: before making load/unload decisions on an 8 GB card where a wrong assumption
#: means a 10.8 GB OOM.
_resident_cache: list[str] = []
_resident_cache_ts: float = 0.0
_RESIDENT_CACHE_TTL_S = 2.0


async def _fetch_resident_models() -> list[str]:
    """Return model names Ollama actually has resident on the GPU right now.

    Never raises: network/parse errors return an empty list and leave the
    cache untouched.  Results are cached for _RESIDENT_CACHE_TTL_S to avoid
    hammering /api/ps on every call.
    """
    import time
    global _resident_cache, _resident_cache_ts
    now = time.monotonic()
    if now - _resident_cache_ts < _RESIDENT_CACHE_TTL_S and _resident_cache:
        return list(_resident_cache)
    try:
        import urllib.request
        req = urllib.request.Request(ollama_url("/api/ps"))
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        models = [m.get("name", "") for m in (data.get("models") or []) if m.get("name")]
        _resident_cache = models
        _resident_cache_ts = now
        return models
    except Exception:
        return []


def _base_name(name: str) -> str:
    """Strip quant suffix and lowercase for model-name comparison."""
    return str(name or "").split(":")[0].lower()


def set_last_atomic_chat_model_provider(
    provider: Callable[[], str | None] | None
) -> None:
    """Register the source of "last loaded Atomic Chat model"."""
    global _LAST_ATOMIC_CHAT_MODEL_PROVIDER
    _LAST_ATOMIC_CHAT_MODEL_PROVIDER = provider


def _resolve_ollama_model(default_model: str) -> str:
    """Resolve and sanitize the last Ollama model name.

    If the last model is a llama variant that isn't the default, fall back to
    the default. Keeps the reload call sites flat (no extra if inside try).
    """
    last_model = _resolve_last_model(default_model)
    if "llama" in last_model.lower() and last_model != default_model:
        last_model = default_model
    return last_model


def _resolve_last_model(default: str | None) -> str | None:
    """Last loaded Ollama model, or `default` when unknown/unavailable.

    Never raises: a missing or broken provider must not stop a VRAM reload, so
    failures fall back to the default rather than propagating.
    """
    if _LAST_MODEL_PROVIDER is None:
        return default
    try:
        value = _LAST_MODEL_PROVIDER()
    except Exception as exc:
        logger.debug("last-model provider unavailable: %s", exc)
        return default
    return value or default


def _resolve_atomic_chat_model(default: str | None) -> str | None:
    """Last loaded Atomic Chat model, or `default` when unknown/unavailable.

    Same contract as `_resolve_last_model` but for Atomic Chat's model.
    """
    if _LAST_ATOMIC_CHAT_MODEL_PROVIDER is None:
        return default
    try:
        value = _LAST_ATOMIC_CHAT_MODEL_PROVIDER()
    except Exception as exc:
        logger.debug("atomic-chat model provider unavailable: %s", exc)
        return default
    return value or default


class VRAMManager:
    """
    Manages GPU VRAM allocation between competing workloads.
    Coordinates Ollama and ComfyUI to prevent OOM errors by:
    1. Monitoring VRAM usage in real-time
    2. Offloading Ollama models when 3D rendering starts
    3. Reloading Ollama models when rendering completes
    """

    _atomic_chat_loaded: bool = False

    def __init__(self):
        self._current_workload: GPUWorkload = GPUWorkload.IDLE
        # Ollama is optional — start with _ollama_loaded=False. It will be set
        # to True only after sync_resident_state() confirms a model is actually
        # resident via /api/ps. The app works fine without Ollama running.
        self._ollama_loaded: bool = False
        self._atomic_chat_loaded: bool = False
        self._comfyui_busy: bool = False
        # Whether ComfyUI is believed to hold loaded models on the GPU. Tracked
        # separately from `_comfyui_busy`, which means "a prompt is running" --
        # ComfyUI is idle-but-resident most of the time and still holds ~5 GB.
        self._comfyui_models_loaded: bool = True
        self._music_gen_running: bool = False
        self._audio_analysis_running: bool = False
        self._lipsync_running: bool = False
        self._lock = asyncio.Lock()
        self._nvml_available = False
        self._gpustat_available = False
        # Optional async callable returning queued jobs, injected at startup so
        # VRAM accounting does not import `queue` (which would re-create the
        # cycle documented in `_queued_reservation_mb`). None means "no queue
        # view available", which under-counts and warns early rather than
        # over-committing.
        self._queue_provider: Callable[[], Awaitable[list[Any]]] | None = None
        self._init_thresholds()

    async def sync_resident_state(self) -> None:
        """Reconcile _ollama_loaded / _atomic_chat_loaded with /api/ps reality.

        Call before any load/unload decision so the manager never assumes a
        model is resident when it isn't (or vice versa).  On an 8 GB card a
        wrong assumption means a ~10.8 GB OOM (gemma4 ~6 GB + qwen3.5 ~4.8 GB).
        """
        resident = await _fetch_resident_models()
        names = {_base_name(m) for m in resident}
        self._ollama_loaded = any(
            n.startswith(("gemma4", "llama")) for n in names
        )
        self._atomic_chat_loaded = any(
            n.startswith("qwen3") or "qwen3_5" in n for n in names
        )

    def set_queue_provider(
        self, provider: Callable[[], Awaitable[list[Any]]] | None
    ) -> None:
        """Register the source of queued jobs for VRAM reservation accounting.

        Wired once in `main.py`, the composition root. Tests can inject a stub
        without constructing a real queue.
        """
        self._queue_provider = provider

    async def _queued_jobs(self) -> list[Any]:
        if self._queue_provider is None:
            return []
        return await self._queue_provider()

    def _init_thresholds(self) -> None:
        # Thresholds for GTX 1070 Ti (8GB VRAM)
        self.thresholds = {
            "vram_warning": 85.0,      # Start considering offload
            "vram_critical": 92.0,     # Must offload immediately
            "vram_available": 50.0,    # Safe to reload Ollama
        }

        # Minimum free VRAM needed for 3D generation (in MB)
        self.MIN_VRAM_FOR_3D = 4000  # 4GB for Hunyuan3D-2mini
        # Minimum free VRAM needed for music generation (in MB)
        # ACE-Step 1.5 Tier 3 on GTX 1070 Ti: 2B turbo DiT + 0.6B LM, INT8, CPU offload
        self.MIN_VRAM_FOR_MUSIC = 6144
        # Minimum free VRAM for the CUDA audio spectral pass.
        # Measured 0.3s on the GPU against ~92s CPU-bound on this card, so the
        # offload is worth far more here per second spent than for other
        # workloads. 1200 MB is the measured peak of one STFT plus its feature
        # stack on a full track, with headroom; Ollama holds ~1573 MB, which is
        # what pushes an 8 GB card over without this.
        self.MIN_VRAM_FOR_AUDIO = 1200
        # Minimum free VRAM for local lip-sync (MuseTalk v1.5, D42).
        # Official 4GB minimum; 256px face crop keeps it well under 8GB.
        self.MIN_VRAM_FOR_LIPSYNC = 4096

        # Safety margins for system stability
        # Don't offload to CPU if system RAM is below this threshold
        self.MIN_SYSTEM_RAM_FOR_OFFLOAD = 4096  # 4GB free RAM required
        # Maximum system RAM usage percentage for safe offload
        self.MAX_SYSTEM_RAM_PERCENT = 75.0
        # Wait up to this long for VRAM to free up naturally
        self.VRAM_WAIT_TIMEOUT = 120  # 2 minutes
        # Poll interval when waiting
        self.VRAM_POLL_INTERVAL = 5  # 5 seconds
        self._init_gpu_monitoring()

    def _init_gpu_monitoring(self):
        """Initialize GPU monitoring libraries."""
        try:
            import gpustat  # noqa: F401  # availability probe, not used directly
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
        except Exception as e:
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
        # Try gpustat / NVML first
        if self._gpustat_available or self._nvml_available:
            try:
                if self._gpustat_available:
                    return await self._get_vram_gpustat()
                elif self._nvml_available:
                    return await self._get_vram_nvml()
            except Exception as e:
                logger.warning("Failed to get VRAM status via gpustat/nvml: %s", e)

        # Fallback: torch.cuda (works on WDDM/system python without NVSMI dll)
        try:
            import torch

            if torch.cuda.is_available():
                free, total = torch.cuda.mem_get_info(0)
                used = total - free
                percent = (used / total) * 100 if total else 0
                props = torch.cuda.get_device_properties(0)
                try:
                    temp = 0
                    util = 0
                    import pynvml as _pynvml

                    try:
                        _pynvml.nvmlInit()
                        h = _pynvml.nvmlDeviceGetHandleByIndex(0)
                        temp = _pynvml.nvmlDeviceGetTemperature(h, _pynvml.NVML_TEMPERATURE_GPU)
                        util = _pynvml.nvmlDeviceGetUtilizationRates(h).gpu
                    except Exception:
                        pass
                except Exception:
                    temp = 0
                    util = 0
                return {
                    "available": True,
                    "total_mb": int(total // (1024 * 1024)),
                    "used_mb": int(used // (1024 * 1024)),
                    "free_mb": int(free // (1024 * 1024)),
                    "percent": round(percent, 1),
                    "gpu_utilization": util,
                    "temperature": temp,
                    "state": self._determine_state(percent),
                    "fallback": "torch.cuda",
                    "name": props.name,
                }
        except Exception as e:
            logger.debug(f"torch.cuda fallback failed: {e}")

        return {"available": False}

    def _get_vram_gpustat_sync(self) -> dict[str, Any]:
        """Get VRAM stats via gpustat (sync version for asyncio.to_thread)."""
        import gpustat

        stats = gpustat.new_query()
        if not stats.gpus:
            return {"available": False}

        gpu = stats.gpus[0]
        if hasattr(gpu, "memory_total"):
            total_mb = gpu.memory_total
            used_mb = gpu.memory_used
            free_mb = gpu.memory_free
        elif hasattr(gpu, "memory") and hasattr(gpu.memory, "total"):
            total_mb = gpu.memory.total
            used_mb = gpu.memory.used
            free_mb = gpu.memory.free
        elif isinstance(getattr(gpu, "entry", None), dict):
            total_mb = int(gpu.entry.get("memory.total", 0))
            used_mb = int(gpu.entry.get("memory.used", 0))
            free_mb = int(gpu.entry.get("memory.total", 0)) - used_mb
        else:
            return {"available": False}
        percent = (used_mb / total_mb) * 100 if total_mb > 0 else 0

        return {
            "available": True,
            "total_mb": int(total_mb),
            "used_mb": int(used_mb),
            "free_mb": int(free_mb),
            "percent": round(percent, 1),
            "gpu_utilization": getattr(gpu, "utilization", 0) or 0,
            "temperature": getattr(gpu, "temperature", 0) or 0,
            "state": self._determine_state(percent),
        }

    def _get_vram_nvml_sync(self) -> dict[str, Any]:
        """Get VRAM stats via pynvml (sync version for asyncio.to_thread)."""
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

    async def _get_vram_gpustat(self) -> dict[str, Any]:
        """Get VRAM stats via gpustat."""
        return await asyncio.to_thread(self._get_vram_gpustat_sync)

    async def _get_vram_nvml(self) -> dict[str, Any]:
        """Get VRAM stats via pynvml."""
        return await asyncio.to_thread(self._get_vram_nvml_sync)

    def _determine_state(self, percent: float) -> str:
        """Determine GPU state based on VRAM usage percentage."""
        if percent >= self.thresholds["vram_critical"]:
            return GPUState.CRITICAL.value
        elif percent >= self.thresholds["vram_warning"]:
            return GPUState.BUSY.value
        return GPUState.AVAILABLE.value

    async def preflight_check(self, required_mb: int = 4096) -> dict[str, Any]:
        """Advisory, read-only VRAM availability check.

        Unlike :meth:`begin_3d_generation` this never marks ComfyUI busy and
        never sets the workload state, so request handlers that only want to
        warn the user before enqueuing work can call it without a matching
        :meth:`end_3d_generation` (or :meth:`end_music_generation`) cleanup call.

        When free VRAM is below ``required_mb`` the Ollama models are offloaded
        as a courtesy and ``_ollama_loaded`` is updated so a later
        :meth:`end_3d_generation` (or the next 3D render / music generation)
        restores them.

        Returns:
            Dict with ``available``, ``free_mb``, ``total_mb``, ``required_mb``,
            ``offloaded`` and ``message``.
        """
        status = await self.get_vram_status()
        if not status.get("available"):
            return {
                "available": True,
                "free_mb": 0,
                "total_mb": 0,
                "required_mb": required_mb,
                "offloaded": False,
                "message": "VRAM monitoring unavailable -- proceeding",
            }

        free_mb = status.get("free_mb", status.get("memory_free_mb", 0))
        total_mb = status.get("total_mb", status.get("memory_total_mb", 0))
        result: dict[str, Any] = {
            "available": True,
            "free_mb": free_mb,
            "total_mb": total_mb,
            "required_mb": required_mb,
            "offloaded": False,
            "message": f"VRAM OK: {free_mb}MB free of {total_mb}MB",
        }

        if free_mb >= required_mb:
            return result

        # Not enough VRAM -- offload backend models as a courtesy before reporting failure.
        try:
            ollama_unloaded = await _unload_ollama_models()
            ac_unloaded = await _unload_atomic_chat_models()
        except Exception as exc:
            logger.warning("VRAM Manager: preflight offload failed: %s", exc)
            ollama_unloaded = []
            ac_unloaded = []

        if ollama_unloaded or ac_unloaded:
            # Truthful flag: the models really are unloaded now, so a later
            # end_3d_generation() (or the next 3D render) restores them.
            self._ollama_loaded = False
            self._atomic_chat_loaded = False
            result["offloaded"] = True
            result["models"] = {
                "ollama": ollama_unloaded,
                "atomic_chat": ac_unloaded,
            }
            recheck = await self.get_vram_status()
            result["free_mb"] = recheck.get(
                "free_mb", recheck.get("memory_free_mb", result["free_mb"])
            )
            if result["free_mb"] >= required_mb:
                result["message"] = "Offloaded backend models to free VRAM"
                return result

        result["available"] = False
        result["message"] = (
            f"Insufficient VRAM: {result['free_mb']}MB free, {required_mb}MB required"
        )
        return result

    async def begin_3d_generation(self) -> dict[str, Any]:
        """
        Signal that 3D generation is starting.
        Strategy (in order of preference):
        1. If enough VRAM free - proceed immediately
        2. Wait for VRAM to free up naturally (timeout)
        3. If system RAM is sufficient - offload Ollama to CPU
        4. If neither is safe - return error with guidance
        Returns:
            Dict with status and actions taken
        """
        async with self._lock:
            logger.info("VRAM Manager: 3D generation starting")
            self._current_workload = GPUWorkload.RENDER_3D
            self._comfyui_busy = True

            # Reconcile resident flags with /api/ps before offload decisions.
            await self.sync_resident_state()

            vram = await self.get_vram_status()
            actions = []

            # Check if we have enough VRAM
            free_mb = vram.get("free_mb", 0)
            if free_mb >= self.MIN_VRAM_FOR_3D:
                logger.info("VRAM Manager: Sufficient VRAM available (%dMB free)", free_mb)
                return {
                    "success": True,
                    "vram_before": vram,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }

        # Not enough VRAM - wait for natural cleanup.
        #
        # Deliberately OUTSIDE self._lock. This wait can run for up to
        # VRAM_WAIT_TIMEOUT (120s), and the same lock guards the begin/end of
        # every other workload (audio analysis, music generation, and each of
        # their completion handlers). Waiting while holding it blocked all of
        # them for the full timeout on nothing but a GPU-memory condition - a
        # bookkeeping call like begin_audio_analysis() sat blocked behind a
        # 3D request's patience. The lock protects the bookkeeping fields above;
        # a poll loop that only reads VRAM does not need it.
        logger.info("VRAM Manager: Low VRAM (%dMB free), waiting for cleanup...", free_mb)
        waited = await self._wait_for_vram()

        async with self._lock:
            if waited:
                vram = await self.get_vram_status()
                actions.append({"action": "wait_for_vram", "success": True})
                return {
                    "success": True,
                    "vram_before": vram,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }

            # Still not enough VRAM - check if we can safely offload to CPU
            if (self._ollama_loaded or getattr(self, "_atomic_chat_loaded", False)) and self._can_safely_offload():
                logger.info("VRAM Manager: Offloading backend models to CPU (system RAM sufficient)")
                ollama_unloaded = await _unload_ollama_models()
                ac_unloaded = await _unload_atomic_chat_models()
                self._ollama_loaded = False
                self._atomic_chat_loaded = False
                offload_result = {
                    "action": "offload_backend_models",
                    "success": True,
                    "models": {
                        "ollama": ollama_unloaded,
                        "atomic_chat": ac_unloaded,
                    },
                }
                actions.append(offload_result)
                vram = await self.get_vram_status()
                return {
                    "success": True,
                    "vram_before": vram,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }

            # Cannot safely proceed
            logger.warning("VRAM Manager: Cannot safely start 3D generation")
            self._comfyui_busy = False
            self._current_workload = GPUWorkload.IDLE
            return {
                "success": False,
                "error": "Insufficient VRAM and cannot safely offload backend models",
                "vram": vram,
                "guidance": "Close other GPU applications or wait for current tasks to complete",
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }

    async def _wait_for_vram(self) -> bool:
        """
        Wait for VRAM to free up naturally.
        Returns True if enough VRAM became available, False if timeout.
        """
        import asyncio
        start = time.monotonic()
        while True:
            # Check before sleeping, not after. Sleeping first charged the full
            # poll interval to every outcome - including the common one where
            # VRAM is already free and the loop should return immediately, and
            # including the timeout, which overshot its own budget by up to
            # VRAM_POLL_INTERVAL.
            vram = await self.get_vram_status()
            if vram.get("free_mb", 0) >= self.MIN_VRAM_FOR_3D:
                logger.info("VRAM Manager: VRAM freed up naturally (%dMB free)",
                            vram.get("free_mb", 0))
                return True
            remaining = self.VRAM_WAIT_TIMEOUT - (time.monotonic() - start)
            if remaining <= 0:
                break
            # Do not sleep past the deadline.
            await asyncio.sleep(min(self.VRAM_POLL_INTERVAL, remaining))
        logger.info("VRAM Manager: Timeout waiting for VRAM cleanup")
        return False

    def _can_safely_offload(self) -> bool:
        """
        Check if it's safe to offload Ollama models to CPU.
        Considers system RAM availability to prevent system instability.
        """
        try:
            import psutil
            mem = psutil.virtual_memory()
            free_mb = mem.available / (1024 * 1024)
            used_percent = mem.percent

            # Need enough free RAM for Ollama model (typically 3-7GB)
            if free_mb < self.MIN_SYSTEM_RAM_FOR_OFFLOAD:
                logger.info("VRAM Manager: Cannot offload - insufficient system RAM "
                            "(free=%dMB, need=%dMB)", int(free_mb), self.MIN_SYSTEM_RAM_FOR_OFFLOAD)
                return False

            # Don't offload if system RAM is already heavily used
            if used_percent > self.MAX_SYSTEM_RAM_PERCENT:
                logger.info("VRAM Manager: Cannot offload - system RAM too high (%.1f%%)",
                            used_percent)
                return False

            logger.info("VRAM Manager: Safe to offload (RAM free=%dMB, usage=%.1f%%)",
                        int(free_mb), used_percent)
            return True

        except Exception as e:
            logger.warning("VRAM Manager: Error checking system RAM: %s", e)
            return False

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
                    # Get the last used model from Ollama adapter; sanitize to default if contaminated
                    from ..core.config import config as _cfg2
                    last_model = _resolve_last_model(_cfg2.default_model)
                    if "llama" in last_model.lower() and last_model != _cfg2.default_model:
                        logger.info("VRAM Manager: _last_model %s not default, using %s instead", last_model, _cfg2.default_model)
                        last_model = _cfg2.default_model
                    reload_ok = await _reload_ollama_models(last_model)
                    self._ollama_loaded = reload_ok
                    reload_result = {"action": "reload_ollama", "success": reload_ok, "model": last_model}
                    actions.append(reload_result)
                else:
                    logger.warning("VRAM Manager: Not enough VRAM to reload Ollama "
                                   "(free=%dMB, need=%dMB)", free_mb, self.MIN_VRAM_FOR_3D)

            # Reload Atomic Chat model if it was offloaded
            if not self._atomic_chat_loaded:
                last_ac_model = _resolve_atomic_chat_model(None)
                if last_ac_model:
                    free_mb = vram.get("free_mb", 0)
                    if free_mb > self.MIN_VRAM_FOR_3D:
                        logger.info(
                            "VRAM Manager: Reloading Atomic Chat model %s "
                            "(free=%dMB)", last_ac_model, free_mb
                        )
                        reload_ok = await _load_model_for_backend(
                            "atomic_chat", last_ac_model
                        )
                        self._atomic_chat_loaded = reload_ok
                        actions.append({
                            "action": "reload_atomic_chat",
                            "success": reload_ok,
                            "model": last_ac_model,
                        })

            return {
                "success": True,
                "vram_after": vram,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }

    async def begin_music_generation(self, engine: str = "ace",
                                     vram_budget_mb: int = 6144) -> dict[str, Any]:
        """
        Signal that music generation is starting.
        Offloads Ollama and ComfyUI (if idle) if VRAM is tight.

        Args:
            engine: Engine name ("ace") for logging
            vram_budget_mb: Required VRAM in MB for this engine

        Returns:
            Dict with status and actions taken
        """
        async with self._lock:
            logger.info("VRAM Manager: Music generation starting (engine=%s, need=%dMB)",
                        engine, vram_budget_mb)
            self._current_workload = GPUWorkload.MUSIC_GENERATION
            self._music_gen_running = True

            # Reconcile resident flags with /api/ps before offload decisions.
            await self.sync_resident_state()

            vram = await self.get_vram_status()
            actions = []

            # Check if we have enough VRAM
            free_mb = vram.get("free_mb", 0)
            if free_mb >= vram_budget_mb:
                logger.info("VRAM Manager: Sufficient VRAM for music gen (%dMB free)", free_mb)
                return {
                    "success": True,
                    "vram_before": vram,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }

        # Not enough VRAM - wait for natural cleanup.
        #
        # Deliberately OUTSIDE self._lock. This wait can run for up to
        # VRAM_WAIT_TIMEOUT (120s), and the same lock guards the begin/end of
        # every other workload (3D generation, audio analysis, lipsync, and
        # their completion handlers). Waiting while holding it blocked all of
        # them for the full timeout on nothing but a GPU-memory condition.
        logger.info("VRAM Manager: Low VRAM (%dMB free), waiting for cleanup...", free_mb)
        waited = await self._wait_for_vram()

        async with self._lock:
            if waited:
                vram = await self.get_vram_status()
                actions.append({"action": "wait_for_vram", "success": True})
                free_mb = vram.get("free_mb", 0)
                if free_mb >= vram_budget_mb:
                    logger.info("VRAM Manager: VRAM freed up naturally (%dMB free)", free_mb)
                    return {
                        "success": True,
                        "vram_before": vram,
                        "actions": actions,
                        "ollama_loaded": self._ollama_loaded,
                        "atomic_chat_loaded": self._atomic_chat_loaded,
                    }

            # Still not enough VRAM - offload both backend models
            if (self._ollama_loaded or getattr(self, "_atomic_chat_loaded", False)) and self._can_safely_offload():
                logger.info("VRAM Manager: Offloading backend models for music generation")
                ollama_unloaded = await _unload_ollama_models()
                ac_unloaded = await _unload_atomic_chat_models()
                self._ollama_loaded = False
                self._atomic_chat_loaded = False
                actions.append({
                    "action": "offload_backend_models",
                    "success": True,
                    "models": {
                        "ollama": ollama_unloaded,
                        "atomic_chat": ac_unloaded,
                    },
                })
                vram = await self.get_vram_status()
                free_mb = vram.get("free_mb", 0)
                if free_mb >= vram_budget_mb:
                    return {
                        "success": True,
                        "vram_before": vram,
                        "actions": actions,
                        "ollama_loaded": False,
                        "atomic_chat_loaded": False,
                    }

            # Still short after offloading Ollama + Atomic Chat. ComfyUI holds
            # far more (~5.3 GB measured) and ACE-Step needs 6 GB, so this is
            # usually the tier that actually unblocks the GPU. Never touch it
            # while it is running a prompt: unloading mid-render would strand a
            # running prompt.
            if free_mb < vram_budget_mb and self._comfyui_models_loaded:
                if self._comfyui_busy or not await _comfyui_is_idle():
                    logger.warning(
                        "VRAM Manager: %dMB free is below the %dMB music budget "
                        "and ComfyUI is busy; leaving its models loaded",
                        free_mb, vram_budget_mb,
                    )
                else:
                    logger.info("VRAM Manager: Offloading ComfyUI models for music generation")
                    comfy = await _unload_comfyui_models()
                    self._comfyui_models_loaded = False
                    actions.append({
                        "action": "offload_comfyui", **comfy,
                    })
                    vram = await self.get_vram_status()
                    free_mb = vram.get("free_mb", 0)

            # Still not enough
            self._current_workload = GPUWorkload.IDLE
            self._music_gen_running = False
            return {
                "success": False,
                "error": f"Insufficient VRAM for music generation ({free_mb}MB free, {vram_budget_mb}MB required)",
                "vram": vram,
                "actions": actions,
                "guidance": "Close other GPU applications or reduce VRAM budget",
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }

    async def end_music_generation(self) -> dict[str, Any]:
        """
        Signal that music generation is complete.
        Stops the ACE-Step subprocess and reloads Ollama models if they were offloaded.

        Returns:
            Dict with status and actions taken
        """
        async with self._lock:
            logger.info("VRAM Manager: Music generation complete")
            self._current_workload = GPUWorkload.IDLE
            self._music_gen_running = False

            vram = await self.get_vram_status()
            actions = []

        # Stop the music-gen subprocess OUTSIDE the lock to avoid deadlock
        # (stop_service may take several seconds and holds HTTP connections).
        try:
            from ..adapters.music_gen import shutdown_music_gen_services

            await shutdown_music_gen_services()
            actions.append({"action": "stop_music_gen_service", "success": True})
        except Exception as e:
            logger.warning("Failed to stop music-gen service on end: %s", e)
            actions.append({"action": "stop_music_gen_service", "success": False, "error": str(e)})

        # Reload Ollama if it was offloaded
        async with self._lock:
            if not self._ollama_loaded:
                free_mb = vram.get("free_mb", 0)
                if free_mb > self.MIN_VRAM_FOR_AUDIO:
                    try:
                        logger.info("VRAM Manager: Reloading Ollama after music gen (free=%dMB)", free_mb)
                        from ..core.config import config as _cfg2
                        last_model = _resolve_ollama_model(_cfg2.default_model)
                        reload_ok = await _reload_ollama_models(last_model)
                        self._ollama_loaded = reload_ok
                        actions.append({"action": "reload_ollama", "success": reload_ok, "model": last_model})
                    except Exception as e:
                        logger.warning("Failed to reload Ollama after music gen: %s", e)
                        actions.append({"action": "reload_ollama", "success": False, "error": str(e)})
                else:
                    logger.info(
                        "VRAM Manager: Leaving Ollama offloaded after music gen "
                        "(free=%dMB, need >%dMB to reload)", free_mb, self.MIN_VRAM_FOR_AUDIO
                    )

            # Reload Atomic Chat model if it was offloaded
            if not self._atomic_chat_loaded:
                last_ac_model = _resolve_atomic_chat_model(None)
                if last_ac_model:
                    free_mb = vram.get("free_mb", 0)
                    if free_mb > self.MIN_VRAM_FOR_AUDIO:
                        logger.info(
                            "VRAM Manager: Reloading Atomic Chat model %s "
                            "(free=%dMB)", last_ac_model, free_mb
                        )
                    try:
                        reload_ok = await _load_model_for_backend(
                            "atomic_chat", last_ac_model
                        )
                        self._atomic_chat_loaded = reload_ok
                        actions.append({
                            "action": "reload_atomic_chat",
                            "success": reload_ok,
                            "model": last_ac_model,
                        })
                    except Exception as e:
                        logger.warning("Failed to reload Atomic Chat after music gen: %s", e)
                        actions.append({
                            "action": "reload_atomic_chat",
                            "success": False,
                            "error": str(e),
                        })
                    else:
                        logger.info(
                            "VRAM Manager: Leaving Atomic Chat offloaded after music gen "
                            "(free=%dMB, need >%dMB to reload)", free_mb, self.MIN_VRAM_FOR_AUDIO
                        )

            return {
                "success": True,
                "vram_after": vram,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }

    async def begin_lipsync_generation(self,
                                       vram_budget_mb: int = 4096) -> dict[str, Any]:
        """
        Signal that local lip-sync (MuseTalk, D42) is starting.
        Offloads Ollama if VRAM is tight, mirroring begin_music_generation.

        Args:
            vram_budget_mb: Required VRAM in MB (default 4096, MuseTalk v1.5)

        Returns:
            Dict with status and actions taken
        """
        async with self._lock:
            logger.info("VRAM Manager: Lip-sync starting (need=%dMB)", vram_budget_mb)
            self._current_workload = GPUWorkload.LIPSYNC
            self._lipsync_running = True

            # Reconcile resident flags with /api/ps before offload decisions.
            await self.sync_resident_state()

            vram = await self.get_vram_status()
            actions = []

            free_mb = vram.get("free_mb", 0)
            if free_mb >= vram_budget_mb:
                logger.info("VRAM Manager: Sufficient VRAM for lip-sync (%dMB free)", free_mb)
                return {
                    "success": True,
                    "vram_before": vram,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }

            if (self._ollama_loaded or getattr(self, "_atomic_chat_loaded", False)) and self._can_safely_offload():
                logger.info("VRAM Manager: Offloading backend models for lip-sync")
                ollama_unloaded = await _unload_ollama_models()
                ac_unloaded = await _unload_atomic_chat_models()
                self._ollama_loaded = False
                self._atomic_chat_loaded = False
                actions.append({
                    "action": "offload_backend_models",
                    "success": True,
                    "models": {
                        "ollama": ollama_unloaded,
                        "atomic_chat": ac_unloaded,
                    },
                })
                vram = await self.get_vram_status()
                free_mb = vram.get("free_mb", 0)
                if free_mb >= vram_budget_mb:
                    return {
                        "success": True,
                        "vram_before": vram,
                        "actions": actions,
                        "ollama_loaded": False,
                        "atomic_chat_loaded": False,
                    }

            self._current_workload = GPUWorkload.IDLE
            self._lipsync_running = False
            return {
                "success": False,
                "error": f"Insufficient VRAM for lip-sync ({free_mb}MB free, {vram_budget_mb}MB required)",
                "vram": vram,
                "actions": actions,
                "guidance": "Close other GPU applications or reduce VRAM budget",
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }

    async def end_lipsync_generation(self) -> dict[str, Any]:
        """
        Signal that lip-sync is complete. Reloads Ollama if it was offloaded.

        Returns:
            Dict with status and actions taken
        """
        async with self._lock:
            logger.info("VRAM Manager: Lip-sync complete")
            self._current_workload = GPUWorkload.IDLE
            self._lipsync_running = False

            vram = await self.get_vram_status()
            actions = []

            if not self._ollama_loaded:
                free_mb = vram.get("free_mb", 0)
                if free_mb > self.MIN_VRAM_FOR_LIPSYNC:
                    logger.info("VRAM Manager: Reloading Ollama after lip-sync (free=%dMB)", free_mb)
                    from ..core.config import config as _cfg2
                    last_model = _resolve_last_model(_cfg2.default_model)
                    if "llama" in last_model.lower() and last_model != _cfg2.default_model:
                        last_model = _cfg2.default_model
                    reload_ok = await _reload_ollama_models(last_model)
                    self._ollama_loaded = reload_ok
                    actions.append({"action": "reload_ollama", "success": reload_ok, "model": last_model})

            # Reload Atomic Chat model if it was offloaded
            if not self._atomic_chat_loaded:
                last_ac_model = _resolve_atomic_chat_model(None)
                if last_ac_model:
                    free_mb = vram.get("free_mb", 0)
                    if free_mb > self.MIN_VRAM_FOR_LIPSYNC:
                        logger.info(
                            "VRAM Manager: Reloading Atomic Chat model %s "
                            "(free=%dMB)", last_ac_model, free_mb
                        )
                        reload_ok = await _load_model_for_backend(
                            "atomic_chat", last_ac_model
                        )
                        self._atomic_chat_loaded = reload_ok
                        actions.append({
                            "action": "reload_atomic_chat",
                            "success": reload_ok,
                            "model": last_ac_model,
                        })

            return {
                "success": True,
                "vram_after": vram,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }

    async def begin_audio_analysis(self,
                                    vram_budget_mb: int | None = None
                                    ) -> dict[str, Any]:
        """
        Signal that GPU audio analysis is starting.

        Offloads Ollama if VRAM is short, then ComfyUI if it is still short.
        On a GTX 1070 Ti this pass measures 0.3s against ~92s CPU-bound, so
        freeing VRAM is worth far more here than the cost of a later reload.

        ComfyUI is the bigger win and was previously unmanaged: on this machine
        POST /free returns ~5.3 GB against ~1.7 GB from offloading Ollama. It is
        only touched when ComfyUI's queue is empty - unloading its models
        mid-render would strand a running prompt, so a busy ComfyUI is left
        alone even when that leaves the budget unmet.

        Never fails: audio analysis can always run on the CPU, so a failed
        offload downgrades speed rather than blocking the request.

        Args:
            vram_budget_mb: Required VRAM. Defaults to MIN_VRAM_FOR_AUDIO.

        Returns:
            Dict with status and actions taken.
        """
        budget = vram_budget_mb or self.MIN_VRAM_FOR_AUDIO
        async with self._lock:
            logger.info("VRAM Manager: Audio analysis starting (need=%dMB)", budget)
            self._current_workload = GPUWorkload.AUDIO_ANALYSIS
            self._audio_analysis_running = True

            # Reconcile resident flags with /api/ps before offload decisions.
            await self.sync_resident_state()

            vram = await self.get_vram_status()
            actions: list[dict[str, Any]] = []
            free_mb = vram.get("free_mb", 0)

            if free_mb >= budget:
                return {
                    "success": True,
                    "offloaded": False,
                    "free_mb": free_mb,
                    # Present on both exit paths: a caller reading
                    # result["meets_budget"] must not KeyError just because the
                    # budget happened to be met on the first check.
                    "meets_budget": True,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                    "comfyui_models_loaded": self._comfyui_models_loaded,
                }

            # Offload both backend models as a courtesy. Failure is non-fatal:
            # the caller still gets a result, just on the CPU.
            if self._ollama_loaded or getattr(self, "_atomic_chat_loaded", False):
                if not self._can_safely_offload():
                    logger.warning(
                        "VRAM Manager: %dMB free is below the %dMB audio "
                        "budget but system RAM is too low to offload models "
                        "safely; proceeding (analysis may fall back to CPU)",
                        free_mb, budget,
                    )
                else:
                    logger.info("VRAM Manager: Offloading backend models for audio analysis")
                    ollama_unloaded = await _unload_ollama_models()
                    ac_unloaded = await _unload_atomic_chat_models()
                    self._ollama_loaded = False
                    self._atomic_chat_loaded = False
                    actions.append({
                        "action": "offload_backend_models", "success": True,
                        "models": {
                            "ollama": ollama_unloaded,
                            "atomic_chat": ac_unloaded,
                        },
                    })
                    vram = await self.get_vram_status()
                    free_mb = vram.get("free_mb", 0)

            # Still short after Ollama. ComfyUI holds far more than Ollama does
            # (~5.3 GB vs ~1.7 GB measured), so this is usually the tier that
            # actually unblocks the GPU. Never touch it while it is running a
            # prompt: unloading mid-render would fail the user's job.
            if free_mb < budget and self._comfyui_models_loaded:
                if self._comfyui_busy or not await _comfyui_is_idle():
                    logger.warning(
                        "VRAM Manager: %dMB free is below the %dMB audio budget "
                        "and ComfyUI is busy; leaving its models loaded (the "
                        "CUDA pass may fall back to CPU)",
                        free_mb, budget,
                    )
                else:
                    logger.info("VRAM Manager: Offloading ComfyUI models for audio analysis")
                    comfy = await _unload_comfyui_models()
                    self._comfyui_models_loaded = False
                    actions.append({
                        "action": "offload_comfyui", **comfy,
                    })
                    vram = await self.get_vram_status()
                    free_mb = vram.get("free_mb", 0)

            return {
                "success": True,
                "offloaded": bool(actions),
                "free_mb": free_mb,
                "meets_budget": free_mb >= budget,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
                "comfyui_models_loaded": self._comfyui_models_loaded,
            }

    async def end_audio_analysis(self) -> dict[str, Any]:
        """
        Signal that GPU audio analysis is complete.

        Reloads Ollama if it was offloaded and there is room for it.

        Returns:
            Dict with status and actions taken.
        """
        async with self._lock:
            logger.info("VRAM Manager: Audio analysis complete")
            self._current_workload = GPUWorkload.IDLE
            self._audio_analysis_running = False

            vram = await self.get_vram_status()
            free_mb = vram.get("free_mb", 0)
            actions: list[dict[str, Any]] = []

            # ComfyUI reloads its models lazily on the next prompt, so there is
            # nothing to call here - but flip the flag back so a later workload
            # knows it is free to offload ComfyUI again.
            self._comfyui_models_loaded = True

            if not self._ollama_loaded:
                # Reload only when there is room. The audio pass is done by
                # now, so the budget is the music one: Ollama needs room to be
                # useful afterwards.
                if free_mb > self.MIN_VRAM_FOR_MUSIC:
                    logger.info(
                        "VRAM Manager: Reloading Ollama after audio analysis "
                        "(free=%dMB)", free_mb)
                    from ..core.config import config as _cfg3
                    last_model = _resolve_last_model(_cfg3.default_model)
                    if "llama" in last_model.lower() and last_model != _cfg3.default_model:
                        last_model = _cfg3.default_model
                    reload_ok = await _reload_ollama_models(last_model)
                    self._ollama_loaded = reload_ok
                    actions.append({
                        "action": "reload_ollama", "success": reload_ok,
                        "model": last_model,
                    })
                else:
                    # Leave it offloaded; the next workload to need VRAM will
                    # find it already unloaded rather than thrashing.
                    logger.info(
                        "VRAM Manager: Leaving Ollama offloaded (free=%dMB, "
                        "need >%dMB to reload)", free_mb, self.MIN_VRAM_FOR_MUSIC)

            # Reload Atomic Chat model if it was offloaded
            if not self._atomic_chat_loaded:
                last_ac_model = _resolve_atomic_chat_model(None)
                if last_ac_model:
                    free_mb = vram.get("free_mb", 0)
                    if free_mb > self.MIN_VRAM_FOR_MUSIC:
                        logger.info(
                            "VRAM Manager: Reloading Atomic Chat model %s "
                            "after audio analysis (free=%dMB)",
                            last_ac_model, free_mb,
                        )
                        reload_ok = await _load_model_for_backend(
                            "atomic_chat", last_ac_model
                        )
                        self._atomic_chat_loaded = reload_ok
                        actions.append({
                            "action": "reload_atomic_chat",
                            "success": reload_ok,
                            "model": last_ac_model,
                        })
                    else:
                        logger.info(
                            "VRAM Manager: Leaving Atomic Chat offloaded "
                            "(free=%dMB, need >%dMB to reload)",
                            free_mb, self.MIN_VRAM_FOR_MUSIC,
                        )

            return {
                "success": True,
                "free_mb": free_mb,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }

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

        if state == GPUState.CRITICAL.value and (self._ollama_loaded or self._atomic_chat_loaded):
            # Critical VRAM - only offload if system can handle it
            if self._can_safely_offload():
                logger.warning("VRAM Manager: CRITICAL VRAM (%.1f%%) - emergency offload", percent)
                ollama_unloaded = await _unload_ollama_models()
                ac_unloaded = await _unload_atomic_chat_models()
                self._ollama_loaded = False
                self._atomic_chat_loaded = False
                result = {"action": "emergency_offload", "success": True, "models": {
                    "ollama": ollama_unloaded,
                    "atomic_chat": ac_unloaded,
                }}
                return {
                    "action": "emergency_offload",
                    "vram_percent": percent,
                    "result": result,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }
            else:
                logger.warning("VRAM Manager: CRITICAL VRAM (%.1f%%) but cannot safely offload "
                               "(system RAM insufficient)", percent)
                return {
                    "action": "critical_vram_no_offload",
                    "vram_percent": percent,
                    "warning": "System RAM too low for safe offload. Close GPU apps manually.",
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }

        return None

    async def preflight_lookahead(self, required_mb: int = 4096) -> dict[str, Any]:
        """Look-ahead VRAM reservation: sum queued job requirements + requested.

        Returns a dict with ``available``, ``free_mb``, ``required_mb``,
        ``queued_reservation_mb``, ``total_required_mb``, and ``message``.
        """
        status = await self.get_vram_status()
        if not status.get("available"):
            return {
                "available": True,
                "free_mb": 0,
                "total_mb": 0,
                "required_mb": required_mb,
                "queued_reservation_mb": 0,
                "total_required_mb": required_mb,
                "message": "VRAM monitoring unavailable -- proceeding",
            }

        free_mb = status.get("free_mb", status.get("memory_free_mb", 0))
        total_mb = status.get("total_mb", status.get("memory_total_mb", 0))

        # Sum VRAM requirements of queued jobs (lightweight heuristic by job type).
        #
        # This used to `from ..queue.manager import queue_manager` inline, which
        # closed a cycle: queue.manager -> diagnostics.resources ->
        # services.vram_manager -> queue.manager. The deferred import hid it from
        # the module graph but not from anyone reading the file, and it made the
        # reservation silently zero whenever the import failed.
        #
        # The queue state now arrives through an explicitly registered provider,
        # wired once at the composition root (see `set_queue_provider`), so this
        # module depends on nothing in `queue`.
        queued_reservation = 0
        try:
            queued_jobs = await self._queued_jobs()
            for job in queued_jobs:
                jt = job.job_type.value if hasattr(job.job_type, "value") else str(job.job_type)
                if jt == "comfyui_workflow":
                    # Flat baseline per job: the per-image cost is dominated by
                    # the loaded diffusion model, not by width/height.
                    queued_reservation += 8192  # ~8GB baseline for image gen
                elif jt == "music_video":
                    queued_reservation += 6144
                elif jt == "audio_feature_extraction":
                    queued_reservation += 512  # CPU-bound mostly
                else:
                    queued_reservation += 2048  # generic
        except Exception as exc:
            # Under-counting VRAM here is the safe direction to fail: we would
            # warn a little early rather than over-commit. Log it so a broken
            # provider is visible instead of silent.
            logger.debug("VRAM reservation from queue unavailable: %s", exc)

        total_required = required_mb + queued_reservation
        result: dict[str, Any] = {
            "available": True,
            "free_mb": free_mb,
            "total_mb": total_mb,
            "required_mb": required_mb,
            "queued_reservation_mb": queued_reservation,
            "total_required_mb": total_required,
            "message": f"VRAM OK: {free_mb}MB free of {total_mb}MB (queued reservations: {queued_reservation}MB)",
        }

        if free_mb >= total_required:
            return result

        # Not enough VRAM -- offload backend models as a courtesy before reporting failure.
        try:
            ollama_unloaded = await _unload_ollama_models()
            ac_unloaded = await _unload_atomic_chat_models()
        except Exception as exc:
            logger.warning("VRAM Manager: lookahead offload failed: %s", exc)
            ollama_unloaded = []
            ac_unloaded = []

        if ollama_unloaded or ac_unloaded:
            self._ollama_loaded = False
            self._atomic_chat_loaded = False
            result["offloaded"] = True
            result["models"] = {
                "ollama": ollama_unloaded,
                "atomic_chat": ac_unloaded,
            }
            recheck = await self.get_vram_status()
            result["free_mb"] = recheck.get(
                "free_mb", recheck.get("memory_free_mb", result["free_mb"])
            )
            if result["free_mb"] >= total_required:
                result["message"] = "Offloaded backend models to free VRAM for queued jobs"
                return result

        result["available"] = False
        result["message"] = (
            f"Insufficient VRAM: {result['free_mb']}MB free, {total_required}MB required "
            f"({required_mb}MB now + {queued_reservation}MB queued)"
        )
        return result

    def get_status(self) -> dict[str, Any]:
        """Get VRAM manager status."""
        return {
            "current_workload": self._current_workload.value,
            "ollama_loaded": self._ollama_loaded,
            "atomic_chat_loaded": self._atomic_chat_loaded,
            "comfyui_busy": self._comfyui_busy,
            "comfyui_models_loaded": self._comfyui_models_loaded,
            "music_gen_running": self._music_gen_running,
            "nvml_available": self._nvml_available,
            "gpustat_available": self._gpustat_available,
            "thresholds": self.thresholds,
            "min_vram_for_3d_mb": self.MIN_VRAM_FOR_3D,
            "min_vram_for_music_mb": self.MIN_VRAM_FOR_MUSIC,
            "safety_thresholds": {
                "min_system_ram_for_offload_mb": self.MIN_SYSTEM_RAM_FOR_OFFLOAD,
            },
        }

    async def switch_backend_model(
        self, backend: str, model: str
    ) -> dict[str, Any]:
        """Coordinated model switch across Ollama and Atomic Chat backends.

        On an 8 GB card, only one model can be resident at a time. When the
        user switches from Atomic Chat (qwen3.5) to Ollama (gemma4) or vice
        versa, this method:

        1. Unloads whatever model is currently resident (from either backend)
        2. Loads the target model for the target backend
        3. Updates `_ollama_loaded` / `_atomic_chat_loaded` accordingly

        This prevents both models being resident simultaneously, which would
        OOM an 8 GB GTX 1070 Ti (gemma4 ~6 GB + qwen3.5 ~4.8 GB = ~10.8 GB).

        Args:
            backend: "ollama" or "atomic_chat"
            model: model name to load for the given backend

        Returns:
            Dict with status, actions taken, and the newly resident model.
        """
        async with self._lock:
            logger.info(
                "VRAM Manager: switching backend=%s model=%s", backend, model
            )
            actions: list[dict[str, Any]] = []

            # Validate backend
            if backend not in ("ollama", "atomic_chat"):
                return {
                    "success": False,
                    "backend": backend,
                    "model": model,
                    "error": f"Unknown backend: {backend!r}. Use 'ollama' or 'atomic_chat'.",
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                }

            # Reconcile flags with /api/ps reality before trusting them -- a
            # stale flag can skip a needed unload and OOM the 8 GB card.
            await self.sync_resident_state()

            # Idempotency: if the same backend already has this model loaded, nothing to do
            if backend == "ollama" and self._ollama_loaded:
                return {
                    "success": True,
                    "backend": backend,
                    "model": model,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                    "message": f"Model {model} already loaded for Ollama",
                }
            if backend == "atomic_chat" and self._atomic_chat_loaded:
                return {
                    "success": True,
                    "backend": backend,
                    "model": model,
                    "actions": actions,
                    "ollama_loaded": self._ollama_loaded,
                    "atomic_chat_loaded": self._atomic_chat_loaded,
                    "message": f"Model {model} already loaded for Atomic Chat",
                }

            # Step 1: unload whatever is currently resident
            if self._ollama_loaded:
                unloaded = await _unload_ollama_models()
                self._ollama_loaded = False
                actions.append(
                    {
                        "action": "unload_ollama",
                        "success": True,
                        "models": unloaded,
                    }
                )

            if self._atomic_chat_loaded:
                unloaded = await _unload_atomic_chat_models()
                self._atomic_chat_loaded = False
                actions.append(
                    {
                        "action": "unload_atomic_chat",
                        "success": True,
                        "models": unloaded,
                    }
                )

            # Step 2: load the target model
            load_ok = await _load_model_for_backend(backend, model)
            if backend == "ollama":
                self._ollama_loaded = load_ok
            else:
                self._atomic_chat_loaded = load_ok

            return {
                "success": load_ok,
                "backend": backend,
                "model": model,
                "actions": actions,
                "ollama_loaded": self._ollama_loaded,
                "atomic_chat_loaded": self._atomic_chat_loaded,
            }


def _unload_atomic_chat_models_sync() -> list[str]:
    """Unload Atomic Chat's resident model via Ollama's API.

    Atomic Chat is a wrapper around Ollama -- it loads its model through
    Ollama's `/api/generate`. So unloading means calling Ollama's generate
    with `keep_alive: 0` for Atomic Chat's model name. Returns list of
    unloaded model names.
    """
    import urllib.request

    unloaded: list[str] = []
    model_name = _resolve_atomic_chat_model(None)
    if model_name:
        unloaded.append(model_name)
    else:
        # No provider registered or provider returned None. Do NOT fall back
        # to scanning Ollama's process list -- that could unload Ollama's own
        # model (e.g. gemma4) thinking it belongs to Atomic Chat. Only the
        # provider knows which model Atomic Chat loaded.
        logger.debug(
            "VRAM Manager: No Atomic Chat model name available; skipping "
            "atomic-chat unload to avoid unloading Ollama's model"
        )

    for name in unloaded:
        try:
            data = json.dumps(
                {"model": name, "prompt": " ", "keep_alive": 0}
            ).encode()
            req = urllib.request.Request(
                ollama_url("/api/generate"),
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5):
                pass
            logger.info(
                "VRAM Manager: Unloaded Atomic Chat model: %s", name
            )
        except Exception:
            pass  # Timeout is expected since we're unloading

    return unloaded


async def _unload_atomic_chat_models() -> list[str]:
    """Async wrapper to unload Atomic Chat models without blocking."""
    return await asyncio.to_thread(_unload_atomic_chat_models_sync)


def _load_model_for_backend_sync(
    backend: str, model: str
) -> bool:
    """Load a model for a given backend via Ollama's API.

    Both Ollama and Atomic Chat load models through Ollama's `/api/generate`
    with `keep_alive` set. The difference is only which model name and which
    backend flag gets updated.
    """
    import os
    import urllib.request

    from ..core.config import config as _cfg

    # Don't infinite-pin models; respect OLLAMA_KEEP_ALIVE
    keep_alive = os.environ.get("OLLAMA_KEEP_ALIVE", "5m")

    # Sanitize: never load a non-default llama as the resident model
    if "llama" in model.lower() and model != _cfg.default_model:
        logger.info(
            "VRAM Manager: Skipping load of non-default llama model %s "
            "(default is %s)",
            model,
            _cfg.default_model,
        )
        return False

    data = json.dumps(
        {"model": model, "prompt": " ", "keep_alive": keep_alive}
    ).encode()

    req = urllib.request.Request(
        ollama_url("/api/generate"),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp.read()
        logger.info(
            "VRAM Manager: Loaded model %s for backend %s", model, backend
        )
        return True
    except Exception as exc:
        logger.warning(
            "VRAM Manager: Failed to load model %s for backend %s: %s",
            model,
            backend,
            exc,
        )
        return False


async def _load_model_for_backend(backend: str, model: str) -> bool:
    """Async wrapper to load a model without blocking the event loop."""
    return await asyncio.to_thread(_load_model_for_backend_sync, backend, model)


def _comfyui_queue_depth_sync() -> tuple[int, int]:
    """Return (running, pending) prompt counts. Zeros if ComfyUI is unreachable.

    Used as the safety gate before freeing its models: unloading mid-render
    would strand the running prompt and lose the job, which is not a trade this
    manager is allowed to make on the user's behalf.
    """
    import urllib.request

    try:
        req = urllib.request.Request(comfyui_url("/queue"))
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        return (
            len(data.get("queue_running") or []),
            len(data.get("queue_pending") or []),
        )
    except Exception:
        # Unreachable ComfyUI holds no models we can evict, and guessing "0"
        # here would let us POST /free at an unknown server.
        return (0, 0)


def _unload_comfyui_models_sync() -> dict[str, Any]:
    """Ask ComfyUI to drop its loaded models and free cached allocator memory.

    Measured on this machine: 1796 MB free -> 7145 MB free, i.e. ~5.3 GB
    reclaimed. That is roughly triple what offloading Ollama returns (~1.7 GB),
    so ComfyUI is the dominant VRAM consumer by a wide margin and has to be part
    of the audio-analysis budget, not just Ollama.

    ComfyUI reloads models lazily on the next prompt, so there is no matching
    "reload" call to make -- unlike Ollama, which keeps a resident model.
    """
    import urllib.request

    running, pending = _comfyui_queue_depth_sync()
    if running or pending:
        return {
            "success": False,
            "skipped": "busy",
            "running": running,
            "pending": pending,
        }

    try:
        payload = json.dumps(
            {"unload_models": True, "free_memory": True}
        ).encode()
        req = urllib.request.Request(
            comfyui_url("/free"),
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10):
            pass
        logger.info("VRAM Manager: Unloaded ComfyUI models and freed VRAM")
        return {"success": True, "skipped": None, "running": 0, "pending": 0}
    except Exception as exc:
        logger.warning("VRAM Manager: ComfyUI /free failed: %s", exc)
        return {"success": False, "skipped": "error", "error": str(exc)}


async def _unload_comfyui_models() -> dict[str, Any]:
    return await asyncio.to_thread(_unload_comfyui_models_sync)


def _comfyui_is_idle_sync() -> bool:
    """True only when ComfyUI has nothing running or queued."""
    running, pending = _comfyui_queue_depth_sync()
    return running == 0 and pending == 0


async def _comfyui_is_idle() -> bool:
    return await asyncio.to_thread(_comfyui_is_idle_sync)


def _offload_backend_models_sync() -> dict[str, list[str]]:
    """Unload ALL models from both Ollama and Atomic Chat backends.

    Returns dict with keys ``ollama`` and ``atomic_chat``, each a list of
    unloaded model names. Used by begin_*_generation methods to ensure no
    model from either backend is resident before a GPU job starts.
    """
    ollama_unloaded = _unload_ollama_models_sync()
    atomic_chat_unloaded = _unload_atomic_chat_models_sync()
    return {
        "ollama": ollama_unloaded,
        "atomic_chat": atomic_chat_unloaded,
    }


async def _offload_backend_models() -> dict[str, list[str]]:
    """Async wrapper for _offload_backend_models_sync."""
    return await asyncio.to_thread(_offload_backend_models_sync)


def _unload_ollama_models_sync() -> list[str]:
    """Synchronous helper to unload Ollama models. Returns list of unloaded model names."""
    import urllib.request

    # Get the list of loaded models
    loaded_models: list[str] = []
    try:
        req = urllib.request.Request(ollama_url("/api/ps"))
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            loaded_models = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
    except Exception:
        pass

    if not loaded_models:
        # Fallback: try the last known model
        last_model = _resolve_last_model(None)
        if last_model:
            loaded_models = [last_model]

    # Unload each loaded model
    for model_name in loaded_models:
        try:
            data = json.dumps({
                "model": model_name,
                "prompt": " ",
                "keep_alive": 0,
            }).encode()
            req = urllib.request.Request(
                ollama_url("/api/generate"),
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5):
                pass
            logger.info("VRAM Manager: Unloaded Ollama model: %s", model_name)
        except Exception:
            pass  # Timeout is expected since we're unloading

    return loaded_models


def _reload_ollama_models_sync(model_name: str) -> bool:
    """Synchronous helper to reload an Ollama model. Returns True on success.
    Uses OLLAMA_KEEP_ALIVE env var if set, defaulting to 5m so model expires
    naturally; also skips reload if model_name is a legacy llama not in config.default_model.
    """
    import urllib.request

    from ..core.config import config as _cfg
    # Don't infinite-pin models; respect OLLAMA_KEEP_ALIVE
    if "llama" in model_name.lower() and model_name != _cfg.default_model:
        logger.info("VRAM Manager: Skipping reload of non-default llama model %s (default is %s)", model_name, _cfg.default_model)
        return False
    keep_alive = os.environ.get("OLLAMA_KEEP_ALIVE", "5m")
    data = json.dumps({
        "model": model_name,
        "prompt": " ",
        "keep_alive": keep_alive,
    }).encode()

    req = urllib.request.Request(
        ollama_url("/api/generate"),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=120) as resp:
        resp.read()

    return True


async def _unload_ollama_models() -> list[str]:
    """Async wrapper to unload Ollama models without blocking the event loop."""
    return await asyncio.to_thread(_unload_ollama_models_sync)


async def _reload_ollama_models(model_name: str) -> bool:
    """Async wrapper to reload an Ollama model without blocking the event loop."""
    return await asyncio.to_thread(_reload_ollama_models_sync, model_name)


# Global VRAM manager singleton
vram_manager = VRAMManager()
