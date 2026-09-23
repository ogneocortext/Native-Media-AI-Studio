"""
Centralized logging configuration for Native Media AI Studio.

Provides:
- Structured logging to both console and files
- Log rotation to prevent disk fill
- Per-module log levels
- stdout/stderr capture for print() calls
- API endpoint to view logs from frontend
"""

import collections
import contextvars
import logging
import logging.handlers
import sys
from datetime import datetime, timedelta
from pathlib import Path

from ..core.config import PROJECT_ROOT

# Capture the *original* stdout/stderr at import time. setup_logging() can run
# more than once (e.g. `python -m app.main` executes the module under both
# `app.main` and `__main__`), and the console handler must never bind to our
# stdout wrapper or logging recurses infinitely (RecursionError crashes the
# backend on Windows).
_ORIGINAL_STDOUT = sys.stdout
_ORIGINAL_STDERR = sys.stderr

# Request-scoped correlation id, set per-request by RequestIDMiddleware.
# Defaults to "-" so log format stays stable outside a request.
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "nma_request_id", default="-"
)


def set_request_id(request_id: str) -> None:
    """Set the correlation id for the current request context."""
    request_id_var.set(request_id or "-")


def get_request_id() -> str:
    """Return the correlation id for the current request context."""
    return request_id_var.get()


