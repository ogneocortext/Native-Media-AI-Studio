"""
CUDA-accelerated processing module.

Provides GPU-accelerated audio analysis, image preprocessing, and
visualization FFT via PyTorch CUDA. Falls back to CPU (librosa/numpy)
when CUDA is unavailable.

Target hardware: GTX 1070 Ti (8GB VRAM, sm_61, 19 SMs) with PyTorch 2.5.1+cu124.
"""

from __future__ import annotations

import logging
import math
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CUDA availability check
# ---------------------------------------------------------------------------
_CUDA_AVAILABLE = False
_DEVICE = None

try:
    import torch
    if torch.cuda.is_available():
        _CUDA_AVAILABLE = True
        _DEVICE = torch.device("cuda:0")
        logger.info(
            "CUDA enabled: %s (CC %d.%d, %d MB VRAM)",
            torch.cuda.get_device_name(0),
            *torch.cuda.get_device_capability(0),
            torch.cuda.get_device_properties(0).total_memory // (1024 ** 2),
        )
    else:
        logger.info("CUDA not available — using CPU fallback")
except ImportError:
    logger.info("PyTorch not installed — CUDA processing disabled")


def cuda_available() -> bool:
    """Return True if PyTorch CUDA is available and initialized."""
    return _CUDA_AVAILABLE


def device():
    """Return the CUDA device, or None if unavailable."""
    return _DEVICE


