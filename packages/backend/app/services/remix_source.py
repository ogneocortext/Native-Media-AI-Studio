"""
Track discovery, resolution and path safety for remixes.

Extracted from stem_remixer.py. Contains everything that turns a caller's
track reference (stem key, library filename or path) into a stem-directory
key and a stem WAV path on disk.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from .remix_constants import (
    AUDIO_DIR,
    AUDIO_EXTENSIONS,
    _HASH_PREFIX_RE,
    STEM_NAMES,
)
from . import stem_remixer

logger = logging.getLogger(__name__)


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
    sep = stem_remixer.SEPARATION_DIR
    for model_dir in sorted(sep.iterdir()) if sep.exists() else []:
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
    """Resolve a stem key OR a library filename/path to the stem key.

    Order matters: an exact stem-dir hit wins first (it is the form this
    module speaks), then an exact basename match, then a normalized-unique
    match. Ambiguity is reported, not resolved silently -- "which track did
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
        raise ValueError("No separated stems exist yet -- run separation first.")

    # 1. The reference is already the stem key (or its normalized form
    #    is unique among stem directories).
    direct = _normalize_track_name(Path(basename).stem)
    if direct in candidates:
        return candidates[direct]

    # 2. Normalized with hash prefixes stripped from BOTH sides: a library
    #    filename like `2f9a5ced_Suno-....m4a` normalizes to the same
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
        f"{reference!r} is ambiguous -- it matches {', '.join(sorted(matches))}. "
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
    """Same contract as ``_safe_track_name``, for the output directory name.

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

    `track` is resolved through :func:`resolve_track_key` first, so a caller
    may pass the library filename or path it already has rather than having
    to know the stem-directory name demucs chose.

    Reads ``SEPARATION_DIR`` and ``resolve_track_key`` through the shim at
    call time so tests can monkeypatch `stem_remixer.SEPARATION_DIR` and
    `stem_remixer.resolve_track_key`.
    """
    if stem not in STEM_NAMES:
        raise ValueError(f"stem must be one of {', '.join(STEM_NAMES)}")
    track = stem_remixer.resolve_track_key(track)
    safe = _safe_track_name(track)
    base = stem_remixer.SEPARATION_DIR.resolve()
    model_dirs = [d for d in sorted(stem_remixer.SEPARATION_DIR.iterdir()) if d.is_dir()]
    model_dirs.sort(key=lambda p: p.name != "mdx_extra_q")
    for model_dir in model_dirs:
        candidate = (model_dir / safe / f"{stem}.wav").resolve()
        if candidate.exists() and str(candidate).startswith(str(base)):
            return candidate
    raise FileNotFoundError(
        f"No {stem}.wav for track {track!r} under {stem_remixer.SEPARATION_DIR}"
    )


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
        f"Track {track!r} has no stems under {stem_remixer.SEPARATION_DIR} (looked for {', '.join(STEM_NAMES)})"
    )


def _probe_summary(track: str) -> dict[str, Any]:
    """Cached probe fields for a track, or {} when it has none.

    A pure file read: the probe already measured bpm, duration and
    first-audible and cached them under ``output/remixes/.probes/``,
    so joining them into a listing costs no analysis. A track that
    has never been probed simply lists without them - the fields
    are optional everywhere they appear.

    Reads ``PROBE_CACHE_DIR`` through the shim at call time so tests can
    monkeypatch `stem_remixer.PROBE_CACHE_DIR`.
    """
    from . import stem_remixer

    try:
        cache_path = stem_remixer.PROBE_CACHE_DIR / f"{_safe_track_name(track)}.json"
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

    ``files`` is the pre-scanned library listing: a caller listing every source
    should pass one scan rather than re-walking ``AUDIO_DIR`` per track (this
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

    Pure path query -- no audio is decoded, so this is safe to call on a
    dropdown open without waiting on demucs. Cached probe measurements
    (bpm, duration, first-audible) are joined from the probe cache when
    they exist, so a picker can show tempo and length without a probe
    round-trip per track. ``library_file`` (B6) carries the library filename
    whenever the join is unambiguous, and is omitted when it is not.
    """
    found: dict[str, dict[str, Any]] = {}
    sep = stem_remixer.SEPARATION_DIR
    for model_dir in sorted(sep.iterdir()):
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


__all__ = [
    "_normalize_track_name",
    "library_audio_files",
    "_stem_dir_map",
    "resolve_track_key",
    "_safe_track_name",
    "_safe_remix_name",
    "resolve_stem_path",
    "_pick_analysis_stem",
    "_probe_summary",
    "library_file_for",
    "list_stem_sources",
]
