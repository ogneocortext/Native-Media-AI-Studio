"""Presence v1.4 — roster, activity labels, restart backfill, git commits, journal.

``compute_presence()`` reads the roster from ``config/logging.json`` ->
``presence`` (``core.logging_settings``) and returns, for each person:

- ``source == "traffic"``: state/activity/session derived from the live traffic
  ring buffer (``core.traffic_log``), with a fallback to the tail of
  ``traffic.log`` when the ring buffer holds nothing for her (restart backfill).
- ``source == "commits"``: state derived from the repo's git log (last 50
  commits, matched against author name / email / any Co-authored-by trailer).
  Commit-source people are only ever ``recent`` or ``away`` -- never active, no
  session, no toast.

The presence and traffic-polling endpoints are excluded from the computation for
EVERY client so polling can never make an identity look present. The backend
binds loopback only and Tailscale's HTTP serve overwrites X-Forwarded-For with
the real peer, so presence cannot be spoofed through the door.

Sessions that have closed (last request older than ``session_gap_seconds``) and
are not yet journaled are appended to ``presence-journal.jsonl`` next to
``traffic.log`` (dedupe by ``started_ts`` so the restart backfill never
double-journals).

Pure module (no FastAPI); the routes in ``app/api/logs.py`` call
:func:`compute_presence` and :func:`read_journal`.
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
import time
from datetime import UTC, datetime
from operator import itemgetter
from pathlib import Path
from typing import Any

from . import logging_settings, traffic_log
from .logging_config import LOG_DIR

logger = logging.getLogger(__name__)

# Paths that must never count toward presence -- the presence probe and the live
# traffic poll. Excluded for every client so polling cannot self-trigger presence.
_SELF_PATHS = frozenset({"/api/logs/presence", "/api/logs/traffic"})

_JOURNAL_FILE = "presence-journal.jsonl"
_TRAFFIC_TAIL_LINES = 500
_GIT_CACHE_TTL = 60.0
_GIT_LOG_LIMIT = 50

_git_cache: dict[str, Any] = {"ts": 0.0, "data": None}
_git_lock = threading.Lock()

_journal_starts_cache: set[str] | None = None
_journal_lock = threading.Lock()


def _iso(ts: float) -> str:
    """Epoch seconds -> ISO-8601 UTC string (unambiguous across timezones)."""
    return datetime.fromtimestamp(ts, tz=UTC).isoformat()


def _activity_for_path(path: str, labels: dict[str, Any]) -> str:
    """Ordered prefix -> label match; the ``default`` key is the fallback."""
    default = str(labels.get("default", "working in the Studio"))
    for prefix, label in labels.items():
        if prefix == "default":
            continue
        if path.startswith(str(prefix)):
            return str(label)
    return default


# --------------------------------------------------------------------------- #
# traffic.log backfill
# --------------------------------------------------------------------------- #


def _read_traffic_tail(limit: int = _TRAFFIC_TAIL_LINES) -> list[dict[str, Any]]:
    """Return up to ``limit`` parsed JSON records from the tail of traffic.log."""
    path = LOG_DIR / str(logging_settings.traffic().get("log_file", "traffic.log"))
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:  # noqa: BLE001 - skip malformed lines
            continue
        if isinstance(rec, dict):
            out.append(rec)
    return out


# --------------------------------------------------------------------------- #
# git commits (commit-source people)
# --------------------------------------------------------------------------- #


def _repo_root() -> Path | None:
    """Walk up from this file until a ``.git`` directory is found."""
    try:
        here = Path(__file__).resolve()
    except Exception:  # noqa: BLE001
        return None
    for parent in here.parents:
        if (parent / ".git").exists():
            return parent
    return None


def _read_recent_commits(limit: int = _GIT_LOG_LIMIT) -> list[dict[str, Any]]:
    """Return ``[{hash, ts, author, email, trailers}]`` for the last ``limit`` commits.

    Only authorship fields are captured (author name/email + Co-authored-by
    trailer values) -- never the subject/body prose -- so matching cannot be
    fooled by a commit message that merely mentions a name.

    Any failure (missing git, not a repo, timeout, non-zero exit) returns ``[]``
    -- never raises, so a git problem degrades to "away" instead of an error.
    """
    root = _repo_root()
    if root is None:
        return []
    # %x1f separates fields, %x1d separates trailer values, %x1e ends a record.
    fmt = "%H%x1f%at%x1f%an%x1f%ae%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e"
    try:
        res = subprocess.run(
            ["git", "log", f"-{limit}", f"--format={fmt}"],
            cwd=str(root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
    except Exception:  # noqa: BLE001 - git missing / timeout / not a repo
        return []
    if res.returncode != 0:
        return []
    commits: list[dict[str, Any]] = []
    for chunk in res.stdout.split("\x1e"):
        chunk = chunk.strip("\n")
        if not chunk.strip():
            continue
        parts = chunk.split("\x1f")
        if len(parts) < 5:
            continue
        h, ts_raw, author, email, trailers_raw = parts[0], parts[1], parts[2], parts[3], parts[4]
        try:
            ts = float(ts_raw)
        except ValueError:
            continue
        trailers = [t for t in trailers_raw.split("\x1d") if t.strip()]
        commits.append(
            {"hash": h.strip(), "ts": ts, "author": author, "email": email, "trailers": trailers}
        )
    return commits


def _git_commits_cached() -> list[dict[str, Any]]:
    now = time.time()
    with _git_lock:
        if _git_cache["data"] is not None and (now - _git_cache["ts"]) < _GIT_CACHE_TTL:
            return _git_cache["data"]
    commits = _read_recent_commits()
    with _git_lock:
        _git_cache["data"] = commits
        _git_cache["ts"] = time.time()
    return commits


def _trailer_name(value: str) -> str:
    """Name part of a Co-authored-by value ('Kilo <kilo@x>' -> 'kilo')."""
    v = value.strip()
    if "<" in v:
        v = v.split("<", 1)[0]
    return v.strip().lower()


def _match_commit(match: str, commits: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Newest commit whose AUTHORSHIP matches ``match`` (never the message prose).

    A match is: ``match`` equals the author name, equals the author email's name
    part (before ``@``), or equals the name in a Co-authored-by trailer value.
    Subject/body prose is never inspected -- a message that merely mentions a
    name does not count.
    """
    needle = match.strip().lower()
    if not needle:
        return None
    for c in commits:  # newest first
        if (c.get("author") or "").strip().lower() == needle:
            return c
        email_name = (c.get("email") or "").split("@", 1)[0].strip().lower()
        if email_name == needle:
            return c
        for t in c.get("trailers", []):
            if _trailer_name(t) == needle:
                return c
    return None


