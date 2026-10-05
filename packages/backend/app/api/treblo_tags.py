"""Treblo Tag Picker API.

A local search tool over Treblo's published v3 style tags. Produces a
paste-ready tag string; it generates nothing and calls nothing.

**Hard boundary (user directive, 2026-10-04):** no third-party API calls. Every
route here reads a JSON file that ships in the repo. See
`tools/music-gen/treblo-tag-picker/SPEC.md`.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from ..services import suno_crossref, treblo_tag_picker

router = APIRouter(prefix="/api/treblo-tags", tags=["MusicPrompts"])


class BuildRequest(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=200)


@router.get("/search")
async def search_tags(
    q: str = Query("", description="Free-text query"),
    limit: int = Query(treblo_tag_picker.DEFAULT_LIMIT, ge=1, le=200),
) -> dict[str, Any]:
    """Rank tags against a query. Empty query returns an empty list.

    `results` stays a plain string list so existing callers keep working; the
    parallel `attestation` map adds how well each tag is attested in Suno community
    use, so the picker can badge it without a second round trip.
    """
    results = treblo_tag_picker.search_tags(q, limit=limit)
    return {
        "query": q,
        "results": results,
        "attestation": suno_crossref.attestation_for(results),
    }


@router.get("/related")
async def related_tags(
    tag: str = Query(..., description="Exact tag to look up"),
    limit: int = Query(12, ge=1, le=100),
) -> dict[str, Any]:
    """Tags the site lists as related. Unknown tags return an empty list, not a 404.

    A miss here is a normal user action (searching, then asking about a tag with
    no related set), so it is reported as an empty result rather than an error.
    """
    known = tag in treblo_tag_picker.all_tags() or bool(treblo_tag_picker.related_tags(tag, limit=1))
    if not known and not treblo_tag_picker.related_tags(tag, limit=1):
        return {"tag": tag, "related": []}
    return {"tag": tag, "related": treblo_tag_picker.related_tags(tag, limit=limit)}


@router.post("/build")
async def build_tag_string(body: BuildRequest) -> dict[str, Any]:
    """Join a selection into a paste-ready, comma-separated tag string."""
    tags = [t for t in body.tags if isinstance(t, str) and t.strip()]
    return {"tag_string": treblo_tag_picker.build_tag_string(tags)}


@router.get("/count")
async def tag_count() -> dict[str, int]:
    """How many tags are indexed - lets the UI show the scope honestly."""
    return {"count": treblo_tag_picker.tag_count()}


@router.get("/suno/production-vocab")
async def suno_production_vocab(
    q: str = Query("", description="Free-text filter"),
    limit: int = Query(24, ge=1, le=314),
) -> dict[str, Any]:
    """Suno community production/effect phrases.

    The additive part of the cross-reference: this is the *how* users steer sound
    (808 bass slides, vinyl crackle, half-time), which Treblo's genre/mood list does
    not cover. Measured disjoint from every Treblo tag, so these can be offered as a
    Suno-only suggestion row without contaminating the tag list.
    """
    return {
        "query": q,
        "results": suno_crossref.production_vocab(q, limit=limit),
        "total": suno_crossref.production_count(),
    }


@router.get("/suno/meta")
async def suno_meta() -> dict[str, Any]:
    """Provenance and tier counts, so the UI can describe its own scope honestly."""
    return {
        "tier_counts": suno_crossref.tier_counts(),
        "tier_labels": {str(k): v for k, v in suno_crossref.TIER_LABELS.items()},
        "production_count": suno_crossref.production_count(),
        "meta": suno_crossref.meta(),
    }
