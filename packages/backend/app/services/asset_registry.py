"""Asset registry — the track↔asset join point (schema v25).

Every produced or consumed media asset (stems, GLB models, textures,
prompts, images, video, audio) can be registered here with optional
track_id/audio_id linkage, so "which track owns this" is answerable
from one table instead of scavenging per-producer columns.

Registration is best-effort by contract: producers call
``register_asset`` inside try/except (or the helper itself swallows and
logs) — an asset registry failure must never fail a generation.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from ..core.connection import get_db

logger = logging.getLogger(__name__)

VALID_KINDS = {
    "audio",
    "audio_stem",
    "model_3d",
    "texture",
    "prompt",
    "image",
    "video",
    "blend",
    "other",
}


def register_asset(
    kind: str,
    path: str,
    *,
    name: str = "",
    track_id: str | None = None,
    audio_id: str | None = None,
    source: str = "",
    meta: dict[str, Any] | None = None,
) -> str | None:
    """Insert an asset row; returns the new id, or None on failure.

    Never raises — asset bookkeeping must not break the producer.
    """
    if kind not in VALID_KINDS:
        kind = "other"
    try:
        asset_id = uuid.uuid4().hex
        with get_db() as conn:
            conn.execute(
                """INSERT INTO assets
                   (id, kind, path, name, track_id, audio_id, source, meta)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    asset_id,
                    kind,
                    path,
                    name,
                    track_id,
                    audio_id,
                    source,
                    json.dumps(meta or {}, default=str),
                ),
            )
        return asset_id
    except Exception as e:  # noqa: BLE001 - registry is best-effort
        logger.warning("asset registry insert failed (%s %s): %s", kind, path, e)
        return None


def list_assets(
    *,
    track_id: str | None = None,
    audio_id: str | None = None,
    kind: str | None = None,
    source: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Query assets with optional equality filters."""
    clauses: list[str] = []
    params: list[Any] = []
    for col, val in (
        ("track_id", track_id),
        ("audio_id", audio_id),
        ("kind", kind),
        ("source", source),
    ):
        if val:
            clauses.append(f"{col} = ?")
            params.append(val)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 5000)))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM assets {where} ORDER BY created_at DESC LIMIT ?",
            params,
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["meta"] = json.loads(d.get("meta") or "{}")
        except json.JSONDecodeError:
            d["meta"] = {}
        out.append(d)
    return out


def assets_for_track(track_id: str) -> dict[str, Any]:
    """Grouped summary for one track: counts + rows by kind."""
    rows = list_assets(track_id=track_id, limit=5000)
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_kind.setdefault(r["kind"], []).append(r)
    return {
        "track_id": track_id,
        "total": len(rows),
        "by_kind": {k: len(v) for k, v in by_kind.items()},
        "assets": rows,
    }
