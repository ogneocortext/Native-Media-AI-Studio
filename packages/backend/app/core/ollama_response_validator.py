from __future__ import annotations

import json
from typing import Any


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
        if field_name in parsed:
            value = parsed[field_name]
            expected_type = field_schema.get("type")
            if expected_type == "string" and not isinstance(value, str):
                return False, None
            elif expected_type == "number" and not isinstance(value, (int, float)):
                return False, None
            elif expected_type == "integer" and not isinstance(value, int):
                return False, None
            elif expected_type == "array" and not isinstance(value, list):
                return False, None
            elif expected_type == "object" and not isinstance(value, dict):
                return False, None

    return True, parsed


__all__ = ["validate_ollama_json_response"]
