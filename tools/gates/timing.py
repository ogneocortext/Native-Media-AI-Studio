"""Timing history and regression detection for gate runs.

Tracks per-gate elapsed-time history in a JSON cache under %TEMP%, and
reports when a gate's elapsed time exceeds 50% over its historical median.
"""

import json
from pathlib import Path

_TIMING_CACHE_VERSION = 1
_TIMING_HISTORY_SIZE = 10  # keep last 10 runs per gate


def _timing_path() -> Path:
    return Path(__import__("tempfile").gettempdir()) / "nma-studio-gate-timing.json"


def read_timing() -> dict:
    """``{gate_name: [elapsed_seconds, ...]}`` from the timing cache."""
    try:
        return json.loads(_timing_path().read_text("utf-8"))
    except Exception:
        return {}


def write_timing(data: dict) -> None:
    """Persist timing history to the cache file (best-effort)."""
    try:
        _timing_path().write_text(json.dumps(data), "utf-8")
    except OSError:
        pass


def record_timing(name: str, elapsed: float) -> None:
    """Append ``elapsed`` to gate ``name``'s history, capping history size."""
    data = read_timing()
    hist = data.get(name, [])
    hist.append(round(elapsed, 2))
    if len(hist) > _TIMING_HISTORY_SIZE:
        hist = hist[-_TIMING_HISTORY_SIZE:]
    data[name] = hist
    write_timing(data)


def regression_notice(name: str, elapsed: float) -> str | None:
    """Return a regression warning string if ``elapsed`` is 50%+ over the
    historical median, else ``None``.

    Needs at least 3 historical runs to judge.
    """
    data = read_timing()
    hist = data.get(name, [])
    if len(hist) < 3:
        return None  # not enough history to judge
    sorted_hist = sorted(hist)
    median = sorted_hist[len(sorted_hist) // 2]
    if median > 0 and elapsed > median * 1.5:
        return (
            f"  (regression: {elapsed:.1f}s vs {median:.1f}s median "
            f"over {len(hist)} runs)"
        )
    return None
