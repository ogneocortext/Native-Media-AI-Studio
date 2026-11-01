"""
Remix library listing and provenance.

Extracted from stem_remixer.py. Contains functions for listing rendered
remixes, listing versions, resolving a specific version directory, and
reconstructing a recipe from a rendered manifest.
"""

from __future__ import annotations

import json
import logging
import operator
from typing import TYPE_CHECKING, Any

from .remix_constants import VERSIONS_DIRNAME
from .remix_source import _safe_remix_name

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)


def remix_dir(name: str) -> Path:
    """Resolve a rendered remix directory, refusing anything outside REMIX_DIR.

    Reads ``REMIX_DIR`` through the shim at call time so tests can
    monkeypatch `stem_remixer.REMIX_DIR`.
    """
    from . import stem_remixer

    safe = _safe_remix_name(name)
    candidate = (stem_remixer.REMIX_DIR / safe).resolve()
    base = stem_remixer.REMIX_DIR.resolve()
    if not str(candidate).startswith(str(base)):
        raise ValueError(f"Invalid remix name: {name!r}")
    return candidate


def list_remixes() -> list[dict[str, Any]]:
    """Rendered remixes with their manifest summary.

    Reads the ``remix.json`` written at render time, so this stays cheap and
    cannot drift from what was actually rendered.

    Reads ``REMIX_DIR`` through the shim at call time so tests can
    monkeypatch `stem_remixer.REMIX_DIR`.
    """
    from . import stem_remixer

    out: list[dict[str, Any]] = []
    if not stem_remixer.REMIX_DIR.is_dir():
        return out
    for entry in sorted(stem_remixer.REMIX_DIR.iterdir()):
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
    is a complete render (stems + manifest + its own ``enhanced/`` master),
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
    for number, directory in sorted(entries, key=operator.itemgetter(0), reverse=True):
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

    The live render is whatever ``version`` its manifest claims, so an
    archived number that is not in ``.versions/`` is refused rather than
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
            if not track or stem not in {"vocals", "drums", "bass", "other"}:
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
    from . import essentia_bridge
    from .remix_source import _pick_analysis_stem

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
    """Rendered remixes that consumed ``track``, with their recipe attached.

    Joins on ``source_tracks`` in the manifest, which is the record of what was
    actually rendered rather than a separate bookkeeping file that could drift.
    Every mashup that used this track is returned, including ones where it was a
    secondary source: hiding those would make a shared mashup look like it
    belonged to whichever track happened to be listed first, and lineage is exactly
    what this endpoint exists to answer.
    """
    from .remix_source import _normalize_track_name

    matched: list[dict[str, Any]] = []
    # B6: a caller may hold the library filename (``....m4a``) or a
    # hash-prefixed variant where the manifest recorded the bare stem key,
    # so join on the normalized identity rather than the raw string --
    # otherwise "accept either key" would mean "does not 400", which is not
    # the same as finding the lineage.
    from . import stem_remixer

    target = _normalize_track_name(track)
    for entry in list_remixes():
        sources = entry.get("source_tracks", [])
        if target not in {_normalize_track_name(s) for s in sources}:
            continue
        directory = stem_remixer.REMIX_DIR / entry["name"]
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


__all__ = [
    "remix_dir",
    "list_remixes",
    "list_remix_versions",
    "remix_version_dir",
    "_live_version",
    "_manifest_recipe",
    "essentia_bpm_batch",
    "list_remixes_for_track",
]
