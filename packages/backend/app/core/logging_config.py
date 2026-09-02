"""
Centralized logging configuration for Native Media AI Studio.

Provides:
- Structured logging to both console and files
- Log rotation to prevent disk fill
- Per-module log levels
- stdout/stderr capture for print() calls
- API endpoint to view logs from frontend
"""

import logging
import logging.handlers
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

from ..core.config import PROJECT_ROOT

# Capture the *original* stdout at import time. setup_logging() can run more
# than once (e.g. `python -m app.main` executes the module under both
# `app.main` and `__main__`), and the console handler must never bind to our
# stdout wrapper or logging recurses infinitely (RecursionError crashes the
# backend on Windows).
_ORIGINAL_STDOUT = sys.stdout

# Log directory - use output/logs/ for consistency with service logs
LOG_DIR = PROJECT_ROOT / "output" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Log file paths
APP_LOG = LOG_DIR / "app.log"
ERROR_LOG = LOG_DIR / "error.log"
COMFYUI_LOG = LOG_DIR / "comfyui.log"
QUEUE_LOG = LOG_DIR / "queue.log"
OLLAMA_LOG = LOG_DIR / "ollama.log"

# ComfyUI's own log directory (ComfyUI lives beside the repo root)
COMFYUI_DIR = PROJECT_ROOT.parent / "ComfyUI"
COMFYUI_USER_LOG_DIR = COMFYUI_DIR / "user"

# Max size per log file (10 MB)
MAX_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5

# Log retention days (cleanup files older than this)
LOG_RETENTION_DAYS = 7


class _StdCapture:
    """Redirect stdout/stderr to logging while preserving console output."""

    def __init__(self, logger: logging.Logger, level: int = logging.INFO):
        self.logger = logger
        self.level = level
        self._original = None

    def install(self):
        # Always wrap the ORIGINAL stdout, never an already-installed wrapper.
        # setup_logging() can run more than once (e.g. `python -m app.main`),
        # and re-nesting wrappers causes infinite logging recursion.
        self._original = _ORIGINAL_STDOUT
        sys.stdout = _StreamWrapper(self.logger, self.level, self._original)

    def uninstall(self):
        if self._original:
            sys.stdout = self._original
            self._original = None


class _StreamWrapper:
    """Wraps a stream to send writes to logging."""

    def __init__(self, logger: logging.Logger, level: int, original):
        self.logger = logger
        self.level = level
        self.original = original
        self._buffer = ""

    def write(self, text: str):
        # Pass through to original stream
        self.original.write(text)
        # Buffer and log complete lines
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line.strip():
                self.logger.log(self.level, line.strip())

    def flush(self):
        self.original.flush()

    def isatty(self):
        return self.original.isatty()

    def fileno(self):
        return self.original.fileno()


