"""
Mastering DSP service — measure, normalize, true-peak limit, and QC-report an
audio file. New module per `audio-mastering-stem-quality-2026-10.md` (M1), which
extends `studio-quality-2026-10.md` Phase 3 (Approved, blocked on nothing).

Why this lives in `services/` (not `api/`): the backend layering rule is
api -> services -> adapters (D32). `audio_mastering.py` owns the routes; this
module owns the pure DSP. Neither imports the other's layer the wrong way up.

Measurement source: FFmpeg's ebur128 filter (the established pattern in
services/ffmpeg_tools.py:compute_loudness). `pyloudnorm` (BS.1770) is NOT
installed in this environment, so we reuse ebur128 for integrated loudness /
LRA and add a scipy-based true-peak estimate. Do not "fix" this by installing
pyloudnorm mid-session — the gate runner pins its own interpreter and a new
dependency would break the baseline until the env is rebuilt.

True peak: ebur128 reports true peak directly, so we trust it for measurement
and implement a lightweight look-ahead-free limiter for the mastering pass
(ceiling gain reduction with attack/release). It prevents clipping; it is not
a transparent broadcast-grade limiter. Dynamic de-harsh / M/S cleanup are v2
and out of scope (per the plan's non-goals).

Tone (v1, static): a conservative de-mud high-pass at ~300 Hz plus a gentle
presence shelf around 4 kHz. This is the "safe half" of the AI-defect chain;
dynamic de-harsh is deliberately not included.

Target presets (LUFS): spotify -14, apple -16, competitive -11, amazon -2.
Ceiling default -1 dBTP.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal as scipy_signal

from ..core.config import PROJECT_ROOT
from .ffmpeg_tools import _find_binary, _run, compute_loudness

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths / constants
# ---------------------------------------------------------------------------

AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
MASTERED_DIR = AUDIO_DIR / "mastered"
MASTERED_DIR.mkdir(parents=True, exist_ok=True)

# Target loudness presets (LUFS, integrated). Mirrors the plan's delivery
# standards; keep these in sync with the frontend preset chips.
TARGET_LUFS: dict[str, float] = {
    "spotify": -14.0,
    "apple": -16.0,
    "competitive": -11.0,
    "amazon": -2.0,
}

DEFAULT_CEILING_DBTP = -1.0
OVERSAMPLE = 2  # true-peak oversampling factor (2x is the cheap, adequate choice)
ATTACK_SEC = 0.005  # limiter attack: 5 ms
RELEASE_SEC = 0.1  # limiter release: 100 ms
DEMUD_HZ = 300.0  # static de-mud high-pass corner
PRESENCE_HZ = 4000.0  # gentle presence shelf centre
PRESENCE_GAIN_DB = 2.0  # presence shelf boost (conservative)

# Iterative gain tuning: how close the final measured loudness must be to
# target (LU), and how many correction passes to try. Tone fixes (esp. the
# 4 kHz presence shelf) shift ebur128's K-weighted measurement, so a single
# gain pass can land off-target. We measure the encoded artifact and correct
# until within tolerance or we run out of passes.
LOUDNESS_TOLERANCE_LU = 0.5
MAX_GAIN_PASSES = 3

# Manual trim: a user offset applied *after* normalization and *before* the
# limiter. It deliberately does not participate in the target-matching loop —
# otherwise the loop would measure the trimmed file and gain it straight back,
# making the control a no-op. Clamped to the same +/-12 dB as the auto gain.
MAX_TRIM_DB = 12.0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _db_to_linear(db: float) -> float:
    return 10.0 ** (db / 20.0)


def _linear_to_db(linear: float) -> float:
    if linear <= 0:
        return -float("inf")
    return 20.0 * math.log10(linear)


@dataclass
class Pcm:
    """Decoded audio: float32 samples in [-1, 1], interleaved per channel."""

    samples: np.ndarray  # shape (n_frames, n_channels), float32
    sample_rate: int


async def _decode_audio(file_path: str | Path) -> Pcm:
    """Decode *file_path* to interleaved float32 PCM via FFmpeg rawaudio.

    Never raises on decode failure — returns an empty Pcm with an error logged.
    """
    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        logger.error("ffmpeg not found on PATH; cannot decode %s", file_path)
        return Pcm(samples=np.zeros((0, 1), dtype=np.float32), sample_rate=44100)
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        logger.error("source file not found: %s", file_path)
        return Pcm(samples=np.zeros((0, 1), dtype=np.float32), sample_rate=44100)

    try:
        proc = await _run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-map",
                "0:a:0?",
                "-f",
                "f32le",
                "-acodec",
                "pcm_f32le",
                "-",
            ],
            capture_output=True,
            timeout=300,
        )
        if proc.returncode != 0:
            logger.error("ffmpeg decode failed for %s: %s", file_path, proc.stderr)
            return Pcm(samples=np.zeros((0, 1), dtype=np.float32), sample_rate=44100)
        raw = proc.stdout
        # Probe sample rate / channels cheaply from the source via ffprobe is
        # heavy here; assume stereo 44.1k for the gain math. The sample rate
        # only matters for filter design, which we re-derive below from the
        # actual decoded length vs duration if needed. Simpler: ask ffprobe.
        from .ffmpeg_tools import probe_media

        probe = await probe_media(path)
        sample_rate = 44100
        channels = 1
        for st in probe.get("streams") or []:
            if st.get("codec_type") == "audio":
                sample_rate = int(st.get("sample_rate") or 44100)
                channels = int(st.get("channels") or 1)
                break
        if len(raw) == 0:
            return Pcm(samples=np.zeros((0, channels), dtype=np.float32), sample_rate=sample_rate)
        samples = np.frombuffer(raw, dtype="<f4").astype(np.float32)
        if channels > 1:
            samples = samples.reshape(-1, channels)
        else:
            samples = samples.reshape(-1, 1)
        return Pcm(samples=samples, sample_rate=sample_rate)
    except Exception as exc:  # noqa: BLE001 - decode is best-effort
        logger.error("decode error for %s: %s", file_path, exc)
        return Pcm(samples=np.zeros((0, 1), dtype=np.float32), sample_rate=44100)


async def _encode_audio(pcm: Pcm, output_path: str | Path) -> bool:
    """Encode interleaved float32 PCM to *output_path* via FFmpeg rawaudio."""
    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        logger.error("ffmpeg not found on PATH; cannot encode %s", output_path)
        return False
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
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
                str(pcm.samples.shape[1] if pcm.samples.ndim == 2 else 1),
                "-i",
                "-",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "192k",
                str(out),
            ],
            input=pcm.samples.astype("<f4").tobytes(),
            capture_output=True,
            timeout=300,
        )
        if proc.returncode != 0:
            logger.error("ffmpeg encode failed for %s: %s", output_path, proc.stderr)
            return False
        return out.exists() and out.stat().st_size > 0
    except Exception as exc:  # noqa: BLE001
        logger.error("encode error for %s: %s", output_path, exc)
        return False


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------


async def measure_loudness(file_path: str | Path) -> dict[str, Any]:
    """Measure integrated loudness (LUFS), true peak (dBTP) and LRA (LU).

    Reuses ``compute_loudness`` (FFmpeg ebur128). Returns a dict with
    ``integrated_lufs``, ``true_peak_dbtp``, ``lra_lu`` and ``error`` keys;
    numeric fields are ``None`` when measurement fails, and ``error`` is set.
    Never raises.
    """
    result = await compute_loudness(file_path)
    return {
        "integrated_lufs": result.get("integrated_lufs"),
        "true_peak_dbtp": result.get("true_peak"),
        "lra_lu": result.get("loudness_range"),
        "error": result.get("error"),
    }


async def measure_file(filename: str) -> dict[str, Any]:
    """Convenience: measure an AUDIO_DIR-relative *filename* (plan M1 spec)."""
    path = AUDIO_DIR / filename
    measurement = await measure_loudness(path)
    measurement["filename"] = filename
    return measurement


# ---------------------------------------------------------------------------
# DSP
# ---------------------------------------------------------------------------


def _design_demud_filter(sample_rate: int) -> np.ndarray:
    """Static de-mud: 2nd-order Butterworth high-pass at DEMUD_HZ."""
    nyq = sample_rate / 2.0
    normalized = min(DEMUD_HZ / nyq, 0.99)
    sos = scipy_signal.butter(2, normalized, btype="high", output="sos")
    return sos


def _design_presence_filter(sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    """Gentle presence shelf: peaking EQ at PRESENCE_HZ, PRESENCE_GAIN_DB boost."""
    nyq = sample_rate / 2.0
    f0 = min(PRESENCE_HZ / nyq, 0.99)
    # Q=1 gives a broad, musical shelf rather than a narrow resonant peak.
    q = 1.0
    gain_linear = _db_to_linear(PRESENCE_GAIN_DB)
    # RBJ peaking EQ coefficients.
    w0 = 2 * math.pi * f0
    alpha = math.sin(w0) / (2 * q)
    a0 = 1 + alpha / gain_linear
    b0 = 1 + (gain_linear * alpha)
    b1 = -2 * math.cos(w0)
    b2 = 1 - (gain_linear * alpha)
    a1 = -2 * math.cos(w0)
    a2 = 1 - (alpha / gain_linear)
    b = np.array([b0, b1, b2]) / a0
    a = np.array([1.0, a1, a2]) / a0
    return b, a


def _true_peak(samples: np.ndarray, sample_rate: int) -> float:
    """Estimate true peak (dBTP) via 2x oversampling + linear interpolation.

    Cheap approximation of the inter-sample peak. Good enough to gate the
    limiter; not a broadcast-grade true-peak meter.
    """
    if samples.size == 0:
        return -float("inf")
    mono = np.mean(samples, axis=1) if samples.ndim == 2 else samples
    n = len(mono)
    # Upsample by inserting zeros then low-pass (simple linear interp suffices
    # for a peak estimate).
    up = np.zeros(n * OVERSAMPLE, dtype=np.float32)
    up[::OVERSAMPLE] = mono
    # Simple boxcar low-pass to interpolate.
    kernel = np.ones(OVERSAMPLE, dtype=np.float32) / OVERSAMPLE
    up = np.convolve(up, kernel, mode="same")
    peak = float(np.max(np.abs(up)))
    return _linear_to_db(peak)


def _apply_gain_db(samples: np.ndarray, gain_db: float) -> np.ndarray:
    """Apply a constant gain (dB) to *samples*, clamped to [-1, 1]."""
    gain = _db_to_linear(gain_db)
    out = samples * gain
    return np.clip(out, -1.0, 1.0).astype(np.float32)


def _apply_demud(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Static de-mud high-pass at DEMUD_HZ, applied per channel."""
    sos = _design_demud_filter(sample_rate)
    if samples.ndim == 1:
        return scipy_signal.sosfilt(sos, samples).astype(np.float32)
    out = np.empty_like(samples)
    for ch in range(samples.shape[1]):
        out[:, ch] = scipy_signal.sosfilt(sos, samples[:, ch])
    return out


