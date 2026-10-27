"""
Prometheus RED metrics middleware for the Native Media AI Studio FastAPI backend.

Exposes Rate, Errors, Duration metrics for all HTTP endpoints via a
``/metrics`` endpoint.  Uses the ``prometheus_client`` package when available;
falls back to a simple in-memory counter/histogram implementation so the
module imports cleanly even without the dependency installed.

Configuration via environment variables:
  NMA_METRICS_ENABLED   - "1" to enable metrics endpoint (default "1")
  NMA_METRICS_PATH      - metrics endpoint path (default "/metrics")
  NMA_METRICS_BUCKETS   - comma-separated latency buckets in seconds
                          (default "0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10")
"""

from __future__ import annotations

import os
import time
from collections import defaultdict
from collections.abc import Callable

from fastapi import Request, Response
from fastapi.responses import PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = __import__("logging").getLogger(__name__)

_METRICS_ENABLED = os.getenv("NMA_METRICS_ENABLED", "1") == "1"
_METRICS_PATH = os.getenv("NMA_METRICS_PATH", "/metrics")
_DEFAULT_BUCKETS = "0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10"
_BUCKETS = tuple(
    float(b.strip()) for b in os.getenv("NMA_METRICS_BUCKETS", _DEFAULT_BUCKETS).split(",")
)

# Try to use prometheus_client; fall back to a minimal in-memory implementation.
try:
    from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

    _HAS_PROMETHEUS = True
except Exception:  # prometheus_client not installed
    _HAS_PROMETHEUS = False

    class _Counter:
        def __init__(self, name, documentation, labelnames=()):
            self._name = name
            self._docs = documentation
            self._labelnames = labelnames
            self._values: dict[tuple, int] = defaultdict(int)

        def labels(self, **kwargs):
            key = tuple(kwargs.get(ln, "") for ln in self._labelnames)
            return self._CounterLabel(self, key)

        class _CounterLabel:
            def __init__(self, counter, key):
                self._counter = counter
                self._key = key

            def inc(self, amount=1):
                self._counter._values[self._key] += amount

    class _Histogram:
        def __init__(self, name, documentation, labelnames=(), buckets=()):
            self._name = name
            self._docs = documentation
            self._labelnames = labelnames
            self._buckets = buckets
            self._counts: dict[tuple, int] = defaultdict(int)
            self._sums: dict[tuple, float] = defaultdict(float)

        def labels(self, **kwargs):
            key = tuple(kwargs.get(ln, "") for ln in self._labelnames)
            return self._HistogramLabel(self, key)

        class _HistogramLabel:
            def __init__(self, histogram, key):
                self._histogram = histogram
                self._key = key

            def observe(self, amount):
                self._histogram._counts[self._key] += 1
                self._histogram._sums[self._key] += amount

    def generate_latest():
        """Minimal Prometheus text exposition format."""
        lines: list[str] = []
        # This is a simplified fallback; install prometheus_client for full output.
        lines.append("# HELP nma_http_requests_total Total HTTP requests")
        lines.append("# TYPE nma_http_requests_total counter")
        lines.append("# HELP nma_http_request_duration_seconds HTTP request latency")
        lines.append("# TYPE nma_http_request_duration_seconds histogram")
        return "\n".join(lines) + "\n"

    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"


# Prometheus metrics
REQUEST_COUNT = (
    Counter("nma_http_requests_total", "Total HTTP requests", ["method", "endpoint", "status"])
    if _HAS_PROMETHEUS
    else _Counter(
        "nma_http_requests_total", "Total HTTP requests", ["method", "endpoint", "status"]
    )
)

REQUEST_DURATION = (
    Histogram(
        "nma_http_request_duration_seconds",
        "HTTP request latency in seconds",
        ["method", "endpoint"],
        buckets=_BUCKETS,
    )
    if _HAS_PROMETHEUS
    else _Histogram(
        "nma_http_request_duration_seconds",
        "HTTP request latency in seconds",
        ["method", "endpoint"],
        buckets=_BUCKETS,
    )
)


def _endpoint_name(request: Request) -> str:
    """Return a stable endpoint label (route path or fallback)."""
    route = request.scope.get("route")
    if route is not None and getattr(route, "path", None):
        return route.path
    return request.url.path


class MetricsMiddleware(BaseHTTPMiddleware):
    """Collect RED metrics for every HTTP request."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not _METRICS_ENABLED:
            return await call_next(request)

        method = request.method
        endpoint = _endpoint_name(request)
        start = time.perf_counter()

        try:
            response = await call_next(request)
            status = str(response.status_code)
        except Exception:
            status = "500"
            raise
        finally:
            duration = time.perf_counter() - start
            REQUEST_COUNT.labels(method=method, endpoint=endpoint, status=status).inc()
            REQUEST_DURATION.labels(method=method, endpoint=endpoint).observe(duration)

        return response


async def metrics_endpoint() -> PlainTextResponse:
    """Return Prometheus-formatted metrics."""
    return PlainTextResponse(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST,
    )
