"""MCP tool contract validators.

Provides lightweight JSON Schema validation for in-repo MCP tool inputs.
Agents can import these helpers to validate arguments before calling
``tools/call``, reducing silent coercion and opaque server errors.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Minimal JSON Schema Draft 2020-12 subset validator.
# We only need the constraints used in the in-repo MCP servers:
# type, enum, default, required, properties, items, additionalProperties.
# ---------------------------------------------------------------------------

_TYPE_MAP = {
    "string": str,
    "number": (int, float),
    "integer": int,
    "boolean": bool,
    "object": dict,
    "array": list,
}


class ValidationError(Exception):
    """Raised when tool arguments do not match the contract schema."""


def _validate_type(value: Any, schema: dict[str, Any], path: str) -> None:
    schema_type = schema.get("type")
    if schema_type is None:
        return
    expected = _TYPE_MAP.get(schema_type)
    if expected is None:
        return
    if not isinstance(value, expected):
        raise ValidationError(
            f"{path}: expected {schema_type}, got {type(value).__name__} ({value!r})"
        )


def _validate_enum(value: Any, schema: dict[str, Any], path: str) -> None:
    enum_values = schema.get("enum")
    if enum_values is not None and value not in enum_values:
        raise ValidationError(
            f"{path}: {value!r} not in allowed values {enum_values}"
        )


def _validate_object(value: dict[str, Any], schema: dict[str, Any], path: str) -> None:
    props = schema.get("properties", {})
    for name, prop_schema in props.items():
        if name in value:
            _validate_value(value[name], prop_schema, f"{path}.{name}")
        elif "default" in prop_schema:
            value.setdefault(name, prop_schema["default"])
    required = schema.get("required", [])
    for req in required:
        if req not in value:
            raise ValidationError(f"{path}: missing required field '{req}'")


def _validate_array(value: list[Any], schema: dict[str, Any], path: str) -> None:
    item_schema = schema.get("items")
    if item_schema is not None:
        for idx, item in enumerate(value):
            _validate_value(item, item_schema, f"{path}[{idx}]")


def _validate_value(value: Any, schema: dict[str, Any], path: str) -> None:
    _validate_type(value, schema, path)
    _validate_enum(value, schema, path)
    if isinstance(value, dict):
        _validate_object(value, schema, path)
    elif isinstance(value, list):
        _validate_array(value, schema, path)


def validate(tool_name: str, arguments: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """Validate *arguments* against the JSON Schema *schema* for *tool_name*.

    Applies defaults from the schema, then raises ``ValidationError`` on
    any constraint violation. Returns the (possibly augmented) arguments
    dict on success.
    """
    args = dict(arguments) if arguments else {}
    try:
        _validate_value(args, schema, tool_name)
    except ValidationError:
        raise
    except Exception as exc:
        logger.debug("Validator unexpected error for %s: %s", tool_name, exc)
    return args


# ---------------------------------------------------------------------------
# Known in-repo MCP tool schemas (extracted from tools/mcp/*.mjs).
# These mirror the Zod / JSON Schema definitions in the server files.
# ---------------------------------------------------------------------------

UNITY_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "unity_command": {
        "type": "object",
        "properties": {
            "command": {"type": "string"},
            "parameters": {"type": "object"},
        },
        "required": ["command"],
    },
    "create_gameobject": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "primitive": {
                "type": "string",
                "enum": ["cube", "sphere", "capsule", "cylinder", "plane", "quad"],
            },
        },
    },
    "add_component": {
        "type": "object",
        "properties": {
            "target": {"type": "string"},
            "type": {"type": "string"},
        },
        "required": ["target", "type"],
    },
    "capture_scene_view": {
        "type": "object",
        "properties": {
            "save_path": {"type": "string"},
            "width": {"type": "number"},
            "height": {"type": "number"},
        },
        "required": ["save_path"],
    },
    "editor_status": {"type": "object", "properties": {}},
    "create_scene": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
        },
        "required": ["path"],
    },
    "create_animation_clip": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "frameRate": {"type": "number", "default": 24},
            "loop": {"type": "boolean", "default": False},
        },
        "required": ["path"],
    },
    "get_beat_data": {"type": "object", "properties": {}},
    "create_beat_animation": {
        "type": "object",
        "properties": {
            "object_name": {"type": "string"},
            "clip_path": {"type": "string"},
            "pulse_scale": {"type": "number", "default": 1.5},
            "frame_rate": {"type": "number", "default": 24},
            "max_beats": {"type": "number"},
        },
        "required": ["object_name", "clip_path"],
    },
    "capture_frame_sequence": {
        "type": "object",
        "properties": {
            "fps": {"type": "number", "default": 24},
            "duration_seconds": {"type": "number", "default": 10},
            "output_dir": {"type": "string"},
            "width": {"type": "number", "default": 1280},
            "height": {"type": "number", "default": 720},
        },
        "required": ["output_dir"],
    },
    "set_object_visibility": {
        "type": "object",
        "properties": {
            "object_name": {"type": "string"},
            "visible": {"type": "boolean"},
        },
        "required": ["object_name", "visible"],
    },
    "list_animations": {
        "type": "object",
        "properties": {
            "object_name": {"type": "string"},
        },
        "required": ["object_name"],
    },
    "play_animation": {
        "type": "object",
        "properties": {
            "object_name": {"type": "string"},
            "clip_name": {"type": "string"},
            "speed": {"type": "number", "default": 1},
            "wrap_mode": {
                "type": "string",
                "default": "once",
                "enum": ["once", "loop", "pingpong", "clamp"],
            },
            "fade_time": {"type": "number"},
        },
        "required": ["object_name", "clip_name"],
    },
    "stop_animation": {
        "type": "object",
        "properties": {
            "object_name": {"type": "string"},
            "return_to_bind_pose": {"type": "boolean", "default": True},
        },
        "required": ["object_name"],
    },
    "blend_animation": {
        "type": "object",
        "properties": {
            "object_name": {"type": "string"},
            "from_clip": {"type": "string"},
            "to_clip": {"type": "string"},
            "fade_time": {"type": "number", "default": 0.5},
        },
        "required": ["object_name", "from_clip", "to_clip"],
    },
    "list_pipeline_commands": {"type": "object", "properties": {}},
    "plan_unity_scene": {
        "type": "object",
        "properties": {
            "description": {"type": "string"},
            "target": {"type": "string"},
            "model": {"type": "string", "default": "llama3.2:3b"},
        },
        "required": ["description"],
    },
}

OLLAMA_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "analyze_image": {
        "type": "object",
        "properties": {
            "image_path": {"type": "string"},
            "prompt": {"type": "string", "default": "Describe this image in detail."},
            "model": {"type": "string", "default": "qwen3-vl:2b"},
            "think": {"type": "boolean", "default": False},
        },
        "required": ["image_path"],
    },
    "analyze_audio": {
        "type": "object",
        "properties": {
            "filename": {"type": "string"},
        },
        "required": ["filename"],
    },
    "generate_image": {
        "type": "object",
        "properties": {
            "prompt": {"type": "string"},
            "negative_prompt": {"type": "string", "default": ""},
            "width": {"type": "number", "default": 1024},
            "height": {"type": "number", "default": 1024},
            "workflow": {"type": "string", "default": "txt2img"},
        },
        "required": ["prompt"],
    },
    "generate_video": {
        "type": "object",
        "properties": {
            "prompt": {"type": "string"},
            "duration": {"type": "number", "default": 4},
            "fps": {"type": "number", "default": 24},
        },
        "required": ["prompt"],
    },
    "list_audio_library": {"type": "object", "properties": {}},
    "create_music_video_plan": {
        "type": "object",
        "properties": {
            "filename": {"type": "string"},
            "style": {"type": "string"},
        },
        "required": ["filename"],
    },
    "suggest_3d_prompt": {
        "type": "object",
        "properties": {
            "idea": {"type": "string"},
            "category": {"type": "string", "default": "character"},
            "style": {"type": "string"},
        },
        "required": ["idea"],
    },
    "generate_3d_concept": {
        "type": "object",
        "properties": {
            "description": {"type": "string"},
            "category": {"type": "string", "default": "3d-character"},
            "width": {"type": "number", "default": 1024},
            "height": {"type": "number", "default": 1024},
        },
        "required": ["description"],
    },
    "update_mcp_context": {
        "type": "object",
        "properties": {
            "context": {"type": "object"},
        },
        "required": ["context"],
    },
}

VISION_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "vision_describe": {
        "type": "object",
        "properties": {
            "image_b64": {"type": "string"},
            "prompt": {"type": "string", "default": "Describe the UI and any visible errors, warnings, or issues."},
            "model": {"type": "string", "default": "gemma4:e2b-it-qat"},
            "max_tokens": {"type": "integer", "default": 2048},
        },
        "required": ["image_b64"],
    },
    "vision_find_text": {
        "type": "object",
        "properties": {
            "image_b64": {"type": "string"},
            "query": {"type": "string"},
            "model": {"type": "string", "default": "gemma4:e2b-it-qat"},
            "fuzzy": {"type": "boolean", "default": True},
        },
        "required": ["image_b64", "query"],
    },
    "vision_health": {"type": "object", "properties": {}},
}

HYPERFRAMES_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "hyperframes_init": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "example": {"type": "string"},
        },
    },
    "hyperframes_preview": {
        "type": "object",
        "properties": {
            "port": {"type": "number"},
        },
    },
    "hyperframes_render": {
        "type": "object",
        "properties": {
            "output": {"type": "string"},
            "format": {
                "type": "string",
                "enum": ["mp4", "mov", "webm", "gif", "png-sequence"],
                "default": "mp4",
            },
            "fps": {"type": "number", "default": 30},
            "quality": {
                "type": "string",
                "enum": ["draft", "standard", "high"],
                "default": "standard",
            },
            "workers": {"type": "string", "default": "auto"},
            "gpu": {"type": "boolean", "default": False},
            "composition": {"type": "string"},
        },
        "required": ["output"],
    },
    "hyperframes_lint": {
        "type": "object",
        "properties": {
            "composition": {"type": "string"},
        },
    },
    "hyperframes_list_examples": {"type": "object", "properties": {}},
    "hyperframes_read_composition": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
        },
    },
    "hyperframes_write_composition": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "content": {"type": "string"},
        },
        "required": ["path", "content"],
    },
    "hyperframes_read_assets": {
        "type": "object",
        "properties": {
            "subfolder": {"type": "string"},
        },
    },
    "hyperframes_status": {"type": "object", "properties": {}},
}

ALL_SCHEMAS: dict[str, dict[str, Any]] = {
    **UNITY_TOOL_SCHEMAS,
    **OLLAMA_TOOL_SCHEMAS,
    **VISION_TOOL_SCHEMAS,
    **HYPERFRAMES_TOOL_SCHEMAS,
}


def validate_tool_call(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Validate arguments for a known in-repo MCP tool by name.

    Looks up the schema in the built-in registry and returns the augmented
    arguments dict (with defaults applied). Raises ``ValidationError`` on
    mismatch.

    Example::

        from app.services.mcp_validator import validate_tool_call, ValidationError

        try:
            args = validate_tool_call("create_gameobject", {"name": "Cube"})
        except ValidationError as exc:
            logger.error("Bad tool args: %s", exc)
    """
    schema = ALL_SCHEMAS.get(tool_name)
    if schema is None:
        logger.debug("No local schema for %s — skipping validation", tool_name)
        return arguments or {}
    return validate(tool_name, arguments or {}, schema)
