"""
Adapters for external services.

Adapter modules wrap third-party APIs (Ollama, ComfyUI, Atomic Chat) and
third-party tool bridges (Unity MCP, Blender MCP). They isolate vendor-specific
API changes so that services and API endpoints remain unchanged when a vendor
updates their protocol.

Dependency direction: api -> services -> adapters. Adapters never import
from app.api or app.services.
"""

from .base import AdapterStatus, BaseAdapter
from .blender_adapter import BlenderAdapter
from .bridge_base import BaseBridgeAdapter
from .unity_adapter import UnityAdapter

__all__ = [
    "AdapterStatus",
    "BaseAdapter",
    "BaseBridgeAdapter",
    "UnityAdapter",
    "BlenderAdapter",
]
