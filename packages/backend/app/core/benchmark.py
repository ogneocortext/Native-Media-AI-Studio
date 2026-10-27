"""
Hardware Benchmark Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .connection import get_db


def _benchmark_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a hardware benchmark row to its API representation."""
    return {
        "run_id": row["run_id"],
        "engine": row["engine"],
        "model": row["model"],
        "status": row["status"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "duration_ms": row["duration_ms"],
        "iterations": row["iterations"],
        "successful_iterations": row["successful_iterations"],
        "request": _safe_json_loads(row["request"], {}),
        "metrics": _safe_json_loads(row["metrics"], {}),
        "result": _safe_json_loads(row["result"], {}),
        "error": row["error"],
        "profile": _safe_json_loads(row["profile"], {}),
        "created_at": row["created_at"],
    }


def insert_benchmark_result(record: dict[str, Any]) -> dict[str, Any]:
    """Persist one benchmark result and return the stored representation."""
    run_id = str(record.get("run_id") or uuid.uuid4())
    started_at = record.get("started_at") or datetime.now().isoformat()
    completed_at = record.get("completed_at")
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO hardware_benchmarks (
                run_id, engine, model, status, started_at, completed_at,
                duration_ms, iterations, successful_iterations, success,
                request, metrics, result, error, profile
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                record.get("engine", ""),
                record.get("model"),
                record.get("status", "failed"),
                started_at,
                completed_at,
                record.get("duration_ms"),
                int(record.get("iterations", 1) or 1),
                int(record.get("successful_iterations", 0) or 0),
                1 if record.get("success") else 0,
                json.dumps(record.get("request") or {}, ensure_ascii=False),
                json.dumps(record.get("metrics") or {}, ensure_ascii=False, default=str),
                json.dumps(record.get("result") or {}, ensure_ascii=False, default=str),
                record.get("error"),
                json.dumps(record.get("profile") or {}, ensure_ascii=False, default=str),
            ),
        )
        row = conn.execute(
            "SELECT * FROM hardware_benchmarks WHERE run_id = ?", (run_id,)
        ).fetchone()
    return _benchmark_row_to_dict(row) if row else {"run_id": run_id}


def list_benchmark_results(
    *,
    engine: str | None = None,
    model: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """List benchmark history, newest first, with bounded filters."""
    clauses = ["1 = 1"]
    args: list[Any] = []
    if engine:
        clauses.append("engine = ?")
        args.append(engine)
    if model:
        clauses.append("model = ?")
        args.append(model)
    if status:
        clauses.append("status = ?")
        args.append(status)
    args.append(max(1, min(int(limit), 500)))
    query = (
        "SELECT * FROM hardware_benchmarks WHERE "
        + " AND ".join(clauses)
        + " ORDER BY started_at DESC LIMIT ?"
    )
    with get_db() as conn:
        rows = conn.execute(query, args).fetchall()
    return [_benchmark_row_to_dict(row) for row in rows]


def get_benchmark_result(run_id: str) -> dict[str, Any] | None:
    """Fetch one benchmark by run ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM hardware_benchmarks WHERE run_id = ?", (run_id,)
        ).fetchone()
    return _benchmark_row_to_dict(row) if row else None


def delete_benchmark_results(older_than_days: int = 30) -> int:
    """Prune benchmark history older than the requested age."""
    cutoff = (datetime.now().timestamp() - int(older_than_days) * 86400) * 1000
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM hardware_benchmarks WHERE "
            "CAST(strftime('%s', started_at) AS INTEGER) * 1000 < ?",
            (int(cutoff),),
        )
        return int(cursor.rowcount or 0)


def _safe_json_loads(val: str | None, default: Any = None) -> Any:
    """Safely parse JSON string, returning default on error."""
    if not val:
        return default if default is not None else {}
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}
