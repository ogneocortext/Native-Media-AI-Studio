"""Database operations for job queue."""
import asyncio
import json
import logging
import sqlite3
import time
from datetime import datetime

from ..core.connection import get_db
from ..models.job import Job, JobStatus, JobType

logger = logging.getLogger(__name__)

# Slow query threshold: log any DB query taking longer than this (seconds).
SLOW_QUERY_THRESHOLD_SECONDS = 0.5

# Retry config for "database is locked" errors during write operations.
DB_WRITE_MAX_RETRIES = 5
DB_WRITE_BASE_DELAY = 0.1  # seconds, doubles each retry


class JobDatabaseManager:
    """Manages job persistence in SQLite."""

    @staticmethod
    def _run_sync(func, *args, **kwargs):
        """Run a sync DB function in a thread to avoid blocking the event loop."""
        return asyncio.to_thread(func, *args, **kwargs)

    @staticmethod
    def _retry_on_locked(func, *args, **kwargs):
        """Run a DB write function with exponential backoff on 'database is locked'."""
        last_exc = None
        for attempt in range(DB_WRITE_MAX_RETRIES):
            try:
                return func(*args, **kwargs)
            except sqlite3.OperationalError as exc:
                if "database is locked" not in str(exc).lower():
                    raise
                last_exc = exc
                if attempt < DB_WRITE_MAX_RETRIES - 1:
                    delay = DB_WRITE_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "DB write locked on attempt %d/%d, retrying in %.2fs: %s",
                        attempt + 1, DB_WRITE_MAX_RETRIES, delay, exc,
                    )
                    time.sleep(delay)
        raise last_exc

    @staticmethod
    def _timed_execute(conn, sql, params=(), label=""):
        """Execute a statement, logging if it exceeds the slow query threshold."""
        start = time.monotonic()
        try:
            return conn.execute(sql, params)
        finally:
            elapsed = time.monotonic() - start
            if elapsed > SLOW_QUERY_THRESHOLD_SECONDS:
                # Params can carry job payloads (prompts, file paths) - log
                # shape only, never values.
                shape = ",".join(
                    f"{type(p).__name__}:{len(p) if isinstance(p, (str, bytes)) else '-'}"
                    for p in params
                )
                logger.warning(
                    "Slow DB query (%.3fs): %s ... params(%d) [%s]",
                    elapsed, label or sql[:80], len(params), shape,
                )

    @staticmethod
    def execute_batch(statements: list[tuple[str, tuple]]) -> None:
        """Execute multiple statements in a single transaction.

        Each item is ``(sql, params_tuple)``. All statements run in one
        transaction so they commit atomically. This reduces the per-statement
        open/commit overhead and is the preferred path for bulk updates.
        """
        def _run():
            with get_db() as conn:
                for sql, params in statements:
                    JobDatabaseManager._timed_execute(conn, sql, params, label="batch")

        JobDatabaseManager._retry_on_locked(_run)

    @staticmethod
    async def create_job_async(job: Job) -> Job:
        """Async wrapper for create_job."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.create_job, job)

    @staticmethod
    async def get_job_async(job_id: str) -> Job | None:
        """Async wrapper for get_job."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.get_job, job_id)

    @staticmethod
    async def get_all_jobs_async() -> list[Job]:
        """Async wrapper for get_all_jobs."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.get_all_jobs)

    @staticmethod
    async def get_jobs_by_status_async(status: JobStatus) -> list[Job]:
        """Async wrapper for get_jobs_by_status."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.get_jobs_by_status, status)

    @staticmethod
    async def update_job_async(job_id: str, **kwargs) -> Job | None:
        """Async wrapper for update_job."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.update_job, job_id, **kwargs)

    @staticmethod
    async def delete_job_async(job_id: str) -> bool:
        """Async wrapper for delete_job."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.delete_job, job_id)

    @staticmethod
    async def clear_completed_async() -> int:
        """Async wrapper for clear_completed."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.clear_completed)

    @staticmethod
    async def clear_failed_async() -> int:
        """Async wrapper for clear_failed."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.clear_failed)

    @staticmethod
    async def clear_status_async(status: JobStatus) -> int:
        """Async wrapper for clear_status."""
        return await JobDatabaseManager._run_sync(JobDatabaseManager.clear_status, status)

    @staticmethod
    async def delete_jobs_batch_async(job_ids: list[str]) -> int:
        """Async wrapper for delete_jobs_batch."""
        if not job_ids:
            return 0
        return await JobDatabaseManager._run_sync(JobDatabaseManager.delete_jobs_batch, job_ids)

    @staticmethod
    async def execute_batch_async(statements: list[tuple[str, tuple]]) -> None:
        """Async wrapper for execute_batch."""
        await JobDatabaseManager._run_sync(JobDatabaseManager.execute_batch, statements)

    @staticmethod
    def create_job(job: Job) -> Job:
        """Insert a new job into the database."""

        def _run():
            with get_db() as conn:
                JobDatabaseManager._timed_execute(
                    conn,
                    '''
                    INSERT INTO jobs (id, job_type, status, created_at, progress, message, params, retry_count, max_retries, output_path, priority)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''',
                    (
                        job.id,
                        job.job_type.value if isinstance(job.job_type, JobType) else job.job_type,
                        job.status.value if isinstance(job.status, JobStatus) else job.status,
                        job.created_at.isoformat(),
                        job.progress,
                        job.message,
                        json.dumps(job.params),
                        job.retry_count,
                        job.max_retries,
                        job.output_path,
                        job.priority,
                    ),
                    label="create_job",
                )
            return job

        return JobDatabaseManager._retry_on_locked(_run)

    @staticmethod
    def get_job(job_id: str) -> Job | None:
        """Get a job by ID."""
        with get_db() as conn:
            row = conn.execute('SELECT * FROM jobs WHERE id = ?', (job_id,)).fetchone()
            if row:
                return JobDatabaseManager._row_to_job(row)
        return None

    @staticmethod
    def get_all_jobs() -> list[Job]:
        """Get all jobs sorted by creation time (newest first)."""
        with get_db() as conn:
            rows = conn.execute('SELECT * FROM jobs ORDER BY created_at DESC').fetchall()
            return [JobDatabaseManager._row_to_job(row) for row in rows]

    @staticmethod
    def get_jobs_by_status(status: JobStatus) -> list[Job]:
        """Get jobs filtered by status."""
        status_value = status.value if isinstance(status, JobStatus) else status
        with get_db() as conn:
            rows = conn.execute(
                'SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC',
                (status_value,),
            ).fetchall()
            return [JobDatabaseManager._row_to_job(row) for row in rows]

    # Columns that may be updated via update_job (prevents arbitrary SQL fragments)
    # ``created_at`` and ``job_type`` are intentionally excluded: they are
    # immutable once set and allowing updates risks data inconsistency.
    _UPDATABLE_COLUMNS = frozenset({
        'status', 'started_at', 'completed_at',
        'progress', 'message', 'error', 'result', 'params', 'output_path',
        'retry_count', 'max_retries', 'priority',
    })

    @staticmethod
    def update_job(job_id: str, **kwargs) -> Job | None:
        """Update job fields."""
        kwargs = {
            key: value for key, value in kwargs.items()
            if key in JobDatabaseManager._UPDATABLE_COLUMNS
        }
        if not kwargs:
            return JobDatabaseManager.get_job(job_id)

        set_clauses = []
        values = []
        for key, value in kwargs.items():
            if key == 'status' and isinstance(value, JobStatus):
                value = value.value
            if key == 'job_type' and isinstance(value, JobType):
                value = value.value
            if key in ('result', 'params') and isinstance(value, dict):
                value = json.dumps(value)
            if key in ('started_at', 'completed_at') and isinstance(value, datetime):
                value = value.isoformat()
            set_clauses.append(f"{key} = ?")
            values.append(value)

        values.append(job_id)

        def _run():
            with get_db() as conn:
                JobDatabaseManager._timed_execute(
                    conn,
                    f'UPDATE jobs SET {", ".join(set_clauses)} WHERE id = ?',
                    values,
                    label="update_job",
                )
            return JobDatabaseManager.get_job(job_id)

        return JobDatabaseManager._retry_on_locked(_run)

    @staticmethod
    def delete_job(job_id: str) -> bool:
        """Delete a job."""

        def _run():
            with get_db() as conn:
                cursor = JobDatabaseManager._timed_execute(
                    conn,
                    'DELETE FROM jobs WHERE id = ?',
                    (job_id,),
                    label="delete_job",
                )
                return cursor.rowcount > 0

        return JobDatabaseManager._retry_on_locked(_run)

    @staticmethod
    def clear_completed() -> int:
        """Delete completed and cancelled jobs."""

        def _run():
            with get_db() as conn:
                cursor = JobDatabaseManager._timed_execute(
                    conn,
                    "DELETE FROM jobs WHERE status IN ('completed', 'cancelled')",
                    (),
                    label="clear_completed",
                )
                return cursor.rowcount

        return JobDatabaseManager._retry_on_locked(_run)

    @staticmethod
    def clear_failed() -> int:
        """Delete failed jobs."""

        def _run():
            with get_db() as conn:
                cursor = JobDatabaseManager._timed_execute(
                    conn,
                    "DELETE FROM jobs WHERE status = 'failed'",
                    (),
                    label="clear_failed",
                )
                return cursor.rowcount

        return JobDatabaseManager._retry_on_locked(_run)

    @staticmethod
    def clear_status(status: JobStatus) -> int:
        """Delete jobs with a given status."""
        status_value = status.value if isinstance(status, JobStatus) else status

        def _run():
            with get_db() as conn:
                cursor = JobDatabaseManager._timed_execute(
                    conn,
                    "DELETE FROM jobs WHERE status = ?",
                    (status_value,),
                    label="clear_status",
                )
                return cursor.rowcount

        return JobDatabaseManager._retry_on_locked(_run)

    @staticmethod
    def _row_to_job(row) -> Job:
        """Convert a database row to a Job model."""
        return Job(
            id=row['id'],
            job_type=JobType(row['job_type']),
            status=JobStatus(row['status']),
            created_at=datetime.fromisoformat(row['created_at']),
            started_at=datetime.fromisoformat(row['started_at']) if row['started_at'] else None,
            completed_at=datetime.fromisoformat(row['completed_at']) if row['completed_at'] else None,
            progress=row['progress'],
            message=row['message'] or '',
            error=row['error'],
            result=json.loads(row['result']) if row['result'] else None,
            params=json.loads(row['params']),
            output_path=row['output_path'],
            retry_count=row['retry_count'],
            max_retries=row['max_retries'],
            priority=row['priority'] if 'priority' in row.keys() else 0,
        )