def setup_logging(level: str = "INFO") -> None:
    """Configure logging for the application.

    Sets up:
    - Console handler (colored, for development)
    - Rotating file handler (all logs)
    - Error-only rotating file handler
    - Module-specific log files
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Clear existing handlers
    root_logger.handlers.clear()

    # === Console Handler (Windows-compatible, no Unicode box chars) ===
    # Bind to the original stdout captured at import time. If we bound to the
    # current sys.stdout and a previous setup_logging() already installed our
    # wrapper, every log write would loop through the wrapper -> RecursionError.
    console_handler = logging.StreamHandler(_ORIGINAL_STDOUT)
    console_handler.setLevel(logging.DEBUG)
    console_fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)-30s | %(message)s",
        datefmt="%H:%M:%S",
    )
    console_handler.setFormatter(console_fmt)
    root_logger.addHandler(console_handler)

    # === App Log (all messages) ===
    app_handler = logging.handlers.RotatingFileHandler(
        APP_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    app_handler.setLevel(logging.DEBUG)
    app_fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)-35s | %(funcName)-25s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    app_handler.setFormatter(app_fmt)
    root_logger.addHandler(app_handler)

    # === Error Log (errors only) ===
    error_handler = logging.handlers.RotatingFileHandler(
        ERROR_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    error_handler.setLevel(logging.ERROR)
    error_fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)-35s | %(funcName)-25s | %(message)s\n"
        "  %(pathname)s:%(lineno)d",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    error_handler.setFormatter(error_fmt)
    root_logger.addHandler(error_handler)

    # === Queue-specific Logger ===
    queue_logger = logging.getLogger("app.queue")
    queue_handler = logging.handlers.RotatingFileHandler(
        QUEUE_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    queue_handler.setLevel(logging.DEBUG)
    queue_handler.setFormatter(app_fmt)
    queue_logger.addHandler(queue_handler)

    # === ComfyUI-specific Logger ===
    comfyui_logger = logging.getLogger("app.adapters.comfyui")
    comfyui_handler = logging.handlers.RotatingFileHandler(
        COMFYUI_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    comfyui_handler.setLevel(logging.DEBUG)
    comfyui_handler.setFormatter(app_fmt)
    comfyui_logger.addHandler(comfyui_handler)

    # === Ollama-specific Logger ===
    ollama_logger = logging.getLogger("app.adapters.ollama")
    ollama_handler = logging.handlers.RotatingFileHandler(
        OLLAMA_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    ollama_handler.setLevel(logging.DEBUG)
    ollama_handler.setFormatter(app_fmt)
    ollama_logger.addHandler(ollama_handler)

    # === Quiet down noisy third-party loggers ===
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("aiohttp").setLevel(logging.WARNING)

    # Suppress benign Windows Proactor ConnectionResetError noise
    # (asyncio pipes closed by remote - happens on every SSE disconnect)
    class _WinResetFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            if "ConnectionResetError" in msg and "10054" in msg:
                return False
            if "_ProactorBasePipeTransport._call_connection_lost" in msg:
                return False
            return True

    for name in ("asyncio", "root"):
        lg = logging.getLogger(name)
        lg.addFilter(_WinResetFilter())

    # === Capture print() calls ===
    std_capture = _StdCapture(logging.getLogger("app.stdout"), logging.INFO)
    std_capture.install()

    root_logger.info("Logging initialized (level=%s, dir=%s)", level, LOG_DIR)

    # Cleanup old log files on startup
    cleanup_old_logs(LOG_DIR, LOG_RETENTION_DAYS)


def cleanup_old_logs(log_dir: Path, retention_days: int = 7) -> int:
    """Remove log files older than retention_days. Returns count of removed files."""
    if not log_dir.exists():
        return 0
    cutoff = datetime.now() - timedelta(days=retention_days)
    removed = 0
    for f in log_dir.glob("**/*"):
        if f.is_file() and f.suffix in (".log", ".err", ".csv", ".json", ".png", ".nsys-rep", ".sqlite"):
            try:
                if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                    f.unlink()
                    removed += 1
            except OSError:
                pass
    if removed:
        logging.getLogger(__name__).info("Cleaned up %d old log files (>%d days)", removed, retention_days)
    return removed


def get_log_files() -> dict[str, Path]:
    """Get paths to all log files."""
    logs = {
        "app": APP_LOG,
        "error": ERROR_LOG,
        "queue": QUEUE_LOG,
        "comfyui": COMFYUI_LOG,
        "ollama": OLLAMA_LOG,
    }
    # Also find ComfyUI's own log file (from its user directory)
    if COMFYUI_USER_LOG_DIR.exists():
        # Find the most recent comfyui_*.log file
        comfyui_logs = sorted(
            COMFYUI_USER_LOG_DIR.glob("comfyui_*.log"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if comfyui_logs:
            logs["comfyui_native"] = comfyui_logs[0]
    return logs


def read_log_tail(log_file: Path, lines: int = 100) -> list[str]:
    """Read the last N lines from a log file."""
    if not log_file.exists():
        return ["Log file not found"]

    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
            return [line.rstrip() for line in all_lines[-lines:]]
    except Exception as e:
        return [f"Error reading log: {e}"]


def get_recent_errors(log_file: Path = ERROR_LOG, minutes: int = 60, max_errors: int = 50) -> list[str]:
    """Get error log entries from the last N minutes."""
    if not log_file.exists():
        return []

    cutoff = datetime.now() - timedelta(minutes=minutes)
    errors = []
    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                # Try to parse the timestamp from the log line
                try:
                    if len(line) > 20 and " | " in line[:25]:
                        ts_str = line[:19]
                        ts = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
                        if ts >= cutoff:
                            errors.append(line.rstrip())
                except ValueError:
                    # If we can't parse the timestamp, include the line anyway
                    errors.append(line.rstrip())
                if len(errors) >= max_errors:
                    break
    except Exception as e:
        return [f"Error reading error log: {e}"]

    return errors[-max_errors:]


def get_log_stats() -> dict:
    """Get statistics about log files."""
    stats = {}
    for name, path in get_log_files().items():
        if path.exists():
            stat = path.stat()
            stats[name] = {
                "path": str(path),
                "size_bytes": stat.st_size,
                "size_human": _format_size(stat.st_size),
                "modified": stat.st_mtime,
            }
        else:
            stats[name] = {"path": str(path), "size_bytes": 0, "size_human": "0 B"}
    return stats


def _format_size(size: int) -> str:
    """Format byte size to human readable."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"
