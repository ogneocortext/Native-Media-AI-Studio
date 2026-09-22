"""
OpenTelemetry tracing setup for the backend.

Configures a console + file exporter so traces are visible during local
development without requiring an external collector. Instrumentation is
opt-in via the ``NMA_TRACING`` environment variable (default: false).
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

TRACING_ENABLED = os.getenv("NMA_TRACING", "").lower() in {"1", "true", "yes"}


def setup_tracing(app) -> None:
    """Configure OpenTelemetry tracing for the FastAPI app.

    No-op when ``NMA_TRACING`` is falsy so local dev stays quiet by default.
    """
    if not TRACING_ENABLED:
        logger.debug("Tracing disabled (set NMA_TRACING=1 to enable)")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchExportSpanProcessor, ConsoleSpanExporter

        resource = Resource.create({"service.name": "nma-backend", "service.version": "1.0.0"})
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchExportSpanProcessor(ConsoleSpanExporter()))

        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        logger.info("OpenTelemetry tracing enabled (console exporter)")
    except Exception as exc:  # pragma: no cover - optional dependency guard
        logger.warning("Tracing setup failed: %s", exc)


class _NoOpSpan:
    """No-op span so callers can use `with tracer.start_as_current_span(...)` safely."""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def set_attribute(self, *args, **kwargs):
        pass

    def record_exception(self, *args, **kwargs):
        pass

    def set_status(self, *args, **kwargs):
        pass


class _NoOpTracer:
    """No-op tracer returned when OpenTelemetry is unavailable/disabled."""

    def start_as_current_span(self, *args, **kwargs):
        return _NoOpSpan()

    def start_span(self, *args, **kwargs):
        return _NoOpSpan()


_NOOP_TRACER = _NoOpTracer()


def get_tracer(name: str) -> object:
    """Return a tracer, or a no-op tracer when tracing is disabled."""
    try:
        from opentelemetry import trace
        return trace.get_tracer(name)
    except Exception:
        return _NOOP_TRACER
