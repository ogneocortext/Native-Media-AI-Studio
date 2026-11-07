"""
Test Analytics CRUD operations.

Provides persistence for test run results, individual test results,
and version checkpoint tracking for historical analytics.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import uuid
from datetime import UTC, datetime
from typing import Any

from .connection import DB_PATH, get_db
from .models import TestResultRow, TestRunRow, VersionCheckpointRow


def _get_machine_id() -> str:
    """Generate a stable machine identifier."""
    try:
        # Use hostname + MAC-like hash for identification
        hostname = socket.gethostname()
        return f"{hostname}-{hash(hostname) % 10000:04d}"
    except Exception:
        return f"unknown-{os.getpid()}"


def _get_git_info() -> tuple[str | None, str | None]:
    """Get current git commit and branch."""
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(DB_PATH.parent.parent.parent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5,
        ).stdout.strip()
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(DB_PATH.parent.parent.parent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5,
        ).stdout.strip()
        return commit or None, branch or None
    except Exception:
        return None, None


def get_app_version() -> str | None:
    """Get app version from config or git tags."""
    try:
        # Try to get version from git describe
        version = subprocess.run(
            ["git", "describe", "--tags", "--always"],
            cwd=str(DB_PATH.parent.parent.parent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=5,
        ).stdout.strip()
        return version or None
    except Exception:
        return None


# ===========================================================================
# Test Runs CRUD
# ===========================================================================

def save_test_run(
    gate_name: str,
    total_tests: int,
    passed: int,
    failed: int,
    skipped: int,
    errors: int,
    duration_ms: int,
    suite_name: str | None = None,
    app_version: str | None = None,
    environment: str | None = None,
) -> str:
    """Save a test run aggregate result. Returns the run ID."""
    run_id = str(uuid.uuid4())
    git_commit, git_branch = _get_git_info()
    machine_id = _get_machine_id()
    success_rate = (passed / total_tests * 100) if total_tests > 0 else 0.0
    if app_version is None:
        app_version = get_app_version()
    if environment is None:
        environment = os.environ.get("NMA_ENV", "development")

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO test_runs (
                id, gate_name, suite_name, total_tests, passed, failed, skipped,
                errors, duration_ms, success_rate, git_commit, git_branch,
                app_version, environment, machine_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                gate_name,
                suite_name,
                total_tests,
                passed,
                failed,
                skipped,
                errors,
                duration_ms,
                success_rate,
                git_commit,
                git_branch,
                app_version,
                environment,
                machine_id,
            ),
        )
    return run_id


def save_test_results(run_id: str, results: list[dict[str, Any]]) -> None:
    """Save individual test results for a run."""
    if not results:
        return

    with get_db() as conn:
        for result in results:
            test_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO test_results (
                    id, run_id, test_name, file_path, status, duration_ms,
                    error_message, error_type, traceback
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    test_id,
                    run_id,
                    result.get("name", "unknown"),
                    result.get("file_path"),
                    result.get("status", "unknown"),
                    result.get("duration_ms", 0),
                    result.get("error_message"),
                    result.get("error_type"),
                    result.get("traceback"),
                ),
            )


def count_test_runs(
    gate_name: str | None = None,
    app_version: str | None = None,
) -> int:
    """Count test runs matching the same filters as get_test_runs."""
    query = "SELECT COUNT(*) FROM test_runs WHERE 1=1"
    params: list[Any] = []
    if gate_name:
        query += " AND gate_name = ?"
        params.append(gate_name)
    if app_version:
        query += " AND app_version = ?"
        params.append(app_version)
    with get_db() as conn:
        return int(conn.execute(query, params).fetchone()[0])


def get_test_runs(
    gate_name: str | None = None,
    limit: int = 100,
    offset: int = 0,
    app_version: str | None = None,
) -> list[TestRunRow]:
    """Get test runs with optional filtering."""
    query = "SELECT * FROM test_runs WHERE 1=1"
    params: list[Any] = []

    if gate_name:
        query += " AND gate_name = ?"
        params.append(gate_name)
    if app_version:
        query += " AND app_version = ?"
        params.append(app_version)

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with get_db() as conn:
        conn.row_factory = None
        rows = conn.execute(query, params).fetchall()

    return [
        TestRunRow(
            id=r[0],
            gate_name=r[1],
            suite_name=r[2],
            total_tests=r[3],
            passed=r[4],
            failed=r[5],
            skipped=r[6],
            errors=r[7],
            duration_ms=r[8],
            success_rate=r[9],
            git_commit=r[10],
            git_branch=r[11],
            app_version=r[12],
            environment=r[13],
            machine_id=r[14],
            created_at=r[15],
        )
        for r in rows
    ]


def get_test_run(run_id: str) -> TestRunRow | None:
    """Get a single test run by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM test_runs WHERE id = ?", (run_id,)
        ).fetchone()
        if not row:
            return None
        return TestRunRow(
            id=row[0],
            gate_name=row[1],
            suite_name=row[2],
            total_tests=row[3],
            passed=row[4],
            failed=row[5],
            skipped=row[6],
            errors=row[7],
            duration_ms=row[8],
            success_rate=row[9],
            git_commit=row[10],
            git_branch=row[11],
            app_version=row[12],
            environment=row[13],
            machine_id=row[14],
            created_at=row[15],
        )


