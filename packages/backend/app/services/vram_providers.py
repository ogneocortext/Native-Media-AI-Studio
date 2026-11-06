"""
VRAM model provider registration and resolution.

Extracted from vram_manager.py. Provides the composition-root pattern for
answering "which model did Ollama/Atomic Chat last load?" without importing
adapters.ollama (which would re-create the last import cycle in the codebase).

Wired once in `main.py` via set_last_model_provider / set_queue_provider /
set_last_atomic_chat_model_provider.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

#: Set by `set_last_model_provider`. Answers "which model did Ollama last
#: load?" without this module importing `adapters.ollama` - that import closed
#: the last cycle in the codebase:
#:   services.vram_manager -> adapters.ollama -> queue.manager
#:   -> diagnostics.resources -> services.vram_manager
#: It was open 4 times as a deferred import, each also re-reading a *private*
#: attribute (`_last_model`) across a module boundary and re-implementing the
#: same "llama" sanitisation. Wired once in `main.py`.
_LAST_MODEL_PROVIDER: Callable[[], str | None] | None = None


def set_last_model_provider(provider: Callable[[], str | None] | None) -> None:
    """Register the source of "last loaded Ollama model"."""
    global _LAST_MODEL_PROVIDER
    _LAST_MODEL_PROVIDER = provider


#: Set by `set_last_atomic_chat_model_provider`. Answers "which model did
#: Atomic Chat last load into VRAM?" Atomic Chat is a separate desktop app
#: that wraps Ollama on port 1337; it loads its own model (e.g. qwen3.5) into
#: the same 8 GB VRAM that Ollama uses. Without tracking this, the VRAM
#: manager can offload Ollama's model while Atomic Chat's qwen3.5 stays
#: resident, then reload Ollama's model on top -- OOM on an 8 GB card.
#: Wired once in `main.py`, same composition-root pattern as above.
_LAST_ATOMIC_CHAT_MODEL_PROVIDER: Callable[[], str | None] | None = None


def set_last_atomic_chat_model_provider(provider: Callable[[], str | None] | None) -> None:
    """Register the source of "last loaded Atomic Chat model"."""
    global _LAST_ATOMIC_CHAT_MODEL_PROVIDER
    _LAST_ATOMIC_CHAT_MODEL_PROVIDER = provider


def _resolve_last_model(default: str | None) -> str | None:
    """Last loaded Ollama model, or `default` when unknown/unavailable.

    Never raises: a missing or broken provider must not stop a VRAM reload, so
    failures fall back to the default rather than propagating.
    """
    if _LAST_MODEL_PROVIDER is None:
        return default
    try:
        value = _LAST_MODEL_PROVIDER()
    except Exception as exc:
        logger.debug("last-model provider unavailable: %s", exc)
        return default
    return value or default


def _resolve_ollama_model(default_model: str) -> str:
    """Resolve and sanitize the last Ollama model name.

    If the last model is a llama variant that isn't the default, fall back to
    the default. Keeps the reload call sites flat (no extra if inside try).
    """
    last_model = _resolve_last_model(default_model)
    if "llama" in last_model.lower() and last_model != default_model:
        last_model = default_model
    return last_model


def _resolve_atomic_chat_model(default: str | None) -> str | None:
    """Last loaded Atomic Chat model, or `default` when unknown/unavailable.

    Same contract as `_resolve_last_model` but for Atomic Chat's model.
    """
    if _LAST_ATOMIC_CHAT_MODEL_PROVIDER is None:
        return default
    try:
        value = _LAST_ATOMIC_CHAT_MODEL_PROVIDER()
    except Exception as exc:
        logger.debug("atomic-chat model provider unavailable: %s", exc)
        return default
    return value or default


__all__ = [
    "_LAST_MODEL_PROVIDER",
    "_LAST_ATOMIC_CHAT_MODEL_PROVIDER",
    "set_last_model_provider",
    "set_last_atomic_chat_model_provider",
    "_resolve_last_model",
    "_resolve_ollama_model",
    "_resolve_atomic_chat_model",
]
