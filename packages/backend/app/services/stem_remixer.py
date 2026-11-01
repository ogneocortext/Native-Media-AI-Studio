"""
Stem remixing / mashups -- build a new composition from stems of different songs.

This module has been split into focused modules for maintainability:
- ``remix_constants``   - paths, constants, key profiles
- ``remix_source``      - track discovery, resolution, path safety
- ``remix_analysis``    - tempo probing, key advisory
- ``remix_recipe``      - RemixLayer, RemixSlot, RemixRecipe, RemixResult
- ``remix_dsp``         - tempo alignment, STFT filters, crossfade ramps
- ``remix_source_cache``- _SourceCache, loudness staging
- ``remix_render``      - timeline planning, mixing, render_remix
- ``remix_preview``     - truncate_recipe, render_preview_audio, preview_recipe
- ``remix_library``     - list_remixes, list_remixes_for_track, provenance

This file re-exports the public API for backward compatibility.
New code should import directly from the focused modules.
"""

from __future__ import annotations

try:
    import librosa
except ImportError:  # pragma: no cover - librosa is a hard backend dep
    librosa = None

from .remix_constants import (
    AUDIO_DIR,
    AUDIO_EXTENSIONS,
    CALIBRATION_MAX_DB,
    KEY_CONFIDENCE_FLOOR,
    LOUDNESS_ANCHOR_LUFS,
    PROBE_CACHE_DIR,
    PROBE_CACHE_VERSION,
    REMIX_DIR,
    REMIX_SR,
    VERSIONS_DIRNAME,
    _HASH_PREFIX_RE,
    _MAJOR_PROFILE,
    _PITCH_NAMES,
    SEPARATION_DIR,
    STEM_NAMES,
)

PREVIEW_DIR = REMIX_DIR / ".previews"
from .remix_analysis import LIBROSA_AVAILABLE as _LIBROSA_AVAILABLE, probe_track
from .remix_dsp import (    LIBROSA_AVAILABLE as _DSP_LIBROSA_AVAILABLE,
    _brightness_tilt,
    _db_to_linear,
    _equal_power_ramp,
    _loop_to_length,
    _low_pass,
    _stft_filter,
    _tempo_align,
)
from .remix_library import (
    _manifest_recipe,
    essentia_bpm_batch,
    list_remixes,
    list_remixes_for_track,
    list_remix_versions,
    remix_dir,
    remix_version_dir,
)
from .remix_preview import (
    PREVIEW_MAX_ENTRIES,
    PREVIEW_MAX_SECONDS,
    _masking_warnings,
    _near_silent_detail,
    _prune_previews,
    _preview_key,
    _preview_meta_path,
    _read_preview_warnings,
    _wav_duration_sec,
    _write_preview_meta,
    preview_recipe,
    render_preview_audio,
    truncate_recipe,
)
from .remix_render import (
    RemixCancelledError,
    _archive_previous_render,
    _mix_recipe,
    _render_slot,
    build_mix_report,
    plan_timeline,
    render_remix,
)
from .remix_recipe import RemixLayer, RemixRecipe, RemixResult, RemixSlot
from .remix_source import (
    _normalize_track_name,
    _probe_summary,
    _safe_remix_name,
    _safe_track_name,
    _stem_dir_map,
    _pick_analysis_stem,
    library_audio_files,
    library_file_for,
    list_stem_sources,
    resolve_stem_path,
    resolve_track_key,
)
from .remix_source_cache import (
    _SourceCache,
    _ebur128_integrated_lufs,
    _ebur128_stats,
)

# Re-export names that tests and other modules reference directly.
__all__ = [
    # Constants
    "REMIX_SR",
    "REMIX_DIR",
    "PROBE_CACHE_DIR",
    "VERSIONS_DIRNAME",
    "KEY_CONFIDENCE_FLOOR",
    "PROBE_CACHE_VERSION",
    "LOUDNESS_ANCHOR_LUFS",
    "CALIBRATION_MAX_DB",
    "_PITCH_NAMES",
    "_MAJOR_PROFILE",
    "AUDIO_DIR",
    "AUDIO_EXTENSIONS",
    "_HASH_PREFIX_RE",
    "SEPARATION_DIR",
    "STEM_NAMES",
    "PREVIEW_MAX_ENTRIES",
    "PREVIEW_MAX_SECONDS",
    # Flags
    "LIBROSA_AVAILABLE",
    # Source
    "_normalize_track_name",
    "_probe_summary",
    "_safe_remix_name",
    "_safe_track_name",
    "_stem_dir_map",
    "_pick_analysis_stem",
    "library_audio_files",
    "library_file_for",
    "list_stem_sources",
    "resolve_stem_path",
    "resolve_track_key",
    # Analysis
    "probe_track",
    # Recipe
    "RemixLayer",
    "RemixRecipe",
    "RemixResult",
    "RemixSlot",
    # DSP
    "_db_to_linear",
    "_loop_to_length",
    "_tempo_align",
    "_stft_filter",
    "_low_pass",
    "_brightness_tilt",
    "_equal_power_ramp",
    # Source cache
    "_SourceCache",
    # Render
    "_ebur128_stats",
    "_ebur128_integrated_lufs",
    "_mix_recipe",
    "_render_slot",
    "RemixCancelledError",
    "_archive_previous_render",
    "_manifest_recipe",
    "build_mix_report",
    "plan_timeline",
    "render_remix",
    # Preview
    "PREVIEW_DIR",
    "_masking_warnings",
    "_near_silent_detail",
    "_prune_previews",
    "_preview_key",
    "_preview_meta_path",
    "_read_preview_warnings",
    "_wav_duration_sec",
    "_write_preview_meta",
    "preview_recipe",
    "render_preview_audio",
    "truncate_recipe",
    # Library
    "essentia_bpm_batch",
    "list_remixes",
    "list_remixes_for_track",
    "list_remix_versions",
    "remix_dir",
    "remix_version_dir",
]

# Make LIBROSA_AVAILABLE available as a module-level name (tests reference it).
LIBROSA_AVAILABLE = _LIBROSA_AVAILABLE or _DSP_LIBROSA_AVAILABLE
