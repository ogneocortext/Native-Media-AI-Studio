from __future__ import annotations

import json
from typing import Any

_TYPE_CHECKS = {
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)),
    "integer": lambda v: isinstance(v, int),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
}


def validate_ollama_json_response(
    response_content: str,
    schema: dict[str, Any],
    model_name: str,
) -> tuple[bool, dict[str, Any] | None]:
    """Validate that an Ollama chat response matches the expected JSON schema."""
    try:
        parsed = json.loads(response_content)
    except (json.JSONDecodeError, TypeError):
        return False, None

    if not isinstance(parsed, dict):
        return False, None

    required = schema.get("required", [])
    properties = schema.get("properties", {})

    missing_fields = [f for f in required if f not in parsed]
    if missing_fields:
        return False, None

    for field_name, field_schema in properties.items():
        if field_name not in parsed:
            continue
        check = _TYPE_CHECKS.get(field_schema.get("type"))
        if check is not None and not check(parsed[field_name]):
            return False, None

    return True, parsed


__all__ = ["validate_ollama_json_response"]
