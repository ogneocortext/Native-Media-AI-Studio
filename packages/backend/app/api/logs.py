"""
Logging API routes.
Provides endpoints to view and manage application logs from the frontend.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..core.logging_config import get_log_files, get_log_stats, read_log_tail

router = APIRouter(prefix="/api/logs", tags=["Logs"])


class FrontendLogRequest(BaseModel):
    """Request body for frontend log entries."""

    entries: list[dict]


@router.get("/")
async def get_log_info() -> dict:
    """Get log file information and statistics."""
    return {
        "log_directory": str(get_log_stats().get("app", {}).get("path", "")),
        "files": get_log_stats(),
    }


@router.get("/{log_name}")
async def get_log_content(
    log_name: str,
    lines: int = Query(default=100, ge=1, le=1000),
) -> dict:
    """Get the last N lines from a log file.

    Args:
        log_name: Name of the log file (app, error, queue, comfyui, ollama, comfyui_native, ...)
        lines: Number of lines to return (1-1000)
    """
    available = get_log_files()
    if log_name not in available:
        return {
            "error": f"Unknown log: {log_name}. Available: {sorted(available.keys())}",
        }

    log_file = available[log_name]
    content = read_log_tail(log_file, lines)

    return {
        "log": log_name,
        "lines": len(content),
        "content": content,
    }


@router.post("/clear")
async def clear_logs() -> dict:
    """Clear all log files (requires restart to take full effect)."""
    cleared = []
    for name, path in get_log_files().items():
        if path.exists():
            try:
                # Truncate the file
                with open(path, "w") as f:
                    f.write("")
                cleared.append(name)
            except Exception:
                pass

    return {"cleared": cleared, "message": f"Cleared {len(cleared)} log files"}


@router.post("/frontend")
async def receive_frontend_logs(body: FrontendLogRequest) -> dict:
    """Receive log entries from the frontend and write them to the app log."""
    entries = body.entries
    logger = logging.getLogger("frontend")

    for entry in entries:
        level = entry.get("level", "INFO")
        source = entry.get("source", "unknown")
        message = entry.get("message", "")
        data = entry.get("data")
        timestamp = entry.get("timestamp", "")
        trace_id = entry.get("trace_id", "")

        # Build a structured line that LogViewer.tsx can parse:
        #   timestamp | LEVEL | logger | funcName | message [trace_id] | data
        # Fall back to a frontend-only format when no timestamp is present.
        if timestamp:
            log_line = f"{timestamp} | {level.upper():<7} | frontend.{source:<35} | receive_frontend_logs | {message}"
        else:
            log_line = f"[frontend.{source}] {message}"

        if trace_id:
            log_line += f" [trace_id={trace_id}]"

        if data:
            log_line += f" | {data}"

        log_level = getattr(logging, level.upper(), logging.INFO)
        logger.log(log_level, log_line)

    return {"received": len(entries)}
