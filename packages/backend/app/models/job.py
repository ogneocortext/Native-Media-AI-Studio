"""
Job models for queue management.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator


class JobStatus(StrEnum):
    """Job lifecycle states"""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"
    DEAD = "dead"  # Dead-letter queue: exceeded max retries


class JobType(StrEnum):
    """Types of generation jobs"""

    IMAGE_GENERATION = "image_generation"
    MUSIC_VIDEO = "music_video"
    MUSIC_VIDEO_PREVIEW = "music_video_preview"
    AUDIO_ANALYSIS = "audio_analysis"
    VISUALIZER = "visualizer"
    SCENE_RENDER = "scene_render"
    NARRATIVE_VIDEO = "narrative_video"
    STORYBOARD_GENERATION = "storyboard_generation"
    COMFYUI_WORKFLOW = "comfyui_workflow"
    AUDIO_FEATURE_EXTRACTION = "audio_feature_extraction"
    LIPSYNC = "lipsync"
    REMIX_BUILD = "remix_build"
    REMIX_ENHANCE = "remix_enhance"
    REMOTION_RENDER = "remotion_render"


class Job(BaseModel):
    """Generation job model"""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_type: JobType
    status: JobStatus = JobStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    progress: float = Field(0.0, ge=0.0, le=1.0)
    message: str = ""
    error: str | None = None
    result: dict[str, Any] | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    output_path: str | None = None
    retry_count: int = Field(0, ge=0)
    max_retries: int = Field(3, ge=0, le=100)
    priority: int = Field(0, description="Higher priority runs first; tie-break by created_at")

    model_config = ConfigDict(
        use_enum_values=True,
        json_schema_extra={
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "job_type": "audio_analysis",
                "status": "queued",
                "progress": 0.0,
                "params": {"audio_path": "/path/to/audio.wav", "section": "chorus"},
                "priority": 5,
                "max_retries": 3,
            }
        },
    )

    @model_validator(mode="after")
    def _validate_retry_budget(self) -> "Job":
        """retry_count cannot exceed max_retries."""
        if self.retry_count > self.max_retries:
            raise ValueError(
                f"retry_count ({self.retry_count}) cannot exceed max_retries ({self.max_retries})"
            )
        return self

    @model_validator(mode="after")
    def _validate_timestamps(self) -> "Job":
        """started_at must be >= created_at; completed_at must be >= started_at."""
        if self.started_at is not None and self.started_at < self.created_at:
            raise ValueError("started_at must be >= created_at")
        if self.completed_at is not None and self.started_at is not None:
            if self.completed_at < self.started_at:
                raise ValueError("completed_at must be >= started_at")
        return self

    @computed_field
    @property
    def is_active(self) -> bool:
        """True when job is in a non-terminal state."""
        return self.status in {
            JobStatus.PENDING,
            JobStatus.QUEUED,
            JobStatus.RUNNING,
            JobStatus.RETRYING,
        }

    @computed_field
    @property
    def is_terminal(self) -> bool:
        """True when job has reached a final state.

        ``DEAD`` is terminal: the processor moves exhausted jobs to the
        dead-letter queue, and omitting it made every dead job report
        ``is_terminal: false`` to API clients.
        """
        return self.status in {
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
            JobStatus.DEAD,
        }

    @computed_field
    @property
    def has_error(self) -> bool:
        """True when job failed or has an error message."""
        return self.status in {JobStatus.FAILED, JobStatus.DEAD} or self.error is not None

    @computed_field
    @property
    def duration_seconds(self) -> float | None:
        """Elapsed time from start to completion (or now if still running)."""
        if self.started_at is None:
            return None
        end = self.completed_at or datetime.now()
        return (end - self.started_at).total_seconds()

    @computed_field
    @property
    def can_retry(self) -> bool:
        """True when job can be retried (unsuccessful and under max retries).

        ``DEAD`` is included because ``POST /api/jobs/{id}/retry`` accepts both
        ``FAILED`` and ``DEAD`` -- this field used to contradict the endpoint.
        """
        return (
            self.status in {JobStatus.FAILED, JobStatus.DEAD}
            and self.retry_count < self.max_retries
        )

    @computed_field
    @property
    def can_cancel(self) -> bool:
        """True when job is in a cancellable state.

        ``RETRYING`` is included: the job is waiting out its backoff in
        memory, still fully owned by the queue, and cancelling it there is
        the only way to stop a retry before it re-runs.
        """
        return self.status in {
            JobStatus.PENDING,
            JobStatus.QUEUED,
            JobStatus.RUNNING,
            JobStatus.RETRYING,
        }


class JobCreateRequest(BaseModel):
    """Request to create a new job"""

    job_type: JobType
    params: dict[str, Any] = Field(default_factory=dict)
    max_retries: int = Field(3, ge=0, le=100)
    priority: int = Field(0, description="Higher priority runs first; tie-break by created_at")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "job_type": "audio_analysis",
                "params": {"audio_path": "/path/to/audio.wav", "section": "chorus"},
                "max_retries": 3,
                "priority": 5,
            }
        }
    )


class JobUpdateRequest(BaseModel):
    """Request to update job status"""

    status: JobStatus | None = None
    progress: float | None = Field(None, ge=0.0, le=1.0)
    message: str | None = None
    error: str | None = None
    result: dict[str, Any] | None = None


class QueueStats(BaseModel):
    """Queue statistics"""

    total_jobs: int = 0
    pending: int = 0
    queued: int = 0
    running: int = 0
    retrying: int = 0
    completed: int = 0
    failed: int = 0
    cancelled: int = 0
    dead: int = 0  # Dead-letter queue count

    @computed_field
    @property
    def active_jobs(self) -> int:
        """Jobs currently being processed or waiting."""
        return self.pending + self.queued + self.running + self.retrying

    @computed_field
    @property
    def terminal_jobs(self) -> int:
        """Jobs that have reached a final state.

        ``failed`` already includes ``DEAD`` (``_UNSUCCESSFUL_STATUSES``),
        so adding ``dead`` again double-counted every dead-lettered job -
        terminal_jobs read 131 against a total_jobs of 104.
        """
        return self.completed + self.failed + self.cancelled

    @computed_field
    @property
    def success_rate(self) -> float:
        """Percentage of completed jobs vs terminal jobs."""
        terminal = self.terminal_jobs
        if terminal == 0:
            return 0.0
        return round(self.completed / terminal * 100, 1)

    @computed_field
    @property
    def is_healthy(self) -> bool:
        """Queue health: healthy if no failed jobs or failures are minority."""
        terminal = self.terminal_jobs
        if terminal == 0:
            return True
        return self.failed / terminal < 0.5


class QueueMetrics(BaseModel):
    """Extended queue metrics for observability."""

    stats: QueueStats
    queue_depth: int = 0  # jobs waiting to be processed (queued + pending)
    current_job_id: str | None = None
    current_job_type: str | None = None
    current_job_started_at: str | None = None
    processing_rate_per_min: float = 0.0
    avg_wait_seconds: float = 0.0
    avg_duration_seconds: float = 0.0
    dead_letter_count: int = 0
    dead_letter_sample: list[dict] = []  # sample of DLQ jobs (id, type, error, failed_at)
