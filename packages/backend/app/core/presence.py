"""Presence computation from the live traffic ring buffer.

Derives a presence state for the configured identity (``config/logging.json``
-> ``presence``) from ``core.traffic_log``. Rules (see the ``presence`` block):

- ``state`` is ``"active"`` when her most recent request is within
  ``active_window_seconds``, ``"recent"`` within ``recent_window_seconds``, else
  ``"away"``.
- A *session* is a run of her requests whose consecutive gaps are under
  ``session_gap_seconds``; ``session_started_ts`` is the first request of the
  current / most recent session.

The presence and traffic-polling endpoints are excluded from the computation for
EVERY client so that polling can never make an identity look present.

This module is pure (no FastAPI); the HTTP route in ``app/api/logs.py`` just
calls :func:`compute_presence`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import logging_settings, traffic_log

# Paths that must never count toward presence -- the presence probe and the live
# traffic poll. Excluded for every client so polling cannot self-trigger presence.
_SELF_PATHS = frozenset({"/api/logs/presence", "/api/logs/traffic"})


def _iso(ts: float) -> str:
    """Epoch seconds -> ISO-8601 UTC string (unambiguous across timezones)."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def compute_presence(now: float | None = None) -> dict[str, Any]:
    """Return the presence snapshot for the configured identity.

    Response has exactly these fields: ``name``, ``role``, ``avatar``,
    ``state`` (``"active"`` | ``"recent"`` | ``"away"``), ``last_seen_ts``
    (ISO or null), ``seconds_since`` (number or null), ``session_started_ts``
    (ISO or null).
    """
    cfg = logging_settings.presence()
    name = str(cfg.get("name", "Maya"))
    role = str(cfg.get("role", "Manager"))
    avatar = str(cfg.get("avatar", "/maya-avatar.webp"))
    client_ip = str(cfg.get("client_ip", ""))
    active_window = float(cfg.get("active_window_seconds", 300))
    recent_window = float(cfg.get("recent_window_seconds", 1800))
    session_gap = float(cfg.get("session_gap_seconds", 900))

    if now is None:
        now = datetime.now(tz=timezone.utc).timestamp()

    # Collect her request timestamps (epoch seconds), newest-first, skipping the
    # self/polling paths so presence can never be triggered by polling.
    stamps: list[float] = []
    for rec in traffic_log.since(0, 1_000_000):
        if rec.get("client_ip") != client_ip:
            continue
        if str(rec.get("path", "")) in _SELF_PATHS:
            continue
        ts_ms = rec.get("ts_ms")
        if isinstance(ts_ms, (int, float)) and ts_ms > 0:
            stamps.append(float(ts_ms) / 1000.0)

    if not stamps:
        return {
            "name": name,
            "role": role,
            "avatar": avatar,
            "state": "away",
            "last_seen_ts": None,
            "seconds_since": None,
            "session_started_ts": None,
        }

    stamps.sort(reverse=True)  # newest first
    last = stamps[0]
    seconds_since = max(0.0, now - last)

    if seconds_since <= active_window:
        state = "active"
    elif seconds_since <= recent_window:
        state = "recent"
    else:
        state = "away"

    # Session = contiguous run of requests (newest -> older) whose gaps stay
    # under session_gap_seconds. The oldest request in that run is the start.
    session_start = last
    for i in range(1, len(stamps)):
        if (stamps[i - 1] - stamps[i]) < session_gap:
            session_start = stamps[i]
        else:
            break

    return {
        "name": name,
        "role": role,
        "avatar": avatar,
        "state": state,
        "last_seen_ts": _iso(last),
        "seconds_since": round(seconds_since, 1),
        "session_started_ts": _iso(session_start),
    }