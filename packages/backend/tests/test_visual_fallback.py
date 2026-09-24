"""Tests for the Q2 deterministic fallback preset selector.

Pure-logic tests: no fixtures, no GPU, no external services.
"""

from app.services.visual_fallback import (
    DEFAULT_PRESET,
    FALLBACK_PRESETS,
    is_known_preset,
    select_fallback_preset,
)


def test_genre_phrase_match():
    assert select_fallback_preset(genre="drift phonk") == "phonk"
    assert select_fallback_preset(genre="synthwave") == "synthwave"
    assert select_fallback_preset(genre="G-Funk") == "gfunk"
    assert select_fallback_preset(genre="lofi") == "lofi"


def test_longest_phrase_wins():
    # "trap metal" must beat the shorter "trap"/"metal" catalog phrases.
    assert select_fallback_preset(genre="trap metal") == "trapMetal"
    assert select_fallback_preset(genre="west coast") == "gfunk"
    # "hip hop" (7 chars) outranks "lofi" (4) even when lofi is named first.
    assert select_fallback_preset(genre="lofi hip hop") == "grime"


def test_padded_token_no_substring_bugs():
    # "rap" is a gfunk phrase; "grape" must not match it.
    assert select_fallback_preset(genre="grape soda") != "gfunk"


def test_normalization():
    assert select_fallback_preset(genre="Drift-Phonk") == "phonk"
    assert select_fallback_preset(genre="drift_phonk") == "phonk"
    assert select_fallback_preset(genre="  DRIFT   PHONK ") == "phonk"


def test_section_and_track_name_participate():
    assert select_fallback_preset(section="phonk drop") == "phonk"
    assert select_fallback_preset(track_name="Neon Rain") == "synthwave"


def test_unknown_genre_falls_through():
    # No catalog phrase or keyword matches "cyberpunk" (same as the frontend),
    # so it falls through to the default rather than guessing.
    assert select_fallback_preset(genre="cyberpunk") == "balanced"
    assert select_fallback_preset(genre="epic trailer") == "cinematic"


def test_energy_thresholds():
    assert select_fallback_preset(energy=0.9) == "dubstep"
    assert select_fallback_preset(energy=0.65) == "grime"
    assert select_fallback_preset(energy=0.2) == "ambient"
    assert select_fallback_preset(energy=0.35) == "lofi"


def test_bpm_thresholds():
    assert select_fallback_preset(bpm=150) == "dubstep"
    assert select_fallback_preset(bpm=130) == "grime"
    assert select_fallback_preset(bpm=80) == "ambient"
    assert select_fallback_preset(bpm=95) == "lofi"


def test_genre_beats_energy():
    assert select_fallback_preset(genre="ambient", energy=0.95) == "ambient"


def test_default_balanced():
    assert select_fallback_preset() == "balanced"
    assert select_fallback_preset(genre="") == "balanced"
    assert select_fallback_preset(genre="unknown genre xyz") == DEFAULT_PRESET


def test_non_finite_analysis_values_are_ignored():
    assert select_fallback_preset(energy=float("nan"), bpm=float("inf")) == "balanced"
    assert select_fallback_preset(energy=float("-inf"), bpm=float("nan")) == "balanced"


def test_deterministic():
    inputs = {"genre": "drift phonk", "energy": 0.7, "bpm": 140, "section": "chorus"}
    first = select_fallback_preset(**inputs)
    assert all(select_fallback_preset(**inputs) == first for _ in range(50))


def test_is_known_preset():
    assert is_known_preset("phonk")
    assert is_known_preset("balanced")
    assert not is_known_preset("nope")
    assert FALLBACK_PRESETS  # catalog is non-empty


def test_track_override_patch_notes():
    # BPM 152 would pick dubstep generically anyway; the override pins it.
    assert select_fallback_preset(track_name="SunoV6Mini-Patch-Notes.m4a", bpm=152) == "dubstep"


def test_track_override_patch_notes_v35_disambiguates():
    # "patchnotesv35" must win over the shorter "patchnotes" fragment.
    assert select_fallback_preset(track_name="SunoV6Mini-PatchNotesV3.5.m4a") == "dubstep"


def test_track_override_valley_phonk_beats_unproductive():
    # Longest fragment wins: the phonk mix must not resolve to gfunk.
    assert (
        select_fallback_preset(
            track_name="SunoV6Mini-Unproductive__Valley-Phonk-Extended-V2.m4a"
        )
        == "phonk"
    )


def test_track_override_unproductive():
    # 103 BPM falls between the generic thresholds (would be "balanced").
    assert select_fallback_preset(track_name="SunoV6Mini-UnproductiveV2.m4a", bpm=103.4) == "gfunk"


def test_track_override_human_in_the_loop():
    # 143.6 BPM would pick dubstep generically; the tuned profile is cinematic.
    assert select_fallback_preset(track_name="SunoV6Mini-Human-in-the-Loop-V2.m4a", bpm=143.6) == "cinematic"
    assert select_fallback_preset(track_name="HITL-V2-final.wav") == "cinematic"


def test_unknown_track_falls_through_to_generic():
    # No override fragment: generic energy/BPM logic still applies.
    assert select_fallback_preset(track_name="Some Random Song", bpm=150) == "dubstep"
    assert select_fallback_preset(track_name="Some Random Song") == "balanced"
