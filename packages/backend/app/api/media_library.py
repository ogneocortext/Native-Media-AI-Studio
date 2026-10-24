"""
Media Library organization API routes.

Layers user organization (favorites, collections, tags, soft-delete trash) on
top of the file-system media library served by ``/api/outputs``. All state is
keyed by ``relative_path`` (the canonical library identifier returned by
``GET /api/outputs``) and persisted in SQLite, so organization survives
rescans and never moves or copies files.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi import Path as PathParam
from pydantic import BaseModel, Field

from ..core.database import (
    add_item_to_collection,
    create_collection,
    create_tag,
    delete_collection,
    empty_trash,
    get_collection,
    get_collections_for_item,
    get_items_in_collection,
    get_items_with_tag,
    get_tags_for_item,
    list_collections,
    list_media_favorites,
    list_tags,
    list_trash,
    move_to_trash,
    purge_from_trash,
    remove_item_from_collection,
    remove_tag_from_item,
    restore_from_trash,
    set_item_tags,
    toggle_media_favorite,
    update_collection,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media-library", tags=["Media Library"])

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class FavoriteToggleResponse(BaseModel):
    relative_path: str
    favorited: bool


class CollectionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    cover_path: str | None = None


class CollectionResponse(BaseModel):
    id: str
    name: str
    cover_path: str | None = None
    created_at: str
    updated_at: str


class CollectionDetailResponse(CollectionResponse):
    item_count: int = 0


class CollectionItemAction(BaseModel):
    relative_path: str


class TagBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    color: str = Field(default="#8b5cf6", pattern=r"^#[0-9a-fA-F]{6}$")


class TagResponse(BaseModel):
    id: str
    name: str
    color: str
    created_at: str


class TagItemAction(BaseModel):
    relative_path: str


class ItemTagsResponse(BaseModel):
    relative_path: str
    tags: list[TagResponse] = []


class BulkTagsRequest(BaseModel):
    relative_paths: list[str]
    tag_ids: list[str]


class TrashItemResponse(BaseModel):
    relative_path: str
    file_type: str
    deleted_at: str
    expires_at: str


class TrashRestoreResponse(BaseModel):
    relative_path: str
    restored: bool


class TrashEmptyResponse(BaseModel):
    removed: int


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------


@router.get("/favorites", response_model=list[str])
async def list_favorites(limit: int = Query(200, ge=1, le=1000)) -> list[str]:
    """Return favorited relative_paths, newest first."""
    return list_media_favorites(limit=limit)


@router.get("/favorites/{relative_path:path}/status", response_model=dict)
async def favorite_status(
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> dict:
    """Return whether the item is favorited."""
    return {"relative_path": relative_path, "favorited": __import__(
        "..core.database", fromlist=["is_media_favorite"]
    ).is_media_favorite(relative_path)}


@router.post(
    "/favorites/{relative_path:path}", response_model=FavoriteToggleResponse
)
async def toggle_favorite(
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> FavoriteToggleResponse:
    """Toggle favorite status; returns the new status."""
    favorited = toggle_media_favorite(relative_path)
    return FavoriteToggleResponse(relative_path=relative_path, favorited=favorited)


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------


@router.get("/collections", response_model=list[CollectionResponse])
async def list_collections_endpoint() -> list[CollectionResponse]:
    """List all collections, newest first."""
    return [CollectionResponse(**c) for c in list_collections()]


@router.post("/collections", response_model=CollectionResponse, status_code=201)
async def create_collection_endpoint(body: CollectionBase) -> CollectionResponse:
    """Create a new collection."""
    created = create_collection(body.name, body.cover_path)
    return CollectionResponse(**created)


@router.get("/collections/{collection_id}", response_model=CollectionDetailResponse)
async def get_collection_endpoint(
    collection_id: str = PathParam(..., description="Collection ID"),
) -> CollectionDetailResponse:
    """Get one collection with its item count."""
    collection = get_collection(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    items = get_items_in_collection(collection_id)
    return CollectionDetailResponse(**collection, item_count=len(items))


@router.put("/collections/{collection_id}", response_model=CollectionResponse)
async def update_collection_endpoint(
    body: CollectionBase,
    collection_id: str = PathParam(..., description="Collection ID"),
) -> CollectionResponse:
    """Rename a collection and/or set its cover."""
    ok = update_collection(
        collection_id,
        name=body.name,
        cover_path=body.cover_path,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Collection not found")
    updated = get_collection(collection_id)
    return CollectionResponse(**updated)


@router.delete("/collections/{collection_id}", status_code=204)
async def delete_collection_endpoint(
    collection_id: str = PathParam(..., description="Collection ID"),
) -> None:
    """Delete a collection. Member items are untouched."""
    if not delete_collection(collection_id):
        raise HTTPException(status_code=404, detail="Collection not found")


@router.get(
    "/collections/{collection_id}/items", response_model=list[str]
)
async def list_collection_items(
    collection_id: str = PathParam(..., description="Collection ID"),
) -> list[str]:
    """Return relative_paths in a collection, newest added first."""
    if not get_collection(collection_id):
        raise HTTPException(status_code=404, detail="Collection not found")
    return get_items_in_collection(collection_id)


@router.post(
    "/collections/{collection_id}/items", status_code=204
)
async def add_collection_item(
    body: CollectionItemAction,
    collection_id: str = PathParam(..., description="Collection ID"),
) -> None:
    """Add a media item to a collection."""
    if not get_collection(collection_id):
        raise HTTPException(status_code=404, detail="Collection not found")
    add_item_to_collection(collection_id, body.relative_path)


@router.delete(
    "/collections/{collection_id}/items/{relative_path:path}", status_code=204
)
async def remove_collection_item(
    collection_id: str = PathParam(..., description="Collection ID"),
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> None:
    """Remove a media item from a collection."""
    if not get_collection(collection_id):
        raise HTTPException(status_code=404, detail="Collection not found")
    remove_item_from_collection(collection_id, relative_path)


@router.get(
    "/items/{relative_path:path}/collections", response_model=list[CollectionResponse]
)
async def list_item_collections(
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> list[CollectionResponse]:
    """Return collections containing the given item."""
    return [CollectionResponse(**c) for c in get_collections_for_item(relative_path)]


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


@router.get("/tags", response_model=list[TagResponse])
async def list_tags_endpoint() -> list[TagResponse]:
    """List all tags, most recently created first."""
    return [TagResponse(**t) for t in list_tags()]


@router.post("/tags", response_model=TagResponse, status_code=201)
async def create_tag_endpoint(body: TagBase) -> TagResponse:
    """Create a tag (idempotent by name)."""
    try:
        created = create_tag(body.name, body.color)
    except Exception as exc:  # UNIQUE constraint on name
        existing = __import__(
            "..core.database", fromlist=["get_or_create_tag"]
        ).get_or_create_tag(body.name, body.color)
        if "UNIQUE" in str(exc) or "unique" in str(exc).lower():
            return TagResponse(**existing)
        raise
    return TagResponse(**created)


@router.get("/tags/{tag_id}/items", response_model=list[str])
async def list_tag_items(
    tag_id: str = PathParam(..., description="Tag ID"),
) -> list[str]:
    """Return relative_paths tagged with the given tag."""
    return get_items_with_tag(tag_id)


@router.get(
    "/items/{relative_path:path}/tags", response_model=ItemTagsResponse
)
async def list_item_tags(
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> ItemTagsResponse:
    """Return tags assigned to a media item."""
    tags = get_tags_for_item(relative_path)
    return ItemTagsResponse(
        relative_path=relative_path, tags=[TagResponse(**t) for t in tags]
    )


@router.post(
    "/items/{relative_path:path}/tags/{tag_id}", status_code=204
)
async def add_item_tag(
    tag_id: str = PathParam(..., description="Tag ID"),
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> None:
    """Assign a tag to a media item."""
    add_item_tag(relative_path, tag_id)


@router.delete(
    "/items/{relative_path:path}/tags/{tag_id}", status_code=204
)
async def remove_item_tag(
    tag_id: str = PathParam(..., description="Tag ID"),
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> None:
    """Remove a tag from a media item."""
    remove_tag_from_item(relative_path, tag_id)


@router.put(
    "/items/{relative_path:path}/tags", response_model=ItemTagsResponse
)
async def set_item_tags_endpoint(
    body: BulkTagsRequest,
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> ItemTagsResponse:
    """Replace an item's tags with exactly the given tag IDs."""
    set_item_tags(relative_path, body.tag_ids)
    tags = get_tags_for_item(relative_path)
    return ItemTagsResponse(
        relative_path=relative_path, tags=[TagResponse(**t) for t in tags]
    )


