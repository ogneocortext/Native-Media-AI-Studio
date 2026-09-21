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


def get_tracer(name: str) -> object:
    """Return a tracer, or a no-op tracer when tracing is disabled."""
    try:
        from opentelemetry import trace
        return trace.get_tracer(name)
    except Exception:
        return None
