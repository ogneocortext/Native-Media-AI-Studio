"""Prompt templates for Ollama structured output with explicit JSON instructions.

Critical: Many models (gemma4 MLX, qwen3.5, etc.) silently ignore format: json_schema.
Always include "Return ONLY JSON" explicit instructions in prompts, AND validate
client-side using validate_ollama_json_response().

See: https://github.com/ollama/ollama/issues/15260
     https://github.com/ollama/ollama/issues/17183
     https://homelabpostmortem.com/2026/10/05/ollama-thinking-model-skips-your-json-schema-when-it-answers-directly
"""

from __future__ import annotations

import json
from typing import Any

# Structured output prompt templates with explicit JSON instructions
# These templates include "Return ONLY JSON" to minimize prose output

PROMPT_TEMPLATES = {
    "music_analysis": """
Analyze this music track and generate visualization parameters.
Return ONLY valid JSON with these exact fields (no prose, no explanation):

{{
  "title": "string - a short title for the visualization",
  "color_scheme": "string - preferred color scheme",
  "energy_level": "number 0-10 - track energy",
  "mood": "string - primary mood (e.g., energetic, melancholic, aggressive)",
  "visual_style": "string - recommended visual style"
}}

Track: {track_name}
Tempo: {tempo} BPM
Key: {key}
Duration: {duration} seconds

Important: Return ONLY the JSON object shown above. No surrounding text, no analysis,
no explanations. The JSON must be valid and parseable.
""",
    "scene_generation": """
Generate a storyboard for a music video in JSON format.
Return ONLY valid JSON with these exact fields (no prose, no explanation):

{{
  "scene_description": "string - description of what's happening at this moment",
  "camera_movement": "string - pan, tilt, zoom, or other movement",
  "timestamp": number - seconds from video start,
  "mood_match": "string - how this matches the music mood"
}}

Context: {context}
Music section: {section_description}

Important: Return ONLY the JSON object shown above. No surrounding text, no analysis,
no explanations. The JSON must be valid and parseable.
""",
    "section_labeling": """
Label the next section of this music track in JSON format.
Return ONLY valid JSON with these exact fields (no prose, no explanation):

{{
  "section_name": "string - name of the section (e.g., intro, verse, chorus, bridge, outro)",
  "start_time": number - start time in seconds,
  "end_time": number - end time in seconds,
  "energy": "number 0-10 - section energy level",
  "description": "string - brief description of what's happening"
}}

Track position: {position}
Previous section: {previous_section}

Important: Return ONLY the JSON object shown above. No surrounding text, no analysis,
no explanations. The JSON must be valid and parseable.
""",
    "audio_section_llm": """
Label the next audio section in JSON format for music visualization.
Return ONLY valid JSON with these exact fields (no prose, no explanation):

{{
  "section_name": "string - section label (e.g., verse, chorus, bridge, drop, intro, outro)",
  "start_measure": number - starting measure number,
  "end_measure": number - ending measure number,
  "bpm_estimate": number - estimated BPM for this section,
  "energy_level": "number 0-10 - section energy"
}}

Current position: {current_position}
Tempo context: {tempo} BPM

Important: Return ONLY the JSON object shown above. No surrounding text, no analysis,
no explanations. The JSON must be valid and parseable. Do not include any reasoning
or analysis outside the JSON object.
""",
}


def normalize_prompt_template(template_key: str, **kwargs) -> str:
    """Fill a prompt template with the given keyword arguments.

    Args:
        template_key: The key for the template to use (see PROMPT_TEMPLATES)
        **kwargs: Values to substitute into the template

    Returns:
        The filled prompt template string
    """
    if template_key not in PROMPT_TEMPLATES:
        raise ValueError(
            f"Unknown template key: {template_key}. Available: {list(PROMPT_TEMPLATES.keys())}"
        )

    template = PROMPT_TEMPLATES[template_key]
    return template.format(**kwargs)


def validate_and_extract_json(
    response_content: str,
    schema: dict[str, Any],
    model_name: str,
) -> tuple[bool, dict[str, Any] | None]:
    """Validate an Ollama response and extract the JSON portion.

    This is a utility function that:
    1. Tries to parse the entire response as JSON
    2. If that fails, tries to extract JSON from within the response
    3. Validates the extracted JSON against the schema

    Returns (is_valid, parsed_data)
    """
    from ...core.ollama_response_validator import validate_ollama_json_response

    # First, try full JSON parse
    is_valid, parsed = validate_ollama_json_response(response_content, schema, model_name)
    if is_valid:
        return True, parsed

    # If full parse fails, try to extract JSON from within text
    # Look for the first { and last } to find JSON object
    json_start = response_content.find("{")
    json_end = response_content.rfind("}")

    if json_start >= 0 and json_end > json_start:
        potential_json = response_content[json_start : json_end + 1]
        try:
            parsed = json.loads(potential_json)
            if isinstance(parsed, dict):
                is_valid, parsed = validate_ollama_json_response(
                    json.dumps(parsed), schema, model_name
                )
                if is_valid:
                    return True, parsed
        except (json.JSONDecodeError, ValueError):
            pass

    return False, None


__all__ = [
    "PROMPT_TEMPLATES",
    "normalize_prompt_template",
    "validate_and_extract_json",
]
