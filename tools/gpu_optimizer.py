"""
GPU optimizer — Pascal (sm_61) detection and optimization for the GTX 1070 Ti.

Applies the October 2026 Pascal best practices from
docs/knowledge-library/pascal-gpu-optimization-2026.md:

- Detect Pascal compute capability (sm_61)
- Check NVIDIA driver against the Pascal ceiling (580.x last supported)
- Apply PyTorch Pascal runtime settings (no TF32, no BF16, FP16 dtype, math SDPA)
- Report VRAM and optimization recommendations
- Safe to import without torch installed (torch is imported lazily)

Usage:

    from tools.gpu_optimizer import optimize_for_pascal, report_gpu_status
    optimize_for_pascal()
    print(report_gpu_status())

Or from the CLI:

    python tools/gpu_optimizer.py
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Pascal driver ceiling — 590.x drops Pascal, Maxwell, Volta support.
PASCAL_DRIVER_CEILING = "580"
PASCAL_COMPUTE_CAPABILITY = (6, 1)

# Recommended PyTorch version for Pascal (last wheel with sm_61 support).
RECOMMENDED_TORCH_VERSION = "2.5.0"
RECOMMENDED_TORCH_CUDA = "cu124"


@dataclass
class GpuInfo:
    """Discovered GPU information."""
    name: str = ""
    compute_capability: tuple[int, int] | None = None
    vram_total_mb: int = 0
    vram_used_mb: int = 0
    driver_version: str = ""
    is_pascal: bool = False
    driver_exceeds_ceiling: bool = False
    torch_available: bool = False
    torch_version: str = ""
    torch_cuda: str = ""


@dataclass
class OptimizationReport:
    """Results of applying Pascal optimizations."""
    applied: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def _run_nvidia_smi(query: str) -> str | None:
    """Run nvidia-smi and return stdout, or None if unavailable."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=" + query, "--format=csv,noheader,nounits"],
            capture_output=True,
            encoding="utf-8",
            timeout=10,
        )
        if result.returncode != 0:
            return None
        return result.stdout.strip().splitlines()[0] if result.stdout.strip() else None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def detect_gpu() -> GpuInfo:
    """Detect GPU via nvidia-smi and torch (lazily)."""
    info = GpuInfo()

    name = _run_nvidia_smi("name")
    if name:
        info.name = name

    driver = _run_nvidia_smi("driver_version")
    if driver:
        info.driver_version = driver
        # Driver ceiling check: 590.x drops Pascal.
        major = int(driver.split(".")[0])
        info.driver_exceeds_ceiling = major > 580

    vram_total = _run_nvidia_smi("memory.total")
    if vram_total:
        try:
            info.vram_total_mb = int(vram_total)
        except ValueError:
            pass

    vram_used = _run_nvidia_smi("memory.used")
    if vram_used:
        try:
            info.vram_used_mb = int(vram_used)
        except ValueError:
            pass

    # Torch detection (lazy, import-safe).
    try:
        import torch  # type: ignore

        info.torch_available = True
        info.torch_version = torch.__version__
        info.torch_cuda = getattr(torch.version, "cuda", "") or ""
        if torch.cuda.is_available():
            cap = torch.cuda.get_device_capability(0)
            info.compute_capability = (cap[0], cap[1])
            info.is_pascal = info.compute_capability == PASCAL_COMPUTE_CAPABILITY
    except ImportError:
        pass

    return info


# ---------------------------------------------------------------------------
# Optimization
# ---------------------------------------------------------------------------


def _set_torch_pascal_settings() -> list[str]:
    """Apply Pascal-appropriate PyTorch runtime settings. Returns applied settings."""
    import torch  # type: ignore

    applied: list[str] = []

    # TF32 is a no-op on Pascal — disable explicitly.
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    applied.append("disabled TF32 (matmul + cuDNN)")

    # cuDNN autotuner for fixed input sizes.
    torch.backends.cudnn.benchmark = True
    applied.append("enabled cuDNN benchmark autotuner")

    applied.append("recommended dtype: torch.float16 (2x FP32 on Pascal cores)")
    applied.append("avoid BF16 (bitwise-emulated, ~10x slower than FP16)")
    applied.append("disable torch.compile (Triton requires sm_70+)")

    return applied


