"""
Media Library Repository -- favorites, collections, tags, trash.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from .connection import get_db


def toggle_media_favorite(relative_path: str) -> bool:
    """Toggle favorite status for a media item. Returns new status."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM media_favorites WHERE relative_path = ?",
            (relative_path,),
        ).fetchone()
        if row:
            conn.execute(
                "DELETE FROM media_favorites WHERE relative_path = ?",
                (relative_path,),
            )
            return False
        conn.execute(
            "INSERT INTO media_favorites (relative_path) VALUES (?)",
            (relative_path,),
        )
        return True


def is_media_favorite(relative_path: str) -> bool:
    """Return True if the item is favorited."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM media_favorites WHERE relative_path = ?",
            (relative_path,),
        ).fetchone()
        return row is not None


def list_media_favorites(limit: int = 200) -> list[str]:
    """Return favorited relative_paths, newest first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT relative_path FROM media_favorites "
            "ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [r["relative_path"] for r in rows]


def create_collection(name: str, cover_path: str | None = None) -> dict:
    """Create a collection and return its stored record."""
    collection_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO media_collections (id, name, cover_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (collection_id, name, cover_path, now, now),
        )
        row = conn.execute(
            "SELECT * FROM media_collections WHERE id = ?", (collection_id,)
        ).fetchone()
    return _collection_row_to_dict(row)


def list_collections() -> list[dict]:
    """List all collections, newest first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM media_collections ORDER BY updated_at DESC"
        ).fetchall()
        return [_collection_row_to_dict(r) for r in rows]


def get_collection(collection_id: str) -> dict | None:
    """Get one collection by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM media_collections WHERE id = ?", (collection_id,)
        ).fetchone()
        return _collection_row_to_dict(row) if row else None


def update_collection(
    collection_id: str, name: str | None = None, cover_path: str | None = None
) -> bool:
    """Update a collection's name and/or cover. Returns True if updated."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM media_collections WHERE id = ?", (collection_id,)
        ).fetchone()
        if not row:
            return False
        fields = []
        params: list[Any] = []
        if name is not None:
            fields.append("name = ?")
            params.append(name)
        if cover_path is not None:
            fields.append("cover_path = ?")
            params.append(cover_path)
        fields.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(collection_id)
        conn.execute(
            f"UPDATE media_collections SET {', '.join(fields)} WHERE id = ?",
            params,
        )
        return True


def delete_collection(collection_id: str) -> bool:
    """Delete a collection (items are NOT deleted). Returns True if removed."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM media_collections WHERE id = ?", (collection_id,)
        )
        return cursor.rowcount > 0


def add_item_to_collection(collection_id: str, relative_path: str) -> bool:
    """Add a media item to a collection. Returns True if added (new membership)."""
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM media_collection_items "
            "WHERE collection_id = ? AND relative_path = ?",
            (collection_id, relative_path),
        ).fetchone()
        if existing:
            return False
        conn.execute(
            """
            INSERT INTO media_collection_items (collection_id, relative_path)
            VALUES (?, ?)
            """,
            (collection_id, relative_path),
        )
        conn.execute(
            "UPDATE media_collections SET updated_at = ? WHERE id = ?",
            (datetime.now().isoformat(), collection_id),
        )
        return True


def remove_item_from_collection(collection_id: str, relative_path: str) -> bool:
    """Remove a media item from a collection. Returns True if removed."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM media_collection_items "
            "WHERE collection_id = ? AND relative_path = ?",
            (collection_id, relative_path),
        )
        if cursor.rowcount:
            conn.execute(
                "UPDATE media_collections SET updated_at = ? WHERE id = ?",
                (datetime.now().isoformat(), collection_id),
            )
            return True
        return False


def get_items_in_collection(collection_id: str) -> list[str]:
    """Return relative_paths in a collection, newest added first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT relative_path FROM media_collection_items "
            "WHERE collection_id = ? ORDER BY added_at DESC",
            (collection_id,),
        ).fetchall()
        return [r["relative_path"] for r in rows]


def get_collections_for_item(relative_path: str) -> list[dict]:
    """Return collections containing the given item."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT c.* FROM media_collections c
            JOIN media_collection_items i ON i.collection_id = c.id
            WHERE i.relative_path = ?
            ORDER BY c.updated_at DESC
            """,
            (relative_path,),
        ).fetchall()
        return [_collection_row_to_dict(r) for r in rows]


def create_tag(name: str, color: str = "#8b5cf6") -> dict:
    """Create a tag. Raises if name already exists (caller should catch)."""
    tag_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO media_tags (id, name, color, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (tag_id, name, color, now),
        )
        row = conn.execute(
            "SELECT * FROM media_tags WHERE id = ?", (tag_id,)
        ).fetchone()
    return _tag_row_to_dict(row)


