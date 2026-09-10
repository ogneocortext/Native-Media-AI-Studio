"""
Shared CORS utilities for the backend.

Centralizes the local-origin allowlist so it cannot drift between the
global CORSMiddleware (``app.main``) and per-endpoint CORS headers
(e.g. ``api.audio``).
"""

from __future__ import annotations

from typing import FrozenSet

from .config import config


def get_local_origins() -> FrozenSet[str]:
    """Return the set of trusted local origins for CORS.

    The set is built from the configured ports plus common dev-server
    ports so both the middleware and manual header helpers stay in sync.
    """
    frontend = config.frontend_port
    backend = config.backend_port
    return frozenset({
        f"http://127.0.0.1:{frontend}",
        f"http://127.0.0.1:{backend}",
        # Common dev-server fallbacks
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5174",
    })


def is_local_origin(origin: str) -> bool:
    """Check whether *origin* is in the trusted local allowlist."""
    return origin in get_local_origins()
