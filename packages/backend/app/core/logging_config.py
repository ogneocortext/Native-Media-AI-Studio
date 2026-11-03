"""
Centralized logging configuration for Native Media AI Studio.

Provides:
- Structured logging to both console and files (text and JSON formats)
- Log rotation to prevent disk fill
- Per-module log levels
- stdout/stderr capture for print() calls
- API endpoint to view logs from frontend
- PII redaction (emails, phones, IPs, Windows paths)
- Optional Sentry integration for structured log shipping
- Log sampling for high-volume operations

November 2026 best practices applied:
- Structured JSON logging for machine-parseable output
- Correlation IDs via contextvars (request_id, job_id)
- Structured event names (snake_case)
- PII redaction
- Proper log levels (DEBUG/INFO/WARN/ERROR)
- Log sampling for high-volume operations
"""

import collections
import contextlib
import contextvars
import functools
import json
import logging
import logging.handlers
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

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
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("nma_request_id", default="-")


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


# Job-scoped correlation id, set by the processor for the lifetime of one job's
# execution. Separate from ``request_id`` because a job outlives the request that
# created it: the enqueue happens under a request id, but every later step -
# claiming, the handler, retries, dead-lettering - runs in the processor's own
# context with no request to inherit from.
#
# Without this, `rg <job-id>` finds the enqueue line and nothing after it, which
# is why an untraceable failure could not be followed: there was no second line
# to find. Set it with ``job_context`` so the handler's own loggers pick it up
# without threading a parameter through every call.
job_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("nma_job_id", default="-")


def set_job_id(job_id: str) -> None:
    """Set the job correlation id for the current execution context."""
    job_id_var.set(job_id or "-")


def get_job_id() -> str:
    """Return the job correlation id for the current execution context."""
    return job_id_var.get()


# Capture correlation IDs at record-creation time, not format time.
#
# By the time a handler runs a formatter, the emitting coroutine may have
# yielded and the ambient contextvar may belong to a different request/job.
# A record factory stamps request_id/job_id onto each record at the moment
# it is created, so the value travels with the record. This is the
# recommended pattern for async logging (contextvars are copied per task).
_base_record_factory = logging.getLogRecordFactory()


def _context_record_factory(*args, **kwargs):
    record = _base_record_factory(*args, **kwargs)
    record.request_id = request_id_var.get()
    record.job_id = job_id_var.get()
    return record


logging.setLogRecordFactory(_context_record_factory)


@contextlib.contextmanager
def job_context(job_id: str):
    """Bind ``job_id`` for the duration of a job's execution.

    Restores the previous value on exit so one job's id cannot leak into the
    next - the processor reuses one task for every job it runs.
    """
    token = job_id_var.set(job_id or "-")
    try:
        yield
    finally:
        job_id_var.reset(token)


