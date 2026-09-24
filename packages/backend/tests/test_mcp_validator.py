"""Contract validation tests for in-repo MCP tool schemas."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.mcp_validator import (  # noqa: E402
    ValidationError,
    validate_tool_call,
)


def test_validate_tool_call_applies_defaults() -> None:
    args = validate_tool_call("create_animation_clip", {"path": "Assets/clip.anim"})
    assert args == {
        "path": "Assets/clip.anim",
        "frameRate": 24,
        "loop": False,
    }


def test_validate_tool_call_rejects_missing_required_field() -> None:
    with pytest.raises(ValidationError, match="missing required field 'command'"):
        validate_tool_call("unity_command", {})


def test_validate_tool_call_rejects_invalid_enum() -> None:
    with pytest.raises(ValidationError, match="not in allowed values"):
        validate_tool_call(
            "create_gameobject",
            {"name": "Cube", "primitive": "dodecahedron"},
        )


def test_validate_tool_call_preserves_unknown_tool_compatibility() -> None:
    args = {"command": "external_command", "parameters": {"x": 1}}
    assert validate_tool_call("external_command", args) == args
