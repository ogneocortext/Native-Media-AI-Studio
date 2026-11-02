"""Audio analysis job handler for processing audio files and extracting features."""

import asyncio
import logging
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT
from ..core.logging_config import structured_logger
from ..models.job import Job
from ..queue.manager import queue_manager
from ..services.audio_analyzer import AudioAnalyzer, AudioAnalyzerError

logger = logging.getLogger(__name__)

OUTPUT_DIR = PROJECT_ROOT / "output" / "audio_analysis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class AudioAnalysisHandler:
    """
    Handler for audio analysis jobs.

    Processes audio analysis jobs by:
    1. Reading audio file from output/audio/
    2. Extracting waveform amplitude envelope
    3. Detecting beat markers
    4. Saving feature data as JSON

    The extracted features are mathematical data (not character animation)
    suitable for driving visualizations, music sync, or future animation work.
    """

    def __init__(self, analyzer: AudioAnalyzer | None = None):
        """
        Initialize the audio analysis handler.

        Args:
            analyzer: AudioAnalyzer instance. If None, creates default.
        """
        self.analyzer = analyzer or AudioAnalyzer()

    async def process_job(self, job: Job) -> dict[str, Any]:
        """
        Process an audio analysis job.

        Args:
            job: The job to process

        Returns:
            Dictionary containing:
            - analysis_path: Path to the JSON feature file
            - audio_file: Path to the source audio file
            - duration: Audio duration in seconds
            - tempo: Detected tempo in BPM
            - num_beats: Number of detected beats
            - num_onsets: Number of detected onsets
        """
        params = job.params

        # Get audio file path
        audio_path = params.get("audio_path")
        if not audio_path:
            structured_logger.error(
                "audio_analysis.validation_failed",
                job_id=job.id,
                error="missing_audio_path",
            )
            raise ValueError("audio_path is required in job params")

        # Make path absolute if relative
        if not Path(audio_path).is_absolute():
            audio_path = PROJECT_ROOT / audio_path

        if not Path(audio_path).exists():
            structured_logger.error(
                "audio_analysis.validation_failed",
                job_id=job.id,
                error="audio_file_not_found",
                audio_path=str(audio_path),
            )
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        structured_logger.info(
            "audio_analysis.job_started",
            job_id=job.id,
            audio_path=str(audio_path),
        )

        try:
            loop = asyncio.get_running_loop()

            def _progress(frac: float, message: str) -> None:
                loop.create_task(
                    queue_manager.update_job(job.id, progress=frac, message=message)
                )

            # Perform analysis
            result, json_path = self.analyzer.analyze_and_save(
                str(audio_path), job_id=job.id, progress_cb=_progress
            )

            result_dict = {
                "analysis_path": json_path,
                "audio_file": str(audio_path),
                "duration_seconds": result.waveform.duration_seconds,
                "sample_rate": result.waveform.sample_rate,
                "tempo_bpm": result.beats.tempo_bpm,
                "num_beats": len(result.beats.beat_times),
                "num_onsets": len(result.beats.onset_times),
                "beat_confidence": result.beats.confidence,
                "amplitude_points": len(result.waveform.amplitude_envelope),
            }

            structured_logger.info(
                "audio_analysis.job_completed",
                job_id=job.id,
                output_path=json_path,
                duration_seconds=result.waveform.duration_seconds,
                tempo_bpm=result.beats.tempo_bpm,
                num_beats=len(result.beats.beat_times),
                num_onsets=len(result.beats.onset_times),
                beat_confidence=result.beats.confidence,
            )
            return result_dict
        except AudioAnalyzerError as e:
            structured_logger.error(
                "audio_analysis.job_failed",
                job_id=job.id,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise
        except Exception as e:
            structured_logger.error(
                "audio_analysis.unexpected_error",
                job_id=job.id,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise AudioAnalyzerError(f"Job processing failed: {e}") from e

    def save_analysis(
        self, job: Job, result: Any, output_path: str | None = None
    ) -> dict[str, str]:
        """
        Save analysis result to JSON file.

        Args:
            job: The completed job
            result: Analysis result
            output_path: Optional custom output path

        Returns:
            Dictionary with output file paths
        """
        return {"analysis": self.analyzer.save_to_json(result, output_path)}


# Default handler instance
default_handler = AudioAnalysisHandler()