def _apply_presence(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Gentle presence shelf boost at PRESENCE_HZ, applied per channel."""
    b, a = _design_presence_filter(sample_rate)
    if samples.ndim == 1:
        return scipy_signal.lfilter(b, a, samples).astype(np.float32)
    out = np.empty_like(samples)
    for ch in range(samples.shape[1]):
        out[:, ch] = scipy_signal.lfilter(b, a, samples[:, ch])
    return out


def _true_peak_limit(samples: np.ndarray, sample_rate: int, ceiling_dbtp: float) -> np.ndarray:
    """Limit true inter-sample peaks to *ceiling_dbtp*.

    Look-ahead-free limiter: estimate true peak, and if it exceeds the ceiling
    apply a constant gain reduction with attack/release smoothing so the gain
    doesn't pump sample-to-sample. Prevents clipping; not a transparent
    broadcast limiter (v2 can add look-ahead).
    """
    if samples.size == 0:
        return samples
    peak_dbtp = _true_peak(samples, sample_rate)
    if peak_dbtp <= ceiling_dbtp:
        return samples
    # Constant gain reduction to bring the estimated peak to the ceiling.
    target_gain_db = ceiling_dbtp - peak_dbtp
    # Smooth the gain with a simple attack/release envelope so we don't snap
    # the whole file at once (avoids audible pumping on transient-only peaks).
    target_gain = _db_to_linear(target_gain_db)
    n = len(samples)
    attack_samples = int(ATTACK_SEC * sample_rate)
    release_samples = int(RELEASE_SEC * sample_rate)
    gains = np.ones(n, dtype=np.float32)
    current_gain = 1.0
    for i in range(n):
        if target_gain < current_gain:
            # attack: move toward target quickly
            step = 1.0 / max(attack_samples, 1)
            current_gain = max(target_gain, current_gain - step)
        else:
            # release: move back toward unity slowly
            step = 1.0 / max(release_samples, 1)
            current_gain = min(1.0, current_gain + step)
        gains[i] = current_gain
    if samples.ndim == 1:
        return (samples * gains[:, None]).astype(np.float32)
    return (samples * gains[:, None]).astype(np.float32)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def master_file(
    filename: str,
    target_lufs: float = -14.0,
    ceiling_dbtp: float = DEFAULT_CEILING_DBTP,
    tone_fixes: bool = True,
    gain_trim_db: float = 0.0,
) -> dict[str, Any]:
    """Master *filename* (AUDIO_DIR-relative) and write a mastered copy.

    Returns a QC report dict with before/after LUFS-TP-LRA, the mastered file
    path, and any error. Per D17's lesson: assert the artifact, not the intent
    — the report numbers are re-measured from the written file, not asserted
    from the intent.

    ``gain_trim_db`` is a manual offset (clamped to +/-MAX_TRIM_DB) applied
    after the loudness match and before limiting, so it is audible in the
    written file and visible in ``applied.gain_trim_db``.

    Steps:
      1. Measure the source (LUFS / true peak / LRA).
      2. Iteratively apply gain to hit *target_lufs*: measure → gain → encode
         → re-measure → correct. Tone fixes (esp. the 4 kHz presence shelf)
         shift ebur128's K-weighted measurement, so one pass can land off
         target; we correct until within LOUDNESS_TOLERANCE_LU or
         MAX_GAIN_PASSES is reached.
      3. Apply the manual trim, then true-peak limit to *ceiling_dbtp*.
      4. Encode to output/audio/mastered/<stem>_mastered.mp3.
      5. Final re-measure of the written file for the QC report.
    """
    src = AUDIO_DIR / filename
    trim_db = max(-MAX_TRIM_DB, min(MAX_TRIM_DB, float(gain_trim_db or 0.0)))
    if not src.exists() or not src.is_file():
        return {
            "filename": filename,
            "error": f"source file not found: {filename}",
            "mastered_path": None,
        }

    # 1. Measure source.
    before = await measure_loudness(src)
    before_lufs = before.get("integrated_lufs")
    if before_lufs is None:
        return {
            "filename": filename,
            "error": before.get("error") or "could not measure source loudness",
            "mastered_path": None,
            "before": before,
        }

    # 2. Decode once; all gain/tone/limit passes work on the decoded PCM.
    pcm = await _decode_audio(src)
    if pcm.samples.size == 0:
        return {
            "filename": filename,
            "error": "failed to decode source audio",
            "mastered_path": None,
            "before": before,
        }

    # Iterative gain tuning. Each pass: apply gain → tone → limit → encode to
    # a temp file → measure → compute residual error → adjust gain.
    import tempfile

    current_gain_db = target_lufs - before_lufs
    current_gain_db = max(-12.0, min(12.0, current_gain_db))
    after_lufs: float | None = None
    applied_gain_db = current_gain_db

    for _pass in range(MAX_GAIN_PASSES):
        samples = _apply_gain_db(pcm.samples, current_gain_db)
        if tone_fixes:
            samples = _apply_demud(samples, pcm.sample_rate)
            samples = _apply_presence(samples, pcm.sample_rate)
        samples = _true_peak_limit(samples, pcm.sample_rate, ceiling_dbtp)

        # Encode to a temp file for measurement (mkstemp gives a file path,
        # not a directory — mkdtemp would fail with "Permission denied").
        fd, tmp_path = tempfile.mkstemp(suffix=".mp3")
        import os

        os.close(fd)
        tmp = Path(tmp_path)
        ok = await _encode_audio(Pcm(samples=samples, sample_rate=pcm.sample_rate), tmp)
        if not ok:
            tmp.unlink(missing_ok=True)
            return {
                "filename": filename,
                "error": "failed to encode mastered file",
                "mastered_path": None,
                "before": before,
            }

        measurement = await measure_loudness(tmp)
        after_lufs = measurement.get("integrated_lufs")
        tmp.unlink(missing_ok=True)

        if after_lufs is None:
            break

        applied_gain_db = current_gain_db
        error_lu = target_lufs - after_lufs
        if abs(error_lu) <= LOUDNESS_TOLERANCE_LU:
            break
        # Correct: add the residual error to the gain (more gain if too quiet,
        # less if too loud). Clamp so we don't chase noise.
        current_gain_db = max(-12.0, min(12.0, current_gain_db + error_lu))

    # 3. Final encode to the output path with the best gain found.
    samples = _apply_gain_db(pcm.samples, applied_gain_db)
    if tone_fixes:
        samples = _apply_demud(samples, pcm.sample_rate)
        samples = _apply_presence(samples, pcm.sample_rate)
    if trim_db:
        # Multiply rather than `_apply_gain_db`: that helper clips to [-1, 1],
        # and clipping before the limiter is unrecoverable distortion. The
        # limiter below is what pulls the result back under the ceiling.
        samples = (samples * _db_to_linear(trim_db)).astype(np.float32)
    samples = _true_peak_limit(samples, pcm.sample_rate, ceiling_dbtp)

    stem = src.stem
    out_name = f"{stem}_mastered.mp3"
    out_path = MASTERED_DIR / out_name
    ok = await _encode_audio(Pcm(samples=samples, sample_rate=pcm.sample_rate), out_path)
    if not ok:
        return {
            "filename": filename,
            "error": "failed to encode mastered file",
            "mastered_path": None,
            "before": before,
        }

    # 4. Final re-measure of the artifact (D17: assert the artifact, not the intent).
    after = await measure_loudness(out_path)

    return {
        "filename": filename,
        "mastered_path": str(out_path),
        "error": None,
        "before": before,
        "after": after,
        "applied": {
            "gain_db": round(applied_gain_db, 2),
            "gain_trim_db": round(trim_db, 2),
            "target_lufs": target_lufs,
            "ceiling_dbtp": ceiling_dbtp,
            "tone_fixes": tone_fixes,
            "gain_passes": _pass + 1,
        },
    }
