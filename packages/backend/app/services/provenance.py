"""
Media provenance recording — the origin link between a source file and a
derived artifact.

Two durable copies, both best-effort (a provenance failure must never fail
the producing job):

- DB row in ``media_provenance`` (schema v27) — queryable across restarts,
  powers "what derived from X" lookups.
- ``<file>.provenance.json`` sidecar next to the artifact — travels with the
  file if it is moved or the DB row is lost.

Paths are stored repo-relative (POSIX style) so links survive checkout moves.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT
from ..core.database import record_provenance

logger = logging.getLogger(__name__)


def repo_rel(path: str | Path) -> str:
    """Repo-relative POSIX path when possible, else the absolute string."""
    try:
        return Path(path).resolve().relative_to(PROJECT_ROOT.resolve()).as_posix()
    except (ValueError, OSError):
        return str(path)


def record_media_provenance(
    *,
    output_path: str | Path,
    tool: str,
    source_paths: list[str | Path],
    params: dict[str, Any] | None = None,
    qc: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Record provenance for *output_path*. Returns the record dict, or None
    if both persistence paths failed (never raises)."""
    out = Path(output_path)
    record = {
        "output_path": repo_rel(out),
        "tool": tool,
        "source_paths": [repo_rel(s) for s in source_paths],
        "params": params or {},
        "qc": qc or {},
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Sidecar first: it does not depend on the DB being reachable.
    sidecar = out.with_name(out.name + ".provenance.json")
    try:
        sidecar.write_text(
            json.dumps(record, indent=2) + "\n", encoding="utf-8"
        )
    except OSError as exc:
        logger.warning("provenance sidecar write failed for %s: %s", out, exc)

    try:
        record_provenance(
            output_path=record["output_path"],
            tool=tool,
            source_paths=record["source_paths"],
            params=record["params"],
            qc=record["qc"],
        )
    except Exception as exc:  # noqa: BLE001 - provenance must not fail the job
        logger.warning("provenance DB write failed for %s: %s", out, exc)

    return record
