"""
VRAM test utilities — query GPU memory usage via nvidia-smi.

Used by ``tests/test_vram_leak.py`` to verify VRAM returns to baseline
after each job type (V3 of the video-generation-e2e plan).

All functions are pure/subprocess — no FastAPI, no database, safe to import
in any test context. Skipped gracefully when nvidia-smi is unavailable
(non-NVIDIA machines, headless CI).
"""

from __future__ import annotations

import logging
import subprocess

logger = logging.getLogger(__name__)

#: VRAM tolerance in MB — a job may leave up to this much above baseline
#: without counting as a leak (allows for driver overhead, cached allocations).
VRAM_TOLERANCE_MB = 512


def query_vram_used_mb() -> int | None:
    """Query current GPU memory used (MiB) via nvidia-smi.

    Returns ``None`` when nvidia-smi is unavailable or the query fails.
    Callers should treat ``None`` as "skip this check".
    """
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            logger.debug("nvidia-smi failed: %s", result.stderr.strip())
            return None
        output = result.stdout.strip()
        if not output:
            return None
        return int(output.splitlines()[0])
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError, OSError) as exc:
        logger.debug("nvidia-smi query failed: %s", exc)
        return None


def vram_available() -> bool:
    """True when nvidia-smi can query VRAM (NVIDIA GPU present)."""
    return query_vram_used_mb() is not None