# ---------------------------------------------------------------------------
# Trash (soft delete)
# ---------------------------------------------------------------------------


@router.post(
    "/trash", response_model=TrashItemResponse, status_code=201
)
async def move_item_to_trash(
    body: CollectionItemAction,
    retention_days: int = Query(30, ge=1, le=365),
) -> TrashItemResponse:
    """Soft-delete a media item into the trash queue."""
    # file_type is best-effort; the caller may not know it, default "media".
    file_type = "media"
    ok = move_to_trash(body.relative_path, file_type, retention_days=retention_days)
    if not ok:
        raise HTTPException(status_code=400, detail="Could not trash item")
    item = next(
        (t for t in list_trash() if t["relative_path"] == body.relative_path), None
    )
    return TrashItemResponse(**item) if item else TrashItemResponse(
        relative_path=body.relative_path, file_type=file_type,
        deleted_at=datetime.now(timezone.utc).isoformat(),
        expires_at=(datetime.now(timezone.utc) + timedelta(days=retention_days)).isoformat(),
    )


@router.get("/trash", response_model=list[TrashItemResponse])
async def list_trash_endpoint() -> list[TrashItemResponse]:
    """Return trashed items, newest deleted first."""
    return [TrashItemResponse(**t) for t in list_trash()]


@router.post(
    "/trash/{relative_path:path}/restore", response_model=TrashRestoreResponse
)
async def restore_item(
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> TrashRestoreResponse:
    """Cancel a soft delete (return item from trash)."""
    restored = restore_from_trash(relative_path)
    return TrashRestoreResponse(relative_path=relative_path, restored=restored)


@router.delete(
    "/trash/{relative_path:path}", status_code=204
)
async def purge_item(
    relative_path: str = PathParam(..., description="Library relative_path"),
) -> None:
    """Permanently remove a trashed item's trash record (bookkeeping only)."""
    if not purge_from_trash(relative_path):
        raise HTTPException(status_code=404, detail="Item not in trash")


@router.delete("/trash", response_model=TrashEmptyResponse)
async def empty_trash_endpoint() -> TrashEmptyResponse:
    """Clear every trashed item."""
    removed = empty_trash()
    return TrashEmptyResponse(removed=removed)
