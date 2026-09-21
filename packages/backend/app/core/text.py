"""
Text helpers for LLM output post-processing.

Consolidates the markdown-fence stripping previously copy-pasted (with
slight drift) across ``api/integrations_generation.py`` (prompt enrich +
visualizer preset parse), ``api/integrations_misc.py`` (HTML + JSON preset
parses) and ``api/audio.py`` (section-label parse).
"""

from __future__ import annotations


def strip_code_fences(text: str) -> str:
    """Remove one layer of markdown code fences (```json / ```html / ```).

    Handles the variants seen in the wild: leading language tag, missing
    closing fence, and surrounding whitespace. Returns the stripped text;
    callers still ``json.loads`` / store the result themselves.
    """
    cleaned = (text or "").strip()
    if not cleaned.startswith("```"):
        return cleaned
    # Drop the opening fence line (``` + optional language tag)
    first_nl = cleaned.find("\n")
    if first_nl == -1:
        return ""
    cleaned = cleaned[first_nl + 1:]
    # Drop everything from the closing fence onward (if present)
    closing = cleaned.find("```")
    if closing != -1:
        cleaned = cleaned[:closing]
    return cleaned.strip()
