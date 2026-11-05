"""
Bridge registry for third-party tool adapters.

Deprecated shim: ``BridgeRegistry`` and ``bridge_registry`` now alias the
unified :class:`app.adapters.registry.AdapterRegistry` / ``adapter_registry``
singleton. HTTP adapters (ComfyUI, Ollama, Atomic Chat) and bridge adapters
(Unity, Blender) share one registry — see
``app.adapters.adapter_base.AdapterBase`` for the common base class.

This module is kept for backward compatibility. New code should import
``adapter_registry`` directly from ``app.adapters.registry``.

Dependency direction: this module imports only from app.adapters.registry.
"""

from __future__ import annotations

from .registry import AdapterRegistry as BridgeRegistry  # noqa: F401
from .registry import adapter_registry as bridge_registry  # noqa: F401

__all__ = ["BridgeRegistry", "bridge_registry"]
