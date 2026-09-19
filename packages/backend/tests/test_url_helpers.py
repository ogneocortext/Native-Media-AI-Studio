"""Regression tests for backend URL helpers and dynamic port resolution.

Guards a previously-shipped bug: ``PortManager._build_resolved_config`` accepted
a resolved ``backend_port`` but derived ``backend_url`` / ``ws_url`` /
``backend_events_url`` from the *configured* port, so a fallback bind
(8000 -> 8001) produced config that advertised the wrong backend URL.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import config  # noqa: E402
from app.core.port_manager import PortManager  # noqa: E402
from app.core.urls import backend_events_url, backend_url, backend_ws_url  # noqa: E402
from app.services.generation_estimator import estimate_generation_time  # noqa: E402


def test_backend_url_defaults_to_configured_port():
    assert backend_url() == f"http://127.0.0.1:{config.backend_port}"
    assert backend_url("/api/health") == f"http://127.0.0.1:{config.backend_port}/api/health"


def test_backend_url_honours_port_override():
    url = backend_url(port=8001)
    assert url == "http://127.0.0.1:8001"
    assert url.endswith(":8001")


def test_backend_events_and_ws_url_honour_port_override():
    assert backend_events_url(port=8001) == "http://127.0.0.1:8001/api/events"
    assert backend_ws_url(port=8001) == "ws://127.0.0.1:8001/ws"


def test_resolved_config_uses_resolved_backend_port():
    """Every backend-derived URL must match the resolved (possibly fallback) port."""
    manager = PortManager()
    resolved = manager._build_resolved_config(8001)

    assert resolved["backend_port"] == 8001
    assert resolved["ws_port"] == 8001
    assert resolved["backend_url"] == "http://127.0.0.1:8001"
    assert resolved["ws_url"] == "ws://127.0.0.1:8001/ws"
    assert resolved["backend_events_url"] == "http://127.0.0.1:8001/api/events"


def test_estimate_generation_time_reports_frames_and_model_factor():
    result = estimate_generation_time(
        steps=20, width=512, height=512, num_frames=60, fps=24, model_name="wan-2.2"
    )

    assert result["total_frames"] == 60
    assert result["factors"]["model_factor"] == 3.0
    assert result["estimated_seconds"] > 0
    assert result["estimated_end_time"].endswith("Z")


def test_estimate_generation_time_derives_frames_from_fps_when_unset():
    result = estimate_generation_time(
        steps=20, width=512, height=512, num_frames=0, fps=24, model_name="sd-v1-5"
    )

    assert result["total_frames"] == 120
    assert result["factors"]["model_factor"] == 1.0
