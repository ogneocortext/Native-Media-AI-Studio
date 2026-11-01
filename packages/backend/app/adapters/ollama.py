"""
Ollama adapter — re-export shim.

The Ollama adapter has been split into focused modules:
- ``ollama_adapter``  - core adapter (connection, generate, chat, health)
- ``ollama_tools``    - tool definitions and implementations
- ``ollama_models``   - model lifecycle (list/pull/delete/default)

This module re-exports ``OllamaAdapter`` for backward compatibility.
New code should import directly from the focused modules.
"""

from .ollama_adapter import OllamaAdapter
from .ollama_models import OllamaModelMixin
from .ollama_tools import OllamaToolsMixin

__all__ = ["OllamaAdapter", "OllamaModelMixin", "OllamaToolsMixin"]
