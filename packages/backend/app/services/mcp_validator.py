"""Lightweight JSON Schema validator for in-repo MCP tool calls.

Covers the tools exposed by the in-repo MCP bridges
(``tools/mcp/*.mjs``).  Unknown tools are logged and passed through unchanged
so upstream servers (Blender MCP, Remotion MCP) still work.

Usage::

    from app.services.mcp_validator import validate_tool_call, ValidationError

    try:
        args = validate_tool_call("create_gameobject", {"name": "Cube"})
    except ValidationError as exc:
        logger.error("Bad tool args: %s", exc)
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class ValidationError(Exception):
    """Raised when a tool call's arguments don't match the registered schema."""


# ---------------------------------------------------------------------------
# Schema registry — one entry per in-repo tool.
# Each schema follows JSON Schema subset (type + required + properties).
# ---------------------------------------------------------------------------

_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    # ---- Ollama Tools bridge ----
    "analyze_image": {
        "type": "object",
        "required": ["image_path"],
        "properties": {
            "image_path": {"type": "string"},
            "prompt": {"type": "string"},
            "model": {"type": "string"},
            "think": {"type": "boolean"},
        },
    },
    "analyze_audio": {
        "type": "object",
        "required": ["filename"],
        "properties": {
            "filename": {"type": "string"},
        },
    },
    "generate_image": {
        "type": "object",
        "required": ["prompt"],
        "properties": {
            "prompt": {"type": "string"},
            "negative_prompt": {"type": "string"},
            "width": {"type": "number"},
            "height": {"type": "number"},
            "workflow": {"type": "string"},
        },
    },
    "generate_video": {
        "type": "object",
        "required": ["prompt"],
        "properties": {
            "prompt": {"type": "string"},
            "duration": {"type": "number"},
            "fps": {"type": "number"},
        },
    },
    "list_audio_library": {
        "type": "object",
        "properties": {},
    },
    "create_music_video_plan": {
        "type": "object",
        "required": ["filename"],
        "properties": {
            "filename": {"type": "string"},
            "style": {"type": "string"},
        },
    },
    "suggest_3d_prompt": {
        "type": "object",
        "required": ["idea"],
        "properties": {
            "idea": {"type": "string"},
            "category": {"type": "string"},
            "style": {"type": "string"},
        },
    },
    "generate_3d_concept": {
        "type": "object",
        "required": ["description"],
        "properties": {
            "description": {"type": "string"},
            "category": {"type": "string"},
            "width": {"type": "number"},
            "height": {"type": "number"},
        },
    },
    "plan_blender_script": {
        "type": "object",
        "required": ["description"],
        "properties": {
            "description": {"type": "string"},
            "target": {"type": "string"},
            "model": {"type": "string"},
        },
    },
    "update_mcp_context": {
        "type": "object",
        "required": ["context"],
        "properties": {
            "context": {"type": "object"},
        },
    },
    # ---- Unity MCP bridge ----
    "create_gameobject": {
        "type": "object",
        "required": ["name"],
        "properties": {
            "name": {"type": "string"},
            "position": {"type": "array", "items": {"type": "number"}},
            "rotation": {"type": "array", "items": {"type": "number"}},
            "scale": {"type": "array", "items": {"type": "number"}},
        },
    },
    "unity_command": {
        "type": "object",
        "required": ["command"],
        "properties": {
            "command": {"type": "string"},
            "args": {"type": "array", "items": {"type": "string"}},
            "timeout": {"type": "number"},
        },
    },
    "list_pipeline_commands": {
        "type": "object",
        "properties": {},
    },
    "capture_frame_sequence": {
        "type": "object",
        "required": ["output_dir"],
        "properties": {
            "output_dir": {"type": "string"},
            "frames": {"type": "number"},
            "fps": {"type": "number"},
        },
    },
    "set_object_visibility": {
        "type": "object",
        "required": ["name"],
        "properties": {
            "name": {"type": "string"},
            "visible": {"type": "boolean"},
        },
    },
    "list_animations": {
        "type": "object",
        "required": ["game_object"],
        "properties": {
            "game_object": {"type": "string"},
        },
    },
    "play_animation": {
        "type": "object",
        "required": ["game_object", "clip_name"],
        "properties": {
            "game_object": {"type": "string"},
            "clip_name": {"type": "string"},
            "speed": {"type": "number"},
            "fade": {"type": "number"},
        },
    },
    "stop_animation": {
        "type": "object",
        "required": ["game_object"],
        "properties": {
            "game_object": {"type": "string"},
            "return_to": {"type": "string"},
        },
    },
    "blend_animation": {
        "type": "object",
        "required": ["game_object", "from_clip", "to_clip"],
        "properties": {
            "game_object": {"type": "string"},
            "from_clip": {"type": "string"},
            "to_clip": {"type": "string"},
            "duration": {"type": "number"},
        },
    },
    "plan_unity_scene": {
        "type": "object",
        "required": ["description"],
        "properties": {
            "description": {"type": "string"},
            "style": {"type": "string"},
        },
    },
    # ---- Vision MCP bridge ----
    "describe_image": {
        "type": "object",
        "required": ["image_b64"],
        "properties": {
            "image_b64": {"type": "string"},
            "prompt": {"type": "string"},
            "model": {"type": "string"},
        },
    },
    "find_text_in_image": {
        "type": "object",
        "required": ["image_b64", "query"],
        "properties": {
            "image_b64": {"type": "string"},
            "query": {"type": "string"},
            "fuzzy": {"type": "boolean"},
        },
    },
    # ---- HyperFrames MCP bridge ----
    "hyperframes_init": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "example": {"type": "string"},
        },
    },
    "hyperframes_render": {
        "type": "object",
        "required": ["composition"],
        "properties": {
            "composition": {"type": "string"},
            "format": {"type": "string"},
            "fps": {"type": "number"},
            "quality": {"type": "string"},
        },
    },
}


def validate_tool_call(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Validate *args* against the registered schema for *tool_name*.

    Parameters
    ----------
    tool_name : str
        The MCP tool being called.
    args : dict
        The arguments dict supplied by the agent.

    Returns
    -------
    dict
        The validated *args* dict (unchanged on success).

    Raises
    ------
    ValidationError
        If *args* don't satisfy the registered schema. Unknown tools are
        passed through unchanged (no raise), so upstream servers keep working.
    """
    schema = _TOOL_SCHEMAS.get(tool_name)
    if schema is None:
        logger.warning("validate_tool_call: unknown tool %r — passing through unchanged", tool_name)
        return args

    errors: list[str] = []

    # Type check
    if not isinstance(args, dict):
        raise ValidationError(f"tool {tool_name!r}: arguments must be a dict, got {type(args).__name__}")

    # Required fields
    for field in schema.get("required", []):
        if field not in args:
            errors.append(f"missing required field {field!r}")

    # Property types
    for key, value in args.items():
        prop_schema = schema.get("properties", {}).get(key)
        if prop_schema is None:
            # Unknown fields are allowed (forward-compat), just log
            logger.debug("validate_tool_call: tool %r got unknown field %r", tool_name, key)
            continue
        expected = prop_schema.get("type")
        if expected == "string" and not isinstance(value, str):
            errors.append(f"field {key!r} must be a string, got {type(value).__name__}")
        elif expected == "number" and (
            isinstance(value, bool) or not isinstance(value, (int, float))
        ):
            errors.append(f"field {key!r} must be a number, got {type(value).__name__}")
        elif expected == "boolean" and not isinstance(value, bool):
            errors.append(f"field {key!r} must be a boolean, got {type(value).__name__}")
        elif expected == "object" and not isinstance(value, dict):
            errors.append(f"field {key!r} must be an object, got {type(value).__name__}")
        elif expected == "array" and not isinstance(value, list):
            errors.append(f"field {key!r} must be an array, got {type(value).__name__}")

    if errors:
        raise ValidationError(
            f"tool {tool_name!r}: invalid arguments — " + "; ".join(errors)
        )

    return args
