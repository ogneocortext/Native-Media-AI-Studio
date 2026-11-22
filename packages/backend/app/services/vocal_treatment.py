"""
Standalone vocal treatment stage -- treat a single vocal stem (or any single
audio file) on its own, with before/after measurement.

New module per the vocal-treatment packet. Lives in ``services/`` because the
backend layering rule is api -> services -> adapters (D32); ``audio_vocal.py``
owns the routes and this module owns the pure DSP.

Chain (per-file, in order):
  1. decode (FFmpeg rawaudio -> float32 PCM)
  2. measure before (LUFS / true peak / LRA via ebur128 + band energies)
  3. de-ess (dynamic, sibilance band ~5-9 kHz, max reduction = deess_amount_db)
     -- reuses _band_rms_deesser from services/suno_enhancer.py
  4. vocal dynamic EQ harshness tame (reuse enhancer logic, 2-5 kHz, max 3 dB)
     -- reuses _dynamic_eq_tame_harshness from services/suno_enhancer.py
  5. static tone: low-mid body shelf ~250 Hz (+body_db) + presence peak ~3.2 kHz (+presence_db)
     -- reuses mastering.py RBJ filter designers
  6. warmth saturation (tanh soft-clip waveshaper, drive/warmth_mix, 2x oversampled, gain-compensated)
  7. true-peak limit to ceiling (reuse mastering's limiter approach)
  8. encode to output/audio/vocal-treated/<stem>_treated.wav  (WAV deliverable)
     (+ .mp3 sibling)
  9. measure after from the written artifact (D17: assert the artifact, not the intent)

Measurement QC language (measure_vocal): integrated LUFS, true peak (dBTP),
LRA (LU), plus band energies:
  - sibilance 5-9 kHz
  - harshness 2-5 kHz
  - body 150-400 Hz

numpy/scipy only. No pyloudnorm (see mastering.py header). Loudness stays on
the FFmpeg ebur128 path.

Does NOT modify services/suno_enhancer.py or services/mastering.py -- imports
their separable helpers only.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal as scipy_signal

from ..core.config import PROJECT_ROOT
from .ffmpeg_tools import _find_binary, _run, compute_loudness
from .mastering import (
    DEFAULT_CEILING_DBTP,
    OVERSAMPLE,
    Pcm,
    _apply_filter_ba,
    _band_energy_db,
    _decode_audio,
    _design_lowshelf,
    _design_peaking,
    _encode_audio,
    _true_peak_limit,
)
from .suno_enhancer import _band_rms_deesser, _dynamic_eq_tame_harshness

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths / constants
# ---------------------------------------------------------------------------

AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
VOCAL_TREATED_DIR = AUDIO_DIR / "vocal-treated"
VOCAL_TREATED_DIR.mkdir(parents=True, exist_ok=True)

# Default treatment knobs (all defaulted so {} + filename works).
DEFAULT_DEESS_AMOUNT_DB = 4.0
DEFAULT_WARMTH_DRIVE = 0.15
DEFAULT_WARMTH_MIX = 0.35
DEFAULT_BODY_DB = 1.5
DEFAULT_PRESENCE_DB = 1.0

# De-ess: sibilance band ~5-9 kHz.
DEESS_FREQ_HZ = 7000.0
DEESS_BANDWIDTH_HZ = 2000.0  # band = freq +/- bandwidth -> 5000-9000 Hz

# Dynamic EQ harshness tame: 2-5 kHz.
HARSHNESS_FREQ_HZ = 3500.0
HARSHNESS_BANDWIDTH_HZ = 1500.0  # band = freq +/- bandwidth -> 2000-5000 Hz
HARSHNESS_MAX_REDUCTION_DB = 3.0

# Static tone: body shelf ~250 Hz, presence peak ~3.2 kHz.
BODY_SHELF_HZ = 250.0
PRESENCE_PEAK_HZ = 3200.0

# Warmth saturation.
WARMTH_TANH_SCALE = 6.0  # scales `drive` into perceptible tanh saturation

# Band-energy QC bands (Hz).
BAND_SIBILANCE_LO_HZ = 5000.0
BAND_SIBILANCE_HI_HZ = 9000.0
BAND_HARSHNESS_LO_HZ = 2000.0
BAND_HARSHNESS_HI_HZ = 5000.0
BAND_BODY_LO_HZ = 150.0
BAND_BODY_HI_HZ = 400.0


# ---------------------------------------------------------------------------
# PCM helpers
# ---------------------------------------------------------------------------


async def _encode_wav(pcm: Pcm, output_path: str | Path) -> bool:
    """Encode interleaved float32 PCM to a WAV file via FFmpeg (pcm_s16le)."""
    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        logger.error("ffmpeg not found on PATH; cannot encode %s", output_path)
        return False
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    channels = pcm.samples.shape[1] if pcm.samples.ndim == 2 else 1
    try:
        proc = await _run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "f32le",
                "-acodec",
                "pcm_f32le",
                "-ar",
                str(pcm.sample_rate),
                "-ac",
                str(channels),
                "-i",
                "-",
                "-c:a",
                "pcm_s16le",
                str(out),
            ],
            input=pcm.samples.astype("<f4").tobytes(),
            capture_output=True,
            timeout=300,
        )
        if proc.returncode != 0:
            logger.error("ffmpeg WAV encode failed for %s: %s", output_path, proc.stderr)
            return False
        return out.exists() and out.stat().st_size > 0
    except Exception as exc:  # noqa: BLE001
        logger.error("WAV encode error for %s: %s", output_path, exc)
        return False


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------


async def _measure_loudness(file_path: str | Path) -> dict[str, Any]:
    """Measure integrated loudness (LUFS), true peak (dBTP) and LRA (LU).

    Reuses ``compute_loudness`` (FFmpeg ebur128). Returns keys
    ``integrated_lufs``, ``true_peak_dbtp``, ``lra_lu`` and ``error``.
    Never raises.
    """
    result = await compute_loudness(file_path)
    return {
        "integrated_lufs": result.get("integrated_lufs"),
        "true_peak_dbtp": result.get("true_peak"),
        "lra_lu": result.get("loudness_range"),
        "error": result.get("error"),
    }


async def _measure_bands(samples: np.ndarray, sample_rate: int) -> dict[str, float]:
    """Band-energy QC: sibilance 5-9 kHz, harshness 2-5 kHz, body 150-400 Hz."""
    return {
        "sibilance_db": _band_energy_db(
            samples, sample_rate, BAND_SIBILANCE_LO_HZ, BAND_SIBILANCE_HI_HZ
        ),
        "harshness_db": _band_energy_db(
            samples, sample_rate, BAND_HARSHNESS_LO_HZ, BAND_HARSHNESS_HI_HZ
        ),
        "body_db": _band_energy_db(samples, sample_rate, BAND_BODY_LO_HZ, BAND_BODY_HI_HZ),
    }


async def measure_vocal(filename: str) -> dict[str, Any]:
    """Measure an AUDIO_DIR-relative *filename*: LUFS / true peak / LRA plus
    the three QC band energies (sibilance / harshness / body).

    Never raises; returns an ``error`` key on failure.
    """
    path = AUDIO_DIR / filename
    if not path.exists() or not path.is_file():
        return {
            "filename": filename,
            "error": f"source file not found: {filename}",
            "integrated_lufs": None,
            "true_peak_dbtp": None,
            "lra_lu": None,
            "sibilance_db": None,
            "harshness_db": None,
            "body_db": None,
        }

    loudness = await _measure_loudness(path)

    pcm = await _decode_audio(path)
    bands = {}
    if pcm.samples.size:
        bands = await _measure_bands(pcm.samples, pcm.sample_rate)
    else:
        bands = {"sibilance_db": None, "harshness_db": None, "body_db": None}

    return {
        "filename": filename,
        "integrated_lufs": loudness.get("integrated_lufs"),
        "true_peak_dbtp": loudness.get("true_peak_dbtp"),
        "lra_lu": loudness.get("lra_lu"),
        "error": loudness.get("error"),
        **bands,
    }


# ---------------------------------------------------------------------------
# DSP
# ---------------------------------------------------------------------------


def _true_peak(samples: np.ndarray, sample_rate: int) -> float:
    """Estimate true peak (dBTP) via 2x oversampling + linear interpolation."""
    if samples.size == 0:
        return -float("inf")
    mono = np.mean(samples, axis=1) if samples.ndim == 2 else samples
    n = len(mono)
    up = np.zeros(n * OVERSAMPLE, dtype=np.float32)
    up[::OVERSAMPLE] = mono
    kernel = np.ones(OVERSAMPLE, dtype=np.float32) / OVERSAMPLE
    up = np.convolve(up, kernel, mode="same")
    peak = float(np.max(np.abs(up)))
    return 20.0 * math.log10(peak) if peak > 0 else -float("inf")


def _db_to_linear(db: float) -> float:
    return 10.0 ** (db / 20.0)


def _warmth_saturation(
    samples: np.ndarray,
    sample_rate: int,
    drive: float = DEFAULT_WARMTH_DRIVE,
    mix: float = DEFAULT_WARMTH_MIX,
) -> np.ndarray:
    """Tanh soft-clip waveshaper with 2x oversampling, gain-compensated.

    Applied per channel. ``drive`` scales how hard the signal hits tanh;
    ``mix`` is the wet/dry blend (0 = dry, 1 = fully saturated). Output peak
    is gain-compensated to the input peak so the stage doesn't change level by
    itself (the downstream limiter catches any residual overs).
    """
    if samples.size == 0 or drive <= 0:
        return samples

    is_stereo = samples.ndim == 2
    channels = [samples] if not is_stereo else [samples[:, ch] for ch in range(samples.shape[1])]

    out_channels: list[np.ndarray] = []
    for ch in channels:
        n = len(ch)
        # 2x oversample: zero-insert then boxcar low-pass.
        up = np.zeros(n * OVERSAMPLE, dtype=np.float32)
        up[::OVERSAMPLE] = ch
        kernel = np.ones(OVERSAMPLE, dtype=np.float32) / OVERSAMPLE
        up = np.convolve(up, kernel, mode="same")

        up_peak = float(np.max(np.abs(up)))
        if up_peak <= 0:
            out_channels.append(ch.astype(np.float32))
            continue

        # Tanh soft-clip with drive scaling.
        wet = np.tanh(up * drive * WARMTH_TANH_SCALE)

        # Gain-compensate wet peak to dry peak so saturation is level-neutral.
        wet_peak = float(np.max(np.abs(wet)))
        if wet_peak > 0:
            wet = wet * (up_peak / wet_peak)

        # Wet/dry mix, then low-pass at the original Nyquist to remove tanh
        # aliases before decimation.
        out_up = up * (1.0 - mix) + wet * mix
        sos = scipy_signal.butter(
            2, min(0.49, 0.99), btype="low", output="sos"
        )  # cutoff just under original Nyquist
        out_up = scipy_signal.sosfilt(sos, out_up).astype(np.float32)

        # Decimate back to the original rate.
        out = out_up[::OVERSAMPLE]
        if len(out) < n:
            out = np.pad(out, (0, n - len(out)), mode="constant")
        elif len(out) > n:
            out = out[:n]

        out_channels.append(out.astype(np.float32))

    if not is_stereo:
        return out_channels[0]
    return np.stack(out_channels, axis=1)


def _apply_body_shelf(samples: np.ndarray, sample_rate: int, gain_db: float) -> np.ndarray:
    """Low-shelf at BODY_SHELF_HZ (~250 Hz) by *gain_db* dB, per channel."""
    if abs(gain_db) < 1e-6:
        return samples
    b, a = _design_lowshelf(sample_rate, BODY_SHELF_HZ, gain_db)
    return _apply_filter_ba(samples, b, a)


def _apply_presence_peak(samples: np.ndarray, sample_rate: int, gain_db: float) -> np.ndarray:
    """Peaking EQ at PRESENCE_PEAK_HZ (~3.2 kHz) by *gain_db* dB, per channel."""
    if abs(gain_db) < 1e-6:
        return samples
    b, a = _design_peaking(sample_rate, PRESENCE_PEAK_HZ, gain_db)
    return _apply_filter_ba(samples, b, a)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def treat_file(
    filename: str,
    *,
    deess: bool = True,
    deess_amount_db: float = DEFAULT_DEESS_AMOUNT_DB,
    warmth_drive: float = DEFAULT_WARMTH_DRIVE,
    warmth_mix: float = DEFAULT_WARMTH_MIX,
    body_db: float = DEFAULT_BODY_DB,
    presence_db: float = DEFAULT_PRESENCE_DB,
    ceiling_dbtp: float = DEFAULT_CEILING_DBTP,
) -> dict[str, Any]:
    """Treat a single vocal stem (or any single audio file) and write a treated
    copy under output/audio/vocal-treated/<stem>_treated.wav.

    Returns a QC report dict mirroring the mastering service's shape:
    ``{filename, treated_path, before, after, applied, error}``. Per D17 the
    report numbers are re-measured from the written artifact, not asserted from
    the intent.

    Chain: decode -> measure-before -> de-ess -> dynamic EQ harshness tame ->
    static tone (body shelf + presence peak) -> warmth saturation ->
    true-peak limit -> encode WAV -> measure-after.
    """
    src = AUDIO_DIR / filename
    applied = {
        "deess": deess,
        "deess_amount_db": round(float(deess_amount_db), 2),
        "warmth_drive": round(float(warmth_drive), 3),
        "warmth_mix": round(float(warmth_mix), 3),
        "body_db": round(float(body_db), 2),
        "presence_db": round(float(presence_db), 2),
        "ceiling_dbtp": round(float(ceiling_dbtp), 2),
    }

    if not src.exists() or not src.is_file():
        return {
            "filename": filename,
            "treated_path": None,
            "error": f"source file not found: {filename}",
            "applied": applied,
        }

    # 1 + 2. Decode + measure before.
    before = await measure_vocal(filename)
    if before.get("error") and before.get("integrated_lufs") is None:
        return {
            "filename": filename,
            "treated_path": None,
            "error": before.get("error") or "could not measure source",
            "applied": applied,
            "before": before,
        }

    pcm = await _decode_audio(src)
    if pcm.samples.size == 0:
        return {
            "filename": filename,
            "treated_path": None,
            "error": "failed to decode source audio",
            "applied": applied,
            "before": before,
        }

    samples = pcm.samples.copy()

    # 3. De-ess: dynamic sibilance reduction (~5-9 kHz).
    if deess:
        if samples.ndim == 1:
            samples = _band_rms_deesser(
                samples,
                pcm.sample_rate,
                freq_hz=DEESS_FREQ_HZ,
                bandwidth_hz=DEESS_BANDWIDTH_HZ,
                max_reduction_db=float(deess_amount_db),
            ).astype(np.float32)
        else:
            treated_ch = [
                _band_rms_deesser(
                    samples[:, ch],
                    pcm.sample_rate,
                    freq_hz=DEESS_FREQ_HZ,
                    bandwidth_hz=DEESS_BANDWIDTH_HZ,
                    max_reduction_db=float(deess_amount_db),
                ).astype(np.float32)
                for ch in range(samples.shape[1])
            ]
            samples = np.stack(treated_ch, axis=1)

    # 4. Vocal dynamic EQ harshness tame (~2-5 kHz, max 3 dB reduction).
    if samples.ndim == 1:
        samples = _dynamic_eq_tame_harshness(
            samples,
            pcm.sample_rate,
            freq_hz=HARSHNESS_FREQ_HZ,
            bandwidth_hz=HARSHNESS_BANDWIDTH_HZ,
            max_reduction_db=HARSHNESS_MAX_REDUCTION_DB,
        ).astype(np.float32)
    else:
        treated_ch = [
            _dynamic_eq_tame_harshness(
                samples[:, ch],
                pcm.sample_rate,
                freq_hz=HARSHNESS_FREQ_HZ,
                bandwidth_hz=HARSHNESS_BANDWIDTH_HZ,
                max_reduction_db=HARSHNESS_MAX_REDUCTION_DB,
            ).astype(np.float32)
            for ch in range(samples.shape[1])
        ]
        samples = np.stack(treated_ch, axis=1)

    # 5. Static tone: body shelf + presence peak.
    samples = _apply_body_shelf(samples, pcm.sample_rate, body_db)
    samples = _apply_presence_peak(samples, pcm.sample_rate, presence_db)

    # 6. Warmth saturation (tanh soft-clip, 2x oversampled, gain-compensated).
    samples = _warmth_saturation(samples, pcm.sample_rate, drive=warmth_drive, mix=warmth_mix)

    # 7. True-peak limit to ceiling.
    samples = _true_peak_limit(samples, pcm.sample_rate, ceiling_dbtp)

    # 8. Encode WAV deliverable (+ MP3 sibling).
    stem = src.stem
    wav_name = f"{stem}_treated.wav"
    wav_path = VOCAL_TREATED_DIR / wav_name
    ok = await _encode_wav(Pcm(samples=samples, sample_rate=pcm.sample_rate), wav_path)
    if not ok:
        return {
            "filename": filename,
            "treated_path": None,
            "error": "failed to encode treated WAV file",
            "applied": applied,
            "before": before,
        }

    mp3_name = f"{stem}_treated.mp3"
    mp3_path = VOCAL_TREATED_DIR / mp3_name
    try:
        await _encode_audio(Pcm(samples=samples, sample_rate=pcm.sample_rate), mp3_path)
    except Exception as exc:  # MP3 sibling is optional
        logger.debug("MP3 sibling encode skipped for %s: %s", filename, exc)

    # 9. Final re-measure of the artifact (D17).
    after = await measure_vocal(str(wav_path.relative_to(AUDIO_DIR)))

    return {
        "filename": filename,
        "treated_path": str(wav_path),
        "error": None,
        "before": before,
        "after": after,
        "applied": applied,
    }
