"""Adapter registry."""
import os
import threading

from ..core.config import config
from .base import BaseAdapter
from .comfyui import ComfyUIAdapter


class AdapterRegistry:
    """Registry for managing AI adapter instances."""

    def __init__(self):
        self._adapters: dict[str, BaseAdapter] = {}
        self._initialized = False
        self._mock_mode = os.getenv("MOCK_GENERATION", "false").lower() == "true"
        self._init_lock = threading.Lock()

    def _ensure_init(self):
        """Initialize adapters if not already done. Thread-safe."""
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            # Initialize with mock mode based on env var or forced setting
            self._adapters["comfyui"] = ComfyUIAdapter(
                config.comfyui_url,
                mock_mode=self._mock_mode or not self._is_service_available("comfyui")
            )
            # Ollama is optional — only initialize when explicitly requested
            # via get_adapter("ollama"). It's an added bonus for agentic
            # creative work, not a core dependency.
            self._initialized = True

    def get_adapter(self, name: str) -> BaseAdapter | None:
        """Get an adapter by name.

        Ollama and Atomic Chat are lazily initialized on first request — they
        are optional dependencies for agentic creative work, not core
        requirements.
        """
        self._ensure_init()
        adapter = self._adapters.get(name)
        if adapter is None and name == "ollama":
            # Lazily create Ollama adapter on first request
            from .ollama import OllamaAdapter
            adapter = OllamaAdapter(
                config.ollama_url,
                mock_mode=False,
            )
            self._adapters["ollama"] = adapter
        elif adapter is None and name in ("atomic-chat", "atomic_chat"):
            # Lazily create Atomic Chat adapter on first request
            from .atomic_chat import AtomicChatAdapter
            adapter = AtomicChatAdapter(
                config.atomic_chat_url,
                mock_mode=False,
            )
            self._adapters["atomic-chat"] = adapter
        return adapter

    def _is_service_available(self, service: str) -> bool:
        """Check if a service should be available based on configuration."""
        # Check for DISABLED_ env vars
        disabled = os.getenv(f"DISABLED_{service.upper()}", "false").lower() == "true"
        return not disabled

    def set_mock_mode(self, enabled: bool):
        """Enable or disable mock mode for all adapters."""
        self._mock_mode = enabled
        # Reinitialize adapters with new mock mode
        self._initialized = False
        self._adapters = {}

    def is_mock_mode(self) -> bool:
        """Check if running in mock mode"""
        return self._mock_mode

    def get(self, name: str) -> BaseAdapter | None:
        """Get an adapter by name (alias for get_adapter)."""
        return self.get_adapter(name)

    def get_all_adapters(self) -> dict[str, BaseAdapter]:
        """Get all registered adapters."""
        self._ensure_init()
        return self._adapters.copy()

    def get_status_all(self) -> dict[str, str]:
        """Get status of all adapters as a dict of name -> status string."""
        self._ensure_init()
        return {
            name: adapter.get_status().value if hasattr(adapter.get_status(), 'value') else str(adapter.get_status())
            for name, adapter in self._adapters.items()
        }

    def get_status_with_errors(self) -> dict[str, dict]:
        """Get status of all adapters with error details."""
        self._ensure_init()
        result = {}
        for name, adapter in self._adapters.items():
            status = adapter.get_status().value if hasattr(adapter.get_status(), 'value') else str(adapter.get_status())
            error = None
            if hasattr(adapter, 'get_last_error'):
                error = adapter.get_last_error()
            result[name] = {"status": status, "error": error, "url": adapter.base_url}
        return result

    async def check_all_health(self) -> dict[str, bool]:
        """Check health status of all adapters."""
        self._ensure_init()
        health_status = {}
        for name, adapter in self._adapters.items():
            try:
                is_healthy = await adapter.health_check()
                health_status[name] = is_healthy
            except Exception:
                health_status[name] = False
        return health_status

    async def close_all(self):
        """Close all adapter sessions (cleanup)."""
        for adapter in self._adapters.values():
            if hasattr(adapter, 'close'):
                await adapter.close()
        self._adapters.clear()
        self._initialized = False


# Global registry instance
adapter_registry = AdapterRegistry()
