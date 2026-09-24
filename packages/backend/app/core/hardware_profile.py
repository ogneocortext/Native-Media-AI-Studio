"""Hardware discovery and workstation-specific limits.

The profile is intentionally dependency-light: CPU, memory, storage, and GPU
details are collected from ``psutil`` and optional ``pynvml``.  Values in
``config/hardware-profile.json`` are overrides, not a replacement for live
detection, so the API can refresh the profile after a driver or hardware change.
"""

from __future__ import annotations

import hashlib
import json
import logging
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import CONFIG_DIR, PROJECT_ROOT

logger = logging.getLogger(__name__)

DEFAULT_PROFILE_PATH = CONFIG_DIR / "hardware-profile.json"


class CPUInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    physical_cores: int
    logical_cores: int
    frequency_mhz: float | None = None


class MemoryInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    total_mb: int
    available_mb: int
    used_percent: float


class StorageInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    root: str
    total_gb: float
    used_gb: float
    free_gb: float
    used_percent: float


class GPUInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    index: int = 0
    uuid: str | None = None
    driver_version: str | None = None
    compute_capability: str | None = None
    memory_total_mb: int | None = None
    memory_used_mb: int | None = None
    utilization_percent: int | None = None
    temperature_c: float | None = None
    source: str = "pynvml"


