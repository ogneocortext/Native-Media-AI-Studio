"""Adapter registry — unified for HTTP adapters and bridge adapters.

Manages both categories of external-service adapters under one registry:

* HTTP-based API adapters (``app.adapters.base.BaseAdapter``): ComfyUI,
  Ollama, Atomic Chat — long-lived HTTP connections, no subprocess lifecycle.
* Subprocess-based MCP bridge adapters (``app.adapters.bridge_base.BaseBridgeAdapter``):
  Unity, Blender — launched as Node.js subprocesses with start/stop/restart.

Both hierarchies share ``app.adapters.adapter_base.AdapterBase``, so a single
registry can hold either type. ``start_adapter``/``stop_adapter``/``restart_adapter``
only act on adapters that expose those methods (bridge adapters); HTTP adapters
are silently skipped.

Dependency direction: api -> services -> adapters. This module imports only
from sibling adapter modules and app.core.config. It never imports from
app.api or app.services.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .adapter_base import AdapterBase

from ..core.config import config
from .comfyui import ComfyUIAdapter

logger = logging.getLogger(__name__)


class AdapterRegistry:
    """Registry for managing AI adapter instances (HTTP + bridge).

    ComfyUI is initialized eagerly on first ``_ensure_init()`` because it is a
    core dependency. Ollama, Atomic Chat, Unity and Blender are created lazily
    on first ``get_adapter(name)`` call — they are optional dependencies.

    Bridge adapters (Unity, Blender) expose ``start()``/``stop()``/``restart()``
    for subprocess lifecycle. HTTP adapters (ComfyUI, Ollama, Atomic Chat) do
    not; calling ``start_adapter``/``stop_adapter`` on them is a safe no-op.
    """

    def __init__(self):
        self._adapters: dict[str, AdapterBase] = {}
        self._initialized = False
        self._mock_mode = os.getenv("MOCK_GENERATION", "false").lower() == "true"
        self._init_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def _ensure_init(self):
        """Initialize adapters if not already done. Thread-safe.

        ComfyUI is created eagerly as a core dependency. Bridge subprocesses
        (Unity, Blender) are NOT started here — they start on first
        ``start_adapter()`` call or when a caller explicitly invokes
        ``adapter.start()``.
        """
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            # ComfyUI is a core dependency — initialize eagerly.
            self._adapters["comfyui"] = ComfyUIAdapter(
                config.comfyui_url,
                mock_mode=self._mock_mode or not self._is_service_available("comfyui"),
            )
            self._initialized = True

    # ------------------------------------------------------------------
    # Adapter access
    # ------------------------------------------------------------------

    def get_adapter(self, name: str) -> AdapterBase | None:
        """Get an adapter by name, creating it lazily on first access.

        Adapters are created but not started — bridge adapters require an
        explicit ``start_adapter(name)`` call (or ``adapter.start()``) before
        ``execute()`` can be used.

        Args:
            name: Adapter name. One of ``comfyui``, ``ollama``, ``atomic-chat``,
                ``atomic_chat``, ``unity``, ``blender``.

        Returns:
            The adapter instance, or ``None`` if the name is unknown.
        """
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter is None:
            if name == "ollama":
                from .ollama import OllamaAdapter

                adapter = OllamaAdapter(
                    config.ollama_url,
                    mock_mode=False,
                )
                self._adapters["ollama"] = adapter
            elif name in ("atomic-chat", "atomic_chat"):
                from .atomic_chat import AtomicChatAdapter

                adapter = AtomicChatAdapter(
                    config.atomic_chat_url,
                    mock_mode=False,
                )
                self._adapters["atomic-chat"] = adapter
            elif name == "unity":
                from .unity_adapter import UnityAdapter

                adapter = UnityAdapter(mock_mode=self._mock_mode)
                self._adapters["unity"] = adapter
            elif name == "blender":
                from .blender_adapter import BlenderAdapter

                adapter = BlenderAdapter(mock_mode=self._mock_mode)
                self._adapters["blender"] = adapter
        return adapter

    def get(self, name: str) -> AdapterBase | None:
        """Get an adapter by name (alias for get_adapter)."""
        return self.get_adapter(name)

    # ------------------------------------------------------------------
    # Bridge lifecycle (no-op for HTTP adapters)
    # ------------------------------------------------------------------

    async def start_adapter(self, name: str) -> None:
        """Start a specific adapter's subprocess (bridge adapters only).

        HTTP adapters (ComfyUI, Ollama, Atomic Chat) have no subprocess and
        are silently skipped.

        Args:
            name: Adapter name.
        """
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter is None:
            return
        start = getattr(adapter, "start", None)
        if start is not None:
            await start()

    async def stop_adapter(self, name: str) -> None:
        """Stop a specific adapter's subprocess (bridge adapters only)."""
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter is None:
            return
        stop = getattr(adapter, "stop", None)
        if stop is not None:
            await stop()

    async def restart_adapter(self, name: str) -> None:
        """Restart a specific adapter's subprocess (bridge adapters only)."""
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter is None:
            return
        restart = getattr(adapter, "restart", None)
        if restart is not None:
            await restart()

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def _is_service_available(self, service: str) -> bool:
        """Check if a service should be available based on configuration."""
        disabled = os.getenv(f"DISABLED_{service.upper()}", "false").lower() == "true"
        return not disabled

    def get_all_adapters(self) -> dict[str, AdapterBase]:
        """Get all registered adapters."""
        self._ensure_init()
        return self._adapters.copy()

    def get_status_all(self) -> dict[str, str]:
        """Get status of all adapters as a dict of name -> status string."""
        self._ensure_init()
        return {
            name: adapter.get_status().value
            if hasattr(adapter.get_status(), "value")
            else str(adapter.get_status())
            for name, adapter in self._adapters.items()
        }

    def get_status_with_errors(self) -> dict[str, dict]:
        """Get status of all adapters with error details."""
        self._ensure_init()
        result: dict[str, dict] = {}
        for name, adapter in self._adapters.items():
            status = (
                adapter.get_status().value
                if hasattr(adapter.get_status(), "value")
                else str(adapter.get_status())
            )
            error = None
            if hasattr(adapter, "get_last_error"):
                error = adapter.get_last_error()
            result[name] = {
                "status": status,
                "error": error,
                "url": getattr(adapter, "base_url", None),
            }
        return result

    async def check_all_health(self) -> dict[str, bool]:
        """Check health status of all adapters."""
        self._ensure_init()
        health_status: dict[str, bool] = {}
        for name, adapter in self._adapters.items():
            try:
                is_healthy = await adapter.health_check()
                health_status[name] = is_healthy
            except Exception:
                health_status[name] = False
        return health_status

    async def close_all(self):
        """Close all adapter sessions/subprocesses (cleanup)."""
        for adapter in self._adapters.values():
            await self._close_one(adapter)
        self._adapters.clear()
        self._initialized = False

    async def _close_one(self, adapter: Any) -> None:
        """Close a single adapter, logging but never raising on failure."""
        if not hasattr(adapter, "close"):
            return
        try:
            await adapter.close()
        except Exception:
            logger.warning(
                "adapter.close_failed", adapter=getattr(adapter, "name", "?")
            )

    def set_mock_mode(self, *, enabled: bool):
        """Enable or disable mock mode for all adapters.

        Requires re-initialization to take effect.
        """
        self._mock_mode = enabled
        self._initialized = False
        self._adapters = {}

    def is_mock_mode(self) -> bool:
        """Check if running in mock mode."""
        return self._mock_mode


# Global registry instance — shared by HTTP routes, diagnostics, health
# monitoring, idle monitor, and shutdown. Formerly split into
# ``app.adapters.registry.adapter_registry`` and ``app.adapters.bridge_registry
# .bridge_registry``; both names now point to the same instance.
adapter_registry = AdapterRegistry()
