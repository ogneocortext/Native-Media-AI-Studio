"""Audio analysis job handler for processing audio files and extracting features."""

import logging
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT
from ..models.job import Job
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
            raise ValueError("audio_path is required in job params")

        # Make path absolute if relative
        if not Path(audio_path).is_absolute():
            audio_path = PROJECT_ROOT / audio_path

        if not Path(audio_path).exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            # Perform analysis
            result, json_path = self.analyzer.analyze_and_save(
                str(audio_path), job_id=job.id
            )

            return {
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
        except AudioAnalyzerError as e:
            logger.error(f"Audio analysis job failed: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error processing audio analysis job: {e}")
            raise AudioAnalyzerError(f"Job processing failed: {e}")

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
