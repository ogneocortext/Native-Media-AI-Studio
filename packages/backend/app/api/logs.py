"""
Logging API routes.
Provides endpoints to view and manage application logs from the frontend.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..core.logging_config import clear_log_files, get_log_files, get_log_stats, read_log_tail

router = APIRouter(prefix="/api/logs", tags=["Logs"])


class FrontendLogRequest(BaseModel):
    """Request body for frontend log entries."""

    entries: list[dict]

_VALID_FRONTEND_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
_MAX_FRONTEND_ENTRIES = 100
_MAX_FRONTEND_MESSAGE = 2000


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
        raise HTTPException(
            status_code=404,
            detail=f"Unknown log: {log_name}. Available: {sorted(available.keys())}",
        )

    log_file = available[log_name]
    content = read_log_tail(log_file, lines)

    return {
        "log": log_name,
        "lines": len(content),
        "content": content,
    }


@router.post("/clear")
async def clear_logs() -> dict:
    """Clear all log files (handler-safe truncation, no restart needed)."""
    cleared = clear_log_files()

    return {"cleared": cleared, "message": f"Cleared {len(cleared)} log files"}


@router.post("/frontend")
async def receive_frontend_logs(body: FrontendLogRequest) -> dict:
    """Receive log entries from the frontend and write them to the app log."""
    entries = body.entries[:_MAX_FRONTEND_ENTRIES]
    dropped = len(body.entries) - len(entries)
    logger = logging.getLogger("frontend")

    for entry in entries:
        level = str(entry.get("level", "INFO")).upper()
        if level not in _VALID_FRONTEND_LEVELS:
            level = "INFO"
        message = str(entry.get("message", ""))[:_MAX_FRONTEND_MESSAGE]
        data = entry.get("data")
        trace_id = entry.get("trace_id", "")

        # Attribute every entry to the originating frontend module so the logs
        # UI and analytics can filter frontend noise by component. The entry's
        # own `timestamp` is intentionally ignored — the app log formatter adds
        # the authoritative receive-time prefix.
        source = entry.get("source", "unknown")
        message = f"[{source}] {message}"

        # Build a flat message. The app log formatter adds its own
        # timestamp / level / logger / funcName prefix, so we only pass the
        # payload here. trace_id is appended as metadata that the log parser
        # can extract later for correlation.
        if data:
            message = f"{message} | data={json.dumps(data, ensure_ascii=False)}"
        if trace_id:
            message = f"{message} [trace_id={trace_id}]"

        log_level = getattr(logging, level.upper(), logging.INFO)
        logger.log(log_level, message)

    result: dict = {"received": len(entries)}
    if dropped:
        logger.warning("Dropped %d frontend log entries (batch cap %d)", dropped, _MAX_FRONTEND_ENTRIES)
        result["dropped"] = dropped
    return result
