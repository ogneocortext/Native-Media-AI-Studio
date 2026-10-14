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

import hashlib
import json
import logging
import math
import re
import shutil
import subprocess
from collections.abc import Callable
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

# Archived renders of a remix, inside the remix directory: `<name>/.versions/
# vNNN/` is the Nth previous render of that name, stems and manifest included.
# A leading dot keeps `list_remixes` (which skips dot-directories) from ever
# reporting a history entry as a remix of its own.
VERSIONS_DIRNAME = ".versions"

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
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])


# ─── source discovery ────────────────────────────────────────────────────────


# ─── track-key resolution (B6) ─────────────────────────────────────────────
#
# The library reports filenames and paths (`2f9a5ced_Suno-V6-mini-….m4a`,
# `Suno-V6-Mini/SunoV6Mini-The Last-Original-V1.m4a`); this module keys stems
# by the bare directory demucs wrote (`SunoV6Mini-Ad-Nauseam`). Both forms are
# real to a caller, so every remix endpoint accepts either: a stem key passes
# through, and a library filename, relative path or hash-prefixed variant is
# normalised to the stem key. The join is deliberately conservative — a
# reference that matches no stem directory, or more than one after
# normalisation, is a ValueError naming the candidates rather than a guess.

AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
AUDIO_EXTENSIONS = (".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".wma")
_HASH_PREFIX_RE = re.compile(r"^([0-9a-f]{8}_)+", re.IGNORECASE)


def _normalize_track_name(name: str) -> str:
    """Lowercase alphanumeric-only identity of a track name.

    Hash prefixes stripped (the library adds 1-3 of them) and a trailing
    library extension dropped, so `X.m4a`, `2f9a5ced_X.wav` and `X` all
    normalize to the same identity. Separators and punctuation go too, so
    `Suno-V6-mini-Cold-Steel` and `SunoV6Mini-ColdSteel` agree.
    """
    base = _HASH_PREFIX_RE.sub("", (name or "").strip())
    lowered = base.lower()
    for ext in AUDIO_EXTENSIONS:
        if lowered.endswith(ext):
            base = base[: -len(ext)]
            break
    return re.sub(r"[^a-z0-9]+", "", base.lower())


def library_audio_files() -> list[Path]:
    """Every audio file in the library. A path query, so no decoding."""
    if not AUDIO_DIR.exists():
        return []
    return [
        f
        for f in sorted(AUDIO_DIR.rglob("*"))
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS and not f.name.startswith(".")
    ]


def _stem_dir_map() -> dict[str, str]:
    """Normalized stem-dir name -> stem key, for the reverse join."""
    found: dict[str, str] = {}
    for model_dir in sorted(SEPARATION_DIR.iterdir()) if SEPARATION_DIR.exists() else []:
        if not model_dir.is_dir():
            continue
        for track_dir in sorted(model_dir.iterdir()):
            if not track_dir.is_dir():
                continue
            if not any((track_dir / f"{s}.wav").exists() for s in STEM_NAMES):
                continue
            found.setdefault(_normalize_track_name(track_dir.name), track_dir.name)
    return found


def resolve_track_key(reference: str) -> str:
    """Resolve a stem key OR a library filename/path to the stem key (B6).

    Order matters: an exact stem-dir hit wins first (it is the form this
    module speaks), then an exact basename match, then a normalized-unique
    match. Ambiguity is reported, not resolved silently — "which track did
    you mean" is a question for the caller, and a wrong guess renders
    the wrong song.
    """
    reference = (reference or "").strip()
    if not reference:
        raise ValueError("track reference is empty")
    # Folder components are caller decoration, never identity.
    basename = reference.replace("\\", "/").split("/")[-1].strip()
    candidates = _stem_dir_map()
    if not candidates:
        raise ValueError("No separated stems exist yet — run separation first.")

    # 1. The reference is already the stem key (or its normalized form
    #    is unique among stem directories).
    direct = _normalize_track_name(Path(basename).stem)
    if direct in candidates:
        return candidates[direct]

    # 2. Normalized with hash prefixes stripped from BOTH sides: a library
    #    filename like `2f9a5ced_Suno-….m4a` normalizes to the same
    #    identity as its stem directory.
    matches = {key for norm, key in candidates.items() if norm == direct}
    if not matches:
        # 3. A suffix relationship covers `take-the-crown` <-> `NeoCortext -
        #    Take the Crown.mp3`: the stem dir is often a shortened form.
        matches = {
            key
            for norm, key in candidates.items()
            if norm and (norm.endswith(direct) or direct.endswith(norm))
        }
    if len(matches) == 1:
        return next(iter(matches))
    if not matches:
        raise ValueError(
            f"{reference!r} is not a separated source. Call GET /api/audio/remix/sources "
            "for the available tracks."
        )
    raise ValueError(
        f"{reference!r} is ambiguous — it matches {', '.join(sorted(matches))}. "
        "Pass one of those exactly."
    )


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
    """Locate one stem WAV on disk, preferring newer separation models.

    `track` is resolved through `resolve_track_key` first (B6), so a caller
    may pass the library filename or path it already has rather than having
    to know the stem-directory name demucs chose.
    """
    if stem not in STEM_NAMES:
        raise ValueError(f"stem must be one of {', '.join(STEM_NAMES)}")
    track = resolve_track_key(track)
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


def library_file_for(track: str, files: list[Path] | None = None) -> str | None:
    """The library filename a stem key came from, when the join is unambiguous.

    B6: the UI names tracks the way the library reports them, so a source
    listing that also carries the library filename lets a picker show one
    consistent identity. The join is refused rather than guessed when it is
    ambiguous (two library files normalizing to the same identity), because
    a picker preselected to the wrong song is worse than no preselection.

    `files` is the pre-scanned library listing: a caller listing every source
    should pass one scan rather than re-walking `AUDIO_DIR` per track (this
    measured 0.25 s per call on a library of ~120 files, which is not a
    dropdown-load cost).
    """
    target = _normalize_track_name(track)
    if not target:
        return None
    hits = [
        f
        for f in (files if files is not None else library_audio_files())
        if _normalize_track_name(f.stem) == target or _normalize_track_name(f.name) == target
    ]
    if not hits:
        return None
    # Hash-prefixed re-uploads of the same track are one identity, not two;
    # the shortest name is the cleanest label to show a picker.
    return min((f.name for f in hits), key=len)


def list_stem_sources() -> list[dict[str, Any]]:
    """Every track directory holding at least one stem, with per-stem presence.

    Pure path query — no audio is decoded, so this is safe to call on a
    dropdown open without waiting on demucs. Cached probe measurements
    (bpm, duration, first-audible) are joined from the probe cache when
    they exist, so a picker can show tempo and length without a probe
    round-trip per track. `library_file` (B6) carries the library filename
    whenever the join is unambiguous, and is omitted when it is not.
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
            entry["stems"] = {s: entry["stems"].get(s, False) or present[s] for s in STEM_NAMES}
    for entry in found.values():
        entry.update(_probe_summary(entry["track"]))
    # One library scan for the whole listing (see library_file_for).
    library_files = library_audio_files()
    for entry in found.values():
        library_file = library_file_for(entry["track"], library_files)
        if library_file:
            entry["library_file"] = library_file
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
        except (FileNotFoundError, ValueError):
            # Both mean "no stem file for this track": FileNotFoundError from
            # a missing WAV, ValueError from a key that resolves to no source
            # at all (B6). Either way the next stem in the chain is tried.
            continue
    raise FileNotFoundError(
        f"Track {track!r} has no stems under {SEPARATION_DIR} (looked for {', '.join(STEM_NAMES)})"
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
    # B6: accept a library filename/path here too, so /probe and the render
    # cache agree on what was asked.
    track = resolve_track_key(track)
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
    frame_rms = np.sqrt(np.mean(frames**2, axis=1))
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
        "key_confident": bool(correlation >= KEY_CONFIDENCE_FLOOR and flatness < 0.5),
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

    `lowpass_hz` / `brightness_db` are the tone-shaping pair the remix plan's
    B4 added, because "darker" was previously inexpressible — the only lever
    was gain. `lowpass_hz` zeroes spectrum above the cutoff (same STFT trick as
    the enhancer's `_high_pass`), and `brightness_db` tilts the spectrum in
    dB/octave around a 1 kHz pivot (positive = brighter). Both default to
    none, so every existing recipe renders bit-identically.
    """

    track: str
    stem: str
    gain_db: float = 0.0
    key_shift_semitones: float = 0.0
    # Offset into the source in *bars*, so a layer can enter partway through its
    # own song rather than always replaying from bar 0.
    source_start_bar: int = 0
    lowpass_hz: float | None = None
    brightness_db: float | None = None

    def validate(self) -> None:
        if self.stem not in STEM_NAMES:
            raise ValueError(f"stem must be one of {', '.join(STEM_NAMES)}")
        if not math.isfinite(self.gain_db) or not -60.0 <= self.gain_db <= 12.0:
            raise ValueError(f"gain_db out of range: {self.gain_db}")
        if self.lowpass_hz is not None and not (
            math.isfinite(self.lowpass_hz) and 200.0 <= self.lowpass_hz <= 20000.0
        ):
            # 200 Hz keeps the kick; 20 kHz is a no-op at REMIX_SR. B4.
            raise ValueError(f"lowpass_hz out of range: {self.lowpass_hz}")
        if self.brightness_db is not None and not (
            math.isfinite(self.brightness_db) and -12.0 <= self.brightness_db <= 12.0
        ):
            # ±12 dB/octave is the range where a tilt reads as tone rather
            # than as a broken signal. B4.
            raise ValueError(f"brightness_db out of range: {self.brightness_db}")
        if not math.isfinite(self.key_shift_semitones) or abs(self.key_shift_semitones) > 12.0:
            raise ValueError(f"key_shift_semitones out of range: {self.key_shift_semitones}")
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
    mix_report: dict[str, Any] = field(default_factory=dict)


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


def _stft_filter(
    y: np.ndarray,
    sr: int,
    gain_by_bin: callable,
) -> np.ndarray:
    """Apply a per-bin magnitude gain in the STFT domain.

    Same construction as the enhancer's `_high_pass` (FFT magnitude shaping
    with librosa's stft/istft and length restoration) — no scipy in this
    dependency set, and one implementation is easier to reason about than
    two. `gain_by_bin` maps the bin-frequency array to a linear gain array.
    """
    if y.size == 0 or not LIBROSA_AVAILABLE:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    stft *= gain_by_bin(freqs).astype(np.float32)[:, np.newaxis]
    out = librosa.istft(stft, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


def _low_pass(y: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    """Keep spectrum at or below `cutoff_hz`, zero above. The B4 "dark" half."""
    return _stft_filter(y, sr, lambda freqs: (freqs <= cutoff_hz).astype(np.float32))


_TILT_PIVOT_HZ = 1000.0


def _brightness_tilt(y: np.ndarray, sr: int, db_per_octave: float) -> np.ndarray:
    """Shelf the spectrum above a 1 kHz pivot by `db_per_octave` dB/octave.

    The B4 "bright/dark" control that gain cannot express: positive lifts
    highs, negative cuts them. It is a *shelf*, not a constant slope —
    a true tilt would also boost the lows by 6 dB under a "darker"
    command, which fights the layer's own bass gain and reads as mud.

    In the STFT domain the gain is naturally a per-bin power ratio:
    the octave count above the pivot is log2(f/pivot), and 20*log10 of
    one octave is 6.02 dB, so the linear gain is 10**(db*octaves/20).
    Below the pivot the gain is unity.
    """
    if not db_per_octave:
        return y
    return _stft_filter(
        y,
        sr,
        lambda freqs: np.where(
            freqs <= _TILT_PIVOT_HZ,
            1.0,
            np.power(
                10.0, (db_per_octave * np.log2(np.maximum(freqs, 1.0) / _TILT_PIVOT_HZ)) / 20.0
            ),
        ).astype(np.float32),
    )


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


# ─── loudness staging ────────────────────────────────────────────────────────
#
# Source stems come from different masters: 0 dB on a loud master is not 0 dB
# on a quiet one, so a recipe's gain_db is meaningless until the sources are
# calibrated to a common anchor. The anchor is a working level, not a target:
# the enhance chain still masters the finished mix to -14 LUFS downstream.
# Calibration is fail-open (0 dB) when ffmpeg is missing or a measurement
# fails — no calibration beats a wrong one.
LOUDNESS_ANCHOR_LUFS = -20.0
CALIBRATION_MAX_DB = 12.0


def _ebur128_stats(y: np.ndarray, sr: int) -> dict[str, float | None]:
    """Integrated LUFS and true peak of a (2, N) float32 buffer.

    One ffmpeg ebur128 run, piped through stdin — no temp files. This is
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
    m = re.search(r"^\s*Peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS", stderr, re.M)
    if m:
        out["true_peak_dbfs"] = float(m.group(1))
    return out


def _ebur128_integrated_lufs(y: np.ndarray, sr: int) -> float | None:
    """Integrated LUFS only — the loudness-staging calibration path."""
    return _ebur128_stats(y, sr)["integrated_lufs"]


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
        # (track, stem) -> {"offset_db": float, "measured_lufs": float | None, "clamped": bool}
        self._calibration: dict[tuple[str, str], dict[str, Any]] = {}

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
            # B4: tone shaping is per-layer like the rest of the key, so two
            # layers of the same stem with different lowpass settings do not
            # share a cache entry.
            round(layer.lowpass_hz or 0.0, 1),
            round(layer.brightness_db or 0.0, 2),
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

        # B4 tone shaping, cheap enough to sit after the cache-able steps.
        # Lowpass first, then tilt: filtering highs before tilting them means
        # the tilt cannot resurrect energy the lowpass removed.
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
        ±CALIBRATION_MAX_DB; fail-open 0.0 when ffmpeg is missing or the
        measurement fails. Cached per (track, stem).
        """
        key = (track, stem)
        if key not in self._calibration:
            record: dict[str, Any] = {"offset_db": 0.0, "measured_lufs": None, "clamped": False}
            try:
                path = resolve_stem_path(track, stem)
                y, _ = librosa.load(str(path), sr=REMIX_SR, mono=False)
                if y.ndim == 1:
                    y = y[np.newaxis, :]
                lufs = _ebur128_integrated_lufs(y, REMIX_SR)
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
        `source_start_bar=0` renders four bars of nothing and a
        whole-file RMS reports no problem. That is the "looks like a
        broken mixer" case the near-silent warning exists for, so the
        warning slices where `_render_slot` slices - from the layer's
        own `source_start_bar`, with the same loop semantics, so a
        window past the end of a short stem is judged on the audio the
        render would actually play.
        """
        source = self.get(layer)
        offset = layer.source_start_bar * bar_n
        window = _loop_to_length(source, offset + n_samples)[:, offset:]
        rms = float(np.sqrt(np.mean(window.astype(np.float64) ** 2)))
        return 20.0 * math.log10(rms + 1e-12)


# ─── rendering ───────────────────────────────────────────────────────────────


class RemixCancelledError(Exception):
    """A render was cancelled between slots.

    Cooperative by construction: `_mix_recipe` calls the caller's cancel
    token at each slot boundary and raises before the next slot renders.
    Nothing is destructive, because the whole mix is in memory until it
    completes - see `render_remix`, which writes nothing until
    `_mix_recipe` returns. A cancelled build therefore leaves the
    previous render, if any, exactly as it was.
    """


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
        # Loudness staging: the calibration equalizes source masters so the
        # recipe's gain_db is relative to a common anchor, not to whoever
        # mastered loudest. Recorded per (track, stem) in the manifest.
        staged_gain = layer.gain_db + cache.calibration_db(layer.track, layer.stem)
        out[layer.stem] += window * _db_to_linear(staged_gain)
    return out


def _mix_recipe(
    recipe: RemixRecipe,
    cache: _SourceCache | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, int], list[str], dict[str, float]]:
    """Render a recipe's slots into per-stem buffers, in memory.

    Shared by the full render and the audible preview (A3), so a preview
    exercises the same tempo alignment, key shifting, tone shaping,
    crossfades and per-layer gains as the build it previews — a preview
    that mixed differently would misrepresent the thing it previews.

    `should_cancel` is polled at each slot boundary and raises
    `RemixCancelledError` when it returns True. The check sits between slots
    rather than inside them, so cancellation is bounded by one slot's
    render time (seconds) while a slot itself always completes - there
    is no clean way to abort a time-stretch mid-flight.

    Returns (stems, plan, warnings, stretch_ratios); the ratios are part
    of the manifest's provenance, so they come back with the audio.
    """
    plan = plan_timeline(recipe)
    bar_n, seg_ns, xf_ns, total_n = (plan["bar_n"], plan["seg_ns"], plan["xf_ns"], plan["total_n"])
    cache = cache or _SourceCache(recipe.target_bpm)
    mixed = {stem: np.zeros((2, total_n), dtype=np.float32) for stem in STEM_NAMES}

    written = 0
    previous: dict[str, np.ndarray] | None = None
    previous_n = 0
    for index, slot in enumerate(recipe.slots):
        if should_cancel is not None and should_cancel():
            raise RemixCancelledError(f"cancelled after {index} of {len(recipe.slots)} slots")
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
                    mixed[stem][:, written : written + seg_n - xf] += segment[stem][:, xf:]
            written += seg_n - xf
        previous = segment
        previous_n = seg_n

    assert written == total_n, f"write cursor {written} != planned length {total_n}"

    # Consumers need plain Python ints (a manifest can hand over floats, and
    # numpy scalars leak in through the stretch maths), so normalise here
    # once. `seg_ns`/`xf_ns` are lists, so each element is converted: `int()`
    # on the list itself is a TypeError, which is exactly how this line
    # failed when `_mix_recipe` first ran.
    int_plan: dict[str, Any] = {
        key: [int(v) for v in value] if isinstance(value, list) else int(value)
        for key, value in plan.items()
    }

    # Peak warnings, shared by both paths: a caller is told before it writes.
    warnings: list[str] = []
    for stem, buf in mixed.items():
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:
            warnings.append(
                f"{stem} peaks at {20.0 * math.log10(peak):+.2f} dBFS before the limiter"
            )
    return mixed, int_plan, warnings, dict(cache.stretch_ratios)


def _version_dir(name: str, version: int) -> Path:
    """One archived render: `<name>/.versions/vNNN/`."""
    return REMIX_DIR / name / VERSIONS_DIRNAME / f"v{version:03d}"


def _archive_previous_render(out_dir: Path) -> int | None:
    """Move the current render aside as the next archived version.

    Everything except `.versions/` moves, so a version carries its own
    stems, manifest and `enhanced/` master - an archived version is a
    complete render, not a half-reference. The directory itself is
    recreated by the caller, which then writes the new render into it.

    Returns the version number the previous render was archived as, or
    None when there was nothing to archive (an empty directory) or the
    move failed. A failure to archive must not fail the render: the new
    mix is already in memory, and losing a stale archive is a smaller
    loss than losing the build the user asked for. The caller records
    the number in the manifest, so a missing version is visible rather
    than silent.
    """
    entries = [p for p in out_dir.iterdir() if p.name != VERSIONS_DIRNAME]
    if not entries:
        return None  # an empty directory is not a render; nothing to keep
    versions_root = out_dir / VERSIONS_DIRNAME
    versions_root.mkdir(parents=True, exist_ok=True)
    existing = sorted(p.name for p in versions_root.glob("v*") if p.is_dir())
    # Step over any number already taken, so a hand-created directory or
    # a partially failed archive cannot make two renders claim one slot.
    version = len(existing) + 1
    while f"v{version:03d}" in existing:
        version += 1
    destination = versions_root / f"v{version:03d}"
    destination.mkdir(parents=True, exist_ok=True)
    try:
        for entry in out_dir.iterdir():
            if entry.name == VERSIONS_DIRNAME:
                continue
            shutil.move(str(entry), str(destination / entry.name))
    except OSError:
        logger.exception("could not archive the previous render in %s", out_dir)
        return None
    return version


def build_mix_report(mixed: dict[str, np.ndarray]) -> dict[str, Any]:
    """Post-build mix report: per-stem and summed-mix loudness facts.

    For the R1 revision loop: an agent reads this instead of listening —
    per-stem integrated LUFS shows the balance ("vocals 8 dB hotter than
    drums"), true peak and the clipping flag show whether the limiter
    engaged. Measured from the clipped buffers (what is on disk); the
    clipping flag comes from the pre-clip peak (anything over 0 dBFS hit
    the limiter at write). LUFS fields are None when ffmpeg is missing;
    peak_dbfs is always measured (pure numpy).
    """
    stems: dict[str, dict[str, Any]] = {}
    mix_buf = None
    for stem, buf in mixed.items():
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        clipped = np.clip(buf, -1.0, 1.0)
        stats = _ebur128_stats(clipped, REMIX_SR)
        stems[stem] = {
            "integrated_lufs": stats["integrated_lufs"],
            "true_peak_dbfs": stats["true_peak_dbfs"],
            "peak_dbfs": round(20.0 * math.log10(peak + 1e-12), 2),
            "clipping": bool(peak > 1.0),
        }
        mix_buf = clipped if mix_buf is None else mix_buf + clipped
    mix_peak = float(np.max(np.abs(mix_buf))) if mix_buf is not None and mix_buf.size else 0.0
    mix_stats = _ebur128_stats(np.clip(mix_buf, -1.0, 1.0), REMIX_SR) if mix_buf is not None else {"integrated_lufs": None, "true_peak_dbfs": None}
    return {
        "stems": stems,
        "mix": {
            "integrated_lufs": mix_stats["integrated_lufs"],
            "true_peak_dbfs": mix_stats["true_peak_dbfs"],
            "peak_dbfs": round(20.0 * math.log10(mix_peak + 1e-12), 2),
            "clipping": bool(mix_peak > 1.0),
        },
    }


def render_remix(
    recipe: RemixRecipe,
    overwrite: bool = True,
    should_cancel: Callable[[], bool] | None = None,
) -> RemixResult:
    """Render a recipe to a four-stem directory under `output/remixes/`.

    The output is a plain stem set, so it feeds the existing enhancer chain,
    `/api/audio/stem-file` playback and the visualizer with no special casing.

    Writing happens only after `_mix_recipe` returns, which is what makes
    cancellation non-destructive: `should_cancel` raises `RemixCancelledError`
    during the mix, before this function touches the output directory, so a
    cancelled build leaves any previous render exactly as it was.
    """
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa is required to render remixes")
    name = _safe_remix_name(recipe.name)
    cache = _SourceCache(recipe.target_bpm)
    mixed, plan, warnings, stretch_ratios = _mix_recipe(recipe, cache, should_cancel)
    calibration = cache.calibration_report()
    for ref, rec in calibration.items():
        if rec["measured_lufs"] is None:
            warnings.append(f"{ref}: loudness calibration skipped (ffmpeg/measurement failed) — layer renders uncalibrated")
        elif rec["clamped"]:
            warnings.append(f"{ref}: calibration {rec['offset_db']:+.1f} dB hit the ±{CALIBRATION_MAX_DB:.0f} dB clamp — source is unusually quiet/loud, check the stem")
    total_n = plan["total_n"]

    try:
        import soundfile as sf
    except ImportError as exc:  # pragma: no cover - soundfile is a hard dep
        raise RuntimeError("soundfile is required to write remixes") from exc

    out_dir = REMIX_DIR / name
    version = 1
    if out_dir.exists():
        if not overwrite:
            raise FileExistsError(f"Remix already exists: {out_dir}")
        # A rebuild used to delete the previous render: one mis-click on
        # Build and the mix you were A/B-ing against was gone. The prior
        # render is archived under `.versions/` first, so the lineage
        # survives and the current directory stays the live one.
        archived_as = _archive_previous_render(out_dir)
        if archived_as is not None:
            version = archived_as + 1
    out_dir.mkdir(parents=True, exist_ok=True)

    stems_out: dict[str, str] = {}
    for stem, buf in mixed.items():
        destination = out_dir / f"{stem}.wav"
        sf.write(str(destination), np.clip(buf, -1.0, 1.0).T, REMIX_SR, subtype="PCM_16")
        stems_out[stem] = str(destination)

    manifest = {
        "name": name,
        "version": version,
        "target_bpm": round(recipe.target_bpm, 3),
        "beats_per_bar": recipe.beats_per_bar,
        "total_bars": sum(slot.bars for slot in recipe.slots),
        "duration_sec": round(total_n / REMIX_SR, 3),
        "sample_rate": REMIX_SR,
        "key_advisory": recipe.key,
        "source_tracks": sorted({layer.track for slot in recipe.slots for layer in slot.layers}),
        "stretch_ratios": {k: round(v, 4) for k, v in stretch_ratios.items()},
        "warnings": warnings,
        "loudness_calibration_db": {ref: rec["offset_db"] for ref, rec in calibration.items()},
        "slots": [
            {
                "bars": slot.bars,
                "crossfade_bars": slot.crossfade_bars,
                "layers": [asdict(layer) for layer in slot.layers],
            }
            for slot in recipe.slots
        ],
    }
    mix_report = build_mix_report(mixed)
    manifest["mix_report"] = mix_report
    for stem, entry in mix_report["stems"].items():
        if entry["clipping"]:
            warnings.append(
                f"{stem} hits {entry['peak_dbfs']:+.1f} dBFS — the limiter engaged; pull its layers down"
            )
    if mix_report["mix"]["clipping"]:
        warnings.append(
            f"summed mix hits {mix_report['mix']['peak_dbfs']:+.1f} dBFS — the limiter engaged on the master"
        )
    (out_dir / "remix.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return RemixResult(
        name=name,
        directory=str(out_dir),
        stems=stems_out,
        manifest=manifest,
        duration_sec=manifest["duration_sec"],
        warnings=warnings,
        mix_report=mix_report,
    )


# ─── audible preview (A3) ────────────────────────────────────────────────────
#
# `preview_recipe` answers "what would this render to" in numbers; A3 answers
# "what does it sound like" without paying for a build. The preview is the same
# recipe rendered through the same mix core, truncated to a bounded length and
# cached by recipe hash so re-clicking Preview Audio after a tweak is one load.

PREVIEW_DIR = REMIX_DIR / ".previews"
PREVIEW_MAX_SECONDS = 30.0
PREVIEW_MAX_ENTRIES = 12


def truncate_recipe(recipe: RemixRecipe, max_seconds: float = PREVIEW_MAX_SECONDS) -> RemixRecipe:
    """Bound a recipe's rendered length to `max_seconds`, whole slots first.

    Whole slots stay whole — an audition of the first three slots and a
    fade tells the user more about the arrangement than a hard cut in the
    middle of the second one. Only the final kept slot is trimmed, and its
    crossfade is clamped with it so `plan_timeline` cannot reject the
    result. Recipes that already fit are returned unchanged.
    """
    bar_seconds = recipe.bar_seconds
    if bar_seconds <= 0:
        raise ValueError("bar_seconds must be positive")
    max_bars = max(1, int(max_seconds / bar_seconds))
    kept: list[RemixSlot] = []
    total_bars = 0
    for slot in recipe.slots:
        if not slot.layers:
            continue
        remaining = max_bars - total_bars
        if remaining <= 0:
            break
        if slot.bars <= remaining:
            kept.append(slot)
            total_bars += slot.bars
            continue
        # Trim the crossing slot: at least one bar, and a crossfade that
        # fits inside both adjacent segments after the trim.
        bars = max(1, remaining)
        trimmed = RemixSlot(
            layers=list(slot.layers),
            bars=bars,
            crossfade_bars=min(
                slot.crossfade_bars, float(bars), float(kept[-1].bars) if kept else float(bars)
            ),
        )
        kept.append(trimmed)
        total_bars += bars
        break
    if not kept:
        raise ValueError("recipe renders to no playable bars")
    return RemixRecipe(
        name=recipe.name,
        target_bpm=recipe.target_bpm,
        beats_per_bar=recipe.beats_per_bar,
        key=recipe.key,
        slots=kept,
    )


def _preview_key(recipe: RemixRecipe) -> str:
    """Stable hash of everything the preview audio depends on."""
    payload = json.dumps(
        {
            "bpm": round(recipe.target_bpm, 3),
            "beats_per_bar": recipe.beats_per_bar,
            "slots": [
                {
                    "bars": slot.bars,
                    "crossfade_bars": slot.crossfade_bars,
                    "layers": [asdict(layer) for layer in slot.layers],
                }
                for slot in recipe.slots
            ],
        },
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]  # noqa: S324 - cache key, not security


def _preview_meta_path(wav_path: Path) -> Path:
    """Sidecar JSON beside a cached excerpt, carrying what the wav cannot."""
    return wav_path.with_suffix(".json")


def _write_preview_meta(wav_path: Path, warnings: list[str]) -> None:
    """Record the mix facts that produced the excerpt.

    The written file is peak-normalised, so the pre-normalisation warnings
    cannot be recovered from it. Without the sidecar a cache hit would report
    `warnings: []` for a recipe whose first render warned, which is a
    different answer for the same input.
    """
    _preview_meta_path(wav_path).write_text(
        json.dumps({"warnings": warnings}), encoding="utf-8"
    )


def _read_preview_warnings(wav_path: Path) -> list[str]:
    """Warnings recorded when the excerpt was rendered; [] if unreadable."""
    try:
        data = json.loads(_preview_meta_path(wav_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return []
    return list(data.get("warnings", [])) if isinstance(data, dict) else []


def render_preview_audio(
    recipe: RemixRecipe, max_seconds: float = PREVIEW_MAX_SECONDS
) -> dict[str, Any]:
    """Render a bounded, playable excerpt of a recipe (A3).

    Returns `{path, duration_sec, truncated, warnings}`. The result is
    cached by recipe hash, so an unchanged recipe replays from disk rather
    than re-timestretching every source. The cache holds the newest
    `PREVIEW_MAX_ENTRIES` excerpts and drops the rest - a preview nobody
    replays is dead weight.
    """
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa is required to render a preview")
    bounded = truncate_recipe(recipe, max_seconds)
    truncated = len(bounded.slots) != len(recipe.slots) or any(
        a.bars != b.bars for a, b in zip(bounded.slots, recipe.slots, strict=False)
    )
    key = _preview_key(bounded)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    destination = PREVIEW_DIR / f"{key}.wav"

    if destination.exists():
        warnings = _read_preview_warnings(destination)
    else:
        import soundfile as sf

        mixed, plan, warnings, _ratios = _mix_recipe(bounded)
        # A single stereo mixdown, peak-normalised: an audition is no use
        # if it plays back quieter than the full build would.
        mono = np.zeros(plan["total_n"], dtype=np.float32)
        for buf in mixed.values():
            mono += buf.mean(axis=0)
        peak = float(np.max(np.abs(mono))) if mono.size else 0.0
        if peak > 0:
            mono = mono / peak
        sf.write(str(destination), np.stack([mono, mono], axis=0).T, REMIX_SR, subtype="PCM_16")
        _write_preview_meta(destination, warnings)

    _prune_previews()
    return {
        "path": str(destination),
        "duration_sec": round(_wav_duration_sec(destination), 3),
        "truncated": truncated,
        "warnings": warnings,
    }


def _wav_duration_sec(path: Path) -> float:
    """Duration of a 16-bit PCM WAV from its header — no decode needed."""
    import wave

    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


def _prune_previews(keep: int = PREVIEW_MAX_ENTRIES) -> None:
    """Drop the oldest preview files beyond `keep`, newest-first by mtime.

    The `.json` sidecar goes with its wav: leaving it behind would orphan a
    file every later run rewrites anyway.
    """
    if not PREVIEW_DIR.exists():
        return
    files = sorted(PREVIEW_DIR.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in files[keep:]:
        for candidate in (stale, _preview_meta_path(stale)):
            try:
                candidate.unlink()
            except OSError:
                pass


def _near_silent_detail(layer: RemixLayer, rms: float, bar_seconds: float) -> dict[str, Any]:
    """Structured form of the near-silence warning.

    `first_audible_sec` is already measured by the probe, so the
    suggestion can name the bar to jump to instead of the vague
    "check source_start_bar" the free-text form is stuck with. An
    agent (or a UI) can act on `code`/`field`/`suggestion` without
    parsing prose.
    """
    first_audible = _probe_summary(layer.track).get("first_audible_sec")
    suggestion = "check source_start_bar"
    if isinstance(first_audible, (int, float)) and first_audible > 0.0 and bar_seconds > 0.0:
        bar = math.ceil(float(first_audible) / bar_seconds - 1e-9)
        suggestion = (
            f"first_audible_sec is {float(first_audible):.2f}; try source_start_bar >= {bar}"
        )
    return {
        "code": "near_silent",
        "layer_ref": f"{layer.track}/{layer.stem}",
        "field": "source_start_bar",
        "measured_rms_db": round(rms, 2),
        "suggestion": suggestion,
    }


def _masking_warnings(slot_index: int, layers: list[RemixLayer]) -> tuple[list[str], list[dict[str, Any]]]:
    """Frequency-slotting warnings (knowledge: mashup-arrangement-theory §4).

    Two layers in the same band mask each other: louder but muddier, not
    fuller. Drums are exempt — transients poke through sustained material,
    so stacking drums is a level problem, not a masking problem.
    """
    warnings: list[str] = []
    details: list[dict[str, Any]] = []
    by_stem: dict[str, list[RemixLayer]] = {}
    for layer in layers:
        by_stem.setdefault(layer.stem, []).append(layer)
    bass = by_stem.get("bass", [])
    if len(bass) >= 2:
        refs = " + ".join(f"{lyr.track}/bass" for lyr in bass)
        warnings.append(
            f"slot {slot_index + 1}: two bass layers ({refs}) will mask each other — "
            "keep one, or cut the other 3-6 dB"
        )
        details.append(
            {
                "code": "bass_collision",
                "layer_ref": f"slot {slot_index + 1}: {refs}",
                "field": "gain_db",
                "suggestion": "keep one bass layer; cut the other 3-6 dB or drop it",
            }
        )
    other = by_stem.get("other", [])
    if len(other) >= 2 and max(lyr.gain_db for lyr in other) - min(lyr.gain_db for lyr in other) <= 6.0:
        refs = " + ".join(f"{lyr.track}/other" for lyr in other)
        warnings.append(
            f"slot {slot_index + 1}: two 'other' stems at similar gain ({refs}) — "
            "midrange masking likely; pull one down 3-6 dB or lowpass it (lowpass_hz)"
        )
        details.append(
            {
                "code": "midrange_masking",
                "layer_ref": f"slot {slot_index + 1}: {refs}",
                "field": "gain_db",
                "suggestion": "pull one \u2018other\u2019 down 3-6 dB or set lowpass_hz on it",
            }
        )
    return warnings, details


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
    does not have to parse prose. Two RMS values appear in the response and
    they mean different things: `layers[].measured_rms_db` is the whole
    aligned source (a gain-suggestion reference), while the near-silent
    detail's `measured_rms_db` is the slice the slot renders from the
    layer's own `source_start_bar` - the one a listener actually hears.
    """
    recipe.validate()
    plan = plan_timeline(recipe)
    cache = _SourceCache(recipe.target_bpm)
    bar_n = plan["bar_n"]
    layers: list[dict[str, Any]] = []
    warnings: list[str] = []
    warnings_detail: list[dict[str, Any]] = []
    for si, slot in enumerate(recipe.slots):
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
            # The near-silent check reads the slice the slot renders, not the
            # whole source: a stem that opens silently has a healthy
            # whole-file RMS and would otherwise render four bars of nothing
            # with no warning at all.
            window_rms = cache.window_rms_db(layer, slot.bars * bar_n, bar_n)
            if window_rms < -50.0:
                warnings_detail.append(_near_silent_detail(layer, window_rms, recipe.bar_seconds))
                warnings.append(
                    f"{layer.track}/{layer.stem} is near-silent at this offset "
                    f"({window_rms:.0f} dBFS) - check source_start_bar"
                )
        mw, md = _masking_warnings(si, slot.layers)
        warnings.extend(mw)
        warnings_detail.extend(md)
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
                "stems": sorted(p.stem for p in entry.glob("*.wav")),
                "has_enhanced": (entry / "enhanced").is_dir(),
            }
        )
    return sorted(out, key=lambda d: d["name"].lower())


def list_remix_versions(name: str) -> list[dict[str, Any]]:
    """Every render of one remix, newest first: the current one and its archive.

    Each entry carries the facts the listing shows and the stem files that
    exist, so playing an earlier version needs no second call. A version
    is a complete render (stems + manifest + its own `enhanced/` master),
    which is what "archive the whole directory" was chosen for over
    copying just the stems.

    Returns [] for an unknown name, so a caller can treat "no history"
    and "no such remix" the same way - neither has anything to play.
    """
    out_dir = remix_dir(name)
    if not out_dir.is_dir():
        return []
    versions_root = out_dir / VERSIONS_DIRNAME

    entries: list[tuple[int, Path]] = []
    for directory in versions_root.glob("v*") if versions_root.is_dir() else []:
        if directory.is_dir() and directory.name[1:].isdigit():
            entries.append((int(directory.name[1:]), directory))
    # The live render is the newest version; its own number comes from
    # its manifest so a hand-edited history cannot renumber it. A render
    # from before manifests carried versions is numbered after whatever
    # is archived, which is where the next rebuild would put it.
    live_version = _live_version(out_dir)
    if (out_dir / "remix.json").exists():
        if live_version <= 0:
            live_version = max((n for n, _ in entries), default=0) + 1
        entries.append((live_version, out_dir))

    out: list[dict[str, Any]] = []
    for number, directory in sorted(entries, key=lambda pair: pair[0], reverse=True):
        manifest = {}
        try:
            manifest = json.loads((directory / "remix.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            logger.debug("unreadable manifest for %s v%d", name, number)
        out.append(
            {
                "version": number,
                "current": directory == out_dir,
                "duration_sec": manifest.get("duration_sec"),
                "target_bpm": manifest.get("target_bpm"),
                "total_bars": manifest.get("total_bars"),
                "source_tracks": manifest.get("source_tracks", []),
                "stems": sorted(p.stem for p in directory.glob("*.wav")),
                "has_enhanced": (directory / "enhanced").is_dir(),
            }
        )
    return out


def remix_version_dir(name: str, version: int) -> Path:
    """Resolve one render of a remix: the live directory or an archived one.

    The live render is whatever `version` its manifest claims, so an
    archived number that is not in `.versions/` is refused rather than
    silently falling back to the current render - a request for v3 that
    answers with v4 is a wrong answer, not a default.
    """
    out_dir = remix_dir(name)
    if version <= 0:
        raise ValueError("version must be positive")
    if version == _live_version(out_dir):
        return out_dir
    candidate = out_dir / VERSIONS_DIRNAME / f"v{version:03d}"
    if not candidate.is_dir():
        raise FileNotFoundError(f"No version {version} of remix {name!r}")
    return candidate


def _live_version(out_dir: Path) -> int:
    """The version number the live render claims, or 0 when it says nothing."""
    try:
        manifest = json.loads((out_dir / "remix.json").read_text(encoding="utf-8"))
        return int(manifest.get("version", 0))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 0


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
                    # B4: None when absent so an older manifest reads back as
                    # the no-tone-shaping recipe it rendered.
                    "lowpass_hz": (
                        float(layer["lowpass_hz"]) if layer.get("lowpass_hz") is not None else None
                    ),
                    "brightness_db": (
                        float(layer["brightness_db"])
                        if layer.get("brightness_db") is not None
                        else None
                    ),
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
    # B6: a caller may hold the library filename (`….m4a`) or a
    # hash-prefixed variant where the manifest recorded the bare stem key,
    # so join on the normalized identity rather than the raw string —
    # otherwise "accept either key" would mean "does not 400", which is not
    # the same as finding the lineage.
    target = _normalize_track_name(track)
    for entry in list_remixes():
        sources = entry.get("source_tracks", [])
        if target not in {_normalize_track_name(s) for s in sources}:
            continue
        directory = REMIX_DIR / entry["name"]
        recipe = None
        manifest_path = directory / "remix.json"
        if manifest_path.exists():
            try:
                recipe = _manifest_recipe(json.loads(manifest_path.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                recipe = None
        first = sources[0] if sources else ""
        matched.append(
            {
                **entry,
                "recipe": recipe,
                "role": ("primary" if _normalize_track_name(first) == target else "contributor"),
            }
        )
    return matched
