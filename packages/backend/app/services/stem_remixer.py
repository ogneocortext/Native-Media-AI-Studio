"""Stem remixing / mashups — build a new composition from stems of different songs.

## Why this is a stem service

A remix is only useful downstream if it is *shaped like a stem set*. So
`render_remix` writes a plain four-stem directory (`vocals/drums/bass/other`
`.wav`) plus a `remix.json` manifest. Everything already built then works on a
remix unchanged: the Suno enhancer chain (`enhance_stems`), `/api/audio/stem-file`
playback, and the visualizer's per-stem mapping. No special-case code anywhere
else, which is the whole point.

## Tempo is automatic; key is not, deliberately

Tempo detection on this library is solid: measured 143.55 / 136.00 / 151.99 BPM
on the three full-length tracks, stable across runs. So source tempo is detected
and stretched to a common grid automatically.

Key detection is **not** usable, and this module refuses to pretend otherwise.
Measured chroma flatness (geometric/arithmetic mean) on the separated stems is
0.978-0.998, where 1.0 is pure noise and ~0.1 is a single pitch — the profiles
are effectively flat. The Krumhansl-Schmuckler correlation ranged 0.03-0.48, and
probing returned a *different* argmax for the same file between two runs.
Automatically pitch-shifting a stem by a difference derived from that would shift
by an arbitrary amount, which is worse than not matching keys at all. So
`key_shift_semitones` is an explicit per-layer parameter, and the detected key is
reported only as an advisory with its confidence attached.

## Arrangement model

A recipe is a list of slots over a bar grid. Each slot names the stems that play
during its span, so "A's drums under B's vocals, then swap" and "everything at
once" are the same mechanism with different slot contents.
"""

from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from ..core.config import PROJECT_ROOT
from . import essentia_bridge, essentia_tempo_store, tempo_agreement
from .source_separation import SEPARATION_DIR, STEM_NAMES

logger = logging.getLogger(__name__)

try:
    import librosa

    LIBROSA_AVAILABLE = True
except ImportError:  # pragma: no cover - librosa is a hard backend dep
    LIBROSA_AVAILABLE = False

# The enhancer chain resamples to 22050 Hz internally (see suno_enhancer) and
# every stem it consumes is already 22.05 kHz, so remixes render there. Keeping
# it identical avoids a resample inside the chain and halves disk use.
REMIX_SR = 22050

REMIX_DIR = PROJECT_ROOT / "output" / "remixes"
REMIX_DIR.mkdir(parents=True, exist_ok=True)

# Probe measurements live here, not beside the stems: `output/stems/<model>/
# <track>/` is written by `source_separation` and holds nothing but stem WAVs.
PROBE_CACHE_DIR = REMIX_DIR / ".probes"
PROBE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Below this chroma correlation a detected key is reported as unreliable and is
# never used to derive a shift. See the module docstring for the measurements.
KEY_CONFIDENCE_FLOOR = 0.60

# 3 -> 4: the probe result gained `essentia_bpm` and `tempo_agreement`. Measured
# reason for the bump rather than a guess: with the version left at 3, every
# existing cache kept short-circuiting `probe_track` and the new fields never
# appeared - the endpoint reported `essentia_bpm: null` while four tracks sat
# cached in the Essentia store. A schema addition is invisible until the version
# moves; that is the whole reason this constant exists.
# Bump when the probe result gains or changes a field, so stale caches written
# by an earlier version are recomputed instead of silently missing keys.
PROBE_CACHE_VERSION = 4

_PITCH_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
# Krumhansl-Schmuckler major-key profile.
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)


# ─── source discovery ────────────────────────────────────────────────────────


def _safe_track_name(name: str) -> str:
    """Reject anything that could escape SEPARATION_DIR.

    Track names arrive off the wire and are joined onto a path, so this is a
    security boundary rather than cosmetics: `../../secrets` has to be refused
    here, not normalised into something that merely looks harmless.
    """
    cleaned = re.sub(r"[^A-Za-z0-9_\-. ()]", "", name).strip()
    if not cleaned or cleaned in {".", ".."} or ".." in cleaned:
        raise ValueError(f"Invalid track name: {name!r}")
    return cleaned


