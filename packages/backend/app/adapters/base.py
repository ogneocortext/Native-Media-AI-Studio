"""
Base adapter interface for external AI services.

Extends :class:`app.services.adapters.adapter_base.AdapterBase` with
HTTP-specific functionality: base URL, generate/repair methods, and the
``generate_with_fallback`` convenience method.

Dependency direction: api -> services -> adapters. This module imports
only from sibling adapter modules and app.core.http.
"""

from __future__ import annotations

import logging
from abc import abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

from .adapter_base import AdapterBase, AdapterStatus, _handle_adapter_error  # noqa: F401  # type: ignore[reportUnusedImport]

logger = logging.getLogger(__name__)


class BaseAdapter(AdapterBase):
    """
    Base class for service adapters.

    Extends :class:`~app.services.adapters.adapter_base.AdapterBase`
    with HTTP-specific concerns: base URL, generate/repair methods, and
    the ``generate_with_fallback`` convenience method.

    Subclasses implement ``get_vram_status`` (or equivalent health check)
    and ``generate`` (the actual generation logic).
    """

    def __init__(self, base_url: str, name: str, *, mock_mode: bool = False):
        """
        Initialize the adapter.

        Args:
            base_url: Base URL for the external service
            name: Human-readable name for this adapter
            mock_mode: If True, skip service checks and use mock directly
        """
        self.base_url = base_url.rstrip("/") if not mock_mode else "mock://internal"
        super().__init__(name=name, mock_mode=mock_mode)

    @abstractmethod
    async def health_check(self) -> bool:
        """
        Check if the service is available.

        Returns:
            True if the service is reachable and healthy
        """

    @abstractmethod
    async def generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate content with given parameters.

        Args:
            params: Dictionary of generation parameters

        Returns:
            Dictionary containing at minimum:
            - image: base64 encoded image (for image adapters)
            - seed: generation seed used
            - info: additional info about the generation
        """

    @abstractmethod
    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Mock generation for testing without external service.

        This method should return realistic mock data that matches
        the format of the real generate() method output.

        Args:
            params: Dictionary of generation parameters

        Returns:
            Mock response matching the real generate() method output format
        """

    async def generate_with_fallback(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate content -- fails fast when service unavailable unless mock_mode=True.

        Previous behavior silently returned a 1x1 mock PNG when ComfyUI was down,
        masking failures. Per user request to replace mocks with functioning features,
        we now surface the real error so the UI can show it.
        """
        if self._mock_mode:
            logger.info(f"{self.name}: Running in mock mode (explicit)")
            return await self._mock_generate(params)

        # Require real service to be healthy
        healthy = await self.health_check()
        if not healthy:
            self.set_status(AdapterStatus.OFFLINE)
            raise RuntimeError(
                f"{self.name} unavailable at {self.base_url}. "
                f"Start the service or set MOCK_GENERATION=true for placeholder output."
            )

        try:
            result = await self.generate(params)
            self.record_activity()
            self.set_status(AdapterStatus.AVAILABLE)
            return result
        except Exception as e:
            self.set_status(AdapterStatus.ERROR)
            logger.error("%s: Real service failed: %s", self.name, e)
            raise

    async def repair(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Repair model output against available sources.

        Subclasses override this to validate and repair model-generated
        recipes against available sources. Returns a tuple of
        ``(recipe, warnings)`` where ``warnings`` lists every repair made
        so nothing is silent.
        """
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Activity tracking (stubs -- subclasses like OllamaAdapter/AtomicChatAdapter
    # override with real implementations)
    # ------------------------------------------------------------------

    def set_activity(
        self,
        model: str,
        task: str = "generate",
        description: str = "",
        timeout: float = 180,
    ) -> None:
        """Register that a model is actively processing a task."""
        return None

    def clear_activity(self, model: str) -> None:
        """Mark a model's current task as complete."""
        return None

    def get_activity(self) -> dict[str, dict[str, Any]]:
        """Get all currently active tasks."""
        return {}

    # ------------------------------------------------------------------
    # Tool definitions (stub -- OllamaAdapter overrides)
    # ------------------------------------------------------------------

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Return the built-in tool definitions for this adapter."""
        return []

    # ------------------------------------------------------------------
    # Chat (stub -- OllamaAdapter/AtomicChatAdapter override)
    # ------------------------------------------------------------------

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        *,
        stream: bool = False,
        think: bool | str | None = None,
        format: Any | None = None,
        keep_alive: str | int | None = None,
        **kwargs: Any,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """Chat completion with tool calling support."""
        raise NotImplementedError(f"{self.name} does not support chat")

    # ------------------------------------------------------------------
    # Tool execution (stub -- OllamaAdapter overrides)
    # ------------------------------------------------------------------

    async def execute_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        tools_config: dict[str, Any],
    ) -> str:
        """Execute a tool call and return the result."""
        raise NotImplementedError(f"{self.name} does not support tool execution")

    # ------------------------------------------------------------------
    # Submit-only (stub -- ComfyUIAdapter overrides)
    # ------------------------------------------------------------------

    async def submit_only(self, params: dict[str, Any]) -> str:
        """Submit a generation job and return the prompt id immediately."""
        raise NotImplementedError(f"{self.name} does not support submit_only")