class _JobIdFilter(logging.Filter):
    """Inject ``job_id`` into every record, so job logs are greppable by id."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "job_id"):
            record.job_id = get_job_id()  # type: ignore[attr-defined]
        return True


# ---------------------------------------------------------------------------
# PII redaction - November 2026 best practice: never log emails, phones, IPs
# ---------------------------------------------------------------------------

# Mask (not full-replace) PII to preserve debugging structure while protecting
# identity. Full replacement (`<email>`, `<ipv4>`) destroys the ability to
# correlate related records; masking keeps enough shape to debug.

_PII_EMAIL_RE = re.compile(r"([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})")
_PII_PHONE_RE = re.compile(r"\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b")
# Validate octets 0-255 so we don't redact arbitrary digit sequences like
# version numbers (e.g. 3.14.7) or semantic versions.
_PII_IP_V4_RE = re.compile(
    r"\b((?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d))\b"
)
_PII_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:\\(?:[^\"'\n\r]+\\)*[^\"'\n\r:]+")
# Narrower API-key heuristic: common prefixes or 40+ hex/base64 chars, to avoid
# redacting innocuous long alphanumeric tokens (hashes, UUIDs without dashes).
_PII_API_KEY_RE = re.compile(
    r"\b(sk|pk|ghp|glpat|xoxb|ai-)[A-Za-z0-9_\-]{16,}\b"
    r"|\b[A-Za-z0-9+/]{40,}={0,2}\b"
)


class _PIIRedactionFilter(logging.Filter):
    """Redact PII from log messages: emails, phones, IPs, Windows paths, API keys.

    Applied as a filter so it runs on every record before formatting. The
    original message object is mutated so formatters see the redacted text.
    Masking (not full replacement) preserves debugging structure.
    """

    def __init__(self, *, enabled: bool = True):
        super().__init__()
        self.enabled = enabled

    def filter(self, record: logging.LogRecord) -> bool:
        if not self.enabled:
            return True
        try:
            msg = record.getMessage()
            redacted = _redact_pii(msg)
            if redacted != msg:
                record.msg = redacted
                record.args = ()  # clear args so they aren't re-formatted into raw text
        except Exception:
            pass  # never let redaction break logging
        return True


# Redaction audit trail: counts per PII type. Logged periodically so operators
# can detect a feature that is leaking sensitive data into logs. Counts never
# record the actual PII values.
REDACTION_COUNTS: dict[str, int] = defaultdict(int)


def _redaction_audit(kind: str) -> None:
    REDACTION_COUNTS[kind] += 1


def _mask_email(match: re.Match) -> str:
    local, domain = match.group(1), match.group(2)
    masked_local = local[0] + "***" if local else "***"
    return f"{masked_local}@{domain}"


def _mask_phone(match: re.Match) -> str:
    return f"{match.group(1)}-***-{match.group(3)}"


def _mask_ip(match: re.Match) -> str:
    octets = match.group(1).split(".")
    octets[-1] = "xxx"
    return ".".join(octets)


def _redact_pii(text: str) -> str:
    """Return text with PII replaced by masked placeholders.

    Masking preserves structure (email domain, phone area code, IP prefix) so
    logs remain debuggable without exposing identities. Each redaction is
    counted in REDACTION_COUNTS for compliance auditing.
    """
    text, n = _PII_EMAIL_RE.subn(_mask_email, text)
    REDACTION_COUNTS["email"] += n
    text, n = _PII_PHONE_RE.subn(_mask_phone, text)
    REDACTION_COUNTS["phone"] += n
    text, n = _PII_IP_V4_RE.subn(_mask_ip, text)
    REDACTION_COUNTS["ipv4"] += n
    text, n = _PII_WINDOWS_PATH_RE.subn("<path>", text)
    REDACTION_COUNTS["windows_path"] += n
    text, n = _PII_API_KEY_RE.subn("<api_key>", text)
    REDACTION_COUNTS["api_key"] += n
    return text


# ---------------------------------------------------------------------------
# Structured JSON formatter - November 2026 best practice
# ---------------------------------------------------------------------------


class _StructuredJSONFormatter(logging.Formatter):
    """Emit log records as JSON for machine parsing by log aggregators.

    Output fields (snake_case, with units where applicable):
    - timestamp (ISO-8601)
    - level (severity_text)
    - logger (module name)
    - message (the log message, PII-redacted)
    - request_id (correlation id for the request)
    - job_id (correlation id for the job)
    - function (calling function name)
    - line (calling line number)
    - duration_ms (optional, set via extra)
    - size_bytes (optional, set via extra)
    - event (optional structured event name, snake_case)
    - exception (optional, formatted traceback)
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
            "job_id": getattr(record, "job_id", "-"),
            "function": record.funcName,
            "line": record.lineno,
        }

        # Add optional structured fields from extra= kwargs
        for extra_key in ("duration_ms", "size_bytes", "event", "error_code", "retry_count"):
            val = getattr(record, extra_key, None)
            if val is not None:
                payload[extra_key] = val

        # Include exception info if present
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------------------
# Structured event logging helper - snake_case event names with structured fields
# ---------------------------------------------------------------------------


class StructuredLogger:
    """Wrapper around :mod:`logging` that encourages structured event logging.

    Usage::

        from app.core.logging_config import structured_logger

        structured_logger.info("job.completed", job_id="abc", duration_ms=450,
                               size_bytes=1024000, stem="vocals")

    Produces a JSON log record with ``event="job.completed"`` and the extra
    fields as top-level queryable attributes.

    Event names should be snake_case (e.g. ``job.completed``, ``stem.processed``,
    ``audio.analysis.started``).
    """

    def __init__(self, name: str = "app.structured"):
        self._logger = logging.getLogger(name)

    def _log(self, level: int, event: str, message: str | None = None, **fields: Any) -> None:
        exc_info = fields.pop("exc_info", False)
        extra: dict[str, Any] = {"event": event}
        extra.update(fields)
        msg = message or event
        self._logger.log(level, msg, extra=extra, exc_info=exc_info)

    def debug(self, event: str, message: str | None = None, **fields: Any) -> None:
        self._log(logging.DEBUG, event, message, **fields)

    def info(self, event: str, message: str | None = None, **fields: Any) -> None:
        self._log(logging.INFO, event, message, **fields)

    def warning(self, event: str, message: str | None = None, **fields: Any) -> None:
        self._log(logging.WARNING, event, message, **fields)

    def error(self, event: str, message: str | None = None, **fields: Any) -> None:
        self._log(logging.ERROR, event, message, **fields)

    def exception(self, event: str, message: str | None = None, **fields: Any) -> None:
        self._log(logging.ERROR, event, message, exc_info=True, **fields)


