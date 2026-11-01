"""
Source cache and loudness staging for remix rendering.

Extracted from stem_remixer.py. Contains ``_SourceCache`` which loads,
tempo-aligns and key-shifts each (track, stem) at most once, plus
loudness-staging calibration (ebur128 via ffmpeg).
"""

from __future__ import annotations

import logging
import math
import re
import shutil
import subprocess
from typing import TYPE_CHECKING, Any

import numpy as np

from .remix_constants import (
    CALIBRATION_MAX_DB,
    LOUDNESS_ANCHOR_LUFS,
    REMIX_SR,
)
from .remix_dsp import _loop_to_length, _tempo_align

if TYPE_CHECKING:
    from .remix_recipe import RemixLayer

logger = logging.getLogger(__name__)


def _ebur128_stats(y: np.ndarray, sr: int) -> dict[str, float | None]:
    """Integrated LUFS and true peak of a (2, N) float32 buffer.

    One ffmpeg ebur128 run, piped through stdin -- no temp files. This is
    the same measurement ffmpeg_tools.compute_loudness uses (and the
    repo's +157 LUFS lesson is why it is not reimplemented in numpy
    here). Fields are None when ffmpeg is missing or the measurement
    fails; callers treat None as "unmeasured", never as 0.
    """
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return None
    buf = np.ascontiguousarray(y[:2], dtype=np.float32)
    if buf.shape[0] == 1:
        buf = np.repeat(buf, 2, axis=0)
    try:
        proc = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "info",
             "-f", "f32le", "-ac", "2", "-ar", str(sr), "-i", "pipe:0",
             "-af", "ebur128=framelog=verbose:peak=true", "-f", "null", "-"],
            input=np.ascontiguousarray(buf.T).tobytes(),
            capture_output=True, timeout=120,
        )
    except Exception:
        return None
    stderr = proc.stderr.decode("utf-8", "replace") if isinstance(proc.stderr, bytes) else (proc.stderr or "")
    out: dict[str, float | None] = {"integrated_lufs": None, "true_peak_dbfs": None}
    m = re.search(r"Integrated loudness:\s*\n\s*I:\s*([+-]?\d+(?:\.\d+)?)\s*LUFS", stderr, re.IGNORECASE)
    if m:
        out["integrated_lufs"] = float(m.group(1))
    # The summary prints "True peak:" on its own line, then "Peak: -x.x dBFS".
    m = re.search(r"^\s*Peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS", stderr, re.MULTILINE)
    if m:
        out["true_peak_dbfs"] = float(m.group(1))
    return out


def _ebur128_integrated_lufs(y: np.ndarray, sr: int) -> float | None:
    """Integrated LUFS only -- the loudness-staging calibration path."""
    return _ebur128_stats(y, sr)["integrated_lufs"]


