"""Suno Track Enhancer — 10-step auto-mix chain for separated stems.

Pipeline:
  1. Load stems (WAV)
  2. Normalize each stem to peak -1 dBFS
  3. Dynamic EQ carving (remove competing frequencies between stems)
  4. Per-stem compression (glue)
  5. De-ess vocals
  6. Stereo widen non-vocals
  7. Reverb/delay sends
  8. Mix stems with auto-leveling
  9. Master bus processing (limiter)
  10. Export final mix (WAV + optional MP3)

Usage:
    from app.services.suno_enhancer import enhance_stems
    result = await enhance_stems(stems_dir, output_dir)
"""

from __future__ import annotations

import asyncio
import logging
import math
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

try:
    import librosa

    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False

try:
    import soundfile as sf

    SOUNDFILE_AVAILABLE = True
except ImportError:
    SOUNDFILE_AVAILABLE = False


# ─── Config ──────────────────────────────────────────────────────────────────

@dataclass
class EnhanceConfig:
    """Tuning knobs for the 10-step auto-mix chain (KARRA / Gemini Suno guidance).

    Heuristic (always on):
      - High-pass at 110–130 Hz (spectral-centroid adaptive) to strip Demucs
        low-end bleed + Suno sub-bass rumble.
      - Anti-AI-grit: spectral gate on vocals, dynamic EQ taming 2.5–4 kHz.
      - No reverb on vocals (pseudo-reverb already baked into Suno exports).

    Needs-fallback / opt-in:
      - Vocal expander/transient recovery instead of compression (Suno vocals
        are already brickwalled; extra compression pumps artifacts).
      - Air boost + de-ess + gentle acompressor + true-peak limiter on vocals.
      - ±3 dB vocal balance macro slider.

    In The Mix upgrades:
      - Two-stage EQ (subtractive before comp, character after).
      - Parallel weight bus (-12 to -18 dB).
      - Sidechain "pocket EQ" on Other stem: duck 2.5–3.5 kHz while vocals sing.
    """
    target_peak_dbfs: float = -1.0
    attack_ms: float = 5.0
    release_ms: float = 80.0
    ratio: float = 2.5          # Gentle acompressor (2.5:1) — NOT brickwall
    threshold_dbfs: float = -24.0
    reverb_decay: float = 0.4
    reverb_mix: float = 0.12
    delay_mix: float = 0.08
    stereo_widen_amount: float = 0.3
    master_ceiling_dbfs: float = -1.0  # True-peak ceiling per KARRA preset
    output_format: str = "wav"  # "wav" | "mp3" | "both"
    # Suno-specific (heuristic)
    pre_highpass_hz: float = 120.0  # Gemini: 110–130 Hz, default 120
    vocal_spectral_gate_threshold_db: float = -40.0
    vocal_dynamic_eq_max_reduction_db: float = 4.0
    # Needs-fallback / KARRA preset toggles
    vocal_expander: bool = False   # expansion/transient recovery instead of compression
    deess_freq_hz: float = 6500.0  # KARRA de-ess at 6.5 kHz
    air_boost_gain_db: float = 2.5 # +2.5 dB air boost at 10 kHz
    air_boost_freq_hz: float = 10000.0
    vocal_balance_db: float = 0.0  # ±3 dB macro slider for vocal level
    # In The Mix upgrades
    parallel_weight_bus_db: float = -15.0  # -12 to -18 dB parallel weight
    sidechain_pocket_eq_enabled: bool = False  # duck 2.5–3.5 kHz on Other when vocals present


# ─── DSP helpers ─────────────────────────────────────────────────────────────

def _db_to_linear(db: float) -> float:
    return math.pow(10.0, db / 20.0)


def _linear_to_db(lin: float) -> float:
    if lin <= 0:
        return -100.0
    return 20.0 * math.log10(lin)


def _normalize_peak(y: np.ndarray, peak_dbfs: float = -1.0) -> np.ndarray:
    """Scale audio so peak = target_dbfs."""
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak < 1e-10:
        return y
    target = _db_to_linear(peak_dbfs)
    return y * (target / peak)