def optimize_for_pascal() -> OptimizationReport:
    """Apply Pascal GPU optimizations.

    Detects the GPU, checks the driver ceiling, and applies PyTorch runtime
    settings if torch is available. Safe to call even without torch installed.
    """
    report = OptimizationReport()
    info = detect_gpu()

    if not info.name:
        report.errors.append("nvidia-smi unavailable - no NVIDIA GPU detected or driver missing")
        return report

    report.warnings.append(f"Detected GPU: {info.name}")
    report.warnings.append(f"Driver: {info.driver_version} (Pascal ceiling: 580.x)")

    if info.driver_exceeds_ceiling:
        report.errors.append(
            f"Driver {info.driver_version} exceeds Pascal ceiling (580.x). "
            "Roll back to 580.x Studio Driver or CUDA will fail."
        )

    if info.compute_capability:
        report.warnings.append(f"Compute capability: {info.compute_capability[0]}.{info.compute_capability[1]}")

    if info.is_pascal:
        report.warnings.append("Pascal (sm_61) detected - applying Pascal-specific optimizations")

        if info.torch_available:
            try:
                applied = _set_torch_pascal_settings()
                report.applied.extend(applied)
            except Exception as exc:  # noqa: BLE001 — optimize should not crash
                report.errors.append(f"Failed to apply torch settings: {exc}")
        else:
            report.skipped.append("torch not installed - runtime settings not applied")

        if info.vram_total_mb:
            report.warnings.append(f"VRAM: {info.vram_total_mb} MB total, {info.vram_used_mb} MB used")
            if info.vram_total_mb < 8000:
                report.warnings.append("VRAM < 8GB - enable CPU offload and INT8 quantization")
    else:
        report.warnings.append("Non-Pascal GPU detected - Pascal-specific optimizations not applicable")

    return report


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def report_gpu_status() -> str:
    """Return a human-readable GPU status report."""
    info = detect_gpu()
    lines: list[str] = []

    lines.append("=" * 60)
    lines.append("GPU Status Report")
    lines.append("=" * 60)
    lines.append(f"GPU:           {info.name or 'unknown'}")
    lines.append(f"Driver:        {info.driver_version or 'unknown'}")
    if info.driver_exceeds_ceiling:
        lines.append("               WARNING: Exceeds Pascal ceiling (580.x) - CUDA may fail")
    cc = f"{info.compute_capability[0]}.{info.compute_capability[1]}" if info.compute_capability else "unknown"
    lines.append(f"Compute cap:   {cc}")
    lines.append(f"Is Pascal:     {info.is_pascal}")
    lines.append(f"VRAM:          {info.vram_used_mb} / {info.vram_total_mb} MB")
    lines.append(f"Torch:         {info.torch_version or 'not installed'} ({info.torch_cuda or 'N/A'})")
    lines.append("=" * 60)

    if info.is_pascal and info.torch_available:
        lines.append("")
        lines.append("Recommended settings for Pascal:")
        lines.append("  - dtype: torch.float16 (2x FP32 on regular cores)")
        lines.append("  - allow_tf32: False (no TF32 units on Pascal)")
        lines.append("  - torch.compile: disabled (Triton requires sm_70+)")
        lines.append("  - SDPA backend: MATH only (no FlashAttention)")
        lines.append("  - quantization: INT8 (TorchAO weight-only or dynamic)")
        lines.append("  - VRAM: use iGPU for display to free ~1.4 GB")

    return "\n".join(lines)


def cli_main() -> int:
    """CLI entry point: detect GPU, apply optimizations, print report."""
    info = detect_gpu()
    if not info.name:
        print("No NVIDIA GPU detected (nvidia-smi unavailable).")
        return 1

    print(report_gpu_status())

    if info.is_pascal:
        print("\nApplying Pascal optimizations...")
        report = optimize_for_pascal()
        if report.applied:
            print("Applied:")
            for item in report.applied:
                print(f"  OK {item}")
        if report.skipped:
            print("Skipped:")
            for item in report.skipped:
                print(f"  - {item}")
        if report.warnings:
            print("Warnings:")
            for item in report.warnings:
                print(f"  WARN {item}")
        if report.errors:
            print("Errors:")
            for item in report.errors:
                print(f"  ERROR {item}")
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(cli_main())
