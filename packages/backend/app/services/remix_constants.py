"""
Remix constants, paths and shared configuration.

Extracted from stem_remixer.py. Contains all module-level constants,
directory paths, key profiles and normalization helpers used across the
remix pipeline.
"""

from __future__ import annotations

import re

import numpy as np

from ..core.config import PROJECT_ROOT
from .source_separation import SEPARATION_DIR, STEM_NAMES

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

# Loudness-staging calibration anchor and clamp (see remix_source_cache).
# Source stems come from different masters, so 0 dB on a loud master is not
# 0 dB on a quiet one until the sources are calibrated to this common anchor.
LOUDNESS_ANCHOR_LUFS = -20.0
CALIBRATION_MAX_DB = 12.0

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

# --- track-key resolution ------------------------------------------------------

# The library reports filenames and paths (`2f9a5ced_Suno-V6-mini-....m4a`,
# `Suno-V6-Mini/SunoV6Mini-The Last-Original-V1.m4a`); this module keys stems
# by the bare directory demucs wrote (`SunoV6Mini-Ad-Nauseam`). Both forms are
# real to a caller, so every remix endpoint accepts either: a stem key passes
# through, and a library filename, relative path or hash-prefixed variant is
# normalised to the stem key. The join is deliberately conservative -- a
# reference that matches no stem directory, or more than one after
# normalisation, is a ValueError naming the candidates rather than a guess.
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
AUDIO_EXTENSIONS = (".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".wma")
_HASH_PREFIX_RE = re.compile(r"^([0-9a-f]{8}_)+", re.IGNORECASE)

__all__ = [
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
]
