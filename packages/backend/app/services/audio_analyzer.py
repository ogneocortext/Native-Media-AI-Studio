"""Audio analysis service for extracting waveform and beat features from audio files."""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

#: sonara's analysis pipeline is fixed at 22050 Hz mono.
_SONARA_SR = 22050

try:
    import librosa
    import numpy as np

    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False
    np = None

try:
    # NOTE: the import name is `madmom_infer` (underscore). The code used to try
    # `madmom.infer`, which exists in neither the legacy `madmom` package nor
    # this one — and neither package exposes module-level `beats()`/`downbeats()`
    # functions. The real entry points are
    # `madmom_infer.features.downbeats.{RNNDownBeatProcessor, DBNDownBeatTrackingProcessor}`;
    # `_madmom_beats_downbeats()` below adapts them to (beat_times, downbeat_times).
    import madmom_infer.features.downbeats as _madmom_downbeats  # type: ignore

    MADMOM_AVAILABLE = True
except ImportError:
    _madmom_downbeats = None
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


# ---------------------------------------------------------------------------
# madmom-infer neural beat/downbeat tracking
# ---------------------------------------------------------------------------

# Sample rate the madmom-infer DSP + BLSTM models were trained/evaluated at.
# Its `Signal` has no resampler, so callers must supply this rate explicitly.
MADMOM_SAMPLE_RATE = 44100
# RNN activation frame rate (fps=100 -> 10 ms per frame).
MADMOM_ACTIVATION_FPS = 100.0


def resample_audio_gpu(y, orig_sr: int, target_sr: int):
    """Resample 1-D mono audio, preferring GPU via torchaudio.

    Uses ``torchaudio.functional.resample`` on CUDA when torch + CUDA are
    available; otherwise falls back to ``librosa.resample`` on CPU.

    Args:
        y: 1-D mono waveform samples.
        orig_sr: Original sample rate.
        target_sr: Target sample rate.

    Returns:
        Resampled audio as a numpy array (float32).
    """
    audio = np.asarray(y, dtype=np.float32)
    if orig_sr == target_sr:
        return audio
    try:
        import torch

        if torch.cuda.is_available():
            import torchaudio.functional as _taf

            tensor = torch.as_tensor(audio, device="cuda:0")
            out = _taf.resample(tensor, orig_freq=orig_sr, new_freq=target_sr)
            return out.cpu().numpy().astype(np.float32)
    except Exception:
        logger.debug("GPU resample unavailable — falling back to librosa", exc_info=True)
    return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr).astype(np.float32)


def _madmom_beats_downbeats(y_44k):
    """Run the ported madmom beat/downbeat pipeline on 44.1 kHz mono audio.

    Returns ``(beat_times, downbeat_times)`` in seconds. The first call
    downloads the CC BY-NC-SA 4.0 (non-commercial) BLSTM weights from
    ``https://raw.githubusercontent.com/CPJKU/madmom_models/master`` into the
    local cache (``~/.cache/madmom_infer/models/``); later calls reuse them.
    """
    activations = _madmom_downbeats.RNNDownBeatProcessor()(y_44k)
    beats = _madmom_downbeats.DBNDownBeatTrackingProcessor(
        beats_per_bar=[3, 4], fps=MADMOM_ACTIVATION_FPS
    )(activations)
    beats = np.asarray(beats, dtype=float).reshape(-1, 2)
    beat_times = [round(float(t), 3) for t in beats[:, 0]]
    downbeat_times = [round(float(t), 3) for t in beats[beats[:, 1] == 1][:, 0]]
    return beat_times, downbeat_times


# ---------------------------------------------------------------------------
# sonara (Rust PyO3) beat/timing helpers
# ---------------------------------------------------------------------------


def _sonara_frames_to_time(frames) -> list[float]:
    """Convert sonara frame indices to seconds using its own analysis grid.

    sonara reports ``provenance = {sample_rate: 22050, hop_length: 512}`` for
    compact-mode analyses (verified against 0.3.6); older versions are handled
    by the caller, which falls back to the librosa grid.
    """
    out = _sonara.frames_to_time(frames, sr=22050.0, hop_length=512)
    if hasattr(out, "tolist"):
        return out.tolist()
    return [round(float(t), 3) for t in (out or [])]


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


