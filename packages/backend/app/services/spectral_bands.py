"""Multi-band spectral analysis with envelope followers and transient detection.

Splits the FFT into 3 bands (sub 20-120Hz, mids 500Hz-2kHz, highs 4-16kHz),
each with its own attack/decay envelope follower plus a transient/peak trigger.
Turns one energy number into four independent control signals for visualization.

Also computes spectral centroid per frame for hue mapping.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

SUB_BAND = (20.0, 120.0)
MID_BAND = (500.0, 2000.0)
HIGH_BAND = (4000.0, 16000.0)

DEFAULT_ATTACK = 0.3
DEFAULT_DECAY = 0.08
DEFAULT_TRANSIENT_THRESHOLD = 1.5
DEFAULT_TRANSIENT_DECAY = 0.92


@dataclass
class BandEnvelope:
    """Attack/decay envelope follower for a single frequency band."""

    attack: float = DEFAULT_ATTACK
    decay: float = DEFAULT_DECAY
    _value: float = 0.0

    def process(self, energy: float) -> float:
        if energy > self._value:
            self._value = self._value + self.attack * (energy - self._value)
        else:
            self._value = self._value + self.decay * (energy - self._value)
        return self._value

    def reset(self) -> None:
        self._value = 0.0


@dataclass
class TransientDetector:
    """Peak/transient detector with adaptive threshold and decay."""

    threshold: float = DEFAULT_TRANSIENT_THRESHOLD
    decay: float = DEFAULT_TRANSIENT_DECAY
    _history: list[float] = field(default_factory=list)
    _history_size: int = 30
    _value: float = 0.0

    def process(self, energy: float) -> float:
        self._history.append(energy)
        if len(self._history) > self._history_size:
            self._history.pop(0)

        if len(self._history) >= 3:
            mean = float(np.mean(self._history))
            std = float(np.std(self._history)) + 1e-8
            is_transient = energy > mean + self.threshold * std
        else:
            is_transient = False

        if is_transient:
            self._value = 1.0
        else:
            self._value *= self.decay
            if self._value < 0.01:
                self._value = 0.0

        return self._value

    def reset(self) -> None:
        self._history.clear()
        self._value = 0.0


@dataclass
class SpectralBandFrame:
    """Per-frame spectral band energies."""

    frame: int
    time: float
    sub: float
    mid: float
    high: float
    transient: float
    centroid: float
    rms: float


class SpectralBandAnalyzer:
    """Analyzes audio into per-frame multi-band spectral features.

    Uses librosa STFT to compute per-frame band energies, then runs each band
    through an envelope follower and transient detector.
    """

    def __init__(
        self,
        sr: int = 22050,
        hop_length: int = 512,
        n_fft: int = 2048,
        attack: float = DEFAULT_ATTACK,
        decay: float = DEFAULT_DECAY,
        transient_threshold: float = DEFAULT_TRANSIENT_THRESHOLD,
        transient_decay: float = DEFAULT_TRANSIENT_DECAY,
    ):
        self.sr = sr
        self.hop_length = hop_length
        self.n_fft = n_fft
        self.sub_env = BandEnvelope(attack=attack, decay=decay)
        self.mid_env = BandEnvelope(attack=attack, decay=decay)
        self.high_env = BandEnvelope(attack=attack, decay=decay)
        self.sub_transient = TransientDetector(
            threshold=transient_threshold, decay=transient_decay
        )
        self.mid_transient = TransientDetector(
            threshold=transient_threshold, decay=transient_decay
        )
        self.high_transient = TransientDetector(
            threshold=transient_threshold, decay=transient_decay
        )

    def analyze(self, y: np.ndarray) -> list[SpectralBandFrame]:
        """Run full spectral band analysis on audio time series.

        Args:
            y: Mono audio time series.

        Returns:
            List of SpectralBandFrame, one per STFT frame.
        """
        import librosa

        stft = np.abs(librosa.stft(y, n_fft=self.n_fft, hop_length=self.hop_length))
        freqs = librosa.fft_frequencies(sr=self.sr, n_fft=self.n_fft)

        sub_mask = (freqs >= SUB_BAND[0]) & (freqs < SUB_BAND[1])
        mid_mask = (freqs >= MID_BAND[0]) & (freqs < MID_BAND[1])
        high_mask = (freqs >= HIGH_BAND[0]) & (freqs < HIGH_BAND[1])

        sub_energy = np.mean(stft[sub_mask, :], axis=0) if np.any(sub_mask) else np.zeros(stft.shape[1])
        mid_energy = np.mean(stft[mid_mask, :], axis=0) if np.any(mid_mask) else np.zeros(stft.shape[1])
        high_energy = np.mean(stft[high_mask, :], axis=0) if np.any(high_mask) else np.zeros(stft.shape[1])

        sub_energy = self._normalize(sub_energy)
        mid_energy = self._normalize(mid_energy)
        high_energy = self._normalize(high_energy)

        centroid = librosa.feature.spectral_centroid(
            S=stft, sr=self.sr, hop_length=self.hop_length
        )[0]
        centroid = self._normalize(centroid)

        rms = librosa.feature.rms(
            S=stft, hop_length=self.hop_length, frame_length=self.n_fft
        )[0]
        rms = self._normalize(rms)

        n_frames = stft.shape[1]
        frames: list[SpectralBandFrame] = []
        for i in range(n_frames):
            t = float(i * self.hop_length / self.sr)
            sub_val = float(sub_energy[i])
            mid_val = float(mid_energy[i])
            high_val = float(high_energy[i])

            sub_env = self.sub_env.process(sub_val)
            mid_env = self.mid_env.process(mid_val)
            high_env = self.high_env.process(high_val)

            sub_tr = self.sub_transient.process(sub_val)
            mid_tr = self.mid_transient.process(mid_val)
            high_tr = self.high_transient.process(high_val)

            frames.append(
                SpectralBandFrame(
                    frame=i,
                    time=round(t, 4),
                    sub=round(sub_env, 6),
                    mid=round(mid_env, 6),
                    high=round(high_env, 6),
                    transient=round(max(sub_tr, mid_tr, high_tr), 6),
                    centroid=round(float(centroid[i]), 6),
                    rms=round(float(rms[i]), 6),
                )
            )

        return frames

    @staticmethod
    def _normalize(arr: np.ndarray) -> np.ndarray:
        arr = np.asarray(arr, dtype=np.float64)
        min_val = float(np.min(arr))
        max_val = float(np.max(arr))
        if max_val - min_val < 1e-10:
            return np.zeros_like(arr)
        return (arr - min_val) / (max_val - min_val)

    def reset(self) -> None:
        self.sub_env.reset()
        self.mid_env.reset()
        self.high_env.reset()
        self.sub_transient.reset()
        self.mid_transient.reset()
        self.high_transient.reset()


def frames_to_timeline(frames: list[SpectralBandFrame]) -> list[dict[str, Any]]:
    """Convert SpectralBandFrame list to JSON-serializable timeline."""
    return [
        {
            "frame": f.frame,
            "time": f.time,
            "sub": f.sub,
            "mid": f.mid,
            "high": f.high,
            "transient": f.transient,
            "centroid": f.centroid,
            "rms": f.rms,
        }
        for f in frames
    ]


def analyze_audio_bands(
    y: np.ndarray,
    sr: int = 22050,
    hop_length: int = 512,
    n_fft: int = 2048,
) -> list[dict[str, Any]]:
    """Convenience function: analyze audio and return JSON-ready timeline.

    Args:
        y: Mono audio time series.
        sr: Sample rate.
        hop_length: STFT hop length.
        n_fft: FFT window size.

    Returns:
        List of per-frame dicts with sub/mid/high/transient/centroid/rms.
    """
    analyzer = SpectralBandAnalyzer(sr=sr, hop_length=hop_length, n_fft=n_fft)
    frames = analyzer.analyze(y)
    return frames_to_timeline(frames)