def _safe_remix_name(name: str) -> str:
    """Same contract as `_safe_track_name`, for the output directory name.

    Rejects rather than silently rewriting. The sanitiser strips `.` and `/`, so
    a traversal attempt used to be quietly turned into a harmless-looking name -
    `../out` became `out`, and the caller got a remix called "out" with no
    indication its request had been reinterpreted. The `..` test is against the
    original input for the same reason: after stripping it can never match.
    """
    if ".." in name:
        raise ValueError(f"Invalid remix name: {name!r}")
    cleaned = re.sub(r"[^A-Za-z0-9_\- ]", "", name).strip().replace(" ", "_")
    if not cleaned or cleaned in {".", ".."}:
        raise ValueError(f"Invalid remix name: {name!r}")
    return cleaned


def resolve_stem_path(track: str, stem: str) -> Path:
    """Locate one stem WAV on disk, preferring newer separation models."""
    if stem not in STEM_NAMES:
        raise ValueError(f"stem must be one of {', '.join(STEM_NAMES)}")
    safe = _safe_track_name(track)
    base = SEPARATION_DIR.resolve()
    model_dirs = [d for d in sorted(SEPARATION_DIR.iterdir()) if d.is_dir()]
    model_dirs.sort(key=lambda p: p.name != "mdx_extra_q")
    for model_dir in model_dirs:
        candidate = (model_dir / safe / f"{stem}.wav").resolve()
        if candidate.exists() and str(candidate).startswith(str(base)):
            return candidate
    raise FileNotFoundError(f"No {stem}.wav for track {track!r} under {SEPARATION_DIR}")


def _probe_summary(track: str) -> dict[str, Any]:
    """Cached probe fields for a track, or {} when it has none.

    A pure file read: the probe already measured bpm, duration and
    first-audible and cached them under `output/remixes/.probes/`,
    so joining them into a listing costs no analysis. A track that
    has never been probed simply lists without them - the fields
    are optional everywhere they appear.
    """
    try:
        cache_path = PROBE_CACHE_DIR / f"{_safe_track_name(track)}.json"
    except ValueError:
        return {}
    if not cache_path.exists():
        return {}
    try:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(cached, dict):
        return {}
    return {
        "bpm": cached.get("bpm"),
        "duration_sec": cached.get("duration_sec"),
        "first_audible_sec": cached.get("first_audible_sec"),
    }


def list_stem_sources() -> list[dict[str, Any]]:
    """Every track directory holding at least one stem, with per-stem presence.

    Pure path query — no audio is decoded, so this is safe to call on a
    dropdown open without waiting on demucs. Cached probe measurements
    (bpm, duration, first-audible) are joined from the probe cache when
    they exist, so a picker can show tempo and length without a probe
    round-trip per track.
    """
    found: dict[str, dict[str, Any]] = {}
    for model_dir in sorted(SEPARATION_DIR.iterdir()):
        if not model_dir.is_dir():
            continue
        for track_dir in sorted(model_dir.iterdir()):
            if not track_dir.is_dir():
                continue
            present = {s: (track_dir / f"{s}.wav").exists() for s in STEM_NAMES}
            if not any(present.values()):
                continue
            entry = found.setdefault(
                track_dir.name,
                {"track": track_dir.name, "model": model_dir.name, "stems": {}},
            )
            entry["stems"] = {
                s: entry["stems"].get(s, False) or present[s] for s in STEM_NAMES
            }
    for entry in found.values():
        entry.update(_probe_summary(entry["track"]))
    return sorted(found.values(), key=lambda d: d["track"].lower())


# ─── analysis ────────────────────────────────────────────────────────────────


def _pick_analysis_stem(track: str) -> tuple[str, Path]:
    """Choose which stem to analyse, preferring the clearest beat.

    `list_stem_sources` advertises partial stem sets, so requiring a `vocals`
    stem here made the two disagree: a drums-only track was listed as a usable
    source and then failed to probe, and therefore could not be built. The
    fallback chain is drums (most reliable transients) then the Demucs order.

    Returns (stem_name, path) so the caller can record which one it measured.
    """
    for stem in ("drums", *STEM_NAMES):
        try:
            return stem, resolve_stem_path(track, stem)
        except FileNotFoundError:
            continue
    raise FileNotFoundError(
        f"Track {track!r} has no stems under {SEPARATION_DIR} "
        f"(looked for {', '.join(STEM_NAMES)})"
    )


