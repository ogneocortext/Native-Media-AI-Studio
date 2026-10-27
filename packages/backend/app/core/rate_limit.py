"""
Rate limiting middleware for the Native Media AI Studio FastAPI backend.

Implements a token-bucket style rate limiter keyed by client IP.  Designed for
single-worker local deployments (the studio's target).  For multi-worker
production, swap the in-memory store for a Redis-backed limiter such as
`slowapi`.

Configuration via environment variables:
  NMA_RATE_LIMIT_ENABLED  - "1" to enable (default "1")
  NMA_RATE_LIMIT_REQUESTS - requests per window (default 120)
  NMA_RATE_LIMIT_WINDOW   - window in seconds (default 60)
  NMA_RATE_LIMIT_BURST    - burst allowance above the window rate (default 20)

Exempt paths:
  /api/healthz - liveness (always allowed)
  /api/readyz  - readiness (always allowed)
  /api/events  - SSE keepalive (always allowed)
  /docs, /openapi.json - developer tooling (always allowed)
"""

from __future__ import annotations

import os
import time
from collections import defaultdict
from collections.abc import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = __import__("logging").getLogger(__name__)

_RATE_LIMIT_ENABLED = os.getenv("NMA_RATE_LIMIT_ENABLED", "1") == "1"
_RATE_LIMIT_REQUESTS = int(os.getenv("NMA_RATE_LIMIT_REQUESTS", "120"))
_RATE_LIMIT_WINDOW = int(os.getenv("NMA_RATE_LIMIT_WINDOW", "60"))
_RATE_LIMIT_BURST = int(os.getenv("NMA_RATE_LIMIT_BURST", "20"))

# Paths that should never be rate limited (health, SSE keepalive, docs)
_EXEMPT_PATHS = {
    "/api/healthz",
    "/api/readyz",
    "/api/events",
    "/docs",
    "/openapi.json",
    "/favicon.ico",
}

# Client IPs that are never rate limited (loopback for dev/test)
_EXEMPT_IPS = {"127.0.0.1", "localhost", "::1", "unknown"}

# In-memory token buckets: client_ip -> list of request timestamps
# Each entry is a list of timestamps (monotonic) within the current window.
_buckets: dict[str, list[float]] = defaultdict(list)


def _clean_bucket(bucket: list[float], now: float, window: int) -> None:
    """Remove timestamps older than the window from the bucket (in place)."""
    cutoff = now - window
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token-bucket rate limiter keyed by client IP."""

    def __init__(
        self,
        app,
        requests_per_window: int = _RATE_LIMIT_REQUESTS,
        window_seconds: int = _RATE_LIMIT_WINDOW,
        burst: int = _RATE_LIMIT_BURST,
        enabled: bool = _RATE_LIMIT_ENABLED,
    ):
        super().__init__(app)
        self.requests_per_window = requests_per_window
        self.window_seconds = window_seconds
        self.burst = burst
        self.enabled = enabled

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not self.enabled:
            return await call_next(request)

        path = request.url.path
        if path in _EXEMPT_PATHS:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        # Never rate limit loopback/unknown clients (dev, tests, docs)
        if client_ip in _EXEMPT_IPS:
            return await call_next(request)

        now = time.monotonic()

        bucket = _buckets[client_ip]
        _clean_bucket(bucket, now, self.window_seconds)

        # Allow burst above the sustained rate
        max_allowed = self.requests_per_window + self.burst
        if len(bucket) >= max_allowed:
            retry_after = int(self.window_seconds - (now - bucket[0])) + 1
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": "Too many requests. Slow down and try again later.",
                        "retry_after": max(retry_after, 1),
                    }
                },
                headers={"Retry-After": str(max(retry_after, 1))},
            )

        bucket.append(now)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.requests_per_window)
        response.headers["X-RateLimit-Remaining"] = str(max(0, max_allowed - len(bucket)))
        response.headers["X-RateLimit-Reset"] = str(int(now + self.window_seconds))
        return response
