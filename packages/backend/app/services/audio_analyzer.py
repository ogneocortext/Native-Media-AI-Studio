"""Audio analysis service for extracting waveform and beat features from audio files."""

import json
import logging
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

try:
    import librosa
    import numpy as np

    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False
    np = None

try:
    import madmom.infer as _madmom_infer  # type: ignore

    MADMOM_AVAILABLE = True
except ImportError:
    MADMOM_AVAILABLE = False

try:
    import sonara as _sonara  # type: ignore

    SONARA_AVAILABLE = True
except ImportError:
    SONARA_AVAILABLE = False


OUTPUT_DIR = Path(__file__).parent.parent.parent / "output" / "audio_analysis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class AudioAnalyzerError(Exception):
    """Exception raised for errors in the AudioAnalyzer."""
    pass


@dataclass
class WaveformFeatures:
    """Extracted waveform features."""

    sample_rate: int
    duration_seconds: float
    amplitude_envelope: list[float]
    rms_energy: list[float]
    zero_crossing_rate: list[float]
    centroid: list[float] | None = None
    spectral_rolloff: list[float] | None = None
    spectral_bandwidth: list[float] | None = None


@dataclass
class BeatFeatures:
    """Extracted beat and tempo features."""

    tempo_bpm: float
    beat_frames: list[int]
    beat_times: list[float]
    onset_frames: list[int]
    onset_times: list[float]
    confidence: float


@dataclass
class AudioAnalysisResult:
    """Complete audio analysis result."""

    job_id: str
    audio_file: str
    analysis_timestamp: str
    waveform: WaveformFeatures
    beats: BeatFeatures
    metadata: dict[str, Any]


