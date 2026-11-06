"""
Adapters for external services.

Adapter modules wrap third-party APIs (Ollama, ComfyUI, Atomic Chat) and
third-party tool bridges (Unity MCP, Blender MCP). They isolate vendor-specific
API changes so that services and API endpoints remain unchanged when a vendor
updates their protocol.

Dependency direction: api -> services -> adapters. Adapters never import
from app.api or app.services.
"""

from .adapter_base import AdapterBase, AdapterStatus
from .atomic_chat import AtomicChatAdapter
from .base import BaseAdapter
from .blender_adapter import BlenderAdapter
from .bridge_base import BaseBridgeAdapter
from .bridge_registry import BridgeRegistry, bridge_registry
from .comfyui import ComfyUIAdapter
from .music_gen import MusicGenAdapter
from .ollama import OllamaAdapter, OllamaModelMixin, OllamaToolsMixin
from .registry import AdapterRegistry, adapter_registry
from .unity_adapter import UnityAdapter

__all__ = [
    "AdapterStatus",
    "BaseAdapter",
    "BaseBridgeAdapter",
    "BridgeRegistry",
    "bridge_registry",
    "AdapterRegistry",
    "adapter_registry",
    "UnityAdapter",
    "BlenderAdapter",
    "AtomicChatAdapter",
    "ComfyUIAdapter",
    "MusicGenAdapter",
    "OllamaAdapter",
    "OllamaModelMixin",
    "OllamaToolsMixin",
    "AdapterBase",
]