def detect_meter(beat_times: list[float]) -> int:
    """Estimate beats per bar from beat interval regularity.

    Tries meters 2-8 and returns the one whose downbeat intervals have the
    lowest median absolute deviation, with a slight preference for 4/4 when
    meters are equally good. Falls back to 4 when the grid is too short or too
    irregular.
    """
    if len(beat_times) < 6:
        return 4
    intervals = np.diff(np.asarray(beat_times, dtype=float))
    intervals = intervals[intervals > 1e-6]
    if intervals.size < 4:
        return 4
    median_interval = float(np.median(intervals))
    if median_interval <= 0:
        return 4
    best_bpb = 4
    best_score = float("inf")
    for bpb in range(2, 9):
        # Downbeats occur every bpb beats
        if len(intervals) < bpb:
            continue
        db_intervals = intervals[bpb - 1::bpb]
        if db_intervals.size < 2:
            continue
        db_median = float(np.median(db_intervals))
        if db_median <= 0:
            continue
        mad = float(np.mean(np.abs(db_intervals - db_median))) / db_median
        # Penalize meters that imply extreme tempos (0.2s–2.0s per beat)
        beat_dur = median_interval
        if beat_dur < 0.2 or beat_dur > 2.0:
            mad += 0.5
        # Tiebreak: slight preference for 4/4 when scores are equal.
        mad += 0.001 * abs(bpb - 4)
        if mad < best_score:
            best_score = mad
            best_bpb = bpb
    return best_bpb


def downbeat_times_from_beats(beat_times: list[float], beats_per_bar: int = 0) -> list[float]:
    """Return downbeat times, inferring meter when beats_per_bar is 0/None."""
    if not beat_times:
        return []
    if not beats_per_bar:
        beats_per_bar = detect_meter(beat_times)
    return [round(float(t), 3) for t in beat_times[::beats_per_bar]]