# --------------------------------------------------------------------------- #
# visits journal
# --------------------------------------------------------------------------- #


def _journal_path() -> Path:
    return LOG_DIR / _JOURNAL_FILE


def _journaled_starts() -> set[str]:
    """Return the set of ``started_ts`` values already in the journal file."""
    global _journal_starts_cache
    if _journal_starts_cache is not None:
        return _journal_starts_cache
    starts: set[str] = set()
    try:
        with open(_journal_path(), encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:  # noqa: BLE001
                    continue
                s = rec.get("started_ts")
                if s:
                    starts.add(str(s))
    except OSError:
        pass
    _journal_starts_cache = starts
    return starts


def _journal_append(entry: dict[str, Any]) -> None:
    global _journal_starts_cache
    try:
        with open(_journal_path(), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except OSError:
        return
    with _journal_lock:
        if _journal_starts_cache is not None:
            _journal_starts_cache.add(str(entry.get("started_ts")))


def _maybe_journal(name: str, start_ts: float, end_ts: float, events: list[tuple[float, str]], labels: dict[str, Any]) -> None:
    """Append a journal line for a closed session not yet journaled."""
    started_iso = _iso(start_ts)
    with _journal_lock:
        if started_iso in _journaled_starts():
            return
    # Areas = activity labels in the order first touched (events are newest-first).
    areas: list[str] = []
    for _, path in reversed(events):
        label = _activity_for_path(path, labels)
        if label not in areas:
            areas.append(label)
    entry = {
        "name": name,
        "started_ts": started_iso,
        "ended_ts": _iso(end_ts),
        "duration_seconds": round(max(0.0, end_ts - start_ts), 1),
        "areas": areas,
        "requests": len(events),
    }
    _journal_append(entry)


def read_journal(limit: int = 5) -> list[dict[str, Any]]:
    """Return the newest ``limit`` journal entries (newest first)."""
    try:
        with open(_journal_path(), encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:  # noqa: BLE001
            continue
        if len(out) >= limit:
            break
    return out


# --------------------------------------------------------------------------- #
# people
# --------------------------------------------------------------------------- #


def _base_fields(person: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": person.get("id") or str(person.get("name", "")),
        "label": person.get("label") or str(person.get("name", "")),
        "sublabel": person.get("sublabel") or str(person.get("role", "")),
        "note": person.get("note"),
        "unavailable": bool(person.get("unavailable", False)),
        "name": str(person.get("name", "")),
        "role": str(person.get("role", "")),
        "avatar": person.get("avatar"),
        "color": person.get("color"),
    }


def _away(person: dict[str, Any], source: str) -> dict[str, Any]:
    entry = _base_fields(person)
    entry.update(
        {
            "source": source,
            "state": "away",
            "last_seen_ts": None,
            "seconds_since": None,
            "session_started_ts": None,
            "activity": None,
        }
    )
    return entry


def _traffic_person(person: dict[str, Any], now: float, session_gap: float) -> dict[str, Any]:
    client_ip = str(person.get("client_ip", ""))
    active_window = float(person.get("active_window_seconds", 300))
    recent_window = float(person.get("recent_window_seconds", 1800))
    labels = person.get("activity_labels", {})

    events: list[tuple[float, str]] = []
    for rec in traffic_log.since(0, 1_000_000):
        if rec.get("client_ip") != client_ip:
            continue
        path = str(rec.get("path", ""))
        if path in _SELF_PATHS:
            continue
        ts_ms = rec.get("ts_ms")
        if isinstance(ts_ms, (int, float)) and ts_ms > 0:
            events.append((float(ts_ms) / 1000.0, path))

    # Restart backfill: only when the ring buffer holds nothing for her.
    if not events:
        for rec in _read_traffic_tail():
            if rec.get("client_ip") != client_ip:
                continue
            path = str(rec.get("path", ""))
            if path in _SELF_PATHS:
                continue
            ts_ms = rec.get("ts_ms")
            if isinstance(ts_ms, (int, float)) and ts_ms > 0:
                events.append((float(ts_ms) / 1000.0, path))

    if not events:
        return _away(person, "traffic")

    events.sort(key=itemgetter(0), reverse=True)  # newest first
    last_ts, last_path = events[0]
    seconds_since = max(0.0, now - last_ts)

    if seconds_since <= active_window:
        state = "active"
    elif seconds_since <= recent_window:
        state = "recent"
    else:
        state = "away"

    activity = _activity_for_path(last_path, labels) if state != "away" else None

    # Session = contiguous run (newest -> older) with gaps under session_gap.
    session_start_ts = last_ts
    session_events = [events[0]]
    for i in range(1, len(events)):
        if (events[i - 1][0] - events[i][0]) < session_gap:
            session_start_ts = events[i][0]
            session_events.append(events[i])
        else:
            break

    # Journal a closed, not-yet-journaled session (last request older than gap).
    if seconds_since > session_gap:
        _maybe_journal(str(person.get("name", "")), session_start_ts, last_ts, session_events, labels)

    entry = _base_fields(person)
    entry.update(
        {
            "source": "traffic",
            "state": state,
            "last_seen_ts": _iso(last_ts),
            "seconds_since": round(seconds_since, 1),
            "session_started_ts": _iso(session_start_ts),
            "activity": activity,
            "client_ip": client_ip,
        }
    )
    return entry


def _commit_person(person: dict[str, Any], now: float) -> dict[str, Any]:
    recent_window = float(person.get("recent_window_seconds", 1800))
    match = str(person.get("commit_match", ""))
    hit = _match_commit(match, _git_commits_cached()) if match else None
    if hit is None:
        return _away(person, "commits")
    seconds_since = max(0.0, now - hit["ts"])
    state = "recent" if seconds_since <= recent_window else "away"
    entry = _base_fields(person)
    entry.update(
        {
            "source": "commits",
            "state": state,
            "last_seen_ts": _iso(hit["ts"]),
            "seconds_since": round(seconds_since, 1),
            "session_started_ts": None,
            "activity": None,
            "commit_hash": hit["hash"],
        }
    )
    return entry


def compute_presence(now: float | None = None) -> dict[str, Any]:
    """Return ``{"version": "1.4", "people": [...]}`` in config order."""
    cfg = logging_settings.presence()
    version = str(cfg.get("version", "1.4"))
    session_gap = float(cfg.get("session_gap_seconds", 900))
    if now is None:
        now = datetime.now(tz=UTC).timestamp()

    people: list[dict[str, Any]] = []
    for person in cfg.get("people", []):
        if not isinstance(person, dict):
            continue
        if person.get("client_ip"):
            people.append(_traffic_person(person, now, session_gap))
        elif person.get("commit_match"):
            people.append(_commit_person(person, now))
        else:
            people.append(_away(person, "traffic"))
    return {"version": version, "people": people}
