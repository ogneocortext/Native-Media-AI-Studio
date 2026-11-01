"""
Bridge registry for third-party tool adapters.

Manages lifecycle and discovery of bridge adapters (Unity, Blender, etc.)
that run as subprocesses communicating via MCP/CLI interfaces.

Separate from ``app.adapters.registry`` (which manages HTTP-based API
adapters like Ollama, ComfyUI, Atomic Chat) because bridge adapters have
a different lifecycle model (subprocess management vs. HTTP connection).

Dependency direction: this module imports only from app.adapters.bridge_base
and app.adapters.unity_adapter / app.adapters.blender_adapter. It never
imports from app.api or app.services.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .bridge_base import BaseBridgeAdapter

from .blender_adapter import BlenderAdapter
from .unity_adapter import UnityAdapter

logger = logging.getLogger(__name__)


class BridgeRegistry:
    """Registry for managing bridge adapter instances.

    Bridge adapters wrap third-party tools (Unity Editor, Blender, etc.)
    that run as separate processes. The registry handles lazy
    initialization, lifecycle management, and health monitoring.

    Dependency direction: this module imports only from app.adapters.* --
    never from app.api or app.services.
    """

    def __init__(self):
        self._adapters: dict[str, BaseBridgeAdapter] = {}
        self._initialized = False
        self._init_lock = threading.Lock()
        self._mock_mode = os.getenv("MOCK_GENERATION", "false").lower() == "true"

    def _ensure_init(self):
        """Initialize adapters if not already done. Thread-safe."""
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            # Initialize bridge adapters lazily -- they are started on
            # first use via get_adapter(), not at import time.
            self._initialized = True

    def get_adapter(self, name: str) -> BaseBridgeAdapter | None:
        """Get a bridge adapter by name, creating it lazily on first access.

        Adapters are created but not started -- ``start()`` must be called
        explicitly before ``execute()`` can be used.

        Args:
            name: Adapter name (``"unity"`` or ``"blender"``).

        Returns:
            The adapter instance, or ``None`` if the name is unknown.
        """
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter is None and name == "unity":
            adapter = UnityAdapter(mock_mode=self._mock_mode)
            self._adapters["unity"] = adapter
        elif adapter is None and name == "blender":
            adapter = BlenderAdapter(mock_mode=self._mock_mode)
            self._adapters["blender"] = adapter
        return adapter

    def get(self, name: str) -> BaseBridgeAdapter | None:
        """Get a bridge adapter by name (alias for get_adapter)."""
        return self.get_adapter(name)

    def get_all_adapters(self) -> dict[str, BaseBridgeAdapter]:
        """Get all initialized bridge adapters."""
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
        result = {}
        for name, adapter in self._adapters.items():
            status = (
                adapter.get_status().value
                if hasattr(adapter.get_status(), "value")
                else str(adapter.get_status())
            )
            error = None
            if hasattr(adapter, "get_last_error"):
                error = adapter.get_last_error()
            result[name] = {"status": status, "error": error}
        return result

    async def check_all_health(self) -> dict[str, bool]:
        """Check health status of all initialized adapters."""
        self._ensure_init()
        health_status = {}
        for name, adapter in self._adapters.items():
            try:
                is_healthy = await adapter.health_check()
                health_status[name] = is_healthy
            except Exception:
                health_status[name] = False
        return health_status

    async def start_adapter(self, name: str) -> None:
        """Start a specific adapter's subprocess.

        Args:
            name: Adapter name.
        """
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter:
            await adapter.start()

    async def stop_adapter(self, name: str) -> None:
        """Stop a specific adapter's subprocess.

        Args:
            name: Adapter name.
        """
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter:
            await adapter.stop()

    async def restart_adapter(self, name: str) -> None:
        """Restart a specific adapter's subprocess.

        Args:
            name: Adapter name.
        """
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter:
            await adapter.restart()

    async def close_all(self):
        """Close all adapter subprocesses and sessions (cleanup)."""
        for adapter in self._adapters.values():
            if hasattr(adapter, "close"):
                await adapter.close()
        self._adapters.clear()
        self._initialized = False

    def set_mock_mode(self, *, enabled: bool):
        """Enable or disable mock mode for all adapters.

        Requires re-initialization to take effect.
        """
        self._mock_mode = enabled
        self._initialized = False
        self._adapters = {}

    def is_mock_mode(self) -> bool:
        """Check if mock mode is enabled."""
        return self._mock_mode


# Global registry instance
bridge_registry = BridgeRegistry()