class AudioAnalyzer:
    """
    Audio analysis service for extracting mathematical features.

    Extracts:
    - Waveform amplitude envelope
    - Beat markers and tempo
    - Spectral features

    Saves results as JSON for future animation/music video use.
    """

    def __init__(self, hop_length: int = 512, frame_length: int = 1024):
        """
        Initialize the audio analyzer.

        Args:
            hop_length: Number of samples between analysis frames (default 512)
            frame_length: Window size for analysis (default 1024)
        """
        self.hop_length = hop_length
        self.frame_length = frame_length

    def analyze_file(
        self, audio_path: str, job_id: str | None = None, backend: str = "sonara"
    ) -> AudioAnalysisResult:
        """
        Analyze an audio file and extract all features.

        Args:
            audio_path: Path to the audio file
            job_id: Optional job ID for tracking
            backend: One of ``librosa``, ``madmom``, ``sonara``.
                Unavailable backends fall back to librosa.

        Returns:
            AudioAnalysisResult with all extracted features
        """
        backend = (backend or "sonara").lower()
        if backend == "sonara" and SONARA_AVAILABLE:
            return self._analyze_sonara(audio_path, job_id)
        if backend == "madmom" and MADMOM_AVAILABLE:
            return self._analyze_madmom(audio_path, job_id)
        if backend != "librosa":
            logger.warning("Audio backend '%s' unavailable; falling back to librosa", backend)
        return self._analyze_librosa(audio_path, job_id)

    def _to_list(self, value):
        if value is None:
            return None
        if hasattr(value, "tolist"):
            return value.tolist()
        return list(value)

    def _extract_waveform_features(self, y, sr):
        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)[0]
        rms_norm = (rms - rms.min()) / (rms.max() - rms.min() + 1e-10)
        zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=self.hop_length)[0]
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=self.hop_length)[0]
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=self.hop_length)[0]
        bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr, hop_length=self.hop_length)[0]
        return WaveformFeatures(
            sample_rate=int(sr),
            duration_seconds=float(len(y) / sr),
            amplitude_envelope=rms_norm.tolist(),
            rms_energy=rms.tolist(),
            zero_crossing_rate=zcr.tolist(),
            centroid=centroid.tolist(),
            spectral_rolloff=rolloff.tolist(),
            spectral_bandwidth=bandwidth.tolist(),
        )

    def _extract_beat_features(self, y, sr):
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=self.hop_length)
        onset_frames = librosa.onset.onset_detect(y=y, sr=sr, hop_length=self.hop_length)
        try:
            tempo_val = float(tempo.item() if hasattr(tempo, "item") else tempo)
        except Exception:
            import numpy as _np
            tempo_val = float(_np.asarray(tempo).flat[0]) if _np.asarray(tempo).size else 120.0
        return BeatFeatures(
            tempo_bpm=tempo_val,
            beat_frames=beat_frames.tolist(),
            beat_times=librosa.frames_to_time(beat_frames, sr=sr, hop_length=self.hop_length).tolist(),
            onset_frames=onset_frames.tolist(),
            onset_times=librosa.frames_to_time(onset_frames, sr=sr, hop_length=self.hop_length).tolist(),
            confidence=1.0,
        )

    def _analyze_librosa(self, audio_path: str, job_id: str | None = None) -> AudioAnalysisResult:
        """Original librosa analysis path (preserved as default)."""
        if not LIBROSA_AVAILABLE:
            raise RuntimeError(
                "librosa not installed. Install with: pip install librosa soundfile"
            )

        job_id = job_id or str(uuid.uuid4())

        if not Path(audio_path).exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            y, sr = librosa.load(audio_path, sr=None, mono=True)

            if len(y) == 0:
                raise ValueError("Audio file is empty or could not be loaded")

            waveform = self._extract_waveform_features(y, sr)
            beats = self._extract_beat_features(y, sr)

            return AudioAnalysisResult(
                job_id=job_id,
                audio_file=str(audio_path),
                analysis_timestamp=datetime.now().isoformat(),
                waveform=waveform,
                beats=beats,
                metadata={
                    "duration_samples": len(y),
                    "hop_length": self.hop_length,
                    "frame_length": self.frame_length,
                },
            )
        except Exception as e:
            logger.error(f"Audio analysis failed for {audio_path}: {e}")
            raise AudioAnalyzerError(f"Failed to analyze audio file: {e}")

    def _analyze_madmom(self, audio_path: str, job_id: str | None = None) -> AudioAnalysisResult:
        """Beat/downbeat analysis via madmom-infer.

        Falls back to librosa for waveform features.
        """
        if not MADMOM_AVAILABLE:
            raise AudioAnalyzerError("madmom-infer is not installed")

        job_id = job_id or str(uuid.uuid4())
        if not Path(audio_path).exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            beat_times = _madmom_infer.beats(audio_path)
            downbeat_times = _madmom_infer.downbeats(audio_path)

            y, sr = librosa.load(audio_path, sr=None, mono=True)
            waveform = self._extract_waveform_features(y, sr)

            beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=self.hop_length).tolist()
            downbeat_frames = librosa.time_to_frames(downbeat_times, sr=sr, hop_length=self.hop_length).tolist()

            return AudioAnalysisResult(
                job_id=job_id,
                audio_file=str(audio_path),
                analysis_timestamp=datetime.now().isoformat(),
                waveform=waveform,
                beats=BeatFeatures(
                    tempo_bpm=0.0,
                    beat_frames=beat_frames,
                    beat_times=beat_times.tolist() if hasattr(beat_times, "tolist") else list(beat_times),
                    onset_frames=downbeat_frames,
                    onset_times=downbeat_times.tolist() if hasattr(downbeat_times, "tolist") else list(downbeat_times),
                    confidence=1.0,
                ),
                metadata={
                    "backend": "madmom-infer",
                    "duration_samples": len(y),
                    "hop_length": self.hop_length,
                    "frame_length": self.frame_length,
                },
            )
        except Exception as e:
            logger.error(f"madmom-infer analysis failed for {audio_path}: {e}")
            raise AudioAnalyzerError(f"madmom-infer failed: {e}")

    def _analyze_sonara(self, audio_path: str, job_id: str | None = None) -> AudioAnalysisResult:
        """Audio analysis via sonara (Rust-backed PyO3).

        Falls back to librosa for waveform features.
        """
        if not SONARA_AVAILABLE:
            raise AudioAnalyzerError("sonara is not installed")

        job_id = job_id or str(uuid.uuid4())
        if not Path(audio_path).exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            result = _sonara.analyze_file(audio_path, mode="compact")

            y, sr = librosa.load(audio_path, sr=None, mono=True)
            waveform = self._extract_waveform_features(y, sr)

            beat_frames = list(result.get("beats", []))
            onset_frames = list(result.get("onset_frames", []))

            beat_times = (
                librosa.frames_to_time(beat_frames, sr=sr, hop_length=self.hop_length).tolist()
                if beat_frames
                else []
            )
            onset_times = (
                librosa.frames_to_time(onset_frames, sr=sr, hop_length=self.hop_length).tolist()
                if onset_frames
                else []
            )

            return AudioAnalysisResult(
                job_id=job_id,
                audio_file=str(audio_path),
                analysis_timestamp=datetime.now().isoformat(),
                waveform=waveform,
                beats=BeatFeatures(
                    tempo_bpm=float(result.get("bpm") or 0.0),
                    beat_frames=beat_frames,
                    beat_times=beat_times,
                    onset_frames=onset_frames,
                    onset_times=onset_times,
                    confidence=float(result.get("bpm_confidence") or 1.0),
                ),
                metadata={
                    "backend": "sonara",
                    "duration_samples": len(y),
                    "hop_length": self.hop_length,
                    "frame_length": self.frame_length,
                },
            )
        except Exception as e:
            logger.error(f"sonara analysis failed for {audio_path}: {e}")
            raise AudioAnalyzerError(f"sonara failed: {e}")

    def analyze_and_save(
        self, audio_path: str, job_id: str | None = None, backend: str = "sonara"
    ) -> tuple[AudioAnalysisResult, str]:
        """
        Analyze audio file and save results in one call.

        Args:
            audio_path: Path to audio file
            job_id: Optional job ID
            backend: Analysis backend (librosa, madmom, sonara)

        Returns:
            Tuple of (AudioAnalysisResult, output_path)
        """
        result = self.analyze_file(audio_path, job_id, backend)
        output_path = self.save_to_json(result)
        return result, output_path


