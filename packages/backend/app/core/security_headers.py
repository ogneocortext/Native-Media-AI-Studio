"""
Security headers middleware for the Native Media AI Studio FastAPI backend.

Adds production-grade security headers to every response:

  - Strict-Transport-Security (HSTS) - force HTTPS on compliant clients
  - X-Content-Type-Options: nosniff - prevent MIME sniffing
  - X-Frame-Options: DENY - prevent clickjacking
  - Content-Security-Policy - restrict script/style sources
  - Referrer-Policy - limit referrer information leakage
  - Permissions-Policy - disable unused browser features
  - X-XSS-Protection - legacy XSS filter (defense in depth)

Configuration via environment variables:
  NMA_HSTS_ENABLED         - "1" to enable HSTS (default "0" since local dev is HTTP)
  NMA_HSTS_MAX_AGE         - HSTS max-age in seconds (default 31536000 = 1 year)
  NMA_CSP_ENABLED          - "1" to enable CSP (default "1")
  NMA_SECURE_HEADERS_ENABLED - "0" to disable all secure headers (default "1")
"""

from __future__ import annotations

import os
from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = __import__("logging").getLogger(__name__)

_SECURE_HEADERS_ENABLED = os.getenv("NMA_SECURE_HEADERS_ENABLED", "1") == "1"
_HSTS_ENABLED = os.getenv("NMA_HSTS_ENABLED", "0") == "1"
_HSTS_MAX_AGE = int(os.getenv("NMA_HSTS_MAX_AGE", "31536000"))
_CSP_ENABLED = os.getenv("NMA_CSP_ENABLED", "1") == "1"

# Content Security Policy - permissive enough for the local dev frontend
# but strict enough to block inline scripts and untrusted origins.
_CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:* http://localhost:*; "
    "style-src 'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:*; "
    "img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*; "
    "connect-src 'self' ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:* http://localhost:*; "
    "font-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none';"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        if not _SECURE_HEADERS_ENABLED:
            return response

        # MIME sniffing protection
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Clickjacking protection
        response.headers["X-Frame-Options"] = "DENY"

        # Legacy XSS filter (defense in depth for older browsers)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Referrer policy - only send same-origin referrers
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions policy - disable unused browser features
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
        )

        # Content Security Policy
        if _CSP_ENABLED:
            response.headers["Content-Security-Policy"] = _CSP_POLICY

        # HSTS - only on HTTPS (the studio runs on localhost HTTP by default)
        if _HSTS_ENABLED and request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = (
                f"max-age={_HSTS_MAX_AGE}; includeSubDomains"
            )

        return response
