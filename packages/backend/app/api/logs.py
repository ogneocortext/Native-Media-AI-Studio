"""
Logging API routes.
Provides endpoints to view and manage application logs from the frontend.
"""

from fastapi import APIRouter, Query

from ..core.logging_config import get_log_files, read_log_tail, get_log_stats

router = APIRouter(prefix="/api/logs", tags=["Logs"])


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
        log_name: Name of the log file (app, error, queue, comfyui)
        lines: Number of lines to return (1-1000)
    """
    log_files = {
        "app": "app",
        "error": "error",
        "queue": "queue",
        "comfyui": "comfyui",
    }

    if log_name not in log_files:
        return {"error": f"Unknown log: {log_name}. Available: {list(log_files.keys())}"}

    log_file = get_log_files()[log_files[log_name]]
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
async def receive_frontend_logs(body: dict) -> dict:
    """Receive log entries from the frontend and write them to the app log."""
    import logging

    entries = body.get("entries", [])
    logger = logging.getLogger("frontend")

    for entry in entries:
        level = entry.get("level", "INFO")
        source = entry.get("source", "unknown")
        message = entry.get("message", "")
        data = entry.get("data")
        timestamp = entry.get("timestamp", "")

        log_msg = f"[{source}] {message}"
        if data:
            log_msg += f" | {data}"

        log_level = getattr(logging, level.upper(), logging.INFO)
        logger.log(log_level, log_msg)

    return {"received": len(entries)}