def get_test_results_for_run(run_id: str) -> list[TestResultRow]:
    """Get all individual test results for a run."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM test_results WHERE run_id = ? ORDER BY created_at",
            (run_id,),
        ).fetchall()

    return [
        TestResultRow(
            id=r[0],
            run_id=r[1],
            test_name=r[2],
            file_path=r[3],
            status=r[4],
            duration_ms=r[5],
            error_message=r[6],
            error_type=r[7],
            traceback=r[8],
            created_at=r[9],
        )
        for r in rows
    ]


def get_test_run_summary(gate_name: str | None = None, days: int = 30) -> dict[str, Any]:
    """Get summary statistics for test runs."""
    with get_db() as conn:
        query = """
            SELECT
                gate_name,
                COUNT(*) as run_count,
                AVG(success_rate) as avg_success_rate,
                AVG(duration_ms) as avg_duration_ms,
                SUM(total_tests) as total_tests,
                SUM(passed) as total_passed,
                SUM(failed) as total_failed,
                SUM(skipped) as total_skipped,
                SUM(errors) as total_errors,
                MIN(created_at) as first_run,
                MAX(created_at) as last_run
            FROM test_runs
            WHERE created_at >= datetime('now', ?)
        """
        params = [f"-{days} days"]
        if gate_name:
            query += " AND gate_name = ?"
            params.append(gate_name)
        query += " GROUP BY gate_name"

        rows = conn.execute(query, params).fetchall()

    return {
        row[0]: {
            "gate_name": row[0],
            "run_count": row[1],
            "avg_success_rate": round(row[2], 2) if row[2] else 0,
            "avg_duration_ms": round(row[3]) if row[3] else 0,
            "total_tests": row[4] or 0,
            "total_passed": row[5] or 0,
            "total_failed": row[6] or 0,
            "total_skipped": row[7] or 0,
            "total_errors": row[8] or 0,
            "first_run": row[9],
            "last_run": row[10],
        }
        for row in rows
    }


def get_test_trends(gate_name: str, days: int = 30) -> list[dict[str, Any]]:
    """Get daily trend data for a gate."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                date(created_at) as day,
                COUNT(*) as runs,
                AVG(success_rate) as avg_success_rate,
                AVG(duration_ms) as avg_duration_ms,
                SUM(passed) as passed,
                SUM(failed) as failed
            FROM test_runs
            WHERE gate_name = ? AND created_at >= datetime('now', ?)
            GROUP BY date(created_at)
            ORDER BY day
            """,
            (gate_name, f"-{days} days"),
        ).fetchall()

    return [
        {
            "day": r[0],
            "runs": r[1],
            "avg_success_rate": round(r[2], 2) if r[2] else 0,
            "avg_duration_ms": round(r[3]) if r[3] else 0,
            "passed": r[4] or 0,
            "failed": r[5] or 0,
        }
        for r in rows
    ]


# ===========================================================================
# Version Checkpoints CRUD
# ===========================================================================

def create_version_checkpoint(
    version: str,
    phase: str,
    milestone: str | None = None,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Create a new version checkpoint (marks the start of a phase)."""
    checkpoint_id = str(uuid.uuid4())
    git_commit, git_branch = _get_git_info()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO version_checkpoints (
                id, version, phase, milestone, description, git_commit,
                git_branch, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                checkpoint_id,
                version,
                phase,
                milestone,
                description,
                git_commit,
                git_branch,
                json.dumps(metadata or {}),
            ),
        )
    return checkpoint_id


