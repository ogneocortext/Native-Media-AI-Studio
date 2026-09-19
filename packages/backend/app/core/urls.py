"""
URL helpers for backend services.

Centralizes all service URL construction so callers never hardcode
``127.0.0.1`` or ``localhost`` inline. Every URL is derived from
``core.config.config`` or the caller's explicit override.
"""

from __future__ import annotations

from .config import config


def backend_url(path: str = "", port: int | None = None) -> str:
    """Base URL for the backend API.

    ``port`` overrides the configured backend port. Callers that resolve a
    dynamic port at runtime (e.g. :class:`~app.core.port_manager.PortManager`
    falling back from 8000 to 8001) must pass it, otherwise the URL would
    advertise the configured port while the server listens on the resolved one.
    """
    resolved_port = config.backend_port if port is None else port
    base = f"http://127.0.0.1:{resolved_port}"
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def backend_events_url(port: int | None = None) -> str:
    """Canonical SSE events URL for the given (or configured) backend port."""
    resolved_port = config.backend_port if port is None else port
    return f"http://127.0.0.1:{resolved_port}/api/events"


def backend_ws_url(port: int | None = None) -> str:
    """Legacy WebSocket URL (compat shim) for the given (or configured) port."""
    resolved_port = port if port is not None else getattr(config, "ws_port", config.backend_port)
    return f"ws://127.0.0.1:{resolved_port}/ws"


def comfyui_url(path: str = "") -> str:
    """ComfyUI base URL, optionally with a path appended."""
    base = config.comfyui_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def ollama_url(path: str = "") -> str:
    """Ollama base URL, optionally with a path appended."""
    base = config.ollama_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def atomic_chat_url(path: str = "") -> str:
    """Atomic chat service URL, optionally with a path appended."""
    base = config.atomic_chat_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def go_dashboard_url(path: str = "") -> str:
    """Go dashboard URL, optionally with a path appended."""
    base = config.go_dashboard_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def go_media_url(path: str = "") -> str:
    """Go media worker URL, optionally with a path appended."""
    base = config.go_media_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def go_worker_url(path: str = "") -> str:
    """Go worker URL, optionally with a path appended."""
    base = config.go_worker_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def go_gateway_url(path: str = "") -> str:
    """Go gateway URL, optionally with a path appended."""
    base = config.go_gateway_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def go_ports_url(path: str = "") -> str:
    """Go ports checker URL, optionally with a path appended."""
    base = config.go_ports_url
    if not path:
        return base
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def video_editor_url() -> str:
    """Remotion video editor studio URL."""
    port = getattr(config, "video_editor_port", 8080)
    return f"http://127.0.0.1:{port}"


def dashboard_url() -> str:
    """Go dashboard URL (legacy alias for go_dashboard_url)."""
    return go_dashboard_url()


# Backwards-compat aliases used by a few existing modules.
get_backend_url = backend_url
get_events_url = backend_events_url
get_ws_url = backend_ws_url
get_comfyui_url = comfyui_url
get_ollama_url = ollama_url
get_video_editor_url = video_editor_url
