"""
Shared CORS utilities for the backend.

Centralizes the local-origin allowlist so it cannot drift between the
global CORSMiddleware (``app.main``) and per-endpoint CORS headers
(e.g. ``api.audio``).

When a public tunnel (ngrok / Cloudflare Tunnel / localtunnel) is active,
the tunnel origin can be injected via the ``PUBLIC_ORIGIN`` environment
variable so that a sandbox VM or remote agent can reach the API while the
local origin allowlist stays intact.
"""
from __future__ import annotations

import os
import re

from .config import config


def get_local_origins() -> frozenset[str]:
    """Return the set of trusted local origins for CORS.

    The set is built from the configured ports plus common dev-server
    ports so both the middleware and manual header helpers stay in sync.
    """
    frontend = config.frontend_port
    backend = config.backend_port
    origins = {
        f"http://127.0.0.1:{frontend}",
        f"http://127.0.0.1:{backend}",
        f"http://localhost:{frontend}",
        f"http://localhost:{backend}",
    }
    # Include well-known dev-server fallbacks without double-counting.
    for fallback in (5173, 5174, 3000, 8080):
        origins.add(f"http://127.0.0.1:{fallback}")
        origins.add(f"http://localhost:{fallback}")
    return frozenset(origins)


def get_public_origins() -> frozenset[str]:
    """Return optional public origins for CORS from environment.

    Set ``PUBLIC_ORIGIN`` to a single URL or ``PUBLIC_ORIGINS`` to a
    comma-separated list.  Typical value when using ngrok:
    ``https://<random>.ngrok-free.app``.
    """
    origins: set[str] = set()
    raw = os.getenv("PUBLIC_ORIGIN") or os.getenv("PUBLIC_ORIGINS", "")
    for item in raw.split(","):
        item = item.strip()
        if item:
            origins.add(item)
    return frozenset(origins)


def get_all_origins() -> frozenset[str]:
    """Local + public origins.  Used by CORSMiddleware."""
    return get_local_origins() | get_public_origins()


# Public tunnel providers whose hostnames are randomized per tunnel start, so
# they can never be enumerated in ``allow_origins``.  ``is_origin_allowed``
# already treats them as trusted; CORSMiddleware needs the equivalent regex or
# every preflight from a sandbox VM agent fails with 400 and no
# Access-Control-Allow-Origin header.
_TUNNEL_HOST_PATTERNS = (
    r"[a-z0-9-]+\.loca\.lt",        # localtunnel
    r"[a-z0-9-]+\.ngrok-free\.app",  # ngrok (free tier)
    r"[a-z0-9-]+\.ngrok\.app",
    r"[a-z0-9-]+\.ngrok\.io",
    r"[a-z0-9-]+\.ngrok-free\.dev",
    r"[a-z0-9-]+\.trycloudflare\.com",  # Cloudflare Tunnel
    r"[a-z0-9-]+\.serveo\.net",         # serveo
)


def get_public_origin_regex() -> str:
    """Return a regex matching any trusted public tunnel origin.

    Includes the explicitly configured ``PUBLIC_ORIGIN``/``PUBLIC_ORIGINS``
    entries so a custom tunnel domain works without a code change.
    """
    parts = [rf"https?://{host}" for host in _TUNNEL_HOST_PATTERNS]
    for origin in get_public_origins():
        # Escape the scheme/host but keep it matchable as a full origin.
        parts.append(re.escape(origin.rstrip("/")))
    if not parts:
        # Never return an empty regex: an empty string matches everything.
        return r"^$"
    return r"^(?:" + "|".join(parts) + r")$"


def is_local_origin(origin: str) -> bool:
    """Check whether *origin* is in the trusted local allowlist."""
    return origin in get_local_origins()


def is_origin_allowed(origin: str) -> bool:
    """Check whether *origin* is allowed for CORS.

    Local origins and explicitly configured public origins are always
    allowed.  In addition, any ``*.loca.lt`` origin is allowed so localtunnel
    restarts don't require a backend restart.
    """
    if origin in get_local_origins() or origin in get_public_origins():
        return True
    if origin.endswith(".loca.lt"):
        return True
    return False