def extract_amplitude_envelope_simple(audio_path: str) -> dict[str, Any]:
    """
    Simple standalone function to extract amplitude envelope only.

    Useful for quick analysis without full feature extraction.

    Args:
        audio_path: Path to audio file

    Returns:
        Dictionary with amplitude envelope and basic info
    """
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa not installed")

    # Load audio
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = len(y) / sr

    # Calculate RMS energy per frame
    hop_length = 512
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]

    # Normalize to 0-1
    rms_norm = (rms - rms.min()) / (rms.max() - rms.min() + 1e-10)

    # Create amplitude envelope (60 points for animation)
    target_points = 60
    indices = np.linspace(0, len(rms_norm) - 1, target_points).astype(int)
    envelope = rms_norm[indices].tolist()

    # Get beat times — librosa 1.x returns tempo as ndarray (even for mono)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop_length).tolist()
    try:
        tempo_val = float(tempo.item() if hasattr(tempo, "item") else tempo)
    except Exception:
        # tempo may be 0-d array or 1-d array; handle both
        import numpy as _np
        tempo_val = float(_np.asarray(tempo).flat[0]) if _np.asarray(tempo).size else 120.0

    return {
        "audio_file": str(audio_path),
        "sample_rate": sr,
        "duration_seconds": duration,
        "tempo_bpm": tempo_val,
        "amplitude_envelope": envelope,
        "beat_times": beat_times,
        "num_beats": len(beat_times),
    }


def analyze_with_cuda(audio_path: str) -> dict[str, Any]:
    """Analyze audio using GPU acceleration when available.

    Uses the CUDA audio analyzer for FFT and spectral features,
    falling back to CPU (librosa) if CUDA is unavailable.

    Args:
        audio_path: Path to audio file.

    Returns:
        Dict with amplitude_envelope, spectral features, and metadata.
    """
    import librosa

    y, sr = librosa.load(audio_path, sr=22050, mono=True)

    try:
        from .cuda import cuda_audio, cuda_available
        if cuda_available():
            result = cuda_audio.analyze(y)
            result["cuda"] = True
            result["computed_on"] = "GPU"
        else:
            raise RuntimeError("CUDA not available")
    except Exception as e:
        logger.warning(f"CUDA analysis failed ({e}), falling back to CPU")
        # Fallback to CPU analysis
        result = extract_amplitude_envelope_simple(audio_path)
        result["cuda"] = False
        result["computed_on"] = "CPU"
        # Re-load audio for beat tracking
        y, sr = librosa.load(audio_path, sr=22050, mono=True)

    # Add beat tracking (still CPU — librosa beat_track has no GPU equivalent)
    try:
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
        result["tempo_bpm"] = float(tempo.item() if hasattr(tempo, "item") else tempo)
        result["beat_times"] = librosa.frames_to_time(
            beats, sr=sr, hop_length=512
        ).tolist()
    except Exception as e:
        logger.warning(f"Beat tracking failed ({e}), using defaults")
        result["tempo_bpm"] = 120.0
        result["beat_times"] = []

    result["sample_rate"] = sr
    result["audio_file"] = str(audio_path)

    return result


# Default analyzer instance
default_analyzer = AudioAnalyzer()
