"""
Audio analysis agent service.

Provides a single entrypoint for AI agents / MCP tools to:
- discover available audio analysis backends
- trigger analysis on an audio file
- fetch cached analysis summaries
- batch-analyze pending files

All heavy analysis runs server-side; this module is just a thin REST client
so agents don't need to know about librosa/sonara/madmom internals.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import requests  # type: ignore

logger = logging.getLogger(__name__)

_AUDIO_AGENT_BASE_URL: str = os.environ.get("AUDIO_AGENT_BASE_URL", "http://127.0.0.1:8000/api/audio")


def backends() -> dict[str, Any]:
    """Return available audio analysis backends and the current default."""
    try:
        r = requests.get(f"{_AUDIO_AGENT_BASE_URL}/backends", timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.error("Failed to list audio backends: %s", exc)
        return {"available": ["librosa"], "default": "librosa", "error": str(exc)}


def analyze(file_path: str, backend: str = "sonara") -> dict[str, Any]:
    """Analyze an audio file and return the full analysis payload.

    Args:
        file_path: absolute path to an audio file on the server host.
        backend: one of ``sonara``, ``madmom``, ``librosa``.
    """
    try:
        with open(file_path, "rb") as fh:
            files = {"file": fh}
            r = requests.post(
                f"{_AUDIO_AGENT_BASE_URL}/analyze",
                params={"backend": backend},
                files=files,
                timeout=300,
            )
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.error("Audio analysis failed for %s: %s", file_path, exc)
        return {"error": str(exc)}


def ensure(filename: str, backend: str = "sonara") -> dict[str, Any]:
    """Return cached analysis for *filename*, running analysis if missing.

    Args:
        filename: basename as stored in ``output/audio/`` (may include hash prefix).
        backend: analysis backend to use when a new analysis is required.
    """
    try:
        r = requests.post(
            f"{_AUDIO_AGENT_BASE_URL}/ensure-analysis",
            json={"filename": filename, "backend": backend},
            timeout=300,
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.error("ensure-analysis failed for %s: %s", filename, exc)
        return {"status": "error", "error": str(exc)}


def summary(filename: str) -> dict[str, Any]:
    """Return an agent-friendly summary of cached analysis for *filename*.

    The summary is a compact view (tempo, duration, beat count, sections)
    suitable for driving visualization decisions without transferring the
    full ``beat_times`` / ``energy_curve`` arrays.
    """
    try:
        r = requests.get(f"{_AUDIO_AGENT_BASE_URL}/analysis/summary/{filename}", timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.error("analysis summary failed for %s: %s", filename, exc)
        return {"error": str(exc)}


def analyze_all(backend: str = "sonara") -> dict[str, Any]:
    """Analyze every audio file in the library that lacks cached analysis.

    Returns a rollup: ``{"analyzed": N, "total": M, "files": [...], "errors": [...]}``
    """
    try:
        r = requests.post(
            f"{_AUDIO_AGENT_BASE_URL}/analyze-all",
            params={"backend": backend},
            timeout=600,
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.error("analyze-all failed: %s", exc)
        return {"status": "error", "error": str(exc), "analyzed": 0, "total": 0, "files": [], "errors": []}