class _RequestIdFilter(logging.Filter):
    """Inject ``request_id`` into every log record for correlation."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id()  # type: ignore[attr-defined]
        return True

# Log directory - use output/logs/ for consistency with service logs
LOG_DIR = PROJECT_ROOT / "output" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Log file paths
APP_LOG = LOG_DIR / "app.log"
ERROR_LOG = LOG_DIR / "error.log"
COMFYUI_LOG = LOG_DIR / "comfyui.log"
QUEUE_LOG = LOG_DIR / "queue.log"
OLLAMA_LOG = LOG_DIR / "ollama.log"

# ComfyUI's own log directory (ComfyUI lives beside the repo root).
# Resolved lazily via core.paths so config.comfyui_output_dir is honored
# and this module never hardcodes the sibling path.
def _comfyui_user_log_dir() -> Path:
    from .paths import comfyui_dir

    return comfyui_dir() / "user"


COMFYUI_USER_LOG_DIR = _comfyui_user_log_dir()

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
        self._original_out = None
        self._original_err = None

    def install(self):
        # Always wrap the ORIGINAL streams, never an already-installed wrapper.
        # setup_logging() can run more than once (e.g. `python -m app.main`),
        # and re-nesting wrappers causes infinite logging recursion.
        if isinstance(sys.stdout, _StreamWrapper) and isinstance(sys.stderr, _StreamWrapper):
            return
        self._original_out = _ORIGINAL_STDOUT
        self._original_err = _ORIGINAL_STDERR
        sys.stdout = _StreamWrapper(self.logger, logging.INFO, self._original_out)
        # stderr (tracebacks, warnings) goes out at WARNING so it is visible
        # in both console and the error log.
        sys.stderr = _StreamWrapper(self.logger, logging.WARNING, self._original_err)

    def uninstall(self):
        if self._original_out is not None:
            if isinstance(sys.stdout, _StreamWrapper):
                sys.stdout = self._original_out
            self._original_out = None
        if self._original_err is not None:
            if isinstance(sys.stderr, _StreamWrapper):
                sys.stderr = self._original_err
            self._original_err = None


class _StreamWrapper:
    """Wraps a stream to send writes to logging."""

    def __init__(self, logger: logging.Logger, level: int, original):
        self.logger = logger
        self.level = level
        self.original = original
        self._buffer = ""
        # Mirror common TextIO attributes so third-party code that probes
        # the stream (encoding checks, writelines, closed, etc.) keeps working.
        self.encoding = getattr(original, "encoding", "utf-8")
        self.errors = getattr(original, "errors", "replace")

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
        # Emit any partial line still in the buffer before flushing.
        if self._buffer.strip():
            self.logger.log(self.level, self._buffer.strip())
            self._buffer = ""
        self.original.flush()

    def writelines(self, lines):
        for line in lines:
            self.write(line)

    @property
    def closed(self):
        return getattr(self.original, "closed", False)

    def isatty(self):
        return self.original.isatty()

    def fileno(self):
        return self.original.fileno()


def _clear_logger_handlers(logger: logging.Logger) -> None:
    """Remove + close handlers so repeated setup_logging() never duplicates output."""
    for handler in list(logger.handlers):
        try:
            logger.removeHandler(handler)
            handler.close()
        except Exception:
            pass


def apply_log_level(level: str) -> str:
    """Apply a log level to all configured handlers at runtime (no restart).

    Returns the normalized level. Raises ValueError for unknown levels.
    """
    normalized = level.upper()
    if normalized not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        raise ValueError(f"Invalid log level: {level}")
    numeric = getattr(logging, normalized)
    root_logger = logging.getLogger()
    # Root stays at DEBUG so file handlers (app.log at DEBUG) never lose
    # records; the *console* handler follows the configured level.
    root_logger.setLevel(logging.DEBUG)
    # Console follows the configured level; file handlers keep their own
    # floors (app=DEBUG, error=ERROR) so diagnostics are never lost.
    for handler in root_logger.handlers:
        if getattr(handler, "_nma_console", False):
            handler.setLevel(numeric)
    logging.getLogger(__name__).info("Log level changed to %s (applied live)", normalized)
    return normalized


def setup_logging(level: str = "INFO") -> None:
    """Configure logging for the application.

    Sets up:
    - Console handler (colored, for development)
    - Rotating file handler (all logs)
    - Error-only rotating file handler
    - Module-specific log files
    """
    root_logger = logging.getLogger()
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    # Root stays at DEBUG so file handlers always capture full detail;
    # user-facing verbosity is controlled by the console handler level.
    root_logger.setLevel(logging.DEBUG)

    # Clear existing handlers (and close them) so repeated calls are idempotent.
    _clear_logger_handlers(root_logger)
    for _name in ("app.queue", "app.adapters.comfyui", "app.adapters.ollama"):
        child = logging.getLogger(_name)
        _clear_logger_handlers(child)
        # Module loggers propagate to root (which owns app.log) AND write
        # their own file. Clear + re-add keeps exactly one file handler each.
        child.propagate = True

    _request_filter = _RequestIdFilter()

    # === Console Handler (Windows-compatible, no Unicode box chars) ===
    # Bind to the original stdout captured at import time. If we bound to the
    # current sys.stdout and a previous setup_logging() already installed our
    # wrapper, every log write would loop through the wrapper -> RecursionError.
    console_handler = logging.StreamHandler(_ORIGINAL_STDOUT)
    # Console follows the configured level (previously hardcoded DEBUG,
    # which flooded the terminal even at INFO).
    console_handler.setLevel(numeric_level)
    console_handler._nma_console = True  # type: ignore[attr-defined]
    console_handler.addFilter(_request_filter)
    console_fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)-30s | [%(request_id)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    console_handler.setFormatter(console_fmt)
    root_logger.addHandler(console_handler)

    # === App Log (all messages) ===
    app_handler = logging.handlers.RotatingFileHandler(
        APP_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    app_handler.setLevel(logging.DEBUG)
    app_handler.addFilter(_request_filter)
    app_fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)-35s | %(funcName)-25s | [%(request_id)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    app_handler.setFormatter(app_fmt)
    root_logger.addHandler(app_handler)

    # === Error Log (errors only) ===
    error_handler = logging.handlers.RotatingFileHandler(
        ERROR_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.addFilter(_request_filter)
    error_fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)-35s | %(funcName)-25s | [%(request_id)s] %(message)s\n"
        "  %(pathname)s:%(lineno)d",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    error_handler.setFormatter(error_fmt)
    root_logger.addHandler(error_handler)

    # === Queue-specific Logger ===
    queue_logger = logging.getLogger("app.queue")
    queue_logger.propagate = True
    queue_handler = logging.handlers.RotatingFileHandler(
        QUEUE_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    queue_handler.setLevel(logging.DEBUG)
    queue_handler.setFormatter(app_fmt)
    queue_handler.addFilter(_request_filter)
    queue_logger.addHandler(queue_handler)

    # === ComfyUI-specific Logger ===
    comfyui_logger = logging.getLogger("app.adapters.comfyui")
    comfyui_logger.propagate = True
    comfyui_handler = logging.handlers.RotatingFileHandler(
        COMFYUI_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    comfyui_handler.setLevel(logging.DEBUG)
    comfyui_handler.setFormatter(app_fmt)
    comfyui_handler.addFilter(_request_filter)
    comfyui_logger.addHandler(comfyui_handler)

    # === Ollama-specific Logger ===
    ollama_logger = logging.getLogger("app.adapters.ollama")
    ollama_logger.propagate = True
    ollama_handler = logging.handlers.RotatingFileHandler(
        OLLAMA_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    ollama_handler.setLevel(logging.DEBUG)
    ollama_handler.setFormatter(app_fmt)
    ollama_handler.addFilter(_request_filter)
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
    """Read the last N lines from a log file (memory-efficient tail)."""
    if not log_file.exists():
        return ["Log file not found"]

    try:
        with open(log_file, encoding="utf-8", errors="replace") as f:
            tail = collections.deque(f, maxlen=max(1, lines))
            return [line.rstrip("\r\n") for line in tail]
    except Exception as e:
        return [f"Error reading log: {e}"]


def clear_log_files() -> list[str]:
    """Truncate known log files without breaking open RotatingFileHandlers.

    Direct ``open(path, "w")`` truncation leaves handler file offsets stale
    (subsequent writes pad with NUL bytes). Flushing handlers and truncating
    through the same file object keeps offsets consistent.
    """
    cleared: list[str] = []
    # Flush all handlers first so buffered records land before truncation.
    for logger in [logging.getLogger(), *[logging.getLogger(n) for n in (
        "app.queue", "app.adapters.comfyui", "app.adapters.ollama",
    )]]:
        for handler in logger.handlers:
            try:
                handler.acquire()
                try:
                    handler.flush()
                    stream = getattr(handler, "stream", None)
                    if stream is not None and not getattr(stream, "closed", True):
                        try:
                            stream.flush()
                            stream.seek(0)
                            stream.truncate(0)
                            stream.flush()
                        except (OSError, ValueError):
                            pass
                finally:
                    handler.release()
            except Exception:
                pass
    # Truncate any known log file not covered by an open handler (e.g.
    # comfyui_native, which we never write to).
    for name, path in get_log_files().items():
        try:
            if path.exists() and path.stat().st_size > 0:
                with open(path, "w", encoding="utf-8"):
                    pass
        except OSError:
            continue
        cleared.append(name)
    return cleared


def get_recent_errors(log_file: Path = ERROR_LOG, minutes: int = 60, max_errors: int = 50) -> list[str]:
    """Get error log entries from the last N minutes (newest first scan)."""
    if not log_file.exists():
        return []

    cutoff = datetime.now() - timedelta(minutes=minutes)
    errors: list[str] = []
    try:
        tail = read_log_tail(log_file, lines=max(1000, max_errors * 20))
        # Scan newest-first so a large file returns the most recent errors,
        # not the oldest ones that happen to fall inside the window.
        for line in reversed(tail):
            if len(line) > 20 and " | " in line[:25]:
                try:
                    ts = datetime.strptime(line[:19], "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    continue  # continuation/traceback line — skip, parent holds context
                if ts >= cutoff:
                    errors.append(line)
                    if len(errors) >= max_errors:
                        break
                elif errors:
                    # Lines are chronological; older than cutoff after at
                    # least one hit means we have left the window.
                    break
        errors.reverse()
    except Exception as e:
        return [f"Error reading error log: {e}"]

    return errors


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