# ---------------------------------------------------------------------------
# Log sampling for high-volume operations - November 2026 best practice
# ---------------------------------------------------------------------------


class LogSampler:
    """Sample log events to prevent log volume explosion in tight loops.

    Usage::

        sampler = LogSampler(sample_rate=0.1)  # log 10% of events
        if sampler.should_log():
            logger.info("processing_item", item_id=..., duration_ms=...)

    Rate is a float in (0, 1]. A rate of 1.0 logs everything.
    """

    def __init__(self, sample_rate: float = 1.0):
        self.sample_rate = max(0.0, min(1.0, sample_rate))
        self._count = 0

    def should_log(self) -> bool:
        """Return True if this event should be logged (based on sample rate)."""
        import random

        self._count += 1
        if self.sample_rate >= 1.0:
            return True
        return random.random() < self.sample_rate


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


def setup_logging(
    level: str = "INFO",
    *,
    json_logs: bool = False,
    pii_redaction: bool = True,
    sentry_dsn: str | None = None,
    sentry_env: str | None = None,
) -> None:
    """Configure logging for the application.

    Sets up:
    - Console handler (colored, for development)
    - Rotating file handler (all logs)
    - Error-only rotating file handler
    - Module-specific log files
    - Optional JSON formatter (for log aggregation)
    - Optional PII redaction
    - Optional Sentry integration

    Args:
        level: Console log level (DEBUG/INFO/WARNING/ERROR/CRITICAL)
        json_logs: Emit JSON-structured logs to file handlers (machine-parseable)
        pii_redaction: Redact emails, phones, IPs, paths from all log records
        sentry_dsn: Optional Sentry DSN for shipping logs/errors to Sentry
        sentry_env: Optional Sentry environment name
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
    _job_filter = _JobIdFilter()
    _pii_filter = _PIIRedactionFilter(enabled=pii_redaction)

    # Choose formatter based on json_logs flag
    if json_logs:
        console_fmt = _StructuredJSONFormatter()
        app_fmt = _StructuredJSONFormatter()
        error_fmt = _StructuredJSONFormatter()
    else:
        console_fmt = logging.Formatter(
            "%(asctime)s | %(levelname)-7s | %(name)-30s | [%(request_id)s] [%(job_id)s] %(message)s",
            datefmt="%H:%M:%S",
        )
        app_fmt = logging.Formatter(
            "%(asctime)s | %(levelname)-7s | %(name)-35s | %(funcName)-25s | [%(request_id)s] [%(job_id)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        error_fmt = logging.Formatter(
            "%(asctime)s | %(levelname)-7s | %(name)-35s | %(funcName)-25s | [%(request_id)s] [%(job_id)s] %(message)s\n"
            "  %(pathname)s:%(lineno)d",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

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
    console_handler.addFilter(_job_filter)
    console_handler.addFilter(_pii_filter)
    console_handler.setFormatter(console_fmt)
    root_logger.addHandler(console_handler)

    # === App Log (all messages) ===
    app_handler = logging.handlers.RotatingFileHandler(
        APP_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    app_handler.setLevel(logging.DEBUG)
    app_handler.addFilter(_request_filter)
    app_handler.addFilter(_job_filter)
    app_handler.addFilter(_pii_filter)
    app_handler.setFormatter(app_fmt)
    root_logger.addHandler(app_handler)

    # === Error Log (errors only) ===
    error_handler = logging.handlers.RotatingFileHandler(
        ERROR_LOG, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.addFilter(_request_filter)
    error_handler.addFilter(_job_filter)
    error_handler.addFilter(_pii_filter)
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
    queue_handler.addFilter(_job_filter)
    queue_handler.addFilter(_pii_filter)
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
    comfyui_handler.addFilter(_job_filter)
    comfyui_handler.addFilter(_pii_filter)
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
    ollama_handler.addFilter(_job_filter)
    ollama_handler.addFilter(_pii_filter)
    ollama_logger.addHandler(ollama_handler)

    # === Optional Sentry integration ===
    if sentry_dsn:
        _setup_sentry(sentry_dsn, sentry_env)

    # === Quiet down noisy third-party loggers ===
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("aiohttp").setLevel(logging.WARNING)
    logging.getLogger("sse_starlette").setLevel(logging.WARNING)

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

    root_logger.info(
        "Logging initialized (level=%s, dir=%s, json=%s, pii=%s)",
        level,
        LOG_DIR,
        json_logs,
        pii_redaction,
    )

    # Cleanup old log files on startup
    cleanup_old_logs(LOG_DIR, LOG_RETENTION_DAYS)


def _setup_sentry(dsn: str, env: str | None = None) -> None:
    """Initialize Sentry SDK for structured log/error shipping.

    Sentry captures logs alongside errors and traces, enabling
    log-based alerting and dashboarding. Requires ``sentry-sdk`` package.

    November 2026 best practice: logs, errors, and traces live together
    so debugging doesn't require switching tools.
    """
    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration

        sentry_logging = LoggingIntegration(
            level=logging.INFO,  # capture INFO+ as breadcrumbs
            event_level=logging.ERROR,  # send ERROR+ as events
            capture_sentry_logs=True,  # capture structured logs
        )

        sentry_sdk.init(
            dsn=dsn,
            environment=env,
            integrations=[sentry_logging],
            # Attach release/version if available
            release=getattr(
                __import__("app.core.config", fromlist=["__version__"]), "__version__", None
            ),
            # Only send errors, not every transaction (cost control)
            traces_sample_rate=0.1,
        )
        logging.getLogger(__name__).info(
            "Sentry logging integration enabled (env=%s)", env or "default"
        )
    except ImportError:
        logging.getLogger(__name__).warning(
            "Sentry DSN provided but sentry-sdk not installed; install with: pip install sentry-sdk"
        )
    except Exception as exc:  # pragma: no cover - defensive
        logging.getLogger(__name__).warning("Sentry setup failed: %s", exc)


def cleanup_old_logs(log_dir: Path, retention_days: int = 7) -> int:
    """Remove log files older than retention_days. Returns count of removed files."""
    if not log_dir.exists():
        return 0
    cutoff = datetime.now() - timedelta(days=retention_days)
    removed = 0
    # Only clean the log directory itself (not subdirectories like test artifacts
    # or user data that may live under output/logs/).
    for f in log_dir.iterdir():
        if not f.is_file():
            continue
        # Match active logs (app.log) and rotated logs (app.log.1, app.log.2, ...)
        name = f.name
        if not (
            name.startswith(("app.log", "error.log", "queue.log", "comfyui.log", "ollama.log"))
            or f.suffix in (".log", ".err")
        ):
            continue
        try:
            if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                f.unlink()
                removed += 1
        except OSError:
            pass
    if removed:
        logging.getLogger(__name__).info(
            "Cleaned up %d old log files (>%d days)", removed, retention_days
        )
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
    for logger in [
        logging.getLogger(),
        *[
            logging.getLogger(n)
            for n in (
                "app.queue",
                "app.adapters.comfyui",
                "app.adapters.ollama",
            )
        ],
    ]:
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


def get_recent_errors(
    log_file: Path = ERROR_LOG, minutes: int = 60, max_errors: int = 50
) -> list[str]:
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
                    continue  # continuation/traceback line -- skip, parent holds context
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


# ------------------------------------------------------------------
# Timing decorator - November 2026 best practice: log function duration_ms
# ------------------------------------------------------------------


def timed(logger_name: str | None = None, level: int = logging.DEBUG):
    """Decorator that logs function entry/exit with elapsed duration_ms.

    Usage::

        @timed()
        def my_function(arg):
            ...

        @timed(logger_name="app.remotion", level=logging.INFO)
        def render_video(composition_id):
            ...

    The decorated function's logs will include:
    - event: "<module>.<function>.started" / "<module>.<function>.completed"
    - duration_ms: elapsed wall-clock time
    - function: the function name
    - Plus any correlation IDs from contextvars (request_id, job_id)
    """

    def decorator(func):
        func_logger = logging.getLogger(logger_name or func.__module__)
        event_name = f"{func.__module__}.{func.__qualname__}"

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            start = time.perf_counter()
            structured_logger.debug(
                f"{event_name}.started",
                function=func.__qualname__,
            )
            try:
                result = func(*args, **kwargs)
                return result
            except Exception:
                structured_logger.error(
                    f"{event_name}.failed",
                    function=func.__qualname__,
                    duration_ms=(time.perf_counter() - start) * 1000,
                    exc_info=True,
                )
                raise
            finally:
                elapsed_ms = (time.perf_counter() - start) * 1000
                func_logger.log(
                    level,
                    f"{event_name}.completed",
                    extra={
                        "event": f"{event_name}.completed",
                        "duration_ms": round(elapsed_ms, 2),
                        "function": func.__qualname__,
                    },
                )

        return wrapper

    return decorator


# ------------------------------------------------------------------
# Module-level instances
# ------------------------------------------------------------------

structured_logger = StructuredLogger()