class HardwareLimits(BaseModel):
    """Safe defaults for the local 8 GB GPU workstation.

    These values are deliberately conservative.  Benchmark requests can lower
    them, but the runner will not silently exceed the configured limits.
    """

    model_config = ConfigDict(extra="ignore")

    max_concurrent_benchmarks: int = 1
    ollama_context_tokens: int = 4096
    ollama_max_output_tokens: int = 900
    comfyui_width: int = 768
    comfyui_height: int = 768
    comfyui_steps: int = 20
    comfyui_cfg: float = 7.0
    benchmark_timeout_seconds: int = 300
    vram_safety_margin_mb: int = 1536

    @field_validator("max_concurrent_benchmarks", "ollama_context_tokens", "ollama_max_output_tokens", "comfyui_width", "comfyui_height", "comfyui_steps", "benchmark_timeout_seconds", "vram_safety_margin_mb")
    @classmethod
    def validate_positive(cls, value: int) -> int:
        if value < 1:
            raise ValueError("hardware limits must be positive")
        return value

    @field_validator("comfyui_cfg")
    @classmethod
    def validate_cfg(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("comfyui_cfg must be positive")
        return value


class HardwareProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    profile_id: str
    profile_name: str
    detected_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    os: str
    platform: str
    python_version: str
    cpu: CPUInfo
    memory: MemoryInfo
    storage: StorageInfo
    gpus: list[GPUInfo] = Field(default_factory=list)
    limits: HardwareLimits = Field(default_factory=HardwareLimits)
    recommendations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    source: dict[str, Any] = Field(default_factory=dict)


def _read_profile_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not read hardware profile config %s: %s", path, exc)
        return {}


def _safe_divide(numerator: int | float, denominator: int | float) -> float | None:
    if not denominator:
        return None
    return round(float(numerator) / float(denominator), 2)


def _gpu_compute_capability(handle: Any) -> str | None:
    try:
        import pynvml

        major, minor = pynvml.nvmlDeviceGetCudaComputeCapability(handle)
        return f"{major}.{minor}"
    except Exception:
        return None


def _detect_gpus() -> list[GPUInfo]:
    gpus: list[GPUInfo] = []
    try:
        import pynvml

        pynvml.nvmlInit()
        try:
            device_count = pynvml.nvmlDeviceGetCount()
            for index in range(device_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(index)
                try:
                    name = pynvml.nvmlDeviceGetName(handle)
                    if isinstance(name, bytes):
                        name = name.decode("utf-8", errors="replace")
                except (AttributeError, TypeError):
                    name = "Unknown NVIDIA GPU"

                memory_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                try:
                    driver_version = pynvml.nvmlSystemGetDriverVersion()
                except Exception:
                    driver_version = None

                try:
                    utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                    utilization_percent = int(utilization.gpu)
                except Exception:
                    utilization_percent = None

                try:
                    temperature = pynvml.nvmlDeviceGetTemperature(
                        handle, pynvml.NVML_TEMPERATURE_GPU
                    )
                    temperature_c = float(temperature)
                except Exception:
                    temperature_c = None

                gpus.append(
                    GPUInfo(
                        index=index,
                        name=str(name).strip() or "Unknown NVIDIA GPU",
                        uuid=str(pynvml.nvmlDeviceGetUUID(handle)) if hasattr(pynvml, "nvmlDeviceGetUUID") else None,
                        driver_version=driver_version,
                        compute_capability=_gpu_compute_capability(handle),
                        memory_total_mb=int(memory_info.total // (1024 * 1024)),
                        memory_used_mb=int(memory_info.used // (1024 * 1024)),
                        utilization_percent=utilization_percent,
                        temperature_c=temperature_c,
                        source="pynvml",
                    )
                )
        finally:
            pynvml.nvmlShutdown()
    except Exception as exc:
        logger.debug("NVIDIA GPU discovery unavailable: %s", exc)

    if gpus:
        return gpus

    # Keep the profile useful on machines without NVIDIA drivers.  This is a
    # fallback only; the benchmark runner still records whether GPU telemetry
    # was available for each run.
    return []


def _limits_for_gpu(gpus: list[GPUInfo], configured: dict[str, Any]) -> HardwareLimits:
    total_vram_mb = sum(gpu.memory_total_mb or 0 for gpu in gpus)
    if total_vram_mb and total_vram_mb <= 4096:
        defaults = {
            "ollama_context_tokens": 2048,
            "ollama_max_output_tokens": 512,
            "comfyui_width": 512,
            "comfyui_height": 512,
            "comfyui_steps": 16,
            "vram_safety_margin_mb": 768,
        }
    elif total_vram_mb and total_vram_mb <= 8192:
        defaults = {
            "ollama_context_tokens": 4096,
            "ollama_max_output_tokens": 900,
            "comfyui_width": 768,
            "comfyui_height": 768,
            "comfyui_steps": 20,
            "vram_safety_margin_mb": 1536,
        }
    else:
        defaults = {
            "ollama_context_tokens": 8192,
            "ollama_max_output_tokens": 1200,
            "comfyui_width": 1024,
            "comfyui_height": 1024,
            "comfyui_steps": 28,
            "vram_safety_margin_mb": 2048,
        }

    limits_data = dict(defaults)
    limits_data.update(configured.get("limits", {}) if isinstance(configured.get("limits"), dict) else {})
    return HardwareLimits(**limits_data)


def _recommendations(profile: HardwareProfile) -> tuple[list[str], list[str]]:
    recommendations: list[str] = []
    warnings: list[str] = []
    gpu_vram = sum(gpu.memory_total_mb or 0 for gpu in profile.gpus)
    if gpu_vram and gpu_vram <= 8192:
        recommendations.extend(
            [
                "Run one AI benchmark at a time to leave VRAM headroom for the desktop compositor.",
                "Prefer 2B-4B Ollama models or quantized 7B models for interactive work.",
                "Keep ComfyUI image benchmarks at 768x768 or lower unless free VRAM is above 2 GB.",
            ]
        )
    elif gpu_vram:
        recommendations.append("Use the detected VRAM headroom to compare larger models, but keep benchmark concurrency at one.")
    else:
        warnings.append("No NVIDIA GPU was detected through NVML; GPU timing and VRAM deltas will be unavailable.")

    if profile.memory.total_mb < 16 * 1024:
        warnings.append("System RAM is below 16 GB; large model offload may page to disk.")
    if profile.storage.free_gb < 10:
        warnings.append("Less than 10 GB of storage is free; generated benchmark outputs may need cleanup.")
    return recommendations, warnings


def _merge_overrides(profile: HardwareProfile, config: dict[str, Any]) -> HardwareProfile:
    """Apply recorded hardware overrides without replacing live detection."""

    overrides = config.get("manual_overrides", {})
    if not isinstance(overrides, dict):
        overrides = {}

    cpu_data = profile.cpu.model_dump()
    cpu_override = overrides.get("cpu", {})
    if isinstance(cpu_override, dict):
        cpu_data.update(cpu_override)

    memory_data = profile.memory.model_dump()
    memory_override = overrides.get("memory", {})
    if isinstance(memory_override, dict):
        memory_data.update(memory_override)

    storage_data = profile.storage.model_dump()
    storage_override = overrides.get("storage", {})
    if isinstance(storage_override, dict):
        storage_data.update(storage_override)

    gpu_data = [gpu.model_dump() for gpu in profile.gpus]
    override_gpus = overrides.get("gpus")
    if isinstance(override_gpus, list):
        for index, override in enumerate(override_gpus):
            if not isinstance(override, dict):
                continue
            if index < len(gpu_data):
                gpu_data[index].update(override)
            elif override.get("name"):
                gpu_data.append(override)

    limits = _limits_for_gpu(profile.gpus, config)
    return profile.model_copy(
        update={
            "cpu": CPUInfo(**cpu_data),
            "memory": MemoryInfo(**memory_data),
            "storage": StorageInfo(**storage_data),
            "gpus": [GPUInfo(**gpu) for gpu in gpu_data],
            "limits": limits,
        }
    )


def _finalize_profile(
    profile: HardwareProfile,
    config: dict[str, Any],
    *,
    include_source: bool,
) -> HardwareProfile:
    """Recalculate recommendations, warnings, and stable identity."""

    recommendations, warnings = _recommendations(profile)
    identity = {
        "os": profile.os,
        "cpu": profile.cpu.name,
        "gpus": [(gpu.name, gpu.memory_total_mb) for gpu in profile.gpus],
        "memory_total_mb": profile.memory.total_mb,
    }
    profile_id = hashlib.sha256(
        json.dumps(identity, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]
    updates: dict[str, Any] = {
        "profile_id": profile_id,
        "recommendations": recommendations,
        "warnings": warnings,
    }
    if include_source:
        updates["source"] = config
    return profile.model_copy(update=updates)


def detect_hardware_profile(
    profile_path: str | Path = DEFAULT_PROFILE_PATH,
    *,
    include_source: bool = False,
) -> HardwareProfile:
    """Detect the current workstation and apply optional manual overrides."""

    path = Path(profile_path)
    profile_config = _read_profile_config(path)
    memory = psutil.virtual_memory()
    disk_path = Path.home().anchor or str(PROJECT_ROOT)
    disk = psutil.disk_usage(disk_path)
    cpu_frequency = psutil.cpu_freq()
    cpu = CPUInfo(
        name=platform.processor().strip() or platform.machine(),
        physical_cores=psutil.cpu_count(logical=False) or 0,
        logical_cores=psutil.cpu_count(logical=True) or 0,
        frequency_mhz=round(cpu_frequency.current, 1) if cpu_frequency else None,
    )
    gpus = _detect_gpus()
    profile = HardwareProfile(
        profile_id="",
        profile_name=profile_config.get("profile_name", "local-workstation"),
        os=platform.platform(),
        platform=platform.system(),
        python_version=platform.python_version(),
        cpu=cpu,
        memory=MemoryInfo(
            total_mb=int(memory.total // (1024 * 1024)),
            available_mb=int(memory.available // (1024 * 1024)),
            used_percent=_safe_divide(memory.used, memory.total) * 100 if memory.total else 0,
        ),
        storage=StorageInfo(
            root=str(disk_path),
            total_gb=_safe_divide(disk.total, 1024**3) or 0,
            used_gb=_safe_divide(disk.used, 1024**3) or 0,
            free_gb=_safe_divide(disk.free, 1024**3) or 0,
            used_percent=_safe_divide(disk.percent, 1) or 0,
        ),
        gpus=gpus,
    )
    profile = _merge_overrides(profile, profile_config)
    return _finalize_profile(profile, profile_config, include_source=include_source)


def load_hardware_profile(
    profile_path: str | Path = DEFAULT_PROFILE_PATH,
    *,
    refresh: bool = False,
) -> HardwareProfile:
    """Return a profile, applying config overrides even when using the cache."""

    path = Path(profile_path)
    if refresh:
        return detect_hardware_profile(path, include_source=True)

    cached_path = path.with_suffix(".cached.json")
    if cached_path.exists():
        try:
            with cached_path.open(encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                cached = HardwareProfile.model_validate(data)
                config = _read_profile_config(path)
                return _finalize_profile(
                    _merge_overrides(cached, config),
                    config,
                    include_source=True,
                )
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            logger.debug("Ignoring cached hardware profile: %s", exc)
    return detect_hardware_profile(path, include_source=True)


def save_hardware_profile(
    profile: HardwareProfile,
    profile_path: str | Path = DEFAULT_PROFILE_PATH,
) -> Path:
    """Persist a detected baseline without discarding manual overrides."""

    path = Path(profile_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = _read_profile_config(path)
    payload = profile.model_dump(mode="json")
    payload.pop("source", None)
    payload["version"] = 1
    payload["profile_name"] = existing.get("profile_name", profile.profile_name)
    payload["manual_overrides"] = existing.get("manual_overrides", {})
    if isinstance(existing.get("limits"), dict):
        payload["limits"] = existing["limits"]
    payload["last_saved_at"] = datetime.now(timezone.utc).isoformat()
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")

    # Keep a detection-only copy for fast reads. The canonical config remains
    # the source of manual overrides and safety limits.
    cached_path = path.with_suffix(".cached.json")
    cached_payload = profile.model_dump(mode="json")
    cached_payload["source"] = {"cache": True}
    with cached_path.open("w", encoding="utf-8") as handle:
        json.dump(cached_payload, handle, indent=2)
        handle.write("\n")
    return path


def snapshot_hardware_profile(
    profile_path: str | Path = DEFAULT_PROFILE_PATH,
    *,
    refresh: bool = True,
) -> HardwareProfile:
    """Detect and persist a profile, returning the saved model."""

    profile = detect_hardware_profile(profile_path, include_source=True) if refresh else load_hardware_profile(profile_path)
    save_hardware_profile(profile, profile_path)
    return profile


def profile_as_dict(profile: HardwareProfile) -> dict[str, Any]:
    return profile.model_dump(mode="json")


# Backwards-friendly name for callers that prefer an explicit snapshot operation.
get_hardware_profile = load_hardware_profile
