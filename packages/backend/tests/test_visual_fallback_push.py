"""Regression tests for the Q2 deterministic visual fallback + push API (2026-10-06).

Covers the defects found while reviewing the uncommitted Q2/push/MCP work:
the inverted ``_token_in`` containment (every genre matched nothing, so the
fallback always returned ``balanced``), the push endpoints returning 200 with
an ``error`` body instead of a real error status, and the validator route
missing its ``/api`` prefix so the MCP bridges validated against a 404.
"""

from __future__ import annotations

import pytest
from app.main import app
from app.services import push_notifier
from app.services.mcp_validator import ValidationError, validate_tool_call
from app.services.visual_fallback import _token_in, select_fallback_preset
from httpx import ASGITransport, AsyncClient


def test_token_in_matches_phrase_inside_haystack():
    # Regression: the operands were swapped (``haystack in token``), so no
    # genre ever matched and every fallback returned "balanced".
    assert _token_in("trap metal song", "trap metal") is True
    assert _token_in("grape harvest", "rap") is False


def test_fallback_genre_match_longest_first():
    assert select_fallback_preset(genre="trap metal song") == "trapMetal"
    assert select_fallback_preset(genre="trap") == "phonk"


def test_fallback_track_name_joins_genre_haystack():
    # Mirrors the frontend selectVisualPreset(trackName, genre, ...) contract:
    # the track title alone can select a preset.
    assert select_fallback_preset(genre=None, track_name="midnight phonk drive") == "phonk"


def test_fallback_energy_bpm_thresholds_mirror_frontend():
    assert select_fallback_preset(genre=None, energy=0.8) == "dubstep"
    assert select_fallback_preset(genre=None, energy=0.2) == "ambient"
    assert select_fallback_preset(genre=None, bpm=150) == "dubstep"
    assert select_fallback_preset(genre=None, bpm=80) == "ambient"


def test_fallback_unknown_is_balanced_and_deterministic():
    assert select_fallback_preset(genre="grape harvest") == "balanced"
    first = select_fallback_preset(genre="trap metal", energy=0.9, bpm=150)
    second = select_fallback_preset(genre="trap metal", energy=0.9, bpm=150)
    assert first == second == "trapMetal"


def test_validator_accepts_known_tool_and_passes_unknown_through():
    assert validate_tool_call("generate_video", {"prompt": "x"}) == {"prompt": "x"}
    passthrough = {"anything": 1}
    assert validate_tool_call("some_upstream_tool", passthrough) is passthrough


def test_validator_rejects_missing_required_field():
    with pytest.raises(ValidationError, match="missing required field"):
        validate_tool_call("generate_video", {})


def test_validator_rejects_bool_for_number_field():
    # bool is a subclass of int, so isinstance(True, (int, float)) passes —
    # the validator must exclude it explicitly.
    with pytest.raises(ValidationError, match="must be a number"):
        validate_tool_call("generate_image", {"prompt": "x", "width": True})


@pytest.mark.asyncio
async def test_validate_tool_route_lives_under_api_prefix():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/mcp/validate-tool",
            json={"tool_name": "generate_video", "arguments": {"prompt": "x"}},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is True
    assert body["arguments"] == {"prompt": "x"}


@pytest.mark.asyncio
async def test_push_subscribe_round_trip():
    push_notifier.push_subscriptions.clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        sub = {"endpoint": "https://example/push/1", "keys": {"p256dh": "x", "auth": "y"}}
        res = await client.post("/api/notifications/push/subscribe", json=sub)
        assert res.status_code == 200
        assert res.json() == {"status": "subscribed"}
        assert push_notifier.push_subscriptions["https://example/push/1"] == sub

        res = await client.post("/api/notifications/push/unsubscribe", json=sub)
        assert res.status_code == 200
        assert res.json() == {"status": "unsubscribed"}
        assert "https://example/push/1" not in push_notifier.push_subscriptions


@pytest.mark.asyncio
async def test_push_subscribe_missing_endpoint_is_422_not_200_error_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/notifications/push/subscribe", json={"keys": {}})
    assert res.status_code == 422
