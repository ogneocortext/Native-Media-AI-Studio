"""
Job models for queue management.
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, computed_field


class JobStatus(str, Enum):
    """Job lifecycle states"""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"


class JobType(str, Enum):
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


class Job(BaseModel):
    """Generation job model"""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_type: JobType
    status: JobStatus = JobStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    progress: float = 0.0
    message: str = ""
    error: str | None = None
    result: dict[str, Any] | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    output_path: str | None = None
    retry_count: int = 0
    max_retries: int = 3

    model_config = ConfigDict(use_enum_values=True)

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
        """True when job has reached a final state."""
        return self.status in {
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
        }

    @computed_field
    @property
    def has_error(self) -> bool:
        """True when job failed or has an error message."""
        return self.status == JobStatus.FAILED or self.error is not None

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
        """True when job can be retried (failed and under max retries)."""
        return self.status == JobStatus.FAILED and self.retry_count < self.max_retries

    @computed_field
    @property
    def can_cancel(self) -> bool:
        """True when job is in a cancellable state."""
        return self.status in {JobStatus.PENDING, JobStatus.QUEUED, JobStatus.RUNNING}


class JobCreateRequest(BaseModel):
    """Request to create a new job"""

    job_type: JobType
    params: dict[str, Any] = Field(default_factory=dict)
    max_retries: int = 3


class JobUpdateRequest(BaseModel):
    """Request to update job status"""

    status: JobStatus | None = None
    progress: float | None = None
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

    @computed_field
    @property
    def active_jobs(self) -> int:
        """Jobs currently being processed or waiting."""
        return self.pending + self.queued + self.running + self.retrying

    @computed_field
    @property
    def terminal_jobs(self) -> int:
        """Jobs that have reached a final state."""
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
