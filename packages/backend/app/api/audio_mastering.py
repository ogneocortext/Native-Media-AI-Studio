"""
Mastering endpoints, split out of app/api/audio.py per D15.

Owns: POST /api/audio/master, GET /api/audio/master/measure/{filename}.

Split for responsibility, not behaviour: mastering is *editing/measurement*,
so per D15 it goes in this module (audio_mastering.py), registered in main.py
alongside audio.py. All /api/audio routers must stay registered here or the
split silently drops routes -- OpenAPI is built from decorators and never runs
a handler body; tools/snapshot-audio-routes.py --check is the guard, but it
cannot catch a missing import.

Like audio_edit.py, this module does NOT import audio.py (circular risk if
audio.py ever needs anything from here). It calls services/mastering.py
directly -- the dependency direction is api -> services, never upward.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.mastering import (
    AUDIO_DIR,
    DEFAULT_CEILING_DBTP,
    TARGET_LUFS,
    master_file,
    measure_file,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Audio"])

VALID_TARGETS = tuple(sorted(TARGET_LUFS.keys()))


class MasterRequest(BaseModel):
    """Request model for POST /api/audio/master.

    ``filename`` is an AUDIO_DIR-relative path (e.g. "8a1b2c3d_Song.mp3" or a
    subdirectory form "Suno-V6-Mini/x.m4a"). ``target_lufs`` must be one of
    the delivery presets; ``ceiling_dbtp`` defaults to -1 dBTP.
    ``tone_fixes`` enables the static de-mud + presence tone (v1, safe half of
    the AI-defect chain).
    """

    filename: str
    target_lufs: str = Field(
        default="spotify",
        description=f"Delivery loudness preset: {', '.join(VALID_TARGETS)}",
    )
    ceiling_dbtp: float = Field(
        default=DEFAULT_CEILING_DBTP,
        description="True-peak ceiling in dBTP (default -1).",
    )
    tone_fixes: bool = Field(
        default=True,
        description="Apply static de-mud (~300 Hz HPF) + presence shelf (~4 kHz).",
    )
    gain_trim_db: float = Field(
        default=0.0,
        ge=-12.0,
        le=12.0,
        description=(
            "Manual trim in dB applied after loudness normalization and before "
            "true-peak limiting. 0 leaves the normalized gain untouched."
        ),
    )


class MasterResponse(BaseModel):
    filename: str
    mastered_path: str | None = None
    error: str | None = None
    before: dict | None = None
    after: dict | None = None
    applied: dict | None = None


@router.post("/master", response_model=MasterResponse)
async def master_audio(body: MasterRequest) -> MasterResponse:
    """Master a library file to a delivery loudness target.

    Measures the source (LUFS / true peak / LRA), applies gain to the target
    preset, optional static tone, and true-peak limiting, then writes a
    mastered copy under output/audio/mastered/. Re-measures the written file
    for the QC report (D17: assert the artifact, not the intent).
    """
    if body.target_lufs not in TARGET_LUFS:
        raise HTTPException(
            status_code=400,
            detail=f"target_lufs must be one of {VALID_TARGETS}, got {body.target_lufs!r}",
        )
    # Resolve + containment check: filename must stay inside AUDIO_DIR.
    root = Path(AUDIO_DIR).resolve()
    candidate = Path(body.filename)
    src = candidate if candidate.is_absolute() else (root / body.filename)
    if not str(src.resolve()).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Source file not found: {body.filename}")

    result = await master_file(
        body.filename,
        target_lufs=TARGET_LUFS[body.target_lufs],
        ceiling_dbtp=body.ceiling_dbtp,
        tone_fixes=body.tone_fixes,
        gain_trim_db=body.gain_trim_db,
    )
    if result.get("error") and not result.get("mastered_path"):
        status = 404 if "not found" in str(result["error"]) else 400
        raise HTTPException(status_code=status, detail=result["error"])
    return MasterResponse(
        filename=result["filename"],
        mastered_path=result.get("mastered_path"),
        error=result.get("error"),
        before=result.get("before"),
        after=result.get("after"),
        applied=result.get("applied"),
    )


@router.get("/master/measure/{filename:path}")
async def measure_master(filename: str) -> dict:
    """Measurement-only endpoint for preview: LUFS / true peak / LRA of a file.

    Returns the same before/measurement shape as mastering's "before" block,
    without writing anything. Useful for the mastering panel's preview A/B.
    """
    root = Path(AUDIO_DIR).resolve()
    candidate = Path(filename)
    src = candidate if candidate.is_absolute() else (root / filename)
    if not str(src.resolve()).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Source file not found: {filename}")

    measurement = await measure_file(filename)
    if measurement.get("error"):
        raise HTTPException(status_code=400, detail=measurement["error"])
    return measurement
