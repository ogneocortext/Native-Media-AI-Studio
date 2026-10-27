"""
GPU Telemetry Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import time as _time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .connection import get_db


@dataclass
class GpuTelemetryRow:
    id: int
    ts_ms: int
    ts_iso: str
    gpu_name: str | None
    memory_total: int | None
    memory_used: int | None
    memory_free: int | None
    memory_percent: float | None
    gpu_util: int | None
    mem_controller_util: int | None
    temperature_c: int | None
    processes: list[dict]


def log_gpu_telemetry(snapshot: dict, processes: list[dict] | None = None) -> int:
    """Persist a GPU snapshot for trending. Returns row id. No-op if unavailable."""
    if not snapshot.get("available"):
        return 0
    ts_ms = int(_time.time() * 1000)
    ts_iso = datetime.now().isoformat()
    procs = processes if processes is not None else snapshot.get("processes", [])
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO gpu_telemetry
            (ts_ms, ts_iso, gpu_name, memory_total, memory_used, memory_free,
             memory_percent, gpu_util, mem_controller_util, temperature_c, processes_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts_ms,
                ts_iso,
                snapshot.get("name"),
                snapshot.get("memory_total_mb"),
                snapshot.get("memory_used_mb"),
                snapshot.get("memory_free_mb"),
                snapshot.get("memory_percent"),
                snapshot.get("gpu_utilization"),
                snapshot.get("memory_controller_utilization"),
                snapshot.get("temperature_c"),
                json.dumps(procs or []),
            ),
        )
        return cur.lastrowid or 0


def get_gpu_history(
    since_ms: int | None = None, limit: int = 2000, include_processes: bool = False
) -> list[dict]:
    """Fetch GPU telemetry points. since_ms filters ts_ms >= value. Ordered asc for charting."""
    q = "SELECT * FROM gpu_telemetry"
    params: list[Any] = []
    if since_ms is not None:
        q += " WHERE ts_ms >= ?"
        params.append(since_ms)
    q += " ORDER BY ts_ms ASC LIMIT ?"
    params.append(limit)
    with get_db() as conn:
        rows = conn.execute(q, params).fetchall()
        out = []
        for r in rows:
            d: dict[str, Any] = {
                "ts_ms": r["ts_ms"],
                "ts_iso": r["ts_iso"],
                "gpu_name": r["gpu_name"],
                "memory_total": r["memory_total"],
                "memory_used": r["memory_used"],
                "memory_free": r["memory_free"],
                "memory_percent": r["memory_percent"],
                "gpu_util": r["gpu_util"],
                "mem_controller_util": r["mem_controller_util"],
                "temperature_c": r["temperature_c"],
            }
            if include_processes:
                d["processes"] = _safe_json_loads(r["processes_json"], [])
            out.append(d)
        return out


def get_gpu_stats(since_ms: int | None = None) -> dict:
    """Aggregate stats over window."""
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS count,
                MIN(ts_iso) AS since_iso,
                MAX(ts_iso) AS until_iso,
                AVG(temperature_c) AS temperature_c_avg,
                MIN(temperature_c) AS temperature_c_min,
                MAX(temperature_c) AS temperature_c_max,
                MAX(CASE WHEN temperature_c IS NOT NULL THEN temperature_c END) AS temperature_c_cur,
                AVG(memory_percent) AS memory_percent_avg,
                MIN(memory_percent) AS memory_percent_min,
                MAX(memory_percent) AS memory_percent_max,
                MAX(CASE WHEN memory_percent IS NOT NULL THEN memory_percent END) AS memory_percent_cur,
                AVG(gpu_util) AS gpu_util_avg,
                MIN(gpu_util) AS gpu_util_min,
                MAX(gpu_util) AS gpu_util_max,
                MAX(CASE WHEN gpu_util IS NOT NULL THEN gpu_util END) AS gpu_util_cur
            FROM gpu_telemetry
            WHERE (? IS NULL OR ts_ms >= ?)
            """,
            (since_ms, since_ms),
        ).fetchone()
        if not row or row["count"] == 0:
            return {"count": 0}

        def _stats(col: str):
            avg = row[f"{col}_avg"] or 0
            mn = row[f"{col}_min"] or 0
            mx = row[f"{col}_max"] or 0
            cur = row[f"{col}_cur"] or 0
            sl = [
                r[0]
                for r in conn.execute(
                    f"SELECT {col} FROM gpu_telemetry WHERE (? IS NULL OR ts_ms >= ?) AND {col} IS NOT NULL ORDER BY ts_ms ASC LIMIT 40"
                ).fetchall()
            ]
            n = len(sl)
            if n < 2:
                return {"avg": avg, "min": mn, "max": mx, "cur": cur, "trend": "flat", "slope": 0}
            sx = sy = sxy = sx2 = 0
            for i, v in enumerate(sl):
                sx += i
                sy += v
                sxy += i * v
                sx2 += i * i
            slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx or 1)
            trend = "up" if slope > 0.08 else "down" if slope < -0.08 else "flat"
            return {"avg": avg, "min": mn, "max": mx, "cur": cur, "trend": trend, "slope": slope}

        return {
            "count": row["count"],
            "since_ms": since_ms,
            "since_iso": row["since_iso"],
            "until_iso": row["until_iso"],
            "temperature_c": _stats("temperature_c"),
            "memory_percent": _stats("memory_percent"),
            "gpu_util": _stats("gpu_util"),
        }


def cleanup_old_gpu_telemetry(keep_days: int = 14, vacuum: bool = True) -> int:
    """Purge points older than keep_days. Returns deleted count."""
    cutoff_ms = int((_time.time() - keep_days * 86400) * 1000)
    with get_db() as conn:
        cur = conn.execute("DELETE FROM gpu_telemetry WHERE ts_ms < ?", (cutoff_ms,))
        deleted = cur.rowcount
        if deleted and vacuum and deleted >= 500:
            from .connection import safe_vacuum

            safe_vacuum(conn)

    if deleted:
        import logging as _logging

        _logging.info(
            "Cleaned up %d GPU telemetry rows older than %d days", deleted, keep_days
        )
    return deleted


def _safe_json_loads(val: str | None, default: Any = None) -> Any:
    """Safely parse JSON string, returning default on error."""
    if not val:
        return default if default is not None else {}
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}