class _SourceCache:
    """Load, tempo-align and key-shift each (track, stem) at most once.

    ``time_stretch`` and ``pitch_shift`` are the expensive steps and depend only on
    the layer plus the recipe's target tempo, so caching on
    (track, stem, bpm, semitones) means a four-layer slot costs four loads
    instead of four per render call. Bounded, so a long arrangement across many
    sources cannot grow without limit.
    """

    MAX_ENTRIES = 24

    def __init__(self, target_bpm: float) -> None:
        self.target_bpm = target_bpm
        self._audio: dict[tuple[str, str, float, float], np.ndarray] = {}
        self._bpms: dict[str, float] = {}
        self.stretch_ratios: dict[str, float] = {}
        # (track, stem) -> {"offset_db": float, "measured_lufs": float | None, "clamped": bool}
        self._calibration: dict[tuple[str, str], dict[str, Any]] = {}

    def bpm_for(self, track: str) -> float:
        if track not in self._bpms:
            # Resolve probe_track through the stem_remixer shim so tests can
            # monkeypatch `stem_remixer.probe_track` instead of reaching into
            # remix_analysis directly.
            from . import stem_remixer

            self._bpms[track] = float(stem_remixer.probe_track(track)["bpm"])
        return self._bpms[track]

    def get(self, layer: RemixLayer) -> np.ndarray:
        source_bpm = self.bpm_for(layer.track)
        ratio = self.target_bpm / source_bpm if source_bpm > 0 else 1.0
        self.stretch_ratios[layer.track] = ratio
        key = (
            layer.track,
            layer.stem,
            round(self.target_bpm, 3),
            round(layer.key_shift_semitones, 2),
            # B4: tone shaping is per-layer like the rest of the key, so two
            # layers of the same stem with different lowpass settings do not
            # share a cache entry.
            round(layer.lowpass_hz or 0.0, 1),
            round(layer.brightness_db or 0.0, 2),
        )
        cached = self._audio.get(key)
        if cached is not None:
            return cached

        from . import stem_remixer

        path = stem_remixer.resolve_stem_path(layer.track, layer.stem)
        librosa = stem_remixer.librosa
        y, _ = librosa.load(str(path), sr=REMIX_SR, mono=False)
        if y.ndim == 1:
            y = y[np.newaxis, :]
        if y.shape[0] == 1:
            # Force stereo. A mono source broadcast to both channels correlates
            # perfectly with everything else and collapses the stereo image.
            y = np.repeat(y, 2, axis=0)
        y = y[:2].astype(np.float32)

        y = _tempo_align(y, source_bpm, self.target_bpm)
        if layer.key_shift_semitones:
            y = np.stack(
                [
                    librosa.effects.pitch_shift(
                        y=y[c],
                        sr=REMIX_SR,
                        n_steps=float(layer.key_shift_semitones),
                    )
                    for c in range(y.shape[0])
                ],
                axis=0,
            ).astype(np.float32)

        # B4 tone shaping, cheap enough to sit after the cache-able steps.
        # Lowpass first, then tilt: filtering highs before tilting them means
        # the tilt cannot resurrect energy the lowpass removed.
        from .remix_dsp import _brightness_tilt, _low_pass

        if layer.lowpass_hz is not None:
            y = np.stack(
                [_low_pass(y[c], REMIX_SR, float(layer.lowpass_hz)) for c in range(y.shape[0])],
                axis=0,
            ).astype(np.float32)
        if layer.brightness_db:
            y = np.stack(
                [
                    _brightness_tilt(y[c], REMIX_SR, float(layer.brightness_db))
                    for c in range(y.shape[0])
                ],
                axis=0,
            ).astype(np.float32)

        if len(self._audio) >= self.MAX_ENTRIES:
            self._audio.pop(next(iter(self._audio)))
        self._audio[key] = y
        return y

    def calibration_db(self, track: str, stem: str) -> float:
        """Per-source loudness calibration offset in dB.

        Measures the raw source stem's integrated loudness and returns
        LOUDNESS_ANCHOR_LUFS - measured, so 0 dB of recipe gain means the
        same perceived loudness for every source. Clamped to
        +/-CALIBRATION_MAX_DB; fail-open 0.0 when ffmpeg is missing or the
        measurement fails. Cached per (track, stem).

        Resolves resolve_stem_path and _ebur128_integrated_lufs through the
        stem_remixer shim at call time, so tests can monkeypatch
        `stem_remixer.resolve_stem_path` and
        `stem_remixer._ebur128_integrated_lufs`.
        """
        key = (track, stem)
        if key not in self._calibration:
            record: dict[str, Any] = {"offset_db": 0.0, "measured_lufs": None, "clamped": False}
            try:
                from . import stem_remixer

                path = stem_remixer.resolve_stem_path(track, stem)
                librosa = stem_remixer.librosa
                y, _ = librosa.load(str(path), sr=REMIX_SR, mono=False)
                if y.ndim == 1:
                    y = y[np.newaxis, :]
                lufs = stem_remixer._ebur128_integrated_lufs(y, REMIX_SR)
                if lufs is not None:
                    raw = LOUDNESS_ANCHOR_LUFS - lufs
                    clamped = max(-CALIBRATION_MAX_DB, min(CALIBRATION_MAX_DB, raw))
                    record = {"offset_db": clamped, "measured_lufs": round(lufs, 2),
                              "clamped": abs(clamped - raw) > 1e-9}
            except Exception:
                pass
            self._calibration[key] = record
            if len(self._calibration) > self.MAX_ENTRIES:
                self._calibration.pop(next(iter(self._calibration)))
        return float(self._calibration[key]["offset_db"])

    def calibration_report(self) -> dict[str, dict[str, Any]]:
        """Per-source calibration records, keyed "track/stem". For the manifest."""
        return {f"{track}/{stem}": dict(rec) for (track, stem), rec in self._calibration.items()}

    def measured_rms_db(self, layer: RemixLayer) -> float:
        """RMS of the aligned source, for suggesting sensible per-layer gains."""
        y = self.get(layer)
        rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))
        return 20.0 * math.log10(rms + 1e-12)

    def window_rms_db(self, layer: RemixLayer, n_samples: int, bar_n: int) -> float:
        """RMS of the exact slice the slot renders - not the whole source.

        A stem that opens silently breaks the whole-file reading: Ad
        Nauseam's bass is digital silence for its first 26.5 s while the
        stem as a whole measures a healthy -19.9 LUFS, so a layer at
        ``source_start_bar=0`` renders four bars of nothing and a
        whole-file RMS reports no problem. That is the "looks like a
        broken mixer" case the near-silent warning exists for, so the
        warning slices where ``_render_slot`` slices - from the layer's
        own ``source_start_bar``, with the same loop semantics, so a
        window past the end of a short stem is judged on the audio the
        render would actually play.
        """
        source = self.get(layer)
        offset = layer.source_start_bar * bar_n
        window = _loop_to_length(source, offset + n_samples)[:, offset:]
        rms = float(np.sqrt(np.mean(window.astype(np.float64) ** 2)))
        return 20.0 * math.log10(rms + 1e-12)


__all__ = [
    "_SourceCache",
    "_ebur128_stats",
    "_ebur128_integrated_lufs",
]
