"""Live request-traffic recorder.

Every inbound HTTP request is appended to an in-memory ring buffer (and
optionally an append-only ``output/logs/traffic.log`` journal) so the Admin
"Live Traffic" panel can show *all* requests as they happen -- independently of
the console log level. Fast requests that the text access log drops at DEBUG
still appear here, which is the whole point: the operator sees every call.

Configuration (buffer size, capture-all, excluded paths, log file) comes from
``config/logging.json`` via ``core.logging_settings`` -- no hardcoded knobs.

Design notes:
- A single ``deque(maxlen=N)`` bounded by ``traffic.buffer_size`` keeps memory
  flat; the oldest entries fall off. ``seq`` is a monotonic id so the frontend
  can poll incrementally with ``since=<last_seq>`` instead of refetching.
- ``excluded_paths`` (health/SSE/the traffic endpoint itself) are skipped so
  polling loops and probes do not flood the buffer or feed back on themselves.
- File writes are flushed per record: volume is low (dev tool) and this makes
  the journal immediately tail-able and crash-durable.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from datetime import datetime
from typing import TYPE_CHECKING, Any

from . import logging_settings
from .logging_config import LOG_DIR

if TYPE_CHECKING:  # Path is only referenced in annotations (PEP 563)
    from pathlib import Path

_lock = threading.Lock()


def _cfg() -> dict[str, Any]:
    return logging_settings.traffic()


def _initial_buffer_size() -> int:
    """Read buffer_size from config at import time so traffic config is honored
    even if configure() is never called."""
    try:
        return int(_cfg().get("buffer_size", 500) or 500)
    except (TypeError, ValueError):
        return 500


_records: deque[dict[str, Any]] = deque(maxlen=_initial_buffer_size())
_seq = 0

_file_fh = None  # lazy-opened append handle for traffic.log
_file_path: Path | None = None
_file_configured = False


def _excluded_paths() -> set[str]:
    return {str(p) for p in _cfg().get("excluded_paths", [])}


def _ensure_file() -> None:
    """Open traffic.log once (per process) if capture is enabled."""
    global _file_fh, _file_path, _file_configured
    if _file_configured:
        return
    _file_configured = True
    cfg = _cfg()
    if not cfg.get("enabled", True):
        return
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        _file_path = LOG_DIR / str(cfg.get("log_file", "traffic.log"))
        _file_fh = open(_file_path, "a", encoding="utf-8")
    except Exception:  # noqa: BLE001 - logging must never crash the app
        _file_fh = None


def configure() -> None:
    """Re-apply buffer size from config (call after an operator edit)."""
    global _records
    size = int(_cfg().get("buffer_size", 500) or 500)
    with _lock:
        if _records.maxlen != size:
            _records = deque(_records, maxlen=size)


def is_enabled() -> bool:
    return bool(_cfg().get("enabled", True))


def client_ip_from(request: Any) -> str:
    """Best-effort client IP for the Live Traffic panel.

    Resolution order:
      1. First entry of ``X-Forwarded-For`` -- the original client as recorded by
         the Tailscale HTTP serve proxy / Vite dev proxy sitting in front of us.
      2. The socket peer (``request.client.host``) when no forwarding header is set.
      3. ``"-"`` when neither is available.

    Trust note (deployment-specific safeguard): we trust ``X-Forwarded-For``
    because in this deployment EVERY backend request arrives over loopback. The
    backend binds 127.0.0.1:8004 only; the only paths in are the Vite dev proxy
    (127.0.0.1:5173 -> 127.0.0.1:8004) or ``tailscale serve`` forwarding to
    localhost. No external client can open a socket straight to the backend, so a
    caller cannot spoof the header to mask its real IP. If the backend is ever
    bound to 0.0.0.0 / a public interface, this trust MUST be revisited -- only
    then could an untrusted client forge X-Forwarded-For.
    """
    try:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            # First hop = the original client; later hops are our own proxies.
            first = xff.split(",")[0].strip()
            if first:
                return first
        client = getattr(request, "client", None)
        if client is not None and getattr(client, "host", None):
            return client.host
    except Exception:  # noqa: BLE001 - never let IP resolution break request logging
        pass
    return "-"


def record(
    *,
    method: str,
    path: str,
    status: int,
    duration_ms: float,
    client_ip: str = "-",
    request_id: str = "-",
    query: str = "",
) -> dict[str, Any] | None:
    """Append one request record. Returns the stored record, or None if skipped."""
    global _seq
    cfg = _cfg()
    if not cfg.get("enabled", True):
        return None
    if path in _excluded_paths():
        return None

    now = time.time()
    with _lock:
        _seq += 1
        record: dict[str, Any] = {
            "seq": _seq,
            "ts_ms": int(now * 1000),
            "ts": datetime.fromtimestamp(now).isoformat(timespec="milliseconds"),
            "method": method,
            "path": path,
            "status": int(status),
            "duration_ms": round(float(duration_ms), 1),
            "client_ip": client_ip,
            "request_id": request_id,
        }
        if query:
            record["query"] = query[:200]
        _records.append(record)
        line = json.dumps(record, separators=(",", ":"))

    if cfg.get("capture_all", True):
        _ensure_file()
        if _file_fh is not None:
            try:
                _file_fh.write(line + "\n")
                _file_fh.flush()
            except Exception:  # noqa: BLE001
                pass
    return record


def recent(limit: int = 200) -> list[dict[str, Any]]:
    """Return the most recent ``limit`` records, oldest-first."""
    with _lock:
        items = list(_records)
    return items[-limit:] if limit and limit < len(items) else items


def since(after_seq: int = 0, limit: int = 500) -> list[dict[str, Any]]:
    """Return records with ``seq`` greater than ``after_seq`` (incremental poll)."""
    with _lock:
        items = [r for r in _records if r["seq"] > after_seq]
    return items[-limit:] if limit and limit < len(items) else items


def latest_seq() -> int:
    with _lock:
        return _records[-1]["seq"] if _records else 0


def shutdown() -> None:
    """Close the traffic.log file handle. Called on backend shutdown."""
    global _file_fh
    if _file_fh is not None:
        try:
            _file_fh.flush()
            _file_fh.close()
        except Exception:  # noqa: BLE001
            pass
        _file_fh = None
