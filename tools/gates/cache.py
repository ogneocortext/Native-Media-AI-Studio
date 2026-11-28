"""Content-hash based gate result caching.

Skips re-running a gate when the files it cares about have not changed
since a previous PASS. This is the main accelerator for the prepush hook:
a gate whose inputs are identical to a prior run is reported [CACHED]
instead of re-executed.

Cache layout: ``.kilo/gate-cache/results.json``

    {
      "version": 1,
      "entries": {
        "unit": {
          "file_hash": "<sha256 of relevant file contents>",
          "status": "PASS",
          "duration": 3.5,
          "timestamp": "2026-11-28T08:00:00Z",
          "relevant_files": ["packages/frontend/src/features/x/..."]
        }
      }
    }

A gate's cache entry is invalidated when any file relevant to that gate
changes content. A FAIL result is never cached — it must be re-run so the
operator can see whether the fix worked. The cache is best-effort: any
read/write failure simply falls through to running the gate.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

CACHE_DIR = Path(".kilo") / "gate-cache"
CACHE_FILE = CACHE_DIR / "results.json"
CACHE_VERSION = 1


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_cache() -> dict:
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
            return {"version": CACHE_VERSION, "entries": {}}
        return data
    except (OSError, ValueError, KeyError):
        return {"version": CACHE_VERSION, "entries": {}}


def _save_cache(data: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError:
        pass  # best-effort; never block a gate run on cache write failure


def _hash_files(files: list[str]) -> str:
    """SHA-256 of the concatenated (path, content) pairs for ``files``."""
    h = hashlib.sha256()
    root = _repo_root()
    for f in sorted(files):
        h.update(f.encode("utf-8"))
        h.update(b"\0")
        try:
            h.update((root / f).read_bytes())
        except OSError:
            h.update(b"__MISSING__")
        h.update(b"\0")
    return h.hexdigest()


def get_cached_result(gate_name: str, all_relevant_files: list[str]) -> str | None:
    """Return a cached PASS status if the gate's full relevant file set matches.

    The cache key is a SHA-256 over every tracked file the gate could be
    affected by (not just the changed subset). This means a relevant file
    modified outside a gated run busts the cache on the next push.

    Returns ``"PASS"`` if a valid cache hit exists, otherwise ``None`` so
    the caller runs the gate.
    """
    if not all_relevant_files:
        return None
    cache = _load_cache()
    entry = cache.get("entries", {}).get(gate_name)
    if not entry or entry.get("status") != "PASS":
        return None
    if entry.get("file_hash") != _hash_files(all_relevant_files):
        return None
    return "PASS"


def save_result(gate_name: str, all_relevant_files: list[str], status: str,
                duration: float) -> None:
    """Persist a gate result to the cache. Only PASS results are cached.

    ``all_relevant_files`` is the gate's full relevant file set in the tree
    (from ``gate_all_relevant_files``), used as the cache key so that
    out-of-band modifications bust the cache.
    """
    if status != "PASS":
        return
    cache = _load_cache()
    cache.setdefault("entries", {})[gate_name] = {
        "file_hash": _hash_files(all_relevant_files),
        "status": status,
        "duration": round(duration, 2),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "relevant_files": sorted(all_relevant_files),
    }
    _save_cache(cache)
