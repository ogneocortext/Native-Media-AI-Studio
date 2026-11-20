"""Tests for the NSFW visibility gate (``show_nsfw`` + the ``nsfw`` media tag).

The gate has two halves that must not be confused:

* the per-item flag -- the ``nsfw`` tag on ``relative_path``, set by
  ``POST /api/outputs/nsfw``;
* the user setting -- ``show_nsfw`` in ``config/settings.json``, default False.

While the setting is off, flagged items must be absent from every general list
response -- including their cover/thumbnail paths -- while remaining visible in
the dedicated ``/api/outputs/nsfw`` section once it is on. Nothing here touches
files on disk: the library is a synthetic tree in ``tmp_path``.
"""

from __future__ import annotations

import sys
from contextlib import contextmanager
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api import outputs_scanner  # noqa: E402
from app.core import config as config_module  # noqa: E402
from app.core import connection as connection_module  # noqa: E402
from app.core import database as database_module  # noqa: E402
from app.core import migrations as migrations_module  # noqa: E402
from app.core import nsfw  # noqa: E402
from app.main import app  # noqa: E402

# A cover sidecar is only recognized next to a sibling media file, so the
# synthetic library pairs each image with an audio file of the same stem.
FLAGGED = "audio/flagged.mp3"
CLEAN = "audio/clean.mp3"


@pytest.fixture
def nsfw_db(monkeypatch, tmp_path):
    """Throwaway DB + synthetic output tree, with the scan cache cleared."""
    db_path = tmp_path / "nsfw_test.db"
    monkeypatch.setattr(connection_module, "DB_PATH", db_path)
    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    monkeypatch.setattr(migrations_module, "DB_PATH", db_path)
    migrations_module.init_db(db_path)

    output_dir = tmp_path / "output"
    (output_dir / "audio").mkdir(parents=True)
    for name in (FLAGGED, CLEAN):
        # 4 KB of real bytes: files under 10 KB are skipped as broken renders.
        (output_dir / name).write_bytes(b"0" * 4096)
    monkeypatch.setattr(config_module.config, "output_dir", output_dir)
    monkeypatch.setattr(config_module.config, "show_nsfw", False)
    # The scanner also sweeps the ComfyUI output dir for 3D assets. Point it at
    # a path that does not exist so the assertions below are not at the mercy
    # of whatever renders happen to be on this machine.
    monkeypatch.setattr(outputs_scanner, "comfyui_output_dir", lambda: tmp_path / "no-comfyui")
    outputs_scanner._invalidate_cache()

    yield db_path

    connection_module.close_pooled_connections()
    outputs_scanner._invalidate_cache()


@pytest.fixture
async def client(nsfw_db):
    """Async HTTP client against the FastAPI app (no real network)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _flag(client: AsyncClient, relative_path: str, *, value: bool) -> dict:
    res = await client.post(
        "/api/outputs/nsfw", json={"relative_path": relative_path, "nsfw": value}
    )
    assert res.status_code == 200, res.text
    return res.json()


def _paths(payload: list[dict]) -> list[str]:
    return [item["relative_path"] for item in payload]


@contextmanager
def _gate_open():
    """Temporarily set show_nsfw true, restoring the previous value after."""
    previous = config_module.config.show_nsfw
    config_module.config.show_nsfw = True
    try:
        yield
    finally:
        config_module.config.show_nsfw = previous


# ---------------------------------------------------------------------------
# Default state: OFF
# ---------------------------------------------------------------------------


def test_show_nsfw_defaults_to_false():
    """The gate ships closed -- a fresh install hides flagged media."""
    assert config_module.AppConfig().show_nsfw is False


@pytest.mark.asyncio
async def test_flagged_item_is_hidden_from_every_list_surface(client):
    """One flagged item disappears from list, recent, and type-filtered feeds."""
    await _flag(client, FLAGGED, value=True)

    listed = (await client.get("/api/outputs?limit=500")).json()
    assert FLAGGED not in _paths(listed["outputs"])
    assert CLEAN in _paths(listed["outputs"])

    recent = (await client.get("/api/outputs/recent?limit=200")).json()
    assert FLAGGED not in _paths(recent)

    by_type = (await client.get("/api/outputs/audio?limit=200")).json()
    assert FLAGGED not in _paths(by_type)

    # The thumbnail URL must not be in the payload either, not just the row.
    assert "flagged.mp3" not in (await client.get("/api/outputs?limit=500")).text


@pytest.mark.asyncio
async def test_nsfw_section_is_empty_while_gate_is_off(client):
    """Guessing /api/outputs/nsfw returns nothing while show_nsfw is off."""
    await _flag(client, FLAGGED, value=True)
    res = await client.get("/api/outputs/nsfw")
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_gate_open_lists_flagged_item_only_in_the_nsfw_section(client, monkeypatch):
    """With show_nsfw on, /nsfw lists the item and the home feed still does not."""
    await _flag(client, FLAGGED, value=True)
    monkeypatch.setattr(config_module.config, "show_nsfw", True)

    nsfw_items = (await client.get("/api/outputs/nsfw")).json()
    assert FLAGGED in _paths(nsfw_items)

    # General surfaces stay unflagged-only: the flag is a permanent exclusion
    # from the library, not a swap between two libraries.
    assert FLAGGED not in _paths((await client.get("/api/outputs/recent?limit=200")).json())
    assert FLAGGED not in _paths((await client.get("/api/outputs?limit=500")).json()["outputs"])


@pytest.mark.asyncio
async def test_unflagging_restores_the_item(client):
    """Clearing the flag puts the item back in the general lists."""
    await _flag(client, FLAGGED, value=True)
    await _flag(client, FLAGGED, value=False)

    assert FLAGGED in _paths((await client.get("/api/outputs?limit=500")).json()["outputs"])


# ---------------------------------------------------------------------------
# Organization lists must not name flagged items either
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_favorites_and_organization_drop_flagged_paths(client):
    """A path is the item's address: the organization maps hide it too."""
    fav = await client.post(f"/api/media-library/favorites/{FLAGGED}")
    assert fav.status_code == 200

    await _flag(client, FLAGGED, value=True)

    assert FLAGGED not in (await client.get("/api/media-library/favorites")).json()

    org = (await client.get("/api/media-library/items/organization")).json()
    assert FLAGGED not in org["tags"]
    assert FLAGGED not in org["collections"]


@pytest.mark.asyncio
async def test_flags_are_stored_as_the_nsfw_tag(client):
    """The flag is the ``nsfw`` tag -- no separate boolean column exists."""
    await _flag(client, FLAGGED, value=True)

    tags = (await client.get(f"/api/media-library/items/{FLAGGED}/tags")).json()["tags"]
    assert [t["name"] for t in tags] == ["nsfw"]

    assert nsfw.is_flagged(FLAGGED) is True
    assert nsfw.is_flagged(CLEAN) is False


@pytest.mark.asyncio
async def test_nsfw_tag_is_not_offered_as_a_filter_while_gate_is_off(client):
    """No NSFW trace on general surfaces: the tag chip is withheld too."""
    await _flag(client, FLAGGED, value=True)

    tags_off = (await client.get("/api/media-library/tags")).json()
    assert [t["name"] for t in tags_off] == []

    # The owner opted in -> the tag is a normal filter again.
    with _gate_open():
        tags_on = (await client.get("/api/media-library/tags")).json()
    assert [t["name"] for t in tags_on] == ["nsfw"]
