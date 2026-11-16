"""Place/theme conformance check for generated panels (R5).

A small local VLM looks at one rendered panel and answers a single question:
does this show the board's place/theme? The check is deliberately narrow —
``{"conforms": bool, "reason": str}`` — and a check that cannot be performed
returns ``None``, never a verdict. A failed check never auto-accepts and never
auto-rejects; the panel stays ``generated`` with a ``conformance_error``.

Cost-routing pattern: docs/knowledge-library/video-to-glsl-shader-recreation-2026.md
section 4 — a local route (Gemma 4 E2B via Ollama) is attempted first, and the
caller can fall back to a hosted VLM later without changing the interface.
"""

from __future__ import annotations

import base64
import inspect
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_CONFORMANCE_MODEL = "gemma4:e2b-it-qat"

_PROMPT = """You are checking one rendered panel of a music video against its place/theme.

Place/theme: {place_theme}
Section: {section}
Framing: {framing}

Look at the image and reply with JSON only:
{{"conforms": true or false, "reason": "one sentence citing what is actually visible"}}

Rules:
- conforms=false when the image shows a different place, culture, or setting than the place/theme.
- The reason must name concrete visible evidence: architecture, signage, terrain, clothing, or lighting.
- "Looks fine", "good job", or generic praise is not a reason."""


def parse_verdict(content: Any) -> dict[str, Any] | None:
    """Parse a model reply into ``{"accepted": bool, "reason": str}`` or None.

    Accepts a JSON string (with or without markdown fences) or an already
    decoded dict. Anything missing a boolean ``conforms`` or a non-empty
    ``reason`` is not a verdict.
    """
    data: Any = content
    if isinstance(content, str):
        text = content.strip()
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    conforms = data.get("conforms")
    reason = data.get("reason")
    if not isinstance(conforms, bool):
        return None
    if not isinstance(reason, str) or not reason.strip():
        return None
    return {"accepted": conforms, "reason": reason.strip()}


class OllamaVlmConformanceChecker:
    """Conformance checker backed by a local Ollama vision model.

    ``check`` is async because the adapter's ``chat`` is async; the generator
    awaits an awaitable result, so a synchronous checker also works.
    """

    def __init__(self, adapter: Any, model: str = DEFAULT_CONFORMANCE_MODEL) -> None:
        self.adapter = adapter
        self.model = model

    async def check(
        self, image_ref: str, place_theme: str, scene: dict[str, Any]
    ) -> dict[str, Any] | None:
        try:
            path = Path(image_ref)
            if not path.is_file():
                return None
            raw = path.read_bytes()
        except OSError:
            return None

        prompt = _PROMPT.format(
            place_theme=place_theme,
            section=str(scene.get("section") or "unknown"),
            framing=str(scene.get("framing") or "unknown"),
        )
        image_b64 = base64.b64encode(raw).decode("ascii")
        messages = [{"role": "user", "content": prompt, "images": [image_b64]}]

        try:
            response = self.adapter.chat(messages, model=self.model, format="json")
            if inspect.isawaitable(response):
                response = await response
        except Exception as exc:  # noqa: BLE001 - a failed check is None, never a verdict
            logger.warning("conformance check failed for %s: %s", image_ref, exc)
            return None

        if not isinstance(response, dict):
            return None
        message = response.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        return parse_verdict(content)
