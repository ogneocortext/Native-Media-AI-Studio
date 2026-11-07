"""Tests for the media library organization API (``/api/media-library/*``).

Covers favorites, collections, tags and soft-delete trash, plus the migration
that creates the underlying SQLite tables (regression: the media tables were
previously created out-of-band and no migration ever created them, so a fresh
database failed every ``/api/media-library/*`` endpoint with ``no such table``).
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core import connection as connection_module  # noqa: E402
from app.core import database as database_module  # noqa: E402
from app.core import migrations as migrations_module  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def media_db(monkeypatch, tmp_path):
    """Point every DB path reference at a throwaway file and initialize it.

    ``init_db`` reads ``migrations.DB_PATH`` (== ``connection.DB_PATH``) rather
    than its ``db_path`` argument once inside ``get_db``, so all three modules
    must point at the temp file for the migration and the endpoints to share one
    database. Ordered before ``client`` in tests so lifespan (if run) also uses
    the temp file.
    """
    db_path = tmp_path / "media_test.db"
    monkeypatch.setattr(connection_module, "DB_PATH", db_path)
    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    monkeypatch.setattr(migrations_module, "DB_PATH", db_path)
    migrations_module.init_db(db_path)
    yield db_path
    connection_module.close_pooled_connections()


@pytest.fixture
async def client(media_db):
    """Async HTTP client against the FastAPI app (no real network)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Migration regression: fresh DB gets the media tables
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_init_db_creates_media_tables(media_db):
    """A freshly initialized database contains all six media library tables."""
    with sqlite3.connect(media_db) as conn:
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'media_%'"
            )
        }
    expected = {
        "media_favorites",
        "media_collections",
        "media_collection_items",
        "media_tags",
        "media_item_tags",
        "media_trash",
    }
    assert expected <= tables, f"missing media tables: {expected - tables}"
    with sqlite3.connect(media_db) as conn:
        assert migrations_module.get_schema_version(conn) == 22


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_favorite_toggle_round_trip(client):
    path = "audio/track.mp3"

    res = await client.post(f"/api/media-library/favorites/{path}")
    assert res.status_code == 200
    assert res.json()["favorited"] is True

    res = await client.get("/api/media-library/favorites")
    assert res.status_code == 200
    assert path in res.json()

    res = await client.get(f"/api/media-library/favorites/{path}/status")
    assert res.status_code == 200
    assert res.json()["favorited"] is True

    # Toggling again un-favorites.
    res = await client.post(f"/api/media-library/favorites/{path}")
    assert res.status_code == 200
    assert res.json()["favorited"] is False

    res = await client.get(f"/api/media-library/favorites/{path}/status")
    assert res.json()["favorited"] is False


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_collection_crud(client):
    res = await client.post(
        "/api/media-library/collections",
        json={"name": "Beats", "cover_path": None},
    )
    assert res.status_code == 201
    collection = res.json()
    collection_id = collection["id"]
    assert collection["name"] == "Beats"

    res = await client.get("/api/media-library/collections")
    assert res.status_code == 200
    assert any(c["id"] == collection_id for c in res.json())

    res = await client.get(f"/api/media-library/collections/{collection_id}")
    assert res.status_code == 200
    assert res.json()["item_count"] == 0

    # Add an item, then the detail count reflects it.
    await client.post(
        f"/api/media-library/collections/{collection_id}/items",
        json={"relative_path": "audio/track.mp3"},
    )
    res = await client.get(f"/api/media-library/collections/{collection_id}")
    assert res.json()["item_count"] == 1

    res = await client.get(f"/api/media-library/collections/{collection_id}/items")
    assert res.status_code == 200
    assert res.json() == ["audio/track.mp3"]

    res = await client.put(
        f"/api/media-library/collections/{collection_id}",
        json={"name": "Beats 2", "cover_path": None},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "Beats 2"

    res = await client.delete(f"/api/media-library/collections/{collection_id}")
    assert res.status_code == 204

    res = await client.get(f"/api/media-library/collections/{collection_id}")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tags_idempotent_and_per_item(client):
    path = "audio/track.mp3"

    res = await client.post(
        "/api/media-library/tags",
        json={"name": "favorite", "color": "#ef4444"},
    )
    assert res.status_code == 201
    tag = res.json()
    tag_id = tag["id"]
    assert tag["name"] == "favorite"

    # Creating the same name again is idempotent: returns the existing tag.
    res = await client.post(
        "/api/media-library/tags",
        json={"name": "favorite", "color": "#22c55e"},
    )
    assert res.status_code == 201
    assert res.json()["id"] == tag_id

    res = await client.get("/api/media-library/tags")
    assert res.status_code == 200
    assert any(t["id"] == tag_id for t in res.json())

    # Assign to an item.
    await client.post(
        f"/api/media-library/items/{path}/tags/{tag_id}",
    )
    res = await client.get(f"/api/media-library/items/{path}/tags")
    assert res.status_code == 200
    assert [t["id"] for t in res.json()["tags"]] == [tag_id]

    # Replace the item's tags with an empty set.
    res = await client.put(
        f"/api/media-library/items/{path}/tags",
        json={"relative_paths": [path], "tag_ids": []},
    )
    assert res.status_code == 200
    assert res.json()["tags"] == []

    # Remove tag via DELETE.
    await client.post(f"/api/media-library/items/{path}/tags/{tag_id}")
    res = await client.delete(f"/api/media-library/items/{path}/tags/{tag_id}")
    assert res.status_code == 204


# ---------------------------------------------------------------------------
# Trash (soft delete) + 30-day retention
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trash_move_restore_purge(client):
    path = "video/clip.mp4"

    res = await client.post(
        "/api/media-library/trash",
        params={"retention_days": 30},
        json={"relative_path": path},
    )
    assert res.status_code == 201
    assert res.json()["file_type"] == "video"  # derived from extension
    assert res.json()["relative_path"] == path

    res = await client.get("/api/media-library/trash")
    assert res.status_code == 200
    assert any(t["relative_path"] == path for t in res.json())

    res = await client.post(f"/api/media-library/trash/{path}/restore")
    assert res.status_code == 200
    assert res.json()["restored"] is True

    res = await client.get("/api/media-library/trash")
    assert all(t["relative_path"] != path for t in res.json())

    # Purge on an item not in trash is 404.
    res = await client.delete(f"/api/media-library/trash/{path}")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_trash_purge_expired(media_db, client):
    expired_path = "audio/expired.mp3"
    fresh_path = "audio/fresh.mp3"
    now = datetime.now(UTC)

    with connection_module.get_connection() as conn:
        conn.execute(
            "INSERT INTO media_trash (relative_path, file_type, deleted_at, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (expired_path, "audio", (now - timedelta(days=40)).isoformat(),
             (now - timedelta(days=10)).isoformat()),
        )
        conn.execute(
            "INSERT INTO media_trash (relative_path, file_type, deleted_at, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (fresh_path, "audio", now.isoformat(),
             (now + timedelta(days=20)).isoformat()),
        )

    res = await client.post("/api/media-library/trash/purge-expired")
    assert res.status_code == 200
    assert res.json()["removed"] == 1

    res = await client.get("/api/media-library/trash")
    paths = {t["relative_path"] for t in res.json()}
    assert fresh_path in paths
    assert expired_path not in paths


@pytest.mark.asyncio
async def test_trash_purge_expired_on_list(media_db, client):
    """Listing trash also purges expired records (cleanup-on-read)."""
    expired_path = "audio/expired.mp3"
    now = datetime.now(UTC)

    with connection_module.get_connection() as conn:
        conn.execute(
            "INSERT INTO media_trash (relative_path, file_type, deleted_at, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (expired_path, "audio", (now - timedelta(days=40)).isoformat(),
             (now - timedelta(days=10)).isoformat()),
        )

    res = await client.get("/api/media-library/trash")
    assert all(t["relative_path"] != expired_path for t in res.json())
