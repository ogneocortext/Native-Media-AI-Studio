"""
Media provenance repository.

One row per produced artifact: which tool made it, which source path(s) it
derives from, the parameters used, and the QC summary. Paths are stored
repo-relative (POSIX style) so links survive checkout moves and server
restarts — the DB is the durable record; the ``<file>.provenance.json``
sidecar written by ``services.provenance`` is the file-adjacent copy.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from .connection import get_db


def record_provenance(
    output_path: str,
    tool: str,
    source_paths: list[str],
    params: dict[str, Any] | None = None,
    qc: dict[str, Any] | None = None,
) -> str:
    """Insert a provenance row and return its id."""
    row_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO media_provenance
                (id, output_path, tool, source_paths, params, qc)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                output_path,
                tool,
                json.dumps(source_paths),
                json.dumps(params or {}),
                json.dumps(qc or {}),
            ),
        )
    return row_id


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "output_path": row["output_path"],
        "tool": row["tool"],
        "source_paths": json.loads(row["source_paths"] or "[]"),
        "params": json.loads(row["params"] or "{}"),
        "qc": json.loads(row["qc"] or "{}"),
        "created_at": row["created_at"],
    }


def get_provenance(output_path: str) -> list[dict[str, Any]]:
    """All provenance rows for an output path, newest first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM media_provenance WHERE output_path = ? "
            "ORDER BY created_at DESC, id DESC",
            (output_path,),
        ).fetchall()
    cols = ("id", "output_path", "tool", "source_paths", "params", "qc", "created_at")
    return [_row_to_dict(dict(zip(cols, r, strict=True))) for r in rows]


def get_derivatives(source_path: str) -> list[dict[str, Any]]:
    """All artifacts that list *source_path* as an origin, newest first.

    ``source_paths`` is a JSON array; the LIKE match on the quoted element is
    exact-string containment, which is sufficient at this table's scale.
    """
    needle = json.dumps(source_path)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM media_provenance WHERE source_paths LIKE ? "
            "ORDER BY created_at DESC, id DESC",
            (f"%{needle}%",),
        ).fetchall()
    cols = ("id", "output_path", "tool", "source_paths", "params", "qc", "created_at")
    return [_row_to_dict(dict(zip(cols, r, strict=True))) for r in rows]
