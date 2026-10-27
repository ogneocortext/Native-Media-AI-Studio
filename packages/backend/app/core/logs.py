"""
Log Analytics Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import re
import sqlite3
import time as _time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .connection import get_db


@dataclass
class LogEventRow:
    id: int
    ts_iso: str
    ts_ms: int
    level: str
    logger: str
    message: str
    source: str


# Pre-compiled patterns for log message normalization.
_NORMALIZE_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_NORMALIZE_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:\\(?:[^\"'\n\r]+\\)*[^\"'\n\r:]+")
_NORMALIZE_LINE_NUMBER_RE = re.compile(r"\b\d+(?=\.py[:\s])")
_NORMALIZE_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_NORMALIZE_HEX_RE = re.compile(r"0x[0-9a-fA-F]{4,}")
_NORMALIZE_TRACE_ID_RE = re.compile(r"\[trace_id=([^\]]+)\]")

# Map logger name prefixes to analytics source labels.
_SOURCE_MAP: dict[str, str] = {
    "app.adapters.comfyui": "comfyui",
    "app.adapters.ollama": "ollama",
    "app.adapters.base": "adapters",
    "app.queue": "queue",
    "app.stdout": "stdout",
    "frontend": "frontend",
    "asyncio": "asyncio",
    "uvicorn": "uvicorn",
}


def _derive_source(logger_name: str, default: str = "app") -> str:
    """Derive an analytics source label from a Python logger name."""
    for prefix, source in _SOURCE_MAP.items():
        if logger_name == prefix or logger_name.startswith(prefix + "."):
            return source
    return default


def _normalize_log_message(message: str) -> str:
    """Normalize variable parts of a log message so identical errors group together."""
    normalized = _NORMALIZE_UUID_RE.sub("<uuid>", message)
    normalized = _NORMALIZE_WINDOWS_PATH_RE.sub("<path>", normalized)
    normalized = _NORMALIZE_LINE_NUMBER_RE.sub("<line>", normalized)
    normalized = _NORMALIZE_IP_RE.sub("<ip>", normalized)
    normalized = _NORMALIZE_HEX_RE.sub("<hex>", normalized)
    return normalized


def _extract_trace_id(message: str) -> tuple[str, str]:
    """Extract trace_id from message if present. Returns (message_without_trace_id, trace_id)."""
    m = _NORMALIZE_TRACE_ID_RE.search(message)
    if m:
        return message[: m.start()].rstrip() + message[m.end() :].lstrip(), m.group(1)
    return message, ""


def _strip_request_id_prefix(message: str) -> str:
    """Strip a leading ``[request-id]`` correlation token from a log message."""
    if not message.startswith("["):
        return message
    end = message.find("]")
    if end <= 1 or end > 40:
        return message
    token = message[1:end]
    if token == "-" or _NORMALIZE_UUID_RE.fullmatch(token):
        return message[end + 1 :].lstrip()
    return message


def _parse_log_line(line: str) -> LogEventRow | None:
    """Parse a single log line into a LogEventRow."""
    try:
        parts = line.split(" | ", 4)
        if len(parts) < 4:
            return None
        ts_str = parts[0].strip()
        level = parts[1].strip()
        logger = parts[2].strip()
        _func = parts[3].strip() if len(parts) > 3 else ""
        message_raw = parts[4].strip() if len(parts) > 4 else ""
        message, trace_id = _extract_trace_id(message_raw)
        message = _strip_request_id_prefix(message)
        message = _normalize_log_message(message)
        try:
            dt = datetime.fromisoformat(ts_str)
            ts_ms = int(dt.timestamp() * 1000)
        except (ValueError, TypeError):
            ts_ms = 0
        return LogEventRow(
            id=0,
            ts_iso=ts_str,
            ts_ms=ts_ms,
            level=level,
            logger=logger,
            message=message,
            source=_derive_source(logger),
        )
    except Exception:
        return None


def _join_multiline_log_entries(lines: list[str]) -> list[str]:
    """Join continuation lines with their parent log entry."""
    joined: list[str] = []
    current: str | None = None
    for line in lines:
        if re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| ", line):
            if current is not None:
                joined.append(current)
            current = line.rstrip("\n")
        elif current is not None and line.strip():
            current += "\n" + line.rstrip("\n")
    if current is not None:
        joined.append(current)
    return joined


def ingest_log_file(path: str, source: str = "app", limit: int = 20000) -> int:
    """Parse a log file and insert NEW events into SQLite. Returns inserted count."""
    from pathlib import Path

    p = Path(path)
    if not p.exists():
        return 0
    with get_db() as conn:
        last_ts = conn.execute(
            "SELECT MAX(ts_ms) FROM log_events WHERE source = ?",
            (source,),
        ).fetchone()[0] or 0
    rows: list[LogEventRow] = []
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            raw_lines = f.readlines()
        joined_lines = _join_multiline_log_entries(raw_lines)
        for line in joined_lines:
            row = _parse_log_line(line)
            if row and row.ts_ms > last_ts:
                if source != "app":
                    row.source = source
                rows.append(row)
                if len(rows) >= limit:
                    break
    except Exception:
        return 0
    if not rows:
        return 0
    with get_db() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO log_events (ts_iso, ts_ms, level, logger, message, source)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [(r.ts_iso, r.ts_ms, r.level, r.logger, r.message, r.source) for r in rows],
        )
        return conn.total_changes


def get_log_trends(since_ms: int | None = None, limit: int = 5000) -> list[dict]:
    """Return log events as time-series points for charting."""
    q = "SELECT ts_iso, ts_ms, level, logger, message FROM log_events"
    params: list[Any] = []
    if since_ms is not None:
        q += " WHERE ts_ms >= ?"
        params.append(since_ms)
    q += " ORDER BY ts_ms ASC LIMIT ?"
    params.append(limit)
    with get_db() as conn:
        rows = conn.execute(q, params).fetchall()
        return [
            {
                "ts_iso": r["ts_iso"],
                "ts_ms": r["ts_ms"],
                "level": r["level"],
                "logger": r["logger"],
                "message": _normalize_log_message(r["message"]),
            }
            for r in rows
        ]


def get_log_patterns(limit: int = 20) -> dict:
    """Aggregate common log patterns: top loggers, level counts, top messages."""
    with get_db() as conn:
        level_rows = conn.execute(
            "SELECT level, COUNT(*) as cnt FROM log_events GROUP BY level ORDER BY cnt DESC"
        ).fetchall()
        logger_rows = conn.execute(
            "SELECT logger, COUNT(*) as cnt FROM log_events GROUP BY logger ORDER BY cnt DESC LIMIT ?",
            (limit,),
        ).fetchall()
        raw_messages = conn.execute(
            """
            SELECT message, COUNT(*) as cnt, MIN(level) as level
            FROM log_events
            GROUP BY message
            ORDER BY cnt DESC
            LIMIT ?
            """,
            (limit * 4,),
        ).fetchall()
    aggregated: dict[str, dict] = {}
    for r in raw_messages:
        normalized = _normalize_log_message(r["message"])
        entry = aggregated.get(normalized)
        if entry is None:
            aggregated[normalized] = {
                "message": normalized,
                "count": r["cnt"],
                "level": r["level"],
            }
        else:
            entry["count"] += r["cnt"]
    messages = sorted(aggregated.values(), key=lambda x: x["count"], reverse=True)[:limit]
    return {
        "levels": [{"level": r["level"], "count": r["cnt"]} for r in level_rows],
        "loggers": [{"logger": r["logger"], "count": r["cnt"]} for r in logger_rows],
        "messages": messages,
    }


def get_error_patterns(limit: int = 20) -> dict:
    """Return recurring ERROR/CRITICAL patterns with UUID/path/line normalization."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT message, COUNT(*) as cnt, MIN(ts_iso) as first_seen, MAX(ts_iso) as last_seen
            FROM log_events
            WHERE level IN ('ERROR', 'CRITICAL')
            GROUP BY message
            ORDER BY cnt DESC
            LIMIT ?
            """,
            (limit * 4,),
        ).fetchall()

    aggregated: dict[str, dict] = {}
    for r in rows:
        normalized = _normalize_log_message(r["message"])
        entry = aggregated.get(normalized)
        if entry is None:
            aggregated[normalized] = {
                "message": normalized,
                "count": r["cnt"],
                "first_seen": r["first_seen"],
                "last_seen": r["last_seen"],
            }
        else:
            entry["count"] += r["cnt"]
            if r["last_seen"] > entry["last_seen"]:
                entry["last_seen"] = r["last_seen"]
            if r["first_seen"] < entry["first_seen"]:
                entry["first_seen"] = r["first_seen"]

    results = sorted(aggregated.values(), key=lambda x: x["count"], reverse=True)[:limit]
    return {"errors": results}


LOG_ANALYTICS_LAST_CLEANUP_KEY = "log_analytics_last_cleanup_at"


def get_log_analytics_last_cleanup() -> str | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_preferences WHERE key = ?", (LOG_ANALYTICS_LAST_CLEANUP_KEY,)
        ).fetchone()
        if row:
            try:
                return json.loads(row["value"])
            except (json.JSONDecodeError, TypeError):
                return None
    return None


def set_log_analytics_last_cleanup(
    ts_iso: str, conn: sqlite3.Connection | None = None
) -> None:
    """Persist last cleanup timestamp. Reuses `conn` when provided."""
    close_after = False
    if conn is None:
        conn = get_db()
        close_after = True
    try:
        conn.execute(
            "INSERT OR REPLACE INTO user_preferences (key, value, category, updated_at) VALUES (?, ?, 'logs', ?)",
            (LOG_ANALYTICS_LAST_CLEANUP_KEY, json.dumps(ts_iso), ts_iso),
        )
        if close_after:
            conn.commit()
    finally:
        if close_after:
            conn.close()


def get_log_analytics_sources(limit: int = 20) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT source, COUNT(*) as cnt FROM log_events GROUP BY source ORDER BY cnt DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [{"source": r["source"], "count": r["cnt"]} for r in rows]


def cleanup_old_log_events(keep_days: int = 30, conn: sqlite3.Connection | None = None) -> int:
    """Delete log events older than keep_days. Returns deleted count."""
    close_after = False
    if conn is None:
        conn = get_db().__enter__()
        close_after = True
    try:
        cursor = conn.execute(
            "DELETE FROM log_events WHERE ts_ms < ?",
            (int(_time.time() - keep_days * 86400) * 1000,),
        )
        deleted = cursor.rowcount
        ts_iso = datetime.now().isoformat()
        set_log_analytics_last_cleanup(ts_iso, conn=conn)
        if deleted:
            import logging as _logging

            _logging.info(
                "Cleaned up %d log analytics events older than %d days", deleted, keep_days
            )
            if deleted >= 1000:
                from .connection import safe_vacuum

                safe_vacuum(conn)
        else:
            import logging as _logging

            _logging.debug(
                "Log analytics cleanup ran at %s; no events older than %d days",
                ts_iso,
                keep_days,
            )
        if close_after:
            conn.commit()
        return deleted
    finally:
        if close_after:
            conn.close()


def cleanup_old_system_resources(keep_days: int = 7) -> int:
    """Remove system resource snapshots older than keep_days. Returns count deleted."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM system_resources WHERE timestamp < datetime('now', ?)",
            (f"-{keep_days} days",),
        )
        return cursor.rowcount
