"""
Vocal treatment endpoints.

Owns: POST /api/audio/vocal/treat, GET /api/audio/vocal/measure/{filename}.

Split for responsibility, not behaviour: vocal treatment is *editing/
measurement*, so per D15 it goes in this module (audio_vocal.py), registered
in main.py alongside audio_mastering. All /api/audio routers must stay
registered here or the split silently drops routes -- OpenAPI is built from
decorators and never runs a handler body; tools/snapshot-audio-routes.py
--check is the guard, but it cannot catch a missing import.

Like audio_mastering.py, this module does NOT import audio.py (circular risk).
It calls services/vocal_treatment.py directly -- the dependency direction is
api -> services, never upward.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.vocal_treatment import (
    AUDIO_DIR,
    DEFAULT_CEILING_DBTP,
    measure_vocal,
    treat_file,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Audio"])


class VocalTreatRequest(BaseModel):
    """Request model for POST /api/audio/vocal/treat.

    ``filename`` is an AUDIO_DIR-relative path (e.g. "vocals/Suno-x.wav" or a
    bare filename "song.mp3"). All treatment knobs are defaulted so ``{}`` plus
    a filename runs the full chain with conservative, vocal-friendly settings.
    """

    filename: str
    deess: bool = Field(
        default=True,
        description="Apply dynamic de-ess on the sibilance band (~5-9 kHz).",
    )
    deess_amount_db: float = Field(
        default=4.0,
        ge=0.0,
        le=24.0,
        description="Maximum de-ess reduction in dB (default 4).",
    )
    warmth_drive: float = Field(
        default=0.15,
        ge=0.0,
        le=2.0,
        description="Warmth saturation drive (tanh soft-clip, default 0.15).",
    )
    warmth_mix: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="Warmth wet/dry mix (default 0.35).",
    )
    body_db: float = Field(
        default=1.5,
        ge=-12.0,
        le=12.0,
        description="Low-mid body shelf ~250 Hz in dB (default +1.5).",
    )
    presence_db: float = Field(
        default=1.0,
        ge=-12.0,
        le=12.0,
        description="Presence peak ~3.2 kHz in dB (default +1.0).",
    )
    ceiling_dbtp: float = Field(
        default=DEFAULT_CEILING_DBTP,
        description="True-peak ceiling in dBTP (default -1).",
    )


class VocalTreatResponse(BaseModel):
    filename: str
    treated_path: str | None = None
    error: str | None = None
    before: dict | None = None
    after: dict | None = None
    applied: dict | None = None


@router.post("/vocal/treat", response_model=VocalTreatResponse)
async def treat_vocal(body: VocalTreatRequest) -> VocalTreatResponse:
    """Treat a single vocal stem (or any single audio file) and write a
    treated WAV copy under output/audio/vocal-treated/.

    Measures the source (LUFS / true peak / LRA + sibilance/harshness/body
    band energies), applies de-ess -> dynamic EQ harshness tame -> static
    tone (body shelf + presence peak) -> warmth saturation -> true-peak
    limit, encodes the WAV, then re-measures the written artifact for the
    QC report (D17: assert the artifact, not the intent).
    """
    # Resolve + containment check: filename must stay inside AUDIO_DIR.
    root = Path(AUDIO_DIR).resolve()
    candidate = Path(body.filename)
    src = candidate if candidate.is_absolute() else (root / body.filename)
    if not str(src.resolve()).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Source file not found: {body.filename}")

    result = await treat_file(
        body.filename,
        deess=body.deess,
        deess_amount_db=body.deess_amount_db,
        warmth_drive=body.warmth_drive,
        warmth_mix=body.warmth_mix,
        body_db=body.body_db,
        presence_db=body.presence_db,
        ceiling_dbtp=body.ceiling_dbtp,
    )
    if result.get("error") and not result.get("treated_path"):
        status = 404 if "not found" in str(result["error"]) else 400
        raise HTTPException(status_code=status, detail=result["error"])
    return VocalTreatResponse(
        filename=result["filename"],
        treated_path=result.get("treated_path"),
        error=result.get("error"),
        before=result.get("before"),
        after=result.get("after"),
        applied=result.get("applied"),
    )


@router.get("/vocal/measure/{filename:path}")
async def measure_vocal_endpoint(filename: str) -> dict:
    """Measurement-only endpoint for preview: LUFS / true peak / LRA plus
    sibilance (5-9 kHz), harshness (2-5 kHz) and body (150-400 Hz) band
    energies of a file. Returns the same measurement shape as treating's
    "before" block, without writing anything.
    """
    root = Path(AUDIO_DIR).resolve()
    candidate = Path(filename)
    src = candidate if candidate.is_absolute() else (root / filename)
    if not str(src.resolve()).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Source file not found: {filename}")

    measurement = await measure_vocal(filename)
    if measurement.get("error"):
        raise HTTPException(status_code=400, detail=measurement["error"])
    return measurement