# ---------------------------------------------------------------------------
# Audio analysis (GPU STFT + spectral features)
# ---------------------------------------------------------------------------
class CudaAudioAnalyzer:
    """GPU-accelerated audio analysis using torch.stft and torch.fft.

    Mirrors the feature set of the CPU-based `audio_analyzer.AudioAnalyzer`
    but runs STFT and spectral-feature ops on the GPU for throughput on
    large files or batch processing.
    """

    def __init__(
        self,
        sample_rate: int = 22050,
        n_fft: int = 2048,
        hop_length: int = 512,
        win_length: int | None = None,
    ):
        self.sample_rate = sample_rate
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.win_length = win_length or n_fft

    def analyze(self, audio: np.ndarray | list[float]) -> dict[str, Any]:
        """Analyze an audio buffer and return GPU-computed features.

        Args:
            audio: 1-D mono waveform samples (any length).

        Returns:
            Dict with amplitude_envelope, rms_energy, spectral_centroid,
            spectral_rolloff, spectral_bandwidth, onset_envelope
            (all as lists of floats).
        """
        if _CUDA_AVAILABLE:
            return self._analyze_cuda(audio)
        return self._analyze_cpu(audio)

    def _analyze_cuda(self, audio: np.ndarray | list[float]) -> dict[str, Any]:
        import torch

        waveform = torch.as_tensor(np.asarray(audio, dtype=np.float32), device=_DEVICE)

        # STFT on GPU
        window = torch.hann_window(self.win_length, device=_DEVICE)
        stft = torch.stft(
            waveform,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            win_length=self.win_length,
            window=window,
            return_complex=True,
            center=True,
            pad_mode="reflect",
        )
        magnitude = torch.abs(stft)  # (freq, time)
        power = magnitude ** 2

        # RMS energy per frame (amplitude envelope)
        rms = torch.sqrt(torch.mean(power, dim=0))
        rms_np = rms.cpu().numpy()
        if rms_np.max() > 0:
            rms_normalized = (rms_np - rms_np.min()) / (rms_np.max() - rms_np.min() + 1e-10)
        else:
            rms_normalized = np.zeros_like(rms_np)

        # Frequency bins for spectral features
        freqs = torch.fft.rfftfreq(self.n_fft, d=1.0 / self.sample_rate).to(_DEVICE)
        freqs_np = freqs.cpu().numpy()

        # Spectral centroid: sum(f * mag) / sum(mag)
        mag_sum = magnitude.sum(dim=0).clamp(min=1e-10)
        centroid = (freqs.unsqueeze(1) * magnitude).sum(dim=0) / mag_sum
        centroid_np = centroid.cpu().numpy()

        # Spectral rolloff: frequency below which 85% of energy lies
        cum_energy = torch.cumsum(magnitude, dim=0)
        total_energy = cum_energy[-1, :].clamp(min=1e-10)
        rolloff_threshold = 0.85 * total_energy
        # Convert bool to float for CUDA argmax compatibility
        rolloff_idx = torch.argmax((cum_energy >= rolloff_threshold).float(), dim=0)
        rolloff = freqs[rolloff_idx]
        rolloff_np = rolloff.cpu().numpy()

        # Spectral bandwidth: weighted std-dev of frequencies around centroid
        deviation = freqs.unsqueeze(1) - centroid.unsqueeze(0)
        bandwidth = torch.sqrt((deviation ** 2 * magnitude).sum(dim=0) / mag_sum)
        bandwidth_np = bandwidth.cpu().numpy()

        # Onset envelope: frame-to-frame difference of log-magnitude
        log_mag = torch.log(magnitude + 1e-10)
        onset = torch.zeros_like(log_mag[0])
        onset[1:] = torch.clamp(log_mag[:, 1:] - log_mag[:, :-1], min=0).sum(dim=0)
        onset_np = onset.cpu().numpy()

        return {
            "amplitude_envelope": rms_normalized.tolist(),
            "rms_energy": rms_np.tolist(),
            "spectral_centroid": centroid_np.tolist(),
            "spectral_rolloff": rolloff_np.tolist(),
            "spectral_bandwidth": bandwidth_np.tolist(),
            "onset_envelope": onset_np.tolist(),
            "n_frames": magnitude.shape[1],
            "duration_seconds": len(audio) / self.sample_rate,
            "computed_on": "cuda",
        }

    def _analyze_cpu(self, audio: np.ndarray | list[float]) -> dict[str, Any]:
        """CPU fallback using librosa-style numpy ops."""
        y = np.asarray(audio, dtype=np.float32)

        # RMS energy
        frame_length = self.win_length
        hop = self.hop_length
        frames = np.lib.stride_tricks.sliding_window_view(
            np.pad(y, (frame_length // 2, frame_length // 2), mode="reflect"),
            frame_length,
        )[::hop]
        if len(frames) == 0:
            frames = y[np.newaxis, :]
        rms = np.sqrt(np.mean(frames ** 2, axis=1))
        if rms.max() > 0:
            rms_normalized = (rms - rms.min()) / (rms.max() - rms.min() + 1e-10)
        else:
            rms_normalized = np.zeros_like(rms)

        # FFT-based spectral features
        stft = np.abs(
            np.fft.rfft(frames, n=self.n_fft)
        ) if frames.shape[-1] > 0 else np.array([[0.0]])
        freqs = np.fft.rfftfreq(self.n_fft, d=1.0 / self.sample_rate)

        mag_sum = stft.sum(axis=1, keepdims=True).clip(min=1e-10)
        centroid = (freqs[:, np.newaxis] * stft).sum(axis=0) / mag_sum.squeeze(1)

        return {
            "amplitude_envelope": rms_normalized.tolist(),
            "rms_energy": rms.tolist(),
            "spectral_centroid": centroid.tolist(),
            "spectral_rolloff": np.zeros_like(centroid).tolist(),
            "spectral_bandwidth": np.zeros_like(centroid).tolist(),
            "onset_envelope": np.zeros(len(rms)).tolist(),
            "n_frames": len(rms),
            "duration_seconds": len(y) / self.sample_rate,
            "computed_on": "cpu",
        }


# ---------------------------------------------------------------------------
# Image preprocessing (GPU resize / normalize / tensor conversion)
# ---------------------------------------------------------------------------
class CudaImageProcessor:
    """GPU-accelerated image preprocessing for the ComfyUI pipeline.

    Handles:
    - Resize with bilinear interpolation on GPU
    - Normalize to [-1, 1] or [0, 1] range
    - HWC <-> CHW format conversion
    - Batch processing
    """

    def __init__(self, target_size: tuple[int, int] | None = None):
        self.target_size = target_size  # (height, width)

    def preprocess(
        self,
        image: np.ndarray,
        *,
        normalize: str = "zero_one",
        channel_first: bool = True,
        target_size: tuple[int, int] | None = None,
    ) -> np.ndarray:
        """Preprocess an image on GPU.

        Args:
            image: HWC numpy array (uint8 0-255 or float).
            normalize: "zero_one" maps to [0, 1]; "neg_one" to [-1, 1].
            channel_first: If True, output CHW; otherwise HWC.
            target_size: (H, W) to resize to. Overrides instance default.

        Returns:
            Processed numpy array (float32).
        """
        size = target_size or self.target_size

        if _CUDA_AVAILABLE:
            import torch

            tensor = torch.as_tensor(image, device=_DEVICE, dtype=torch.float32)
            # HWC -> CHW
            if tensor.ndim == 3 and tensor.shape[2] in (1, 3, 4):
                tensor = tensor.permute(2, 0, 1)
            tensor = tensor.unsqueeze(0)  # add batch dim: (1, C, H, W)

            if size is not None:
                tensor = torch.nn.functional.interpolate(
                    tensor, size=size, mode="bilinear", align_corners=False, antialias=True
                )

            # Normalize from [0, 255] to target range
            if tensor.max() > 1.0:
                tensor = tensor / 255.0
            if normalize == "neg_one":
                tensor = tensor * 2.0 - 1.0

            if not channel_first:
                tensor = tensor.squeeze(0).permute(1, 2, 0)
            else:
                tensor = tensor.squeeze(0)

            return tensor.cpu().numpy()

        # CPU fallback
        img = image.astype(np.float32)
        if img.max() > 1.0:
            img = img / 255.0
        if normalize == "neg_one":
            img = img * 2.0 - 1.0
        if size is not None:
            from PIL import Image

            pil = Image.fromarray(
                (img * 255).clip(0, 255).astype(np.uint8)
            )
            pil = pil.resize((size[1], size[0]), Image.BILINEAR)
            img = np.array(pil, dtype=np.float32) / 255.0
            if normalize == "neg_one":
                img = img * 2.0 - 1.0
        return img

    def preprocess_batch(
        self,
        images: list[np.ndarray],
        *,
        normalize: str = "zero_one",
        target_size: tuple[int, int] | None = None,
    ) -> list[np.ndarray]:
        """Preprocess a batch of images on GPU."""
        return [self.preprocess(img, normalize=normalize, target_size=target_size) for img in images]


# ---------------------------------------------------------------------------
# Visualization FFT (GPU-accelerated spectrum for real-time rendering)
# ---------------------------------------------------------------------------
class CudaVisualizationFFT:
    """GPU-accelerated FFT for audio visualization.

    Provides smoothed spectrum frames suitable for real-time waveform
    and spectrum display in the music video pipeline.
    """

    def __init__(
        self,
        fft_size: int = 2048,
        smoothing: float = 0.8,
        num_bands: int = 64,
    ):
        self.fft_size = fft_size
        self.smoothing = smoothing
        self.num_bands = num_bands
        self._prev_spectrum: torch.Tensor | None = None

    def get_spectrum(
        self, audio_chunk: np.ndarray | list[float]
    ) -> list[float]:
        """Compute a smoothed magnitude spectrum for visualization.

        Args:
            audio_chunk: Audio samples (should be ~fft_size in length).

        Returns:
            List of `num_bands` float values (0-1 normalized).
        """
        if _CUDA_AVAILABLE:
            return self._spectrum_cuda(audio_chunk)
        return self._spectrum_cpu(audio_chunk)

    def _spectrum_cuda(self, audio_chunk: np.ndarray | list[float]) -> list[float]:
        import torch

        samples = np.asarray(audio_chunk, dtype=np.float32)
        if len(samples) < self.fft_size:
            samples = np.pad(samples, (0, self.fft_size - len(samples)))
        else:
            samples = samples[: self.fft_size]

        window = torch.hann_window(self.fft_size, device=_DEVICE)
        tensor = torch.as_tensor(samples, device=_DEVICE) * window
        fft = torch.fft.rfft(tensor)
        magnitude = torch.abs(fft[: self.fft_size // 2])

        # Log scale for perceptual magnitude
        log_mag = torch.log(magnitude + 1e-10)

        # Smooth with previous frame
        if self._prev_spectrum is not None:
            log_mag = self.smoothing * self._prev_spectrum + (1 - self.smoothing) * log_mag
        self._prev_spectrum = log_mag.clone()

        # Downsample to num_bands via averaging
        band_size = max(1, log_mag.shape[0] // self.num_bands)
        bands = log_mag[: self.num_bands * band_size].reshape(self.num_bands, band_size)
        spectrum = bands.mean(dim=1)

        # Normalize to 0-1
        s_min = spectrum.min()
        s_max = spectrum.max()
        if (s_max - s_min) > 1e-10:
            spectrum = (spectrum - s_min) / (s_max - s_min)

        return spectrum.cpu().numpy().tolist()

    def _spectrum_cpu(self, audio_chunk: np.ndarray | list[float]) -> list[float]:
        samples = np.asarray(audio_chunk, dtype=np.float32)
        if len(samples) < self.fft_size:
            samples = np.pad(samples, (0, self.fft_size - len(samples)))
        else:
            samples = samples[: self.fft_size]

        window = np.hanning(self.fft_size)
        fft = np.abs(np.fft.rfft(samples * window)[: self.fft_size // 2])
        log_mag = np.log(fft + 1e-10)

        if self._prev_spectrum is not None:
            prev = np.asarray(self._prev_spectrum)
            if len(prev) == len(log_mag):
                log_mag = self.smoothing * prev + (1 - self.smoothing) * log_mag
        self._prev_spectrum = log_mag.copy()

        band_size = max(1, len(log_mag) // self.num_bands)
        spectrum = np.array([
            log_mag[i * band_size:(i + 1) * band_size].mean()
            for i in range(self.num_bands)
        ])

        s_min, s_max = spectrum.min(), spectrum.max()
        if (s_max - s_min) > 1e-10:
            spectrum = (spectrum - s_min) / (s_max - s_min)

        return spectrum.tolist()

    def reset_smoothing(self):
        """Reset temporal smoothing state (e.g., on new track)."""
        self._prev_spectrum = None


# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------
cuda_audio = CudaAudioAnalyzer()
cuda_image = CudaImageProcessor()
cuda_viz = CudaVisualizationFFT()
