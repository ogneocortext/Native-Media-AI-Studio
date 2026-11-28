"""
Audio analysis routes exposed under /api/integrations.

These sit under the integrations prefix (distinct from /api/audio) to avoid
changing URLs that existing callers use. The analysis itself is delegated to
app/services/audio_analyzer.py.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT
from ..queue.manager import JobCreateRequest, JobType, queue_manager
from ..services.audio_analyzer import LIBROSA_AVAILABLE, AudioAnalyzer

router = APIRouter(tags=["Integrations-Audio"])


class AudioAnalysisRequest(BaseModel):
    """Request for immediate audio analysis"""

    audio_path: str
    hop_length: int = 512
    frame_length: int = 1024


class AudioAnalysisJobRequest(BaseModel):
    """Request to queue an audio analysis job"""

    audio_path: str
    hop_length: int = 512
    frame_length: int = 1024
    max_retries: int = 3


@router.post("/audio/analyze")
async def analyze_audio(request: AudioAnalysisRequest):
    """
    Analyze an audio file and extract waveform + beat features.
    Uses librosa to extract amplitude envelope, beat markers, tempo, and spectral features.
    """
    if not LIBROSA_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Audio analysis not available. Install: pip install librosa soundfile",
        )
    audio_path = Path(request.audio_path)
    if not audio_path.is_absolute():
        audio_path = PROJECT_ROOT / audio_path
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {audio_path}")
    try:
        analyzer = AudioAnalyzer(hop_length=request.hop_length, frame_length=request.frame_length)
        result, json_path = analyzer.analyze_and_save(str(audio_path))
        return {
            "success": True,
            "analysis_path": json_path,
            "duration_seconds": result.waveform.duration_seconds,
            "sample_rate": result.waveform.sample_rate,
            "tempo_bpm": result.beats.tempo_bpm,
            "num_beats": len(result.beats.beat_times),
            "num_onsets": len(result.beats.onset_times),
            "amplitude_points": len(result.waveform.amplitude_envelope),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/audio/analyze/job")
async def create_audio_analysis_job(request: AudioAnalysisJobRequest):
    """Queue an audio analysis job to extract beat markers and waveform features."""
    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.AUDIO_FEATURE_EXTRACTION,
            params={
                "audio_path": request.audio_path,
                "hop_length": request.hop_length,
                "frame_length": request.frame_length,
            },
            max_retries=request.max_retries,
        )
    )
    return {"job_id": job.id, "status": str(job.status)}
