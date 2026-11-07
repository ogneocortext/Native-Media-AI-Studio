"""Test Analytics API endpoints.

Provides endpoints for querying historical test run data,
version checkpoints, and development phase analytics.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.database import (
    complete_version_checkpoint,
    count_test_runs,
    create_version_checkpoint,
    get_phase_durations,
    get_test_results_for_run,
    get_test_run,
    get_test_run_summary,
    get_test_runs,
    get_test_trends,
    get_version_checkpoint,
    get_version_checkpoints,
)

router = APIRouter(prefix="/api/test-analytics", tags=["test-analytics"])


@router.get("/runs")
async def list_test_runs(
    gate_name: str | None = Query(None, description="Filter by gate name (pytest, unit, lint, etc.)"),
    limit: int = Query(50, ge=1, le=500, description="Max results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    app_version: str | None = Query(None, description="Filter by app version"),
):
    """List test runs with optional filtering."""
    runs = get_test_runs(gate_name=gate_name, limit=limit, offset=offset, app_version=app_version)
    return {
        "runs": [
            {
                "id": r.id,
                "gate_name": r.gate_name,
                "suite_name": r.suite_name,
                "total_tests": r.total_tests,
                "passed": r.passed,
                "failed": r.failed,
                "skipped": r.skipped,
                "errors": r.errors,
                "duration_ms": r.duration_ms,
                "success_rate": r.success_rate,
                "git_commit": r.git_commit,
                "git_branch": r.git_branch,
                "app_version": r.app_version,
                "environment": r.environment,
                "machine_id": r.machine_id,
                "created_at": r.created_at,
            }
            for r in runs
        ],
        "total": count_test_runs(gate_name=gate_name, app_version=app_version),
        "limit": limit,
        "offset": offset,
    }


@router.get("/runs/{run_id}")
async def get_test_run_detail(run_id: str):
    """Get detailed test run with individual test results."""
    run = get_test_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Test run not found")

    results = get_test_results_for_run(run_id)

    return {
        "run": {
            "id": run.id,
            "gate_name": run.gate_name,
            "suite_name": run.suite_name,
            "total_tests": run.total_tests,
            "passed": run.passed,
            "failed": run.failed,
            "skipped": run.skipped,
            "errors": run.errors,
            "duration_ms": run.duration_ms,
            "success_rate": run.success_rate,
            "git_commit": run.git_commit,
            "git_branch": run.git_branch,
            "app_version": run.app_version,
            "environment": run.environment,
            "machine_id": run.machine_id,
            "created_at": run.created_at,
        },
        "results": [
            {
                "id": r.id,
                "test_name": r.test_name,
                "file_path": r.file_path,
                "status": r.status,
                "duration_ms": r.duration_ms,
                "error_message": r.error_message,
                "error_type": r.error_type,
                "traceback": r.traceback,
                "created_at": r.created_at,
            }
            for r in results
        ],
    }


@router.get("/summary")
async def get_summary(
    gate_name: str | None = Query(None, description="Filter by gate name"),
    days: int = Query(30, ge=1, le=365, description="Lookback period in days"),
):
    """Get summary statistics for test runs."""
    return get_test_run_summary(gate_name=gate_name, days=days)


@router.get("/trends/{gate_name}")
async def get_trends(
    gate_name: str,
    days: int = Query(30, ge=1, le=365, description="Lookback period in days"),
):
    """Get daily trend data for a specific gate."""
    return get_test_trends(gate_name, days)


@router.get("/version-checkpoints")
async def list_version_checkpoints(
    *,
    active_only: bool = Query(default=False, description="Only active (incomplete) checkpoints"),
    limit: int = Query(50, ge=1, le=200, description="Max results"),
):
    """List version checkpoints."""
    checkpoints = get_version_checkpoints(active_only=active_only, limit=limit)
    return {
        "checkpoints": [
            {
                "id": c.id,
                "version": c.version,
                "phase": c.phase,
                "milestone": c.milestone,
                "description": c.description,
                "git_commit": c.git_commit,
                "git_branch": c.git_branch,
                "started_at": c.started_at,
                "completed_at": c.completed_at,
                "duration_days": c.duration_days,
                "is_active": bool(c.is_active),
                "metadata": c.metadata,
            }
            for c in checkpoints
        ],
    }


@router.get("/version-checkpoints/{version}")
async def get_version_checkpoint_detail(version: str):
    """Get a specific version checkpoint."""
    checkpoint = get_version_checkpoint(version)
    if not checkpoint:
        raise HTTPException(status_code=404, detail="Version checkpoint not found")

    return {
        "id": checkpoint.id,
        "version": checkpoint.version,
        "phase": checkpoint.phase,
        "milestone": checkpoint.milestone,
        "description": checkpoint.description,
        "git_commit": checkpoint.git_commit,
        "git_branch": checkpoint.git_branch,
        "started_at": checkpoint.started_at,
        "completed_at": checkpoint.completed_at,
        "duration_days": checkpoint.duration_days,
        "is_active": bool(checkpoint.is_active),
        "metadata": checkpoint.metadata,
    }


@router.post("/version-checkpoints")
async def create_version_checkpoint_endpoint(
    version: str = Query(..., description="Version string (e.g., 2.5.0)"),
    phase: str = Query(..., description="Phase: planning, development, testing, release, maintenance"),
    milestone: str | None = Query(None, description="Milestone label (e.g., v2.5-alpha)"),
    description: str | None = Query(None, description="Human-readable description"),
):
    """Create a new version checkpoint (start of a phase)."""
    checkpoint_id = create_version_checkpoint(
        version=version,
        phase=phase,
        milestone=milestone,
        description=description,
    )
    return {"id": checkpoint_id, "version": version, "phase": phase, "status": "created"}


@router.post("/version-checkpoints/{version}/complete")
async def complete_version_checkpoint_endpoint(
    version: str,
    metadata: dict | None = None,
):
    """Mark a version checkpoint as completed."""
    success = complete_version_checkpoint(version, metadata=metadata)
    if not success:
        raise HTTPException(status_code=404, detail="Active checkpoint not found for version")
    return {"version": version, "status": "completed"}


@router.get("/phase-durations")
async def get_phase_duration_stats():
    """Get duration statistics per development phase."""
    return get_phase_durations()