def get_or_create_tag(name: str, color: str = "#8b5cf6") -> dict:
    """Return existing tag or create it."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM media_tags WHERE name = ?", (name,)
        ).fetchone()
        if row:
            return _tag_row_to_dict(row)
        tag_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        conn.execute(
            """
            INSERT INTO media_tags (id, name, color, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (tag_id, name, color, now),
        )
        row = conn.execute(
            "SELECT * FROM media_tags WHERE id = ?", (tag_id,)
        ).fetchone()
    return _tag_row_to_dict(row)


def list_tags() -> list[dict]:
    """List all tags, most recently created first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM media_tags ORDER BY created_at DESC"
        ).fetchall()
        return [_tag_row_to_dict(r) for r in rows]


def add_tag_to_item(relative_path: str, tag_id: str) -> bool:
    """Assign a tag to a media item. Returns True if newly added."""
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM media_item_tags "
            "WHERE relative_path = ? AND tag_id = ?",
            (relative_path, tag_id),
        ).fetchone()
        if existing:
            return False
        conn.execute(
            "INSERT INTO media_item_tags (relative_path, tag_id) VALUES (?, ?)",
            (relative_path, tag_id),
        )
        return True


def remove_tag_from_item(relative_path: str, tag_id: str) -> bool:
    """Remove a tag from a media item. Returns True if removed."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM media_item_tags "
            "WHERE relative_path = ? AND tag_id = ?",
            (relative_path, tag_id),
        )
        return cursor.rowcount > 0


def set_item_tags(relative_path: str, tag_ids: list[str]) -> None:
    """Replace an item's tags with exactly the given tag IDs."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM media_item_tags WHERE relative_path = ?",
            (relative_path,),
        )
        for tag_id in tag_ids:
            conn.execute(
                "INSERT OR IGNORE INTO media_item_tags (relative_path, tag_id) "
                "VALUES (?, ?)",
                (relative_path, tag_id),
            )


def get_tags_for_item(relative_path: str) -> list[dict]:
    """Return tags assigned to a media item."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT t.* FROM media_tags t
            JOIN media_item_tags i ON i.tag_id = t.id
            WHERE i.relative_path = ?
            ORDER BY t.name
            """,
            (relative_path,),
        ).fetchall()
        return [_tag_row_to_dict(r) for r in rows]


def get_items_with_tag(tag_id: str) -> list[str]:
    """Return relative_paths tagged with the given tag."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT relative_path FROM media_item_tags "
            "WHERE tag_id = ?",
            (tag_id,),
        ).fetchall()
        return [r["relative_path"] for r in rows]


def move_to_trash(
    relative_path: str, file_type: str, retention_days: int = 30
) -> bool:
    """Move a media item to trash (soft delete). Returns True if moved."""
    now = datetime.now()
    expires_at = (
        now.timestamp() + retention_days * 86400
    ) * 1000
    expires_iso = datetime.fromtimestamp(expires_at / 1000).isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM media_trash WHERE relative_path = ?",
            (relative_path,),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE media_trash SET deleted_at = ?, expires_at = ? "
                "WHERE relative_path = ?",
                (now.isoformat(), expires_iso, relative_path),
            )
            return True
        conn.execute(
            """
            INSERT INTO media_trash (relative_path, file_type, deleted_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (relative_path, file_type, now.isoformat(), expires_iso),
        )
        return True


def list_trash() -> list[dict]:
    """Return trashed items, newest deleted first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM media_trash ORDER BY deleted_at DESC"
        ).fetchall()
        return [_trash_row_to_dict(r) for r in rows]


def restore_from_trash(relative_path: str) -> bool:
    """Remove an item from trash (cancel soft delete). Returns True if restored."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM media_trash WHERE relative_path = ?", (relative_path,)
        )
        return cursor.rowcount > 0


def purge_from_trash(relative_path: str) -> bool:
    """Permanently mark a trashed item as gone (bookkeeping only)."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM media_trash WHERE relative_path = ?", (relative_path,)
        )
        return cursor.rowcount > 0


def empty_trash() -> int:
    """Clear every trashed item. Returns count removed."""
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM media_trash")
        return int(cursor.rowcount or 0)


def _collection_row_to_dict(row: Any) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "cover_path": row["cover_path"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _tag_row_to_dict(row: Any) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "color": row["color"],
        "created_at": row["created_at"],
    }


def _trash_row_to_dict(row: Any) -> dict:
    return {
        "relative_path": row["relative_path"],
        "file_type": row["file_type"],
        "deleted_at": row["deleted_at"],
        "expires_at": row["expires_at"],
    }
