"""FastAPI routes for hardware discovery and benchmark history."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..core.database import (
    delete_benchmark_results,
    get_benchmark_result,
    list_benchmark_results,
)
from ..core.hardware_profile import load_hardware_profile
from ..services.hardware_benchmark import (
    BenchmarkRequest,
    BenchmarkResult,
    HardwareBenchmarkRunner,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hardware", tags=["Hardware"])
_runner = HardwareBenchmarkRunner()


@router.get("/profile", response_model=dict[str, Any])
async def hardware_profile(refresh: bool = False) -> dict[str, Any]:
    """Return the workstation profile and its conservative limits."""

    return load_hardware_profile(refresh=refresh).model_dump(mode="json")


@router.post("/benchmark", response_model=BenchmarkResult)
async def run_benchmark(request: BenchmarkRequest) -> BenchmarkResult:
    """Run a bounded Ollama or ComfyUI benchmark and persist its result."""

    try:
        return await _runner.run(request)
    except Exception as exc:
        logger.exception("Unable to start hardware benchmark")
        raise HTTPException(status_code=503, detail=f"Benchmark service unavailable: {exc}") from exc


@router.get("/benchmarks", response_model=list[dict[str, Any]])
async def benchmark_history(
    engine: str | None = Query(default=None, description="ollama or comfyui"),
    model: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    """List persisted benchmark runs, newest first."""

    try:
        return list_benchmark_results(
            engine=engine,
            model=model,
            status=status,
            limit=limit,
        )
    except Exception as exc:
        logger.exception("Unable to read benchmark history")
        raise HTTPException(status_code=500, detail=f"Benchmark history unavailable: {exc}") from exc


@router.get("/benchmarks/{run_id}", response_model=dict[str, Any])
async def benchmark_detail(run_id: str) -> dict[str, Any]:
    """Return one persisted benchmark run."""

    result = get_benchmark_result(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Benchmark not found")
    return result


@router.delete("/benchmarks")
async def clear_benchmark_history(older_than_days: int = Query(default=30, ge=0)) -> dict[str, int]:
    """Delete benchmark history older than a retention window."""

    return {"deleted": delete_benchmark_results(older_than_days=older_than_days)}
