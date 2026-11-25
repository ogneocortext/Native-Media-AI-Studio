"""Single source of truth for logging infrastructure config.

Reads ``config/logging.json`` (mirrors ``config/ports.json``) so logging
rotation, retention, per-logger levels, JSON output, PII redaction, request
traffic capture and Sentry wiring are configured in ONE place instead of being
scattered across hardcoded constants in ``logging_config.py`` and ``NMA_*``
environment variables.

The console log LEVEL is deliberately NOT owned here -- it is a live,
user-facing setting stored in ``config/settings.json`` (``config.log_level``)
and edited at runtime from the Settings page. Everything else lives in the
JSON file so operators change it in one spot and it survives restarts.

Loading is cached by file mtime so repeated calls in the request path are
cheap, while an operator edit to ``logging.json`` is picked up on the next
call without a restart (same hot-reload idea as settings.json).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .config import CONFIG_DIR

logger = logging.getLogger(__name__)

LOGGING_CONFIG_PATH = CONFIG_DIR / "logging.json"

# Defaults mirror the historical hardcoded values so behaviour is unchanged
# when the JSON file is absent or only partially specified.
_DEFAULTS: dict[str, Any] = {
    "json_logs": False,
    "pii_redaction": True,
    "rotation": {"max_bytes": 10 * 1024 * 1024, "backup_count": 5},
    "retention_days": 7,
    "third_party_levels": {
        "uvicorn.access": "WARNING",
        "uvicorn.error": "WARNING",
        "websockets": "WARNING",
        "aiohttp": "WARNING",
        "sse_starlette": "WARNING",
    },
    "traffic": {
        "enabled": True,
        "buffer_size": 500,
        "log_file": "traffic.log",
        "capture_all": True,
        "slow_ms": 500,
        "excluded_paths": ["/api/health", "/api/events", "/api/logs/traffic", "/api/logs/presence"],
    },
    "sentry": {"dsn": None, "environment": None},
    "analytics": {
        "auto_ingest": True,
        "interval_seconds": 15,
        "sources": ["app", "error"],
        "limit": 20000,
    },
    "presence": {
        "version": "1.4",
        "session_gap_seconds": 900,
        "people": [],
    },
}

_cache: dict[str, Any] | None = None
_cache_mtime: float | None = None


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``override`` onto a copy of ``base``.

    Nested dicts (rotation, traffic, sentry, third_party_levels) merge key by
    key so a partial JSON file does not wipe out sibling defaults.
    """
    out = dict(base)
    for key, val in (override or {}).items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = val
    return out


def load(*, force: bool = False) -> dict[str, Any]:
    """Return the merged logging config (defaults + config/logging.json)."""
    global _cache, _cache_mtime
    try:
        mtime = LOGGING_CONFIG_PATH.stat().st_mtime
    except OSError:
        _cache = dict(_DEFAULTS)
        _cache_mtime = None
        return _cache

    if _cache is not None and not force and mtime == _cache_mtime:
        return _cache

    data: dict[str, Any] = {}
    try:
        with open(LOGGING_CONFIG_PATH, encoding="utf-8") as fh:
            loaded = json.load(fh)
        if isinstance(loaded, dict):
            # Drop the descriptive "_about" block; it is documentation only.
            data = {k: v for k, v in loaded.items() if k != "_about"}
        else:
            logger.warning("%s is not a JSON object; using defaults", LOGGING_CONFIG_PATH)
    except Exception as exc:  # noqa: BLE001 - never let logging config kill startup
        logger.warning("Could not load %s (%s); using defaults", LOGGING_CONFIG_PATH, exc)
        data = {}

    _cache = _deep_merge(_DEFAULTS, data)
    _cache_mtime = mtime
    return _cache


# --- Typed accessors (so callers do not index dict keys by hand) -----------


def json_logs() -> bool:
    return bool(load().get("json_logs", False))


def pii_redaction() -> bool:
    return bool(load().get("pii_redaction", True))


def rotation() -> dict[str, Any]:
    return load().get("rotation", {})


def retention_days() -> int:
    try:
        return int(load().get("retention_days", 7))
    except (TypeError, ValueError):
        return 7


def third_party_levels() -> dict[str, str]:
    return load().get("third_party_levels", {})


def traffic() -> dict[str, Any]:
    return load().get("traffic", {})


def sentry() -> dict[str, Any]:
    return load().get("sentry", {})


def analytics() -> dict[str, Any]:
    return load().get("analytics", {})


def presence() -> dict[str, Any]:
    return load().get("presence", {})