def complete_version_checkpoint(
    version: str,
    completed_at: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> bool:
    """Mark a version checkpoint as completed."""
    if completed_at is None:
        completed_at = datetime.now(UTC).isoformat()

    with get_db() as conn:
        # Get the checkpoint to calculate duration
        row = conn.execute(
            "SELECT started_at FROM version_checkpoints WHERE version = ? AND is_active = 1",
            (version,),
        ).fetchone()
        if not row:
            return False

        # started_at comes from SQLite datetime('now') → UTC, stored naive.
        # completed_at may be aware (new writes) or naive (legacy local-time
        # writes). Normalize both to aware UTC before subtracting — mixing
        # naive local and naive UTC produced negative duration_days.
        started = datetime.fromisoformat(row[0])
        if started.tzinfo is None:
            started = started.replace(tzinfo=UTC)
        completed_dt = datetime.fromisoformat(completed_at)
        if completed_dt.tzinfo is None:
            completed_dt = completed_dt.replace(tzinfo=UTC)
        duration_days = max(
            0.0, (completed_dt - started).total_seconds() / 86400
        )

        conn.execute(
            """
            UPDATE version_checkpoints
            SET completed_at = ?, duration_days = ?, is_active = 0,
                metadata = COALESCE(metadata, '{}') || ?
            WHERE version = ? AND is_active = 1
            """,
            (
                completed_at,
                duration_days,
                json.dumps(metadata or {}),
                version,
            ),
        )
    return True


def get_version_checkpoints(
    *,
    active_only: bool = False,
    limit: int = 50,
) -> list[VersionCheckpointRow]:
    """Get version checkpoints."""
    query = "SELECT * FROM version_checkpoints WHERE 1=1"
    params: list[Any] = []

    if active_only:
        query += " AND is_active = 1"

    query += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return [
        VersionCheckpointRow(
            id=r[0],
            version=r[1],
            phase=r[2],
            milestone=r[3],
            description=r[4],
            git_commit=r[5],
            git_branch=r[6],
            started_at=r[7],
            completed_at=r[8],
            duration_days=r[9],
            is_active=r[10],
            metadata=r[11],
        )
        for r in rows
    ]


def get_version_checkpoint(version: str) -> VersionCheckpointRow | None:
    """Get a specific version checkpoint."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM version_checkpoints WHERE version = ?", (version,)
        ).fetchone()
        if not row:
            return None
        return VersionCheckpointRow(
            id=row[0],
            version=row[1],
            phase=row[2],
            milestone=row[3],
            description=row[4],
            git_commit=row[5],
            git_branch=row[6],
            started_at=row[7],
            completed_at=row[8],
            duration_days=row[9],
            is_active=row[10],
            metadata=row[11],
        )


def get_phase_durations() -> list[dict[str, Any]]:
    """Get duration statistics per phase."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                phase,
                COUNT(*) as checkpoint_count,
                AVG(duration_days) as avg_duration_days,
                MIN(duration_days) as min_duration_days,
                MAX(duration_days) as max_duration_days,
                SUM(duration_days) as total_duration_days
            FROM version_checkpoints
            WHERE duration_days IS NOT NULL AND duration_days >= 0
            GROUP BY phase
            """
        ).fetchall()

    return [
        {
            "phase": r[0],
            "checkpoint_count": r[1],
            "avg_duration_days": round(r[2], 2) if r[2] else 0,
            "min_duration_days": round(r[3], 2) if r[3] else 0,
            "max_duration_days": round(r[4], 2) if r[4] else 0,
            "total_duration_days": round(r[5], 2) if r[5] else 0,
        }
        for r in rows
    ]