def _tempo_agreement_for(track: str, librosa_bpm: float) -> dict[str, Any] | None:
    """Cross-check librosa against the cached Essentia reading, if there is one.

    Returns None when Essentia has not been measured for this track, so the probe
    response carries no agreement block it cannot support. Essentia is the primary
    authority in `tempo_agreement`, so a disagreement here means librosa is the
    value that should be distrusted - and, per the library measurement, that is
    the common case, not a rare edge.
    """
    essentia = essentia_tempo_store.cached_bpm(track)
    if essentia is None:
        return None
    return tempo_agreement.corroborate({"librosa": librosa_bpm, "essentia": essentia})


def probe_track(track: str) -> dict[str, Any]:
    """Detect tempo, and *report* key as an advisory with its confidence.

    Cached under `output/remixes/.probes/`. It deliberately does *not* live
    beside the stems: that directory is owned by `source_separation` and contains
    nothing but stem WAVs, and a stray JSON there is a file nobody expects.
    """
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa is required for remix analysis")
    analysed_stem, analysis_path = _pick_analysis_stem(track)
    cache_path = PROBE_CACHE_DIR / f"{_safe_track_name(track)}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            # Version guards the *schema*, not just the source. Without it,
            # adding a field left every existing cache serving a dict that lacks
            # it, and the caller failed on KeyError rather than on anything
            # visible. The stem is matched too, so switching the analysed stem
            # cannot return a measurement taken from a different one.
            if (
                cached.get("cache_version") == PROBE_CACHE_VERSION
                and cached.get("analysed_stem") == analysed_stem
                and cached.get("source") == analysis_path.name
            ):
                return cached
        except (json.JSONDecodeError, OSError):
            logger.debug("unreadable probe cache for %s, recomputing", track)

    y, sr = librosa.load(str(analysis_path), sr=REMIX_SR, mono=True)
    if y.size < sr * 5:
        raise ValueError(f"Track {track!r} is too short to analyse ({y.size / sr:.1f}s)")

    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    chroma = chroma / (chroma.sum() + 1e-9)
    # Flatness near 1.0 means the profile carries no pitch information at all,
    # which is the measured state of this library (0.978-0.998).
    geo = float(np.exp(np.mean(np.log(chroma + 1e-12))))
    arith = float(np.mean(chroma))
    flatness = geo / (arith + 1e-12)
    correlation = float(np.corrcoef(_MAJOR_PROFILE, chroma)[0, 1])

    # Where the stem first becomes audible. Measured on this library the vocals
    # of Ad-Nauseam are silent for the first ~6.3 s (peak -57 dBFS), so a slot
    # that lays them down from bar 0 renders an inaudible layer and looks like a
    # broken mixer rather than a song with an instrumental intro. Reporting the
    # entry point lets a caller pick `source_start_bar` deliberately.
    frame = 1024
    n_frames = max(1, len(y) // frame)
    frames = y[: n_frames * frame].reshape(n_frames, frame).astype(np.float64)
    frame_rms = np.sqrt(np.mean(frames ** 2, axis=1))
    loudest = float(np.max(frame_rms)) if frame_rms.size else 0.0
    if loudest > 1e-9:
        # -45 dB relative to the stem's own loudest frame.
        threshold = loudest * 10.0 ** (-45.0 / 20.0)
        audible = np.flatnonzero(frame_rms > threshold)
        first_audible = float(audible[0] * frame / sr) if audible.size else 0.0
    else:
        first_audible = 0.0

    result = {
        "cache_version": PROBE_CACHE_VERSION,
        "track": track,
        "bpm": round(bpm, 3),
        "duration_sec": round(float(len(y) / sr), 3),
        "first_audible_sec": round(first_audible, 3),
        "key_advisory": _PITCH_NAMES[int(np.argmax(chroma))],
        "key_correlation": round(correlation, 4),
        "chroma_flatness": round(flatness, 4),
        "key_confident": bool(
            correlation >= KEY_CONFIDENCE_FLOOR and flatness < 0.5
        ),
        "beat_count": int(len(beats)),
        "analysed_stem": analysed_stem,
        "source": analysis_path.name,
        # Essentia, if it has been measured. Read straight from the cache: this
        # function is on the request path, and asking WSL for a tempo here would
        # add ~31 s to a dropdown. `essentia_tempo_store.cached_bpm` never touches
        # WSL, so an un-refreshed track simply reports None.
        "essentia_bpm": essentia_tempo_store.cached_bpm(track),
        "tempo_agreement": _tempo_agreement_for(track, bpm),
    }
    try:
        cache_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    except OSError:
        logger.debug("could not write probe cache for %s", track)
    return result


# ─── recipe ──────────────────────────────────────────────────────────────────


@dataclass
class RemixLayer:
    """One stem playing inside a slot.

    `key_shift_semitones` is explicit because detection cannot be trusted on this
    material (see the module docstring). `gain_db` is relative to the stem's own
    level, so two layers of the same stem at 0 dB sum to unity.
    """
    track: str
    stem: str
    gain_db: float = 0.0
    key_shift_semitones: float = 0.0
    # Offset into the source in *bars*, so a layer can enter partway through its
    # own song rather than always replaying from bar 0.
    source_start_bar: int = 0

    def validate(self) -> None:
        if self.stem not in STEM_NAMES:
            raise ValueError(f"stem must be one of {', '.join(STEM_NAMES)}")
        if not math.isfinite(self.gain_db) or not -60.0 <= self.gain_db <= 12.0:
            raise ValueError(f"gain_db out of range: {self.gain_db}")
        if (
            not math.isfinite(self.key_shift_semitones)
            or abs(self.key_shift_semitones) > 12.0
        ):
            raise ValueError(
                f"key_shift_semitones out of range: {self.key_shift_semitones}"
            )
        if self.source_start_bar < 0:
            raise ValueError("source_start_bar must be >= 0")


@dataclass
class RemixSlot:
    """A span of the arrangement, in bars."""
    layers: list[RemixLayer]
    bars: int = 8
    # Equal-power crossfade into the *next* slot, in bars. Clamped to the slot
    # length at render time so a short slot cannot overlap its own predecessor.
    crossfade_bars: float = 2.0

    def validate(self) -> None:
        if not self.layers:
            raise ValueError("a slot needs at least one layer")
        if self.bars < 1:
            raise ValueError(f"bars must be >= 1, got {self.bars}")
        if not math.isfinite(self.crossfade_bars) or self.crossfade_bars < 0:
            # inf/nan pass a bare `>= 0` test and then blow up inside
            # plan_timeline's int(round(...)), far from the bad value.
            raise ValueError(f"crossfade_bars must be finite and >= 0, got {self.crossfade_bars}")
        for layer in self.layers:
            layer.validate()


@dataclass
class RemixRecipe:
    name: str
    target_bpm: float
    slots: list[RemixSlot]
    beats_per_bar: int = 4
    # Recorded in the manifest for reference; never acted on automatically.
    key: str | None = None

    def validate(self) -> None:
        if not self.slots:
            raise ValueError("a remix needs at least one slot")
        if not math.isfinite(self.target_bpm) or not 40.0 <= self.target_bpm <= 240.0:
            raise ValueError(f"target_bpm out of range: {self.target_bpm}")
        if not 1 <= self.beats_per_bar <= 16:
            raise ValueError(f"beats_per_bar out of range: {self.beats_per_bar}")
        for slot in self.slots:
            slot.validate()

    @property
    def bar_seconds(self) -> float:
        return self.beats_per_bar * 60.0 / self.target_bpm


@dataclass
class RemixResult:
    name: str
    directory: str
    stems: dict[str, str] = field(default_factory=dict)
    manifest: dict[str, Any] = field(default_factory=dict)
    duration_sec: float = 0.0
    warnings: list[str] = field(default_factory=list)


# ─── DSP ─────────────────────────────────────────────────────────────────────


def _db_to_linear(db: float) -> float:
    return math.pow(10.0, db / 20.0)


def _loop_to_length(y: np.ndarray, n_samples: int) -> np.ndarray:
    """Tile `y` until it covers `n_samples`, then trim to exactly that length.

    Remixes are often longer than their sources — a 32-bar arrangement over a
    60-second stem would otherwise run dry and leave the tail silent, which
    reads as a bug rather than as an arrangement. Callers pass bar-aligned
    counts, so the loop seam lands on a downbeat.
    """
    if n_samples <= 0:
        return np.zeros((2, 0), dtype=np.float32)
    if y.size == 0:
        return np.zeros((2, n_samples), dtype=np.float32)
    if y.shape[-1] >= n_samples:
        return y[..., :n_samples]
    repeats = math.ceil(n_samples / y.shape[-1])
    return np.tile(y, (1, repeats))[..., :n_samples]


def _tempo_align(y: np.ndarray, source_bpm: float, target_bpm: float) -> np.ndarray:
    """Time-stretch so the source's tempo becomes `target_bpm`.

    `librosa.effects.time_stretch(rate=r)` multiplies tempo by r, so r is the
    target/source ratio. It changes duration without moving pitch, which is why
    key work needs a separate `pitch_shift`.
    """
    if source_bpm <= 0 or target_bpm <= 0:
        raise ValueError("tempo values must be positive")
    rate = target_bpm / source_bpm
    if abs(rate - 1.0) < 1e-3:
        return y
    return librosa.effects.time_stretch(y=y.astype(np.float32), rate=float(rate))


def _equal_power_ramp(n: int) -> tuple[np.ndarray, np.ndarray]:
    """Cosine/sine pair for a constant-power crossfade.

    Linear fades sum to a dip at the midpoint (power ~0.5 of unity); cos/sin
    keep the sum flat. `n <= 0` returns silence rather than raising, so a
    zero-length crossfade is legal.
    """
    if n <= 0:
        empty = np.zeros(0, dtype=np.float32)
        return empty, empty.copy()
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    return np.cos(t * math.pi / 2.0), np.sin(t * math.pi / 2.0)


# ─── source cache ────────────────────────────────────────────────────────────


class _SourceCache:
    """Load, tempo-align and key-shift each (track, stem) at most once.

    `time_stretch` and `pitch_shift` are the expensive steps and depend only on
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

    def bpm_for(self, track: str) -> float:
        if track not in self._bpms:
            self._bpms[track] = float(probe_track(track)["bpm"])
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
        )
        cached = self._audio.get(key)
        if cached is not None:
            return cached

        path = resolve_stem_path(layer.track, layer.stem)
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

        if len(self._audio) >= self.MAX_ENTRIES:
            self._audio.pop(next(iter(self._audio)))
        self._audio[key] = y
        return y

    def measured_rms_db(self, layer: RemixLayer) -> float:
        """RMS of the aligned source, for suggesting sensible per-layer gains."""
        y = self.get(layer)
        rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))
        return 20.0 * math.log10(rms + 1e-12)


# ─── rendering ───────────────────────────────────────────────────────────────


def plan_timeline(recipe: RemixRecipe) -> dict[str, Any]:
    """Resolve a recipe into exact sample counts, without rendering audio.

    Planning in samples rather than seconds matters: the write cursor and the
    output buffer length are both derived here, and rounding each to seconds
    independently is how they drift apart and leave a truncated tail.
    """
    recipe.validate()
    bar_n = max(1, int(round(recipe.bar_seconds * REMIX_SR)))
    seg_ns = [slot.bars * bar_n for slot in recipe.slots]
    xf_ns = [0]
    for i in range(1, len(recipe.slots)):
        requested = int(round(recipe.slots[i - 1].crossfade_bars * bar_n))
        xf_ns.append(max(0, min(requested, seg_ns[i - 1], seg_ns[i])))
    total_n = sum(seg_ns) - sum(xf_ns)
    if total_n < 1:
        raise ValueError("arrangement renders to zero samples")
    return {"bar_n": bar_n, "seg_ns": seg_ns, "xf_ns": xf_ns, "total_n": total_n}


def _render_slot(
    slot: RemixSlot,
    cache: _SourceCache,
    n_samples: int,
    bar_n: int,
) -> dict[str, np.ndarray]:
    """Mix one slot's layers into per-stem buffers of exactly `n_samples`."""
    out = {stem: np.zeros((2, n_samples), dtype=np.float32) for stem in STEM_NAMES}
    for layer in slot.layers:
        source = cache.get(layer)
        offset = layer.source_start_bar * bar_n
        # Loop rather than truncate, so a long arrangement over a short stem
        # does not fade to silence for the remainder.
        window = _loop_to_length(source, offset + n_samples)[:, offset:]
        out[layer.stem] += window * _db_to_linear(layer.gain_db)
    return out


def render_remix(recipe: RemixRecipe, overwrite: bool = True) -> RemixResult:
    """Render a recipe to a four-stem directory under `output/remixes/`.

    The output is a plain stem set, so it feeds the existing enhancer chain,
    `/api/audio/stem-file` playback and the visualizer with no special casing.
    """
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa is required to render remixes")
    name = _safe_remix_name(recipe.name)
    plan = plan_timeline(recipe)
    bar_n, seg_ns, xf_ns, total_n = (
        plan["bar_n"], plan["seg_ns"], plan["xf_ns"], plan["total_n"]
    )
    warnings: list[str] = []

    cache = _SourceCache(recipe.target_bpm)
    mixed = {stem: np.zeros((2, total_n), dtype=np.float32) for stem in STEM_NAMES}

    written = 0
    previous: dict[str, np.ndarray] | None = None
    previous_n = 0
    for index, slot in enumerate(recipe.slots):
        seg_n = seg_ns[index]
        segment = _render_slot(slot, cache, seg_n, bar_n)
        xf = xf_ns[index]
        if previous is None:
            for stem in STEM_NAMES:
                mixed[stem][:, :seg_n] = segment[stem]
            written = seg_n
        else:
            fade_out, fade_in = _equal_power_ramp(xf)
            overlap_start = written - xf
            for stem in STEM_NAMES:
                mixed[stem][:, overlap_start:written] = (
                    previous[stem][:, previous_n - xf :] * fade_out
                    + segment[stem][:, :xf] * fade_in
                )
                if seg_n > xf:
                    mixed[stem][:, written : written + seg_n - xf] += segment[stem][
                        :, xf:
                    ]
            written += seg_n - xf
        previous = segment
        previous_n = seg_n

    assert written == total_n, f"write cursor {written} != planned length {total_n}"

    # Warn rather than silently clipping. The enhancer's limiter catches this
    # later, but a remix needing -3 dB of it is worth saying out loud.
    for stem, buf in mixed.items():
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:
            warnings.append(
                f"{stem} peaks at {20.0 * math.log10(peak):+.2f} dBFS before the limiter"
            )

    try:
        import soundfile as sf
    except ImportError as exc:  # pragma: no cover - soundfile is a hard dep
        raise RuntimeError("soundfile is required to write remixes") from exc

    out_dir = REMIX_DIR / name
    if out_dir.exists():
        if not overwrite:
            raise FileExistsError(f"Remix already exists: {out_dir}")
        for old in out_dir.glob("*.wav"):
            old.unlink()
    out_dir.mkdir(parents=True, exist_ok=True)

    stems_out: dict[str, str] = {}
    for stem, buf in mixed.items():
        destination = out_dir / f"{stem}.wav"
        sf.write(str(destination), np.clip(buf, -1.0, 1.0).T, REMIX_SR, subtype="PCM_16")
        stems_out[stem] = str(destination)

    manifest = {
        "name": name,
        "target_bpm": round(recipe.target_bpm, 3),
        "beats_per_bar": recipe.beats_per_bar,
        "total_bars": sum(slot.bars for slot in recipe.slots),
        "duration_sec": round(total_n / REMIX_SR, 3),
        "sample_rate": REMIX_SR,
        "key_advisory": recipe.key,
        "source_tracks": sorted(
            {layer.track for slot in recipe.slots for layer in slot.layers}
        ),
        "stretch_ratios": {k: round(v, 4) for k, v in cache.stretch_ratios.items()},
        "warnings": warnings,
        "slots": [
            {
                "bars": slot.bars,
                "crossfade_bars": slot.crossfade_bars,
                "layers": [asdict(layer) for layer in slot.layers],
            }
            for slot in recipe.slots
        ],
    }
    (out_dir / "remix.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return RemixResult(
        name=name,
        directory=str(out_dir),
        stems=stems_out,
        manifest=manifest,
        duration_sec=manifest["duration_sec"],
        warnings=warnings,
    )


# ─── preview ─────────────────────────────────────────────────────────────────


def _near_silent_detail(
    layer: RemixLayer, rms: float, bar_seconds: float
) -> dict[str, Any]:
    """Structured form of the near-silence warning.

    `first_audible_sec` is already measured by the probe, so the
    suggestion can name the bar to jump to instead of the vague
    "check source_start_bar" the free-text form is stuck with. An
    agent (or a UI) can act on `code`/`field`/`suggestion` without
    parsing prose.
    """
    first_audible = _probe_summary(layer.track).get("first_audible_sec")
    suggestion = "check source_start_bar"
    if (
        isinstance(first_audible, (int, float))
        and first_audible > 0.0
        and bar_seconds > 0.0
    ):
        bar = math.ceil(float(first_audible) / bar_seconds - 1e-9)
        suggestion = (
            f"first_audible_sec is {float(first_audible):.2f}; "
            f"try source_start_bar >= {bar}"
        )
    return {
        "code": "near_silent",
        "layer_ref": f"{layer.track}/{layer.stem}",
        "field": "source_start_bar",
        "measured_rms_db": round(rms, 2),
        "suggestion": suggestion,
    }


def preview_recipe(recipe: RemixRecipe) -> dict[str, Any]:
    """Resolve a recipe without rendering any audio.

    Reports the exact timeline, each source's stretch ratio and its *measured*
    level, so a caller can sanity-check an arrangement before paying for a
    render. It does load and stretch the audio (that is how the RMS is
    measured), so it is not free - it is just free of the write and the
    crossfade mixing.

    The near-silence warning exists because of a real trap: several tracks here
    open with an instrumental intro, so a layer pointing at `source_start_bar=0`
    can be digitally silent and read as a broken mixer. It is reported twice:
    `warnings` stays a list of human-readable strings (existing callers), and
    `warnings_detail` carries the same facts structured as
    `{code, layer_ref, field, measured_rms_db, suggestion}` so an agent
    does not have to parse prose.
    """
    recipe.validate()
    plan = plan_timeline(recipe)
    cache = _SourceCache(recipe.target_bpm)
    layers: list[dict[str, Any]] = []
    warnings: list[str] = []
    warnings_detail: list[dict[str, Any]] = []
    for slot in recipe.slots:
        for layer in slot.layers:
            rms = cache.measured_rms_db(layer)
            source_bpm = cache.bpm_for(layer.track)
            layers.append(
                {
                    "track": layer.track,
                    "stem": layer.stem,
                    "source_bpm": round(source_bpm, 3),
                    "measured_rms_db": round(rms, 2),
                    "stretch_ratio": round(recipe.target_bpm / max(source_bpm, 1e-9), 4),
                    "source_start_bar": layer.source_start_bar,
                }
            )
            if rms < -50.0:
                warnings_detail.append(
                    _near_silent_detail(layer, rms, recipe.bar_seconds)
                )
                warnings.append(
                    f"{layer.track}/{layer.stem} is near-silent at this offset "
                    f"({rms:.0f} dBFS) - check source_start_bar"
                )
    return {
        "duration_sec": round(plan["total_n"] / REMIX_SR, 3),
        "total_bars": sum(slot.bars for slot in recipe.slots),
        "bar_seconds": round(recipe.bar_seconds, 4),
        "sample_rate": REMIX_SR,
        "stretch_ratios": {k: round(v, 4) for k, v in cache.stretch_ratios.items()},
        "layers": layers,
        "warnings": warnings,
        "warnings_detail": warnings_detail,
    }


# ─── existing remixes ────────────────────────────────────────────────────────


def remix_dir(name: str) -> Path:
    """Resolve a rendered remix directory, refusing anything outside REMIX_DIR."""
    safe = _safe_remix_name(name)
    candidate = (REMIX_DIR / safe).resolve()
    base = REMIX_DIR.resolve()
    if not str(candidate).startswith(str(base)):
        raise ValueError(f"Invalid remix name: {name!r}")
    return candidate


def list_remixes() -> list[dict[str, Any]]:
    """Rendered remixes with their manifest summary.

    Reads the `remix.json` written at render time, so this stays cheap and
    cannot drift from what was actually rendered.
    """
    out: list[dict[str, Any]] = []
    if not REMIX_DIR.is_dir():
        return out
    for entry in sorted(REMIX_DIR.iterdir()):
        # `.probes` is the cache, not a remix.
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        manifest_path = entry / "remix.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.debug("unreadable manifest for remix %s", entry.name)
            continue
        out.append(
            {
                "name": entry.name,
                "duration_sec": manifest.get("duration_sec"),
                "target_bpm": manifest.get("target_bpm"),
                "source_tracks": manifest.get("source_tracks", []),
                "stems": sorted(
                    p.stem for p in entry.glob("*.wav")
                ),
                "has_enhanced": (entry / "enhanced").is_dir(),
            }
        )
    return sorted(out, key=lambda d: d["name"].lower())


# ─── provenance: which mashups used a track, and how ──────────────────────────
#
# A remix manifest already stores everything a RemixRecipe needs (target_bpm,
# beats_per_bar, and each slot's bars/crossfade/layers with gain, key shift and
# source_start_bar). That means "reopen this mashup and rearrange it" is a
# round-trip of the manifest, not a guess at how it was built -- so these helpers
# reconstruct the recipe rather than asking the caller to rebuild it.


def _manifest_recipe(manifest: dict[str, Any]) -> dict[str, Any] | None:
    """Reconstruct a RemixRecipeRequest-shaped payload from a rendered manifest.

    Returns None when the manifest cannot round-trip (missing slots, or layers
    that no longer name a usable track/stem). A partial recipe would let the UI
    rebuild something subtly different from what was rendered, which is worse than
    saying "not reconstructable".
    """
    slots = manifest.get("slots")
    if not isinstance(slots, list) or not slots:
        return None
    clean_slots: list[dict[str, Any]] = []
    for slot in slots:
        layers = slot.get("layers")
        if not isinstance(layers, list) or not layers:
            return None
        clean_layers: list[dict[str, Any]] = []
        for layer in layers:
            track = layer.get("track")
            stem = layer.get("stem")
            if not track or stem not in STEM_NAMES:
                return None
            clean_layers.append(
                {
                    "track": track,
                    "stem": stem,
                    "gain_db": float(layer.get("gain_db", 0.0)),
                    "key_shift_semitones": float(layer.get("key_shift_semitones", 0.0)),
                    "source_start_bar": int(layer.get("source_start_bar", 0)),
                }
            )
        clean_slots.append(
            {
                "bars": int(slot.get("bars", 8)),
                "crossfade_bars": float(slot.get("crossfade_bars", 0.0)),
                "layers": clean_layers,
            }
        )
    return {
        "name": manifest.get("name"),
        "target_bpm": manifest.get("target_bpm"),
        "beats_per_bar": manifest.get("beats_per_bar", 4),
        "slots": clean_slots,
    }


def essentia_bpm_batch(tracks: list[str]) -> dict[str, float | None]:
    """Tempo from essentia (via WSL) for many tracks, in ONE subprocess call.

    Batching is not an optimisation detail: a wsl.exe round trip measured 5.65s,
    so a per-track API would take ~40s for a seven-track library. Tracks whose stem
    file is missing are omitted; a track that fails inside WSL comes back with a
    None value, so callers can tell "no answer" from "never asked".

    Returns an empty dict when the bridge is unavailable - the normal state when
    WSL is stopped - and callers then fall back to the other estimators.
    """
    payload: dict[str, Path] = {}
    for track in tracks:
        try:
            _stem, path = _pick_analysis_stem(track)
        except (FileNotFoundError, ValueError):
            continue
        payload[track] = path
    if not payload:
        return {}
    raw = essentia_bridge.probe_batch(payload)
    return {t: (r["bpm"] if r.get("bpm") is not None else None) for t, r in raw.items()}


def list_remixes_for_track(track: str) -> list[dict[str, Any]]:
    """Rendered remixes that consumed `track`, with their recipe attached.

    Joins on `source_tracks` in the manifest, which is the record of what was
    actually rendered rather than a separate bookkeeping file that could drift.
    Every mashup that used this track is returned, including ones where it was a
    secondary source: hiding those would make a shared mashup look like it
    belonged to whichever track happened to be listed first, and lineage is exactly
    what this endpoint exists to answer.
    """
    matched: list[dict[str, Any]] = []
    for entry in list_remixes():
        if track not in entry.get("source_tracks", []):
            continue
        directory = REMIX_DIR / entry["name"]
        recipe = None
        manifest_path = directory / "remix.json"
        if manifest_path.exists():
            try:
                recipe = _manifest_recipe(json.loads(manifest_path.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                recipe = None
        matched.append(
            {
                **entry,
                "recipe": recipe,
                "role": "primary" if entry.get("source_tracks", [None])[0] == track else "contributor",
            }
        )
    return matched