def _compress_audio(
    y: np.ndarray,
    sr: int,
    threshold_db: float = -24.0,
    ratio: float = 4.0,
    attack_ms: float = 5.0,
    release_ms: float = 80.0,
) -> np.ndarray:
    """Simple feed-forward compressor with smooth knee."""
    if y.size == 0:
        return y
    threshold = _db_to_linear(threshold_db)
    attack_coeff = math.exp(-1.0 / (attack_ms * 1e-3 * sr))
    release_coeff = math.exp(-1.0 / (release_ms * 1e-3 * sr))
    env = 0.0
    out = np.zeros_like(y, dtype=np.float32)
    for i in range(len(y)):
        abs_val = abs(y[i])
        if abs_val > env:
            env = attack_coeff * env + (1.0 - attack_coeff) * abs_val
        else:
            env = release_coeff * env + (1.0 - release_coeff) * abs_val
        gain = 1.0
        if env > threshold:
            gain = threshold / (env * (1.0 - 1.0 / ratio) + threshold / ratio)
        out[i] = y[i] * gain
    return out


def _de_ess(y: np.ndarray, sr: int, freq_hz: float = 7500.0, q: float = 1.5, amount: float = 0.5) -> np.ndarray:
    """Broadband de-esser: reduce energy around freq_hz when sibilance is detected."""
    if not LIBROSA_AVAILABLE or y.size == 0:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y, n_fft=n_fft, hop_length=hop)
    mag = np.abs(stft)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    band_mask = (freqs >= freq_hz - 1500.0) & (freqs <= freq_hz + 1500.0)
    if not np.any(band_mask):
        return y
    band_energy = np.mean(mag[band_mask, :], axis=0)
    rms = np.sqrt(np.mean(mag ** 2, axis=0)) + 1e-8
    ratio = band_energy / rms
    threshold = np.percentile(ratio, 85) if ratio.size else 1.0
    reduction = np.where(ratio > threshold, 1.0 - amount * (ratio - threshold) / (threshold + 1e-8), 0.0)
    reduction = np.clip(reduction, 0.0, amount)
    stft[band_mask, :] *= (1.0 - reduction[np.newaxis, :])
    return librosa.istft(stft, hop_length=hop)


def _stereo_widen(y: np.ndarray, amount: float = 0.3) -> np.ndarray:
    """Mid-side stereo widening for stereo signals; pass-through for mono."""
    if y.ndim < 2 or y.shape[0] < 2:
        return y
    left = y[0, :].astype(np.float32)
    right = y[1, :].astype(np.float32)
    mid = (left + right) * 0.5
    side = (left - right) * 0.5
    side *= 1.0 + amount
    left_out = mid + side
    right_out = mid - side
    out = np.stack([left_out, right_out], axis=0)
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 1.0:
        out /= peak
    return out


def _reverb_and_delay(
    y: np.ndarray,
    sr: int,
    decay: float = 0.4,
    mix: float = 0.12,
    delay_mix: float = 0.08,
) -> np.ndarray:
    """Simple convolution reverb + dotted eighth delay."""
    if y.size == 0:
        return y
    # Impulse response
    ir_len = int(sr * 1.8)
    ir = np.random.randn(ir_len).astype(np.float32)
    ir *= np.power(1.0 - np.arange(ir_len) / ir_len, decay * 10.0)
    ir /= np.max(np.abs(ir)) + 1e-8
    wet = np.convolve(y, ir, mode="full")[: y.shape[-1]]
    # Delay: ~330ms (dotted eighth at 90 BPM proxy)
    delay_samples = int(sr * 0.33)
    delayed = np.zeros_like(y, dtype=np.float32)
    if delay_samples < y.shape[-1]:
        delayed[delay_samples:] = y[: y.shape[-1] - delay_samples] * 0.6
    out = y + wet * mix + delayed * delay_mix
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 1.0:
        out /= peak
    return out


def _simple_limiter(y: np.ndarray, ceiling_db: float = -0.3) -> np.ndarray:
    """Brick-wall limiter with lookahead-ish soft knee."""
    if y.size == 0:
        return y
    ceiling = _db_to_linear(ceiling_db)
    out = y.copy()
    for i in range(len(y)):
        if abs(out[i]) > ceiling:
            out[i] = math.copysign(ceiling, out[i])
    return out


# ─── Anti-AI-grit helpers ─────────────────────────────────────────────────────
# Gemini guidance for AI-generated tracks (Suno/UVR5):
#   1. Pre high-pass < 30 Hz (sub-bass rumble / MP3 artifacts).
#   2. Post spectral gating on vocal stem (kill ghost bleed / phase smearing).
#   3. Dynamic EQ taming 2.5–4 kHz digital harshness.

