"""
Ollama model management mixin.

Provides list/pull/delete model operations and default-model accessors
for OllamaAdapter. Extracted from ollama_adapter.py to keep each module
focused on a single responsibility.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)


class OllamaModelMixin:
    """Mixin for Ollama model lifecycle operations.

    Intended to be mixed into ``OllamaAdapter`` alongside
    ``OllamaToolsMixin`` and ``BaseAdapter``.
    """

    # ------------------------------------------------------------------
    # Model lifecycle
    # ------------------------------------------------------------------

    async def list_models(self) -> list[dict[str, Any]]:
        """List available models in Ollama."""
        try:
            session = await self._get_session()
            async with session.get(f"{self.base_url}/api/tags") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self._available_models = [m["name"] for m in data.get("models", [])]
                    return data.get("models", [])
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to list models: {e}")
        return []

    async def pull_model(self, name: str) -> bool:
        """Pull a model from Ollama registry."""
        try:
            session = await self._get_session()
            async with session.post(
                f"{self.base_url}/api/pull",
                json={"model": name},
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                return resp.status == 200
        except Exception:  # noqa: BLE001
            return False

    async def delete_model(self, name: str) -> bool:
        """Delete a model from Ollama (reuses the shared instance session)."""
        try:
            session = await self._get_session()
            async with session.delete(f"{self.base_url}/api/delete", json={"model": name}) as resp:
                return resp.status == 200
        except Exception:  # noqa: BLE001
            return False

    # ------------------------------------------------------------------
    # Default model accessors
    # ------------------------------------------------------------------

    def set_default_model(self, model: str) -> None:
        """Set the default model for generation."""
        self._default_model = model

    def get_default_model(self) -> str:
        """Get the default model."""
        return self._default_model

    def get_available_models(self) -> list[str]:
        """Get list of available models from last refresh."""
        return self._available_models.copy()

    # ------------------------------------------------------------------
    # Tool capability
    # ------------------------------------------------------------------

    def _supports_tools(self, model: str) -> bool:
        from ..core.ollama_client import is_tool_capable_model

        return is_tool_capable_model(model)
