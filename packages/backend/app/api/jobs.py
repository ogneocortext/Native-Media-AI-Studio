"""
Job queue API routes.
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from ..models.job import Job, JobCreateRequest, JobStatus, JobType, QueueStats
from ..queue.manager import queue_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])


@router.post("/", response_model=Job, status_code=201)
async def create_job(request: JobCreateRequest) -> Job:
    """Create a new job and add it to the queue.
    
    Creates the job with QUEUED status and broadcasts an SSE event
    (done inside queue_manager.enqueue).
    """
    logger.info("Creating job: type=%s", request.job_type)
    return await queue_manager.enqueue(request)


@router.get("", response_model=list[Job])
async def list_jobs(
    status: str | None = Query(
        None,
        description="Filter by status (pending, queued, running, completed, failed, cancelled)"
    )
) -> list[Job]:
    """List all jobs, optionally filtered by status."""
    if status:
        try:
            job_status = JobStatus(status.lower())
            return await queue_manager.get_jobs_by_status(job_status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    return await queue_manager.get_all_jobs()


@router.get("/stats", response_model=QueueStats)
async def get_queue_stats() -> QueueStats:
    """Get queue statistics."""
    return await queue_manager.get_stats()


@router.get("/types")
async def get_job_types() -> dict:
    """Get available job types."""
    return {"types": [t.value for t in JobType]}


@router.get("/{job_id}", response_model=Job)
async def get_job(job_id: str) -> Job:
    """Get a specific job by ID."""
    job = await queue_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/{job_id}/cancel", response_model=dict)
async def cancel_job(job_id: str) -> dict:
    """Cancel a pending, queued, or running job.
    
    Returns success if the job was successfully cancelled.
    Raises 404 if job not found, 400 if job cannot be cancelled.
    """
    job = await queue_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Check if job can be cancelled (pending, queued, or running)
    if job.status not in (JobStatus.PENDING, JobStatus.QUEUED, JobStatus.RUNNING):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status: {job.status}"
        )

    success = await queue_manager.cancel_job(job_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status: {job.status}"
        )

    return {"success": True, "message": "Job cancelled", "job_id": job_id}


@router.post("/{job_id}/retry", response_model=Job)
async def retry_job(job_id: str) -> Job:
    """Retry a failed job.
    
    Requeues the job for processing. Returns the updated job.
    Raises 404 if job not found, 400 if job is not failed or max retries exceeded.
    """
    existing_job = await queue_manager.get_job(job_id)
    if not existing_job:
        raise HTTPException(status_code=404, detail="Job not found")

    if existing_job.status != JobStatus.FAILED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry job with status: {existing_job.status}"
        )

    job = await queue_manager.retry_job(job_id)
    if not job:
        raise HTTPException(
            status_code=400,
            detail="Maximum retry attempts exceeded"
        )

    # queue_manager.retry_job already broadcast the "job.queued" event
    return job


@router.delete("/{job_id}", response_model=dict)
async def delete_job(job_id: str) -> dict:
    """Delete a job from the queue."""
    success = await queue_manager.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"success": True, "message": "Job deleted"}


@router.post("/clear-completed", response_model=dict)
async def clear_completed_jobs() -> dict:
    """Clear all completed and cancelled jobs."""
    count = await queue_manager.clear_completed()
    return {"success": True, "deleted": count}


@router.post("/clear-failed", response_model=dict)
async def clear_failed_jobs() -> dict:
    """Clear all failed jobs."""
    count = await queue_manager.clear_failed()
    return {"success": True, "deleted": count}