class AudioAnalyzerError(Exception):
    """Exception raised for errors in the AudioAnalyzer."""


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

        # Downbeats: meter-agnostic detection based on beat interval regularity,
        # replacing the previous hardcoded 4/4 assumption.
        meter = detect_meter(beat_times)
        downbeat_times = downbeat_times_from_beats(beat_times, meter)
        downbeat_frames = [
            int(f) for f in librosa.time_to_frames(downbeat_times, sr=sr, hop_length=self.hop_length)
            if f < len(beat_frames)
        ]

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

    def _beat_features_from_sonara(self, result: dict, sr: int) -> BeatFeatures:
        """Build BeatFeatures from a sonara `compact` result.

        Shared by `_analyze_sonara` (which decodes then calls sonara) and
        `analyze_from_audio(beat_backend="sonara")`, so both produce the same
        beat grid from the same conversion rules.
        """
        beat_frames = list(result.get("beats", []))
        onset_frames = list(result.get("onset_frames", []))

        # sonara pins its own pipeline to sr=22050 / hop=512 regardless of
        # how we decoded the file — it reports them in `provenance`, so
        # convert frame indices with sonara's grid, not ours.
        provenance = result.get("provenance") or {}
        prov_sr = float(provenance.get("sample_rate") or 22050)
        prov_hop = int(provenance.get("hop_length") or 512)
        on_sonara_grid = prov_sr == 22050 and prov_hop == 512

        # Prefer explicitly-provided times; otherwise convert indices with
        # sonara's grid (falling back to ours for older sonara versions).
        if result.get("beat_times"):
            beat_times = [round(float(t), 3) for t in result["beat_times"]]
            beat_frames = (
                librosa.time_to_frames(beat_times, sr=sr, hop_length=self.hop_length).tolist()
                if beat_times
                else []
            )
        elif on_sonara_grid:
            beat_times = _sonara_frames_to_time(beat_frames) if beat_frames else []
        else:
            beat_times = (
                librosa.frames_to_time(beat_frames, sr=sr, hop_length=self.hop_length).tolist()
                if beat_frames
                else []
            )

        if on_sonara_grid:
            onset_times = _sonara_frames_to_time(onset_frames) if onset_frames else []
        else:
            onset_times = (
                librosa.frames_to_time(onset_frames, sr=sr, hop_length=self.hop_length).tolist()
                if onset_frames
                else []
            )

        tempo_val = float(result.get("bpm") or 0.0)
        # Meter-agnostic downbeat detection (replaces hardcoded 4/4).
        downbeats = downbeat_times_from_beats(beat_times)
        return BeatFeatures(
            tempo_bpm=tempo_val,
            beat_frames=beat_frames,
            beat_times=beat_times,
            onset_frames=onset_frames,
            onset_times=onset_times,
            downbeat_frames=[
                int(f)
                for f in librosa.time_to_frames(
                    downbeats, sr=sr, hop_length=self.hop_length
                )
                if f < len(beat_frames)
            ],
            downbeat_times=downbeats,
            # sonara's own confidence when reported, else measured stability
            confidence=float(result.get("bpm_confidence") or beat_confidence(beat_times, tempo_val)),
        )

    def _sonara_beats_from_signal(self, y, sr: int) -> BeatFeatures:
        """Beat/tempo via sonara on an already-decoded buffer.

        This is the fast path for callers that hold the audio (the CUDA route).
        librosa's `_extract_beat_features` costs ~80 s on a 157 s track on this
        machine; sonara is a Rust extension and does it in well under a second.
        sonara pins its analysis pipeline to 22050 Hz mono. Every other caller
        here loads at sr=22050 for that reason; feeding it a native-rate
        stereo buffer silently returns a wrong tempo and an over-counted beat
        grid, so the resample is part of the contract, not an optimisation.
        """
        if sr != _SONARA_SR:
            y = librosa.resample(y, orig_sr=sr, target_sr=_SONARA_SR)
        if getattr(y, "ndim", 1) > 1:
            y = y.mean(axis=0)
        y32 = np.ascontiguousarray(y, dtype=np.float32)
        result = dict(_sonara.analyze_signal(y32, mode="compact"))
        return self._beat_features_from_sonara(result, _SONARA_SR)

    def analyze_from_audio(
        self,
        y,
        sr: int,
        job_id: str | None = None,
        audio_file: str = "",
        backend: str = "librosa",
        beat_backend: str | None = None,
    ) -> AudioAnalysisResult:
        """Run full feature extraction on already-loaded audio.

        Lets callers (e.g. ``/api/audio/analyze-cuda``) decode/beat-track once
        instead of re-loading the file for every backend pass.

        ``backend`` is descriptive metadata. ``beat_backend`` is the one that
        changes behaviour: ``"sonara"`` swaps the slow librosa beat tracker for
        the Rust one on the buffer already in hand.
        """
        if y is None or len(y) == 0:
            raise ValueError("Audio file is empty or could not be loaded")

        beats = None
        if beat_backend and beat_backend.lower() == "sonara" and SONARA_AVAILABLE:
            try:
                beats = self._sonara_beats_from_signal(y, sr)
            except Exception as exc:
                # A correct-but-slow beat grid beats a failed request.
                logger.warning(
                    "sonara beat tracking failed on the decoded buffer, falling "
                    "back to librosa: %s: %s",
                    type(exc).__name__,
                    exc,
                )
                beats = None
        if beats is None:
            beats = self._extract_beat_features(y, sr)

        return AudioAnalysisResult(
            job_id=job_id or str(uuid.uuid4()),
            audio_file=audio_file,
            analysis_timestamp=datetime.now().isoformat(),
            waveform=self._extract_waveform_features(y, sr),
            beats=beats,
            metadata={
                "backend": backend,
                "beat_backend": "sonara" if beat_backend else "librosa",
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
            y, sr = load_audio(audio_path, sr=22050)
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
            # madmom-infer needs 44.1 kHz mono and has no resampler: decode at
            # native rate first, then resample to its DSP rate.
            load_audio, _, _ = _import_shared_audio()
            y, sr = load_audio(audio_path, sr=None)
            if len(y) == 0:
                raise ValueError("Audio file is empty or could not be loaded")
            if sr != MADMOM_SAMPLE_RATE:
                y_44k = resample_audio_gpu(y, orig_sr=sr, target_sr=MADMOM_SAMPLE_RATE)
            else:
                y_44k = y
            beat_times, downbeat_times = _madmom_beats_downbeats(
                np.ascontiguousarray(y_44k, dtype=np.float64)
            )

            waveform = self._extract_waveform_features(y, sr)

            # librosa supplies the waveform/onset features; madmom-infer owns
            # beats, downbeats, and tempo.
            beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=self.hop_length).tolist()
            downbeat_frames = librosa.time_to_frames(downbeat_times, sr=sr, hop_length=self.hop_length).tolist()

            # Compute tempo from beat intervals when madmom does not provide it.
            tempo_val = 0.0
            if len(beat_times) >= 2:
                intervals = [beat_times[i+1] - beat_times[i] for i in range(len(beat_times) - 1)]
                median_interval = sorted(intervals)[len(intervals) // 2]
                if median_interval > 0:
                    tempo_val = 60.0 / median_interval

            # Real onsets (librosa) — previously the downbeats were reported as
            # onsets, which conflated two different musical events. Downbeats now
            # travel in their own fields.
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
                    beat_times=beat_times,
                    onset_frames=onset_frames,
                    onset_times=onset_times,
                    confidence=beat_confidence(beat_times, tempo_val),
                    downbeat_frames=downbeat_frames,
                    downbeat_times=downbeat_times,
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
            # Decode ONCE, at native rate. This used to decode twice: once at
            # 22050 for sonara and again at the native rate for the waveform
            # features — ~5.5 s each on a 157 s track, so half the decode cost
            # was pure duplication. Resampling the buffer we already hold is
            # ~0.2 s, so the second decode is now pure waste.
            #
            # We still decode through our loader rather than letting sonara do
            # it: its bundled decoder mangles some containers (it reads a
            # 246.5 s stereo M4A as 493 s of ghost frames and hallucinates
            # phantom beats). analyze_signal() is identical but tracks the
            # correct timeline.
            load_audio, _, _ = _import_shared_audio()
            y_native, sr_native = load_audio(audio_path, sr=None)
            if len(y_native) == 0:
                raise ValueError("Audio file is empty or could not be loaded")

            if sr_native != _SONARA_SR:
                y = librosa.resample(y_native, orig_sr=sr_native, target_sr=_SONARA_SR)
            else:
                y = y_native
            if getattr(y, "ndim", 1) > 1:
                y = y.mean(axis=0)
            y32 = np.ascontiguousarray(y, dtype=np.float32)
            result = dict(_sonara.analyze_signal(y32, mode="compact"))

            waveform = self._extract_waveform_features(y_native, sr_native)

            beat_features = self._beat_features_from_sonara(result, sr_native)

            return AudioAnalysisResult(
                job_id=job_id,
                audio_file=str(audio_path),
                analysis_timestamp=datetime.now().isoformat(),
                waveform=waveform,
                beats=beat_features,
                metadata={
                    "backend": "sonara",
                    # Compact-mode timbre/loudness stats, so agents can use them
                    # without refetching the full sonara result.
                    "sonara": {
                        k: result.get(k)
                        for k in (
                            "duration_sec",
                            "bpm_raw",
                            "bpm_candidates",
                            "n_beats",
                            "rms_mean",
                            "rms_max",
                            "loudness_lufs",
                            "dynamic_range_db",
                            "spectral_centroid_mean",
                            "zero_crossing_rate",
                            "onset_density",
                        )
                        if result.get(k) is not None
                    },
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
