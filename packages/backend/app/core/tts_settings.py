"""Single source of truth for TTS engine config.

Reads ``config/tts.json`` (mirrors ``config/logging.json``) so the Pocket TTS
proxy endpoint, token env-var name, default voice and timeout live in ONE
place instead of being hardcoded in ``app/api/voice_pocket.py``.

Loading is cached by file mtime so repeated calls in the request path are
cheap, while an operator edit to ``tts.json`` is picked up on the next call
without a restart (same hot-reload idea as logging.json).

The Bearer token itself is deliberately NOT here -- only the NAME of the
environment variable that carries it (``pocket.token_env``). The value is
read from the process environment at request time, server-side only.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .config import CONFIG_DIR

logger = logging.getLogger(__name__)

TTS_CONFIG_PATH = CONFIG_DIR / "tts.json"

# Defaults mirror config/tts.json so behaviour is sane when the file is
# absent or only partially specified.
_DEFAULTS: dict[str, Any] = {
    "pocket": {
        "base_url": "http://127.0.0.1:8811",
        "token_env": "POCKET_TTS_TOKEN",
        "default_voice": "maya-blend65",
        "timeout_s": 30,
    },
}

_cache: dict[str, Any] | None = None
_cache_mtime: float | None = None


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, val in (override or {}).items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = val
    return out


def load(*, force: bool = False) -> dict[str, Any]:
    """Return the merged TTS config (defaults + config/tts.json)."""
    global _cache, _cache_mtime
    try:
        mtime = TTS_CONFIG_PATH.stat().st_mtime
    except OSError:
        _cache = dict(_DEFAULTS)
        _cache_mtime = None
        return _cache

    if _cache is not None and not force and mtime == _cache_mtime:
        return _cache

    data: dict[str, Any] = {}
    try:
        with open(TTS_CONFIG_PATH, encoding="utf-8") as fh:
            loaded = json.load(fh)
        if isinstance(loaded, dict):
            data = {k: v for k, v in loaded.items() if k != "_about"}
        else:
            logger.warning("%s is not a JSON object; using defaults", TTS_CONFIG_PATH)
    except Exception as exc:  # noqa: BLE001 - never let config kill requests
        logger.warning("Could not load %s (%s); using defaults", TTS_CONFIG_PATH, exc)
        data = {}

    _cache = _deep_merge(_DEFAULTS, data)
    _cache_mtime = mtime
    return _cache


def pocket() -> dict[str, Any]:
    return load().get("pocket", {})
