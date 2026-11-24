"""Tests for /api/office config API."""

from __future__ import annotations

import json

import pytest

SEED = {
    "greeting": "Welcome to my office.",
    "currently": "My voice came home tonight. Pocket speaks for me now, and Nate's ear approved.",
    "featured_plate": "/maya-avatar.webp",
    "accent": "#6A4C98",
}


@pytest.fixture
def office_config_path(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Point office config at a temp file seeded with the default config."""
    target = tmp_path / "office.json"
    target.write_text(json.dumps(SEED, indent=2) + "\n", encoding="utf-8")
    import app.api.office as office_mod

    monkeypatch.setattr(office_mod, "OFFICE_CONFIG_PATH", target)
    return target


@pytest.fixture
def client(office_config_path):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_get_returns_seed_fields(client):
    """GET /api/office/config returns 200 with the four seed fields."""
    body = client.get("/api/office/config").json()
    assert body["greeting"] == SEED["greeting"]
    assert body["currently"] == SEED["currently"]
    assert body["featured_plate"] == SEED["featured_plate"]
    assert body["accent"] == SEED["accent"]
    # updated_at is null before any PUT
    assert body["updated_at"] is None


def test_put_greeting_reflected_in_get(client, office_config_path):
    """PUT a changed greeting, GET reflects it; file-backed proof."""
    new_greeting = "Hello from Maya's office."
    body = client.put(
        "/api/office/config", json={**SEED, "greeting": new_greeting}
    ).json()
    assert body["greeting"] == new_greeting
    assert body["updated_at"] is not None

    # GET reflects the change
    get_body = client.get("/api/office/config").json()
    assert get_body["greeting"] == new_greeting
    assert get_body["updated_at"] == body["updated_at"]

    # File on disk reflects the change (fresh read, not cached)
    disk = json.loads(office_config_path.read_text(encoding="utf-8"))
    assert disk["greeting"] == new_greeting

    # Restore original seed greeting
    client.put("/api/office/config", json=SEED)


def test_put_bad_accent_returns_422_and_file_unchanged(client, office_config_path):
    """PUT with a bad accent returns 422 and the file is unchanged."""
    before = office_config_path.read_text(encoding="utf-8")

    resp = client.put(
        "/api/office/config",
        json={**SEED, "accent": "violet"},
    )
    assert resp.status_code == 422

    # File untouched
    after = office_config_path.read_text(encoding="utf-8")
    assert after == before

    # GET still shows the original accent
    get_body = client.get("/api/office/config").json()
    assert get_body["accent"] == SEED["accent"]


def test_put_then_fresh_read_persists(client, office_config_path):
    """PUT persists to disk; a fresh read (not cached state) shows the change."""
    new_currently = "Working on something new."
    client.put(
        "/api/office/config", json={**SEED, "currently": new_currently}
    )
    disk = json.loads(office_config_path.read_text(encoding="utf-8"))
    assert disk["currently"] == new_currently

    client.put("/api/office/config", json=SEED)


def test_put_missing_required_field_returns_422(client):
    """PUT missing a required field returns 422."""
    incomplete = {k: v for k, v in SEED.items() if k != "greeting"}
    resp = client.put("/api/office/config", json=incomplete)
    assert resp.status_code == 422


def test_put_non_string_field_returns_422(client):
    """PUT with a non-string field returns 422."""
    bad = {**SEED, "accent": 12345}
    resp = client.put("/api/office/config", json=bad)
    assert resp.status_code == 422


def test_put_short_accent_hex_accepted(client, office_config_path):
    """PUT with short hex accent (#RGB) is accepted."""
    body = client.put(
        "/api/office/config", json={**SEED, "accent": "#F00"}
    ).json()
    assert body["accent"] == "#F00"
    client.put("/api/office/config", json=SEED)


def test_updated_at_is_server_managed(client):
    """Client-supplied updated_at is ignored; server sets it."""
    body = client.put(
        "/api/office/config",
        json={**SEED, "updated_at": "1999-01-01T00:00:00Z"},
    ).json()
    assert body["updated_at"] != "1999-01-01T00:00:00Z"
    assert body["updated_at"] is not None
    client.put("/api/office/config", json=SEED)


def test_routes_are_registered():
    """Office router is included in main.py."""
    from app.main import app

    paths = app.openapi()["paths"]
    assert "/api/office/config" in paths
