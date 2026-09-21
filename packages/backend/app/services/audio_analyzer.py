"""Audio analysis service for extracting waveform and beat features from audio files."""

import logging
import uuid
from dataclasses import dataclass
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

# ---------------------------------------------------------------------------
# Shared audio core (tools/lib/audio.py) — imported lazily to avoid a hard
# cross-package dependency at module load time.  The project root is on
# sys.path when the backend runs under uvicorn / the service scripts.
# ---------------------------------------------------------------------------

def _import_shared_audio():
    from tools.lib.audio import analyze_beats, load_audio, save_beat_data  # type: ignore[import]
    return load_audio, analyze_beats, save_beat_data


def beat_confidence(beat_times: list[float], tempo_bpm: float = 0.0) -> float:
    """Estimate beat-tracking confidence from inter-beat interval stability.

    A steady grid (low relative deviation of intervals) scores near 1.0; a
    wandering or sparse grid scores low. This replaces the previous hardcoded
    ``1.0``, which made every track look equally reliable to downstream
    visualizers and AI preset generators.
    """
    if not beat_times:
        return 0.0
    if len(beat_times) < 3:
        return 0.5
    intervals = np.diff(np.asarray(beat_times, dtype=float))
    intervals = intervals[intervals > 1e-6]
    if intervals.size < 2:
        return 0.5
    median = float(np.median(intervals))
    if median <= 0:
        return 0.0
    # Mean absolute deviation relative to the median interval (robust to outliers)
    mad = float(np.mean(np.abs(intervals - median))) / median
    stability = max(0.0, 1.0 - mad)
    # Agreement with the reported tempo (a mismatched grid is less trustworthy)
    if tempo_bpm > 0:
        expected = 60.0 / tempo_bpm
        ratio = median / expected if expected > 0 else 1.0
        tempo_fit = max(0.0, 1.0 - abs(ratio - 1.0))
        stability = 0.7 * stability + 0.3 * tempo_fit
    return round(min(1.0, max(0.0, stability)), 3)


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
    downbeat_frames: list[int] | None = None
    downbeat_times: list[float] | None = None


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
        hop_length = self.hop_length
        frame_length = self.frame_length
        rms = librosa.feature.rms(y=y, hop_length=hop_length, frame_length=frame_length)[0]
        rms_norm = (rms - rms.min()) / (rms.max() - rms.min() + 1e-10)
        zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=hop_length, frame_length=frame_length)[0]
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length, n_fft=frame_length)[0]
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=hop_length, n_fft=frame_length)[0]
        bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr, hop_length=hop_length, n_fft=frame_length)[0]
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
        load_audio, analyze_beats, _ = _import_shared_audio()
        beat_result = analyze_beats(y, sr, use_gpu=False)
        tempo_val = beat_result["tempo"]
        beat_times = beat_result["beat_times"]
        beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=self.hop_length).tolist()

        # Superflux-style onset parameters improve accuracy for vibrato/complex music.
        hop_length = self.hop_length
        frame_length = self.frame_length
        onset_envelope = librosa.onset.onset_strength(
            y=y,
            sr=sr,
            hop_length=hop_length,
            n_fft=frame_length,
            fmin=27.5,
            fmax=16000.0,
        )
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_envelope,
            sr=sr,
            hop_length=hop_length,
            units="frames",
        ).tolist()
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length).tolist()

        # Downbeats: 4/4 assumption (every 4th beat), matching the canonical
        # contract in scripts/generate_timing_contract.py and the generated
        # stillIRiseTiming.ts reference (336 beats / 84 downbeats).
        downbeat_times = beat_times[::4]
        downbeat_frames = beat_frames[::4]

        return BeatFeatures(
            tempo_bpm=tempo_val,
            beat_frames=beat_frames,
            beat_times=beat_times,
            onset_frames=onset_frames,
            onset_times=onset_times,
            confidence=beat_confidence(beat_times, tempo_val),
            downbeat_frames=downbeat_frames,
            downbeat_times=downbeat_times,
        )

    def analyze_from_audio(
        self,
        y,
        sr: int,
        job_id: str | None = None,
        audio_file: str = "",
        backend: str = "librosa",
    ) -> AudioAnalysisResult:
        """Run full feature extraction on already-loaded audio.

        Lets callers (e.g. ``/api/audio/analyze-cuda``) decode/beat-track once
        instead of re-loading the file for every backend pass.
        """
        if y is None or len(y) == 0:
            raise ValueError("Audio file is empty or could not be loaded")

        return AudioAnalysisResult(
            job_id=job_id or str(uuid.uuid4()),
            audio_file=audio_file,
            analysis_timestamp=datetime.now().isoformat(),
            waveform=self._extract_waveform_features(y, sr),
            beats=self._extract_beat_features(y, sr),
            metadata={
                "backend": backend,
                "duration_samples": len(y),
                "hop_length": self.hop_length,
                "frame_length": self.frame_length,
            },
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
            load_audio, _, _ = _import_shared_audio()
            y, sr = load_audio(audio_path, sr=None)
            return self.analyze_from_audio(y, sr, job_id=job_id, audio_file=str(audio_path))
        except Exception as e:
            logger.error(f"Audio analysis failed for {audio_path}: {e}")
            raise AudioAnalyzerError(f"Failed to analyze audio file: {e}") from e

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

            load_audio, _, _ = _import_shared_audio()
            y, sr = load_audio(audio_path, sr=None)
            waveform = self._extract_waveform_features(y, sr)

            beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=self.hop_length).tolist()
            downbeat_frames = librosa.time_to_frames(downbeat_times, sr=sr, hop_length=self.hop_length).tolist()

            # Compute tempo from beat intervals when madmom does not provide it.
            tempo_val = 0.0
            if len(beat_times) >= 2:
                intervals = [beat_times[i+1] - beat_times[i] for i in range(len(beat_times) - 1)]
                median_interval = sorted(intervals)[len(intervals) // 2]
                if median_interval > 0:
                    tempo_val = 60.0 / median_interval

            beat_times_list = beat_times.tolist() if hasattr(beat_times, "tolist") else list(beat_times)
            downbeat_times_list = (
                downbeat_times.tolist() if hasattr(downbeat_times, "tolist") else list(downbeat_times)
            )

            # Real onsets (librosa) — previously the downbeats were reported as
            # onsets, which conflated two different musical events. Downbeats now
            # travel in their own fields.
            _, _, _ = _import_shared_audio()
            onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=self.hop_length, n_fft=self.frame_length)
            onset_frames = librosa.onset.onset_detect(
                onset_envelope=onset_env, sr=sr, hop_length=self.hop_length, units="frames"
            ).tolist()
            onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=self.hop_length).tolist()

            return AudioAnalysisResult(
                job_id=job_id,
                audio_file=str(audio_path),
                analysis_timestamp=datetime.now().isoformat(),
                waveform=waveform,
                beats=BeatFeatures(
                    tempo_bpm=round(float(tempo_val), 1),
                    beat_frames=beat_frames,
                    beat_times=beat_times_list,
                    onset_frames=onset_frames,
                    onset_times=onset_times,
                    confidence=beat_confidence(beat_times_list, tempo_val),
                    downbeat_frames=downbeat_frames,
                    downbeat_times=downbeat_times_list,
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
            raise AudioAnalyzerError(f"madmom-infer failed: {e}") from e

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

            load_audio, _, _ = _import_shared_audio()
            y, sr = load_audio(audio_path, sr=None)
            waveform = self._extract_waveform_features(y, sr)

            beat_frames = list(result.get("beats", []))
            onset_frames = list(result.get("onset_frames", []))

            # Prefer explicitly-provided times: sonara frame indices use its own
            # internal hop, so converting them with our hop can misplace beats.
            if result.get("beat_times"):
                beat_times = [round(float(t), 3) for t in result["beat_times"]]
                beat_frames = (
                    librosa.time_to_frames(beat_times, sr=sr, hop_length=self.hop_length).tolist()
                    if beat_times
                    else []
                )
            else:
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
            tempo_val = float(result.get("bpm") or 0.0)

            return AudioAnalysisResult(
                job_id=job_id,
                audio_file=str(audio_path),
                analysis_timestamp=datetime.now().isoformat(),
                waveform=waveform,
                beats=BeatFeatures(
                    tempo_bpm=tempo_val,
                    beat_frames=beat_frames,
                    beat_times=beat_times,
                    onset_frames=onset_frames,
                    onset_times=onset_times,
                    # sonara's own confidence when reported, else measured stability
                    confidence=float(result.get("bpm_confidence") or beat_confidence(beat_times, tempo_val)),
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
            raise AudioAnalyzerError(f"sonara failed: {e}") from e

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
        output_path = self._save_to_json(result)
        return result, output_path

    def save_to_json(self, result: AudioAnalysisResult, output_path: str | None = None) -> str:
        """Persist an ``AudioAnalysisResult`` and return the written path.

        Public counterpart of ``_save_to_json`` (``audio_analysis_handler``
        called the non-existent ``save_to_json`` before, so custom-path saves
        raised ``AttributeError``).
        """
        if output_path is None:
            return self._save_to_json(result)
        import json
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self._result_payload(result), f, indent=2, ensure_ascii=False)
        return str(path.resolve())

    def _result_payload(self, result: AudioAnalysisResult) -> dict:
        """Serialize an analysis result to a JSON-safe dict."""
        return {
            "job_id": result.job_id,
            "audio_file": result.audio_file,
            "analysis_timestamp": result.analysis_timestamp,
            "waveform": {
                "sample_rate": result.waveform.sample_rate,
                "duration_seconds": result.waveform.duration_seconds,
                "amplitude_envelope": self._to_list(result.waveform.amplitude_envelope),
                "rms_energy": self._to_list(result.waveform.rms_energy),
                "zero_crossing_rate": self._to_list(result.waveform.zero_crossing_rate),
                "centroid": self._to_list(result.waveform.centroid),
                "spectral_rolloff": self._to_list(result.waveform.spectral_rolloff),
                "spectral_bandwidth": self._to_list(result.waveform.spectral_bandwidth),
            },
            "beats": {
                "tempo_bpm": result.beats.tempo_bpm,
                "beat_frames": result.beats.beat_frames,
                "beat_times": result.beats.beat_times,
                "onset_frames": result.beats.onset_frames,
                "onset_times": result.beats.onset_times,
                "confidence": result.beats.confidence,
                "downbeat_frames": result.beats.downbeat_frames or [],
                "downbeat_times": result.beats.downbeat_times or [],
            },
            "metadata": result.metadata,
        }

    def _save_to_json(self, result: AudioAnalysisResult) -> str:
        """Save analysis result to JSON file.

        Args:
            result: AudioAnalysisResult to save

        Returns:
            Absolute path of the written JSON file.
        """
        import json

        path = OUTPUT_DIR / f"{result.job_id}_analysis.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self._result_payload(result), f, indent=2, ensure_ascii=False)
        return str(path.resolve())


def extract_amplitude_envelope_simple(audio_path: str) -> dict[str, Any]:
    """
    Simple standalone function to extract amplitude envelope only.

    Useful for quick analysis without full feature extraction.

    Args:
        audio_path: Path to the audio file

    Returns:
        Dictionary with amplitude envelope and basic info
    """
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa not installed")

    load_audio, analyze_beats, _ = _import_shared_audio()
    y, sr = load_audio(audio_path, sr=22050)
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

    # Get beat times via shared beat tracker
    beat_result = analyze_beats(y, sr, use_gpu=False)
    beat_times = beat_result["beat_times"]
    tempo_val = beat_result["tempo"]

    return {
        "audio_file": str(audio_path),
        "sample_rate": sr,
        "duration_seconds": duration,
        "tempo_bpm": tempo_val,
        "amplitude_envelope": envelope,
        "beat_times": beat_times,
        "num_beats": len(beat_times),
    }


def analyze_with_cuda(
    audio_path: str,
    y=None,
    sr: int | None = None,
    include_beats: bool = True,
) -> dict[str, Any]:
    """Analyze audio using GPU acceleration when available.

    Uses the CUDA audio analyzer for FFT and spectral features,
    falling back to CPU (librosa) if CUDA is unavailable.

    Args:
        audio_path: Path to audio file.
        y: Optional pre-loaded mono time series — avoids decoding the file a
            second time when the caller already loaded it.
        sr: Sample rate matching ``y`` (required when ``y`` is given).
        include_beats: Set False when the caller runs its own beat tracking
            (e.g. ``/api/audio/analyze-cuda``), skipping a redundant pass.

    Returns:
        Dict with amplitude_envelope, spectral features, and metadata.
    """
    load_audio, analyze_beats, _ = _import_shared_audio()
    if y is None:
        y, sr = load_audio(audio_path, sr=22050)
    if sr is None:
        raise ValueError("sr is required when y is provided")

    cuda_ok = False
    try:
        from .cuda import cuda_audio, cuda_available
        if cuda_available():
            result = dict(cuda_audio.analyze(y))
            result["cuda"] = True
            result["computed_on"] = "GPU"
            cuda_ok = True
    except Exception as e:
        logger.warning(f"CUDA analysis failed ({e}), falling back to CPU")

    if not cuda_ok:
        # CPU fallback — reuse already-loaded audio for RMS + beats
        rms = librosa.feature.rms(y=y, hop_length=512)[0]
        rms_norm = (rms - rms.min()) / (rms.max() - rms.min() + 1e-10)
        target_points = 60
        indices = np.linspace(0, len(rms_norm) - 1, target_points).astype(int)
        envelope = rms_norm[indices].tolist()
        result = {
            "amplitude_envelope": envelope,
            "cuda": False,
            "computed_on": "CPU",
        }

    # Beat tracking (still CPU — librosa beat_track has no GPU equivalent)
    if include_beats:
        beat_result = analyze_beats(y, sr, use_gpu=False)
        result["tempo_bpm"] = beat_result["tempo"]
        result["beat_times"] = beat_result["beat_times"]

    result["sample_rate"] = sr
    result["audio_file"] = str(audio_path)

    return result


# Default analyzer instance
default_analyzer = AudioAnalyzer()