def _high_pass(y: np.ndarray, sr: int, cutoff_hz: float = 30.0) -> np.ndarray:
    """Simple DC-blocking high-pass via FFT magnitude zeroing."""
    if y.size == 0 or not LIBROSA_AVAILABLE:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    mask = freqs < cutoff_hz
    if np.any(mask):
        stft[mask, :] = 0.0
    out = librosa.istft(stft, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


def _spectral_gate(
    y: np.ndarray,
    sr: int,
    threshold_db: float = -40.0,
    attack_ms: float = 10.0,
    release_ms: float = 100.0,
) -> np.ndarray:
    """Spectral gate: suppress bins below threshold (ghost bleed killer)."""
    if y.size == 0 or not LIBROSA_AVAILABLE:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    mag = np.abs(stft)
    phase = np.angle(stft)
    thresh = _db_to_linear(threshold_db)
    # Smooth gate envelope per bin
    env = np.zeros_like(mag)
    attack_coeff = math.exp(-1.0 / (attack_ms * 1e-3 * sr))
    release_coeff = math.exp(-1.0 / (release_ms * 1e-3 * sr))
    for i in range(mag.shape[1]):
        frame = mag[:, i]
        above = frame > thresh
        env[:, i] = np.where(
            above,
            attack_coeff * env[:, i - 1] + (1.0 - attack_coeff) * frame if i > 0 else frame,
            release_coeff * env[:, i - 1] if i > 0 else frame,
        )
    gate = np.clip(env / (mag + 1e-8), 0.0, 1.0)
    gated = (mag * gate) * np.exp(1j * phase)
    out = librosa.istft(gated, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


def _dynamic_eq_tame_harshness(
    y: np.ndarray,
    sr: int,
    freq_hz: float = 3200.0,
    bandwidth_hz: float = 1500.0,
    max_reduction_db: float = 4.0,
) -> np.ndarray:
    """Dynamic EQ: tame 2.5–4 kHz harshness when energy exceeds local mean."""
    if y.size == 0 or not LIBROSA_AVAILABLE:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    band_mask = (freqs >= freq_hz - bandwidth_hz) & (freqs <= freq_hz + bandwidth_hz)
    if not np.any(band_mask):
        return y
    band_energy = np.mean(np.abs(stft[band_mask, :]), axis=0)
    local_mean = np.mean(band_energy)
    # Reduce up to max_reduction_db when band exceeds mean by > 6 dB
    excess = band_energy / (local_mean + 1e-8)
    reduction = np.where(excess > 2.0, np.minimum(max_reduction_db, (excess - 2.0) * max_reduction_db), 0.0)
    lin_gain = _db_to_linear(-reduction)
    stft[band_mask, :] *= lin_gain[np.newaxis, :]
    out = librosa.istft(stft, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


# ─── KARRA / Gemini Suno Vocal Enhancer helpers ────────────────────────────────
# Reference preset (FFmpeg blueprint):
#   highpass=f=110 → dynamic tamer 2600/3800Hz → de-ess 6.5kHz →
#   air boost 10kHz +2.5dB → gentle acompressor 2.5:1 → alimiter -1.0dB
# We translate the same stages into numpy/librosa DSP.

def _vocal_expander(
    y: np.ndarray,
    sr: int,
    threshold_db: float = -45.0,
    ratio: float = 1.8,
    attack_ms: float = 1.0,
    release_ms: float = 60.0,
) -> np.ndarray:
    """Upward expander / transient recovery for brickwalled Suno vocals.

    Instead of compressing (which pumps artifacts), we gently expand the
    quietest passages back up, restoring micro-dynamics.
    """
    if y.size == 0:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    mag = np.abs(stft)
    phase = np.angle(stft)
    thresh = _db_to_linear(threshold_db)
    # Envelope per frame
    env = np.mean(mag, axis=0)
    attack_coeff = math.exp(-1.0 / (attack_ms * 1e-3 * sr))
    release_coeff = math.exp(-1.0 / (release_ms * 1e-3 * sr))
    smooth = np.zeros_like(env)
    for i in range(len(env)):
        if env[i] > smooth[i - 1] if i > 0 else 0:
            smooth[i] = attack_coeff * (smooth[i - 1] if i > 0 else 0) + (1.0 - attack_coeff) * env[i]
        else:
            smooth[i] = release_coeff * (smooth[i - 1] if i > 0 else 0) + (1.0 - release_coeff) * env[i]
    # Expand: boost below threshold by (1 - ratio) * (thresh - level)
    expand_gain = np.where(
        smooth < thresh,
        _db_to_linear((1.0 - 1.0 / ratio) * 20.0 * np.log10(thresh / (smooth + 1e-8))),
        1.0,
    )
    expand_gain = np.clip(expand_gain, 1.0, 4.0)
    mag_expanded = mag * expand_gain[np.newaxis, :]
    gated = mag_expanded * np.exp(1j * phase)
    out = librosa.istft(gated, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


def _air_boost(
    y: np.ndarray,
    sr: int,
    freq_hz: float = 10000.0,
    gain_db: float = 2.5,
    bandwidth_hz: float = 2000.0,
) -> np.ndarray:
    """High-frequency air boost above freq_hz."""
    if y.size == 0 or not LIBROSA_AVAILABLE:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    mask = (freqs >= freq_hz) & (freqs <= min(freq_hz + bandwidth_hz, sr / 2))
    if not np.any(mask):
        return y
    gain = _db_to_linear(gain_db)
    stft[mask, :] *= gain
    out = librosa.istft(stft, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


def _band_rms_deesser(
    y: np.ndarray,
    sr: int,
    freq_hz: float = 6500.0,
    bandwidth_hz: float = 3000.0,
    max_reduction_db: float = 6.0,
) -> np.ndarray:
    """Band-RMS-driven de-esser: reduce sibilance band when its energy exceeds
    the overall RMS by a threshold (heuristic depth, not fixed).
    """
    if y.size == 0 or not LIBROSA_AVAILABLE:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    band_mask = (freqs >= freq_hz - bandwidth_hz) & (freqs <= freq_hz + bandwidth_hz)
    if not np.any(band_mask):
        return y
    band_energy = np.mean(np.abs(stft[band_mask, :]), axis=0)
    overall_rms = np.sqrt(np.mean(np.abs(stft) ** 2, axis=0)) + 1e-8
    ratio = band_energy / overall_rms
    threshold = 1.8  # band is 1.8× overall RMS → start reducing
    reduction = np.where(ratio > threshold, np.minimum(max_reduction_db, (ratio - threshold) * max_reduction_db), 0.0)
    lin_gain = _db_to_linear(-reduction)
    stft[band_mask, :] *= lin_gain[np.newaxis, :]
    out = librosa.istft(stft, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


def _lufs_gain_stage(y: np.ndarray, target_lufs: float = -14.0) -> np.ndarray:
    """LUFS-like gain staging: normalize RMS to approximate target loudness.

    True LUFS requires pyloudnorm; this is a lightweight RMS proxy.
    """
    if y.size == 0:
        return y
    rms = float(np.sqrt(np.mean(y ** 2)))
    if rms < 1e-10:
        return y
    # Rough LUFS ≈ -0.691 + 10*log10(RMS^2) for full-scale sine
    current_lufs = 20.0 * math.log10(rms + 1e-10) - 0.691
    delta_db = target_lufs - current_lufs
    gain = _db_to_linear(delta_db)
    out = y * gain
    peak = float(np.max(np.abs(out)))
    if peak > 0.99:
        out *= 0.99 / peak
    return out.astype(np.float32)


def _parallel_weight_bus(
    y: np.ndarray,
    attenuation_db: float = -15.0,
) -> np.ndarray:
    """Parallel weight bus: blend an attenuated copy of the signal with the dry.

    In The Mix guidance: -12 to -18 dB parallel path adds body without
    increasing peak level. Used on the master mix or per-stem.
    """
    if y.size == 0:
        return y
    gain = _db_to_linear(attenuation_db)
    wet = y * gain
    out = y + wet
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.99:
        out *= 0.99 / peak
    return out.astype(np.float32)


def _sidechain_pocket_eq(
    vocals: np.ndarray,
    other: np.ndarray,
    sr: int,
    freq_hz: float = 3000.0,
    bandwidth_hz: float = 1000.0,
    max_reduction_db: float = 4.0,
) -> np.ndarray:
    """Sidechain pocket EQ: duck 2.5–3.5 kHz on Other when vocals are present.

    In The Mix guidance: sidechain-duck 2.5–3.5 kHz on the Other stem while
    vocals sing, creating a "pocket" for the vocal to sit in.
    """
    if other.size == 0 or vocals.size == 0 or not LIBROSA_AVAILABLE:
        return other
    n_fft = 2048
    hop = 512
    stft_v = librosa.stft(vocals[0] if vocals.ndim > 1 else vocals, n_fft=n_fft, hop_length=hop)
    stft_o = librosa.stft(other[0] if other.ndim > 1 else other, n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    band_mask = (freqs >= freq_hz - bandwidth_hz) & (freqs <= freq_hz + bandwidth_hz)
    if not np.any(band_mask):
        return other
    # Vocal energy in the pocket band drives reduction on Other
    vocal_band_energy = np.mean(np.abs(stft_v[band_mask, :]), axis=0)
    other_band_energy = np.mean(np.abs(stft_o[band_mask, :]), axis=0)
    # When vocal band energy exceeds Other band energy, duck Other
    ratio = vocal_band_energy / (other_band_energy + 1e-8)
    reduction = np.where(ratio > 1.0, np.minimum(max_reduction_db, (ratio - 1.0) * max_reduction_db), 0.0)
    lin_gain = _db_to_linear(-reduction)
    stft_o[band_mask, :] *= lin_gain[np.newaxis, :]
    out = librosa.istft(stft_o, hop_length=hop)
    target_len = other.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


# ─── Core pipeline ────────────────────────────────────────────────────────────

@dataclass
class EnhanceResult:
    success: bool
    output_dir: str | None
    wav_path: str | None
    mp3_path: str | None
    steps: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


class SunoEnhancer:
    """10-step auto-mix chain for separated stems."""

    def __init__(self, config: EnhanceConfig | None = None):
        self.config = config or EnhanceConfig()

    async def enhance_stems(
        self,
        stems_dir: str | Path,
        output_dir: str | Path | None = None,
    ) -> EnhanceResult:
        """Run the full 10-step pipeline on a Demucs output directory."""
        steps: list[dict[str, Any]] = []
        stems_dir = Path(stems_dir)
        if not stems_dir.exists():
            return EnhanceResult(False, None, None, None, error=f"stems_dir not found: {stems_dir}")

        if output_dir is None:
            output_dir = stems_dir / "enhanced"
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        if not LIBROSA_AVAILABLE:
            return EnhanceResult(False, str(output_dir), None, None, error="librosa not installed")

        stem_names = ["vocals", "drums", "bass", "other"]
        loaded: dict[str, np.ndarray] = {}
        sr = 22050

        # ── Step 1: Load stems ──────────────────────────────────────────────
        try:
            for name in stem_names:
                wav = stems_dir / f"{name}.wav"
                if not wav.exists():
                    continue
                y, loaded_sr = await asyncio.to_thread(librosa.load, str(wav), sr=sr, mono=False)
                if loaded_sr != sr:
                    y = await asyncio.to_thread(librosa.resample, y, loaded_sr, sr)
                loaded[name] = y.astype(np.float32)
            steps.append({"step": 1, "name": "load", "stems": list(loaded.keys())})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"load failed: {exc}")

        if not loaded:
            return EnhanceResult(False, str(output_dir), None, None, error="no stems found")

        # Ensure mono fallback
        for name, y in loaded.items():
            if y.ndim == 1:
                loaded[name] = y[np.newaxis, :]

        # ── Step 2a: Pre high-pass (heuristic: spectral-centroid adaptive) ────
        # Gemini KARRA: push HPF to 110–130 Hz for Suno + Demucs low-end bleed.
        # Default 120 Hz; adapt down to 80 Hz only when spectral centroid is very low.
        try:
            adaptive_hp = self.config.pre_highpass_hz
            if LIBROSA_AVAILABLE and "vocals" in loaded:
                try:
                    centroid = librosa.feature.spectral_centroid(y=loaded["vocals"][0], sr=sr, n_fft=2048, hop_length=512)
                    c_mean = float(np.mean(centroid))
                    if c_mean < 800.0:
                        adaptive_hp = max(80.0, adaptive_hp - 30.0)
                except Exception:
                    pass
            for name, y in loaded.items():
                loaded[name] = _high_pass(y[0], sr, cutoff_hz=adaptive_hp)
                if loaded[name].ndim == 1:
                    loaded[name] = loaded[name][np.newaxis, :]
            steps.append({"step": 2, "name": "pre_highpass", "cutoff_hz": adaptive_hp})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"pre_highpass failed: {exc}")

        # ── Step 2b: LUFS gain staging (heuristic) ───────────────────────────
        try:
            for name, y in loaded.items():
                loaded[name] = _lufs_gain_stage(y, target_lufs=-14.0)
            steps.append({"step": 3, "name": "lufs_gain_stage", "target_lufs": -14.0})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"lufs_gain_stage failed: {exc}")

        # ── Step 3: Normalize ─────────────────────────────────────────────
        try:
            for name, y in loaded.items():
                loaded[name] = _normalize_peak(y, self.config.target_peak_dbfs)
            steps.append({"step": 3, "name": "normalize", "peak_dbfs": self.config.target_peak_dbfs})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"normalize failed: {exc}")

        # ── Step 4: Per-stem processing (KARRA split) ───────────────────────
        # Heuristic (always): non-vocals get gentle glue compression.
        # Needs-fallback (opt-in): vocals get expander + KARRA preset instead.
        try:
            for name, y in loaded.items():
                chans = []
                for c in range(y.shape[0]):
                    if name == "vocals" and self.config.vocal_expander:
                        # KARRA path: expander/transient recovery (no compression)
                        chans.append(_vocal_expander(
                            y[c], sr,
                            threshold_db=-45.0,
                            ratio=1.8,
                        ))
                    else:
                        chans.append(_compress_audio(
                            y[c], sr,
                            threshold_db=self.config.threshold_dbfs,
                            ratio=self.config.ratio,
                            attack_ms=self.config.attack_ms,
                            release_ms=self.config.release_ms,
                        ))
                loaded[name] = np.stack(chans, axis=0)
            steps.append({"step": 4, "name": "stem_processing", "vocal_expander": self.config.vocal_expander})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"stem_processing failed: {exc}")

        # ── Step 5: De-ess vocals (band-RMS heuristic) ──────────────────────
        try:
            if "vocals" in loaded:
                vocals = loaded["vocals"]
                deessed = np.stack([_band_rms_deesser(
                    vocals[c], sr,
                    freq_hz=self.config.deess_freq_hz,
                    bandwidth_hz=3000.0,
                    max_reduction_db=6.0,
                ) for c in range(vocals.shape[0])], axis=0)
                loaded["vocals"] = deessed
                steps.append({"step": 5, "name": "deess", "target": "vocals", "freq_hz": self.config.deess_freq_hz})
            else:
                steps.append({"step": 5, "name": "deess", "skipped": True})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"deess failed: {exc}")

        # ── Step 6: KARRA vocal chain (air boost + gentle acompressor) ──────
        try:
            if "vocals" in loaded:
                vocals = loaded["vocals"]
                # Air boost at 10 kHz
                aired = np.stack([_air_boost(
                    vocals[c], sr,
                    freq_hz=self.config.air_boost_freq_hz,
                    gain_db=self.config.air_boost_gain_db,
                    bandwidth_hz=2000.0,
                ) for c in range(vocals.shape[0])], axis=0)
                # Gentle acompressor 2.5:1
                comped = np.stack([_compress_audio(
                    aired[c], sr,
                    threshold_db=-18.0,
                    ratio=self.config.ratio,
                    attack_ms=2.0,
                    release_ms=40.0,
                ) for c in range(vocals.shape[0])], axis=0)
                loaded["vocals"] = comped
                steps.append({"step": 6, "name": "karrra_vocal_chain", "air_boost_db": self.config.air_boost_gain_db})
            else:
                steps.append({"step": 6, "name": "karrra_vocal_chain", "skipped": True})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"karrra_vocal_chain failed: {exc}")

        # ── Step 7: Vocal balance ±3 dB macro + stereo widen non-vocals ─────
        try:
            if "vocals" in loaded and self.config.vocal_balance_db != 0.0:
                bal = _db_to_linear(self.config.vocal_balance_db)
                loaded["vocals"] = loaded["vocals"] * bal
                steps.append({"step": 7, "name": "vocal_balance", "db": self.config.vocal_balance_db})
            for name in ("drums", "bass", "other"):
                if name not in loaded:
                    continue
                y = loaded[name]
                if y.ndim >= 2 and y.shape[0] >= 2:
                    loaded[name] = _stereo_widen(y, self.config.stereo_widen_amount)
            steps.append({"step": 7, "name": "stereo_widen", "amount": self.config.stereo_widen_amount})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"stereo_widen failed: {exc}")

        # ── Step 8: Post spectral gating on vocals (ghost bleed killer) ─────
        try:
            if "vocals" in loaded:
                vocals = loaded["vocals"]
                gated = np.stack([_spectral_gate(vocals[c], sr, threshold_db=self.config.vocal_spectral_gate_threshold_db) for c in range(vocals.shape[0])], axis=0)
                loaded["vocals"] = gated
                steps.append({"step": 8, "name": "vocal_spectral_gate", "threshold_db": self.config.vocal_spectral_gate_threshold_db})
            else:
                steps.append({"step": 8, "name": "vocal_spectral_gate", "skipped": True})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"vocal_spectral_gate failed: {exc}")

        # ── Step 9: Dynamic EQ tame 2.5–4 kHz harshness on vocals ──────────
        try:
            if "vocals" in loaded:
                vocals = loaded["vocals"]
                tamed = np.stack([_dynamic_eq_tame_harshness(vocals[c], sr, max_reduction_db=self.config.vocal_dynamic_eq_max_reduction_db) for c in range(vocals.shape[0])], axis=0)
                loaded["vocals"] = tamed
                steps.append({"step": 9, "name": "vocal_dynamic_eq", "freq_hz": 3200.0, "max_reduction_db": self.config.vocal_dynamic_eq_max_reduction_db})
            else:
                steps.append({"step": 9, "name": "vocal_dynamic_eq", "skipped": True})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"vocal_dynamic_eq failed: {exc}")

        # ── Step 10: Parallel weight bus (-12 to -18 dB) ─────────────────────
        try:
            if self.config.parallel_weight_bus_db != 0.0:
                for name, y in loaded.items():
                    loaded[name] = _parallel_weight_bus(y, self.config.parallel_weight_bus_db)
                steps.append({"step": 10, "name": "parallel_weight_bus", "attenuation_db": self.config.parallel_weight_bus_db})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"parallel_weight_bus failed: {exc}")

        # ── Step 11: Sidechain pocket EQ on Other while vocals sing ───────────
        try:
            if self.config.sidechain_pocket_eq_enabled and "vocals" in loaded and "other" in loaded:
                vocals_y = loaded["vocals"]
                other_y = loaded["other"]
                # Ensure mono for band analysis
                v_mono = vocals_y[0] if vocals_y.ndim > 1 else vocals_y
                o_mono = other_y[0] if other_y.ndim > 1 else other_y
                min_len = min(v_mono.shape[-1], o_mono.shape[-1])
                if min_len > 0:
                    pocket = _sidechain_pocket_eq(
                        v_mono[:min_len][np.newaxis, :],
                        o_mono[:min_len][np.newaxis, :],
                        sr,
                        freq_hz=3000.0,
                        bandwidth_hz=1000.0,
                        max_reduction_db=4.0,
                    )
                    if other_y.ndim > 1:
                        other_y[0, :min_len] = pocket[0, :min_len]
                    else:
                        other_y[:min_len] = pocket[0, :min_len]
                    loaded["other"] = other_y
                steps.append({"step": 11, "name": "sidechain_pocket_eq", "freq_hz": 3000.0})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"sidechain_pocket_eq failed: {exc}")

        # ── Step 12: Reverb/delay sends (vocals EXCLUDED — pseudo-reverb baked in) ──
        try:
            for name, y in loaded.items():
                send_target = y
                if name != "vocals":
                    send_target = _reverb_and_delay(
                        y, sr,
                        decay=self.config.reverb_decay,
                        mix=self.config.reverb_mix,
                        delay_mix=self.config.delay_mix,
                    )
                loaded[name] = send_target
            steps.append({"step": 12, "name": "fx_sends", "reverb_mix": self.config.reverb_mix, "delay_mix": self.config.delay_mix, "vocals_excluded": True})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"fx_sends failed: {exc}")

        # ── Step 13: Mix stems with auto-leveling ───────────────────────────
        try:
            mixed = await asyncio.to_thread(self._mix_stems, loaded, sr)
            steps.append({"step": 13, "name": "mix", "method": "auto_level"})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"mix failed: {exc}")

        # ── Step 14: Master bus true-peak limiter (-1.0 dB) ─────────────────
        try:
            mixed = _simple_limiter(mixed, self.config.master_ceiling_dbfs)
            steps.append({"step": 14, "name": "limiter", "ceiling_dbfs": self.config.master_ceiling_dbfs})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), None, None, steps=steps, error=f"limiter failed: {exc}")

        # ── Step 13: Export ────────────────────────────────────────────────
        wav_path = None
        mp3_path = None
        try:
            base_name = stems_dir.name
            if self.config.output_format in ("wav", "both"):
                wav_path = output_dir / f"{base_name}_enhanced.wav"
                await asyncio.to_thread(self._write_wav, wav_path, mixed, sr)
                steps.append({"step": 10, "name": "export_wav", "path": str(wav_path)})
            if self.config.output_format in ("mp3", "both"):
                mp3_path = output_dir / f"{base_name}_enhanced.mp3"
                await asyncio.to_thread(self._encode_mp3, wav_path or output_dir / f"{base_name}_enhanced.wav", mp3_path, mixed, sr)
                steps.append({"step": 10, "name": "export_mp3", "path": str(mp3_path)})
        except Exception as exc:
            return EnhanceResult(False, str(output_dir), wav_path, mp3_path, steps=steps, error=f"export failed: {exc}")

        return EnhanceResult(True, str(output_dir), str(wav_path) if wav_path else None, str(mp3_path) if mp3_path else None, steps=steps)

    def _eq_carve(self, loaded: dict[str, np.ndarray], sr: int) -> dict[str, np.ndarray]:
        """Step 3: subtract overlapping energy between stems."""
        out = dict(loaded)
        names = list(out.keys())
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                ya, yb = out[a], out[b]
                min_len = min(ya.shape[-1], yb.shape[-1])
                if min_len < 1:
                    continue
                ya_cut = ya[..., :min_len]
                yb_cut = yb[..., :min_len]
                # Spectral subtraction via magnitude subtraction in STFT
                if not LIBROSA_AVAILABLE:
                    continue
                n_fft = 2048
                hop = 512
                sta = librosa.stft(ya_cut[0], n_fft=n_fft, hop_length=hop)
                stb = librosa.stft(yb_cut[0], n_fft=n_fft, hop_length=hop)
                mag_a = np.abs(sta)
                mag_b = np.abs(stb)
                # Carve: subtract 30% of b's energy from a where b dominates
                diff = np.maximum(mag_a - 0.3 * mag_b, 0.0)
                phase_a = np.angle(sta)
                carved = librosa.istft(diff * np.exp(1j * phase_a), hop_length=hop)
                target_len = ya_cut.shape[-1]
                if carved.shape[0] < target_len:
                    pad = np.zeros(target_len - carved.shape[0], dtype=np.float32)
                    carved = np.concatenate([carved, pad])
                elif carved.shape[0] > target_len:
                    carved = carved[:target_len]
                out[a] = ya.copy()
                out[a][0, :] = carved.astype(np.float32)
        return out

    def _mix_stems(self, loaded: dict[str, np.ndarray], sr: int) -> np.ndarray:
        """Step 8: auto-level mix by RMS energy."""
        weights: dict[str, float] = {}
        for name, y in loaded.items():
            rms = float(np.sqrt(np.mean(y ** 2))) if y.size else 0.0
            weights[name] = 1.0 / max(rms, 1e-6)
        total = sum(weights.values()) or 1.0
        for k in weights:
            weights[k] /= total
        # Target length = longest stem
        max_len = max(y.shape[-1] for y in loaded.values()) if loaded else 0
        mixed = np.zeros(max_len, dtype=np.float32)
        for name, y in loaded.items():
            w = weights[name]
            if y.shape[-1] < max_len:
                pad = np.zeros(max_len - y.shape[-1], dtype=np.float32)
                y = np.concatenate([y, pad], axis=-1)
            for c in range(min(y.shape[0], 2)):
                mixed += y[c, :max_len] * w
        peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
        if peak > 1.0:
            mixed /= peak
        return mixed

    def _write_wav(self, path: Path, y: np.ndarray, sr: int) -> None:
        if SOUNDFILE_AVAILABLE:
            sf.write(str(path), y.T if y.ndim > 1 else y, sr, subtype="FLOAT")
        else:
            import wave
            wav_path = str(path)
            with wave.open(wav_path, "wb") as wf:
                wf.setnchannels(2 if y.ndim > 1 else 1)
                wf.setsampwidth(4)
                wf.setframerate(sr)
                data = (y.T if y.ndim > 1 else y).astype(np.float32)
                wf.writeframes(data.tobytes())

    def _encode_mp3(self, wav_path: Path, mp3_path: Path, y: np.ndarray, sr: int) -> None:
        ffmpeg = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found — cannot encode MP3")
        if not wav_path.exists():
            raise FileNotFoundError(f"intermediate WAV missing: {wav_path}")
        cmd = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(wav_path),
            "-codec:a", "libmp3lame", "-q:a", "2",
            str(mp3_path),
        ]
        subprocess.run(cmd, encoding="utf-8", errors="replace", check=True, capture_output=True, text=True, timeout=300)


# ─── Async entry point ────────────────────────────────────────────────────────

async def enhance_stems(
    stems_dir: str | Path,
    output_dir: str | Path | None = None,
    config: EnhanceConfig | None = None,
) -> EnhanceResult:
    """Enhance separated stems using the 10-step auto-mix chain."""
    enhancer = SunoEnhancer(config=config)
    return await enhancer.enhance_stems(stems_dir, output_dir)
