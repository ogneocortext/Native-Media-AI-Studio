"""Asset registry API — query which tracks own which assets.

Backs the `assets` table (schema v25): every produced/consumed media
asset (stems, GLB models, textures, prompts, images, video, audio) can
carry track_id/audio_id linkage so "which track has which stems,
models, textures, prompts, audio sources" is one query away.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services import asset_registry

router = APIRouter(prefix="/api/assets", tags=["Assets"])


class AssetCreate(BaseModel):
    kind: str = Field(..., description="audio|audio_stem|model_3d|texture|prompt|image|video|blend|other")
    path: str
    name: str = ""
    track_id: str | None = None
    audio_id: str | None = None
    source: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)


@router.get("")
async def list_assets(
    track_id: str | None = Query(None),
    audio_id: str | None = Query(None),
    kind: str | None = Query(None),
    source: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    """List assets, optionally filtered by track/audio/kind/source."""
    rows = asset_registry.list_assets(
        track_id=track_id, audio_id=audio_id, kind=kind, source=source, limit=limit
    )
    return {"assets": rows, "count": len(rows)}


@router.get("/track/{track_id}")
async def assets_for_track(track_id: str) -> dict[str, Any]:
    """Grouped asset summary for one track (counts + rows by kind)."""
    return asset_registry.assets_for_track(track_id)


@router.post("")
async def create_asset(body: AssetCreate) -> dict[str, Any]:
    """Manually register an asset (producers register automatically)."""
    asset_id = asset_registry.register_asset(
        body.kind,
        body.path,
        name=body.name,
        track_id=body.track_id,
        audio_id=body.audio_id,
        source=body.source or "manual",
        meta=body.meta,
    )
    if asset_id is None:
        raise HTTPException(status_code=500, detail="asset insert failed")
    return {"id": asset_id}
