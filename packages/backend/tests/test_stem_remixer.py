"""Tests for the stem remixer.

The crossfade test is deliberately synthetic. Measured on real material it was
inconclusive: the overlap region of a two-slot remix measured ~3 dB below the
lead-in, but that is the song getting quieter, not a fade error - the drums
stem drops from -18.9 dBFS overall to -26.8 dBFS over its first 6.3 s. Asserting
on that would encode the arrangement, not the algorithm. Two full-scale sine
streams with a *known* correlation answer the question the fade actually poses:
does the summed power stay flat through the transition?
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pytest
from app.services import stem_remixer
from app.services.stem_remixer import (
    REMIX_SR,
    RemixLayer,
    RemixRecipe,
    RemixSlot,
    _brightness_tilt,
    _db_to_linear,
    _equal_power_ramp,
    _loop_to_length,
    _low_pass,
    _safe_remix_name,
    _safe_track_name,
    plan_timeline,
)


def _sine(freq: float, n: int, sr: int = REMIX_SR) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / sr
    return np.sin(2.0 * np.pi * freq * t)


# ─── crossfade ───────────────────────────────────────────────────────────────


def test_equal_power_ramp_endpoints_and_power():
    """cos/sin keeps summed power flat for uncorrelated sources."""
    n = 2048
    fade_out, fade_in = _equal_power_ramp(n)
    assert fade_out[0] == pytest.approx(1.0, abs=1e-6)
    assert fade_in[0] == pytest.approx(0.0, abs=1e-6)
    assert fade_out[-1] == pytest.approx(0.0, abs=1e-6)
    assert fade_in[-1] == pytest.approx(1.0, abs=1e-6)
    # Constant power across the whole ramp: this is the property a linear fade
    # fails, dipping to 0.5 of unity at the midpoint.
    power = fade_out**2 + fade_in**2
    assert np.allclose(power, 1.0, atol=1e-6)


def test_equal_power_ramp_handles_zero_length():
    fade_out, fade_in = _equal_power_ramp(0)
    assert fade_out.size == 0
    assert fade_in.size == 0


def test_linear_fade_would_dip_but_equal_power_does_not():
    """Guard the reason this helper exists rather than a linear fade."""
    n = 1024
    t = np.linspace(0.0, 1.0, n)
    linear_power = (1.0 - t) ** 2 + t**2
    assert linear_power.min() < 0.55  # the problem
    fade_out, fade_in = _equal_power_ramp(n)
    assert np.allclose(fade_out**2 + fade_in**2, 1.0, atol=1e-6)  # the fix


# ─── looping ─────────────────────────────────────────────────────────────────


def test_loop_to_length_tiles_a_short_source():
    out = _loop_to_length(np.stack([_sine(220.0, 1000)] * 2), 2500)
    assert out.shape == (2, 2500)
    # Seamlessly tiled: sample 0 and sample 1000 of the tiled result match.
    assert np.allclose(out[0, 0], out[0, 1000], atol=1e-6)


def test_loop_to_length_exact_length_and_empty_guard():
    y = np.stack([_sine(220.0, 500)] * 2)
    assert _loop_to_length(y, 500).shape == (2, 500)
    assert _loop_to_length(y, 120).shape == (2, 120)
    assert _loop_to_length(y, 0).shape == (2, 0)
    assert _loop_to_length(np.zeros((2, 0)), 300).shape == (2, 300)


# ─── timeline planning ───────────────────────────────────────────────────────


def _recipe(**kwargs) -> RemixRecipe:
    defaults = {
        "name": "t",
        "target_bpm": 120.0,
        "slots": [
            RemixSlot(bars=4, crossfade_bars=2, layers=[RemixLayer(track="a", stem="drums")]),
            RemixSlot(bars=4, crossfade_bars=2, layers=[RemixLayer(track="b", stem="vocals")]),
        ],
    }
    defaults.update(kwargs)
    return RemixRecipe(**defaults)


def test_plan_total_accounts_for_crossfade_overlap():
    plan = plan_timeline(_recipe())
    bar_n = plan["bar_n"]
    # 8 bars of material, minus one 2-bar overlap.
    assert plan["total_n"] == 8 * bar_n - 2 * bar_n
    assert plan["xf_ns"] == [0, 2 * bar_n]


def test_crossfade_cannot_exceed_either_slot():
    """A 10-bar crossfade out of a 2-bar slot must be clamped, not overrun."""
    recipe = _recipe(
        slots=[
            RemixSlot(bars=2, crossfade_bars=10, layers=[RemixLayer(track="a", stem="drums")]),
            RemixSlot(bars=6, crossfade_bars=1, layers=[RemixLayer(track="b", stem="vocals")]),
        ]
    )
    plan = plan_timeline(recipe)
    assert plan["xf_ns"][1] == 2 * plan["bar_n"]  # clamped to the shorter slot


def test_zero_crossfade_leaves_no_overlap():
    recipe = _recipe(
        slots=[
            RemixSlot(bars=4, crossfade_bars=0, layers=[RemixLayer(track="a", stem="drums")]),
            RemixSlot(bars=4, crossfade_bars=0, layers=[RemixLayer(track="b", stem="vocals")]),
        ]
    )
    plan = plan_timeline(recipe)
    assert plan["xf_ns"] == [0, 0]
    assert plan["total_n"] == 8 * plan["bar_n"]


# ─── validation ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("name", ["../escape", "..", "", "a/../../b", "  "])
def test_track_names_that_escape_are_rejected(name):
    with pytest.raises(ValueError):
        _safe_track_name(name)


@pytest.mark.parametrize("name", ["ok", "my remix", "a-b_c", "Track 1"])
def test_sane_track_names_pass(name):
    assert _safe_track_name(name)


@pytest.mark.parametrize("name", ["../out", "..", ""])
def test_bad_remix_names_rejected(name):
    with pytest.raises(ValueError):
        _safe_remix_name(name)


def test_invalid_stem_rejected():
    with pytest.raises(ValueError):
        RemixRecipe(
            name="t",
            target_bpm=120.0,
            slots=[RemixSlot(layers=[RemixLayer(track="a", stem="guitar")])],
        ).validate()


def test_out_of_range_values_rejected():
    with pytest.raises(ValueError):
        RemixRecipe(name="t", target_bpm=9999.0, slots=[RemixSlot(layers=[RemixLayer("a", "drums")])]).validate()
    with pytest.raises(ValueError):
        RemixLayer(track="a", stem="drums", gain_db=200.0).validate()
    with pytest.raises(ValueError):
        RemixLayer(track="a", stem="drums", key_shift_semitones=99.0).validate()
    with pytest.raises(ValueError):
        RemixLayer(track="a", stem="drums", source_start_bar=-1).validate()


def test_empty_slot_rejected():
    with pytest.raises(ValueError):
        RemixSlot(layers=[]).validate()


# ─── gain ────────────────────────────────────────────────────────────────────


def test_db_to_linear_matches_known_values():
    assert _db_to_linear(0.0) == pytest.approx(1.0)
    assert _db_to_linear(-6.0) == pytest.approx(0.501187, rel=1e-5)
    assert _db_to_linear(3.0) == pytest.approx(1.412538, rel=1e-5)


# ─── analysis-stem selection ─────────────────────────────────────────────────
# `list_stem_sources` advertises partial stem sets, so the probe must not
# require a vocals stem. A drums-only track used to be listed as a usable source
# and then 404 on probe.


def test_analysis_stem_falls_back_when_no_vocals(tmp_path, monkeypatch):
    import app.services.stem_remixer as sr

    stems = tmp_path / "stems" / "htdemucs" / "drums_only"
    stems.mkdir(parents=True)
    for name in ("vocals", "bass", "other"):
        (stems / f"{name}.wav").write_bytes(b"")
    (stems / "drums.wav").write_bytes(b"")

    monkeypatch.setattr(sr, "SEPARATION_DIR", tmp_path / "stems")
    assert sr._pick_analysis_stem("drums_only")[0] == "drums"

    # Remove drums AND vocals: STEM_NAMES order is vocals, drums, bass, other,
    # so with an (empty) vocals.wav still present the fallback returns vocals,
    # which is the documented behaviour and not a bug.
    (stems / "drums.wav").unlink()
    (stems / "vocals.wav").unlink()
    assert sr._pick_analysis_stem("drums_only")[0] == "bass"


def test_analysis_stem_raises_when_nothing_present(tmp_path, monkeypatch):
    import app.services.stem_remixer as sr

    (tmp_path / "stems" / "htdemucs" / "empty").mkdir(parents=True)
    monkeypatch.setattr(sr, "SEPARATION_DIR", tmp_path / "stems")
    with pytest.raises(FileNotFoundError):
        sr._pick_analysis_stem("empty")


def test_crossfade_must_be_finite():
    """inf passes a bare `>= 0` and then dies inside int(round(...))."""
    import math

    for bad in (math.inf, -math.inf, math.nan):
        with pytest.raises(ValueError):
            RemixSlot(
                layers=[RemixLayer(track="a", stem="drums")], crossfade_bars=bad
            ).validate()


# ─── rendered-remix listing ──────────────────────────────────────────────────


def test_remix_dir_refuses_traversal(tmp_path, monkeypatch):
    import app.services.stem_remixer as sr

    monkeypatch.setattr(sr, "REMIX_DIR", tmp_path / "remixes")
    (tmp_path / "remixes").mkdir()
    for bad in ("../etc", "..", ""):
        with pytest.raises(ValueError):
            sr.remix_dir(bad)


def test_list_remixes_reads_manifests_and_skips_cache(tmp_path, monkeypatch):
    import json

    import app.services.stem_remixer as sr

    root = tmp_path / "remixes"
    (root / ".probes").mkdir(parents=True)
    (root / ".probes" / "cache.json").write_text("{}", encoding="utf-8")
    made = root / "my_mash"
    made.mkdir()
    (made / "remix.json").write_text(
        json.dumps({"duration_sec": 12.5, "target_bpm": 120.0, "source_tracks": ["a"]}),
        encoding="utf-8",
    )
    (made / "drums.wav").write_bytes(b"")
    # a dir with no manifest is not a remix
    (root / "stray").mkdir()
    monkeypatch.setattr(sr, "REMIX_DIR", root)

    found = sr.list_remixes()
    assert [r["name"] for r in found] == ["my_mash"]
    assert found[0]["duration_sec"] == 12.5
    assert found[0]["stems"] == ["drums"]
    assert found[0]["has_enhanced"] is False


# ─── provenance ───────────────────────────────────────────────────────────────


def _write_manifest(directory, manifest):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "remix.json").write_text(json.dumps(manifest), encoding="utf-8")
    for stem in ("vocals", "drums", "bass", "other"):
        (directory / f"{stem}.wav").write_bytes(b"\0" * 2048)


def _minimal_manifest(name, sources, **overrides):
    manifest = {
        "name": name,
        "target_bpm": 144.0,
        "beats_per_bar": 4,
        "duration_sec": 10.0,
        "source_tracks": list(sources),
        "slots": [
            {
                "bars": 4,
                "crossfade_bars": 2.0,
                "layers": [
                    {
                        "track": sources[0],
                        "stem": "drums",
                        "gain_db": 0.0,
                        "key_shift_semitones": 0.0,
                        "source_start_bar": 0,
                    }
                ],
            }
        ],
    }
    manifest.update(overrides)
    return manifest


@pytest.fixture
def remix_dir(tmp_path, monkeypatch):
    """Redirect REMIX_DIR at a tmp path so tests never touch the real library."""
    fake = tmp_path / "remixes"
    fake.mkdir()
    monkeypatch.setattr(stem_remixer, "REMIX_DIR", fake)
    return fake


def test_manifest_recipe_round_trips_into_a_buildable_request():
    """The whole point of provenance: a rendered mashup must be reopenable.

    Reconstructed output is validated against the real request model, not just
    shape-checked, so a field that drifts out of sync fails here.
    """
    manifest = _minimal_manifest("m", ["Track A", "Track B"])
    manifest["slots"][0]["layers"].append(
        {
            "track": "Track B",
            "stem": "vocals",
            "gain_db": -3.5,
            "key_shift_semitones": 2.0,
            "source_start_bar": 4,
        }
    )
    recipe = stem_remixer._manifest_recipe(manifest)

    assert recipe is not None
    from app.api.audio_remix import RemixRecipeRequest

    body = RemixRecipeRequest(**recipe, key=None, overwrite=True)
    assert body.name == "m"
    assert body.target_bpm == 144.0
    assert body.slots[0].layers[1].gain_db == -3.5
    assert body.slots[0].layers[1].key_shift_semitones == 2.0
    assert body.slots[0].layers[1].source_start_bar == 4


@pytest.mark.parametrize(
    "manifest",
    [
        pytest.param({}, id="no-slots"),
        pytest.param({"slots": []}, id="empty-slots"),
        pytest.param({"slots": [{"bars": 4, "layers": []}]}, id="slot-without-layers"),
        pytest.param(
            {"slots": [{"bars": 4, "layers": [{"track": "t", "stem": "guitar"}]}]},
            id="invalid-stem",
        ),
        pytest.param(
            {"slots": [{"bars": 4, "layers": [{"stem": "drums"}]}]},
            id="layer-without-track",
        ),
    ],
)
def test_manifest_that_cannot_round_trip_returns_none(manifest):
    """Partial recipes are worse than none: they would rebuild something subtly
    different from what was rendered."""
    assert stem_remixer._manifest_recipe(manifest) is None


def test_list_remixes_for_track_groups_by_lineage(remix_dir):
    _write_manifest(remix_dir / "shared", _minimal_manifest("shared", ["A", "B"]))
    _write_manifest(remix_dir / "only-a", _minimal_manifest("only-a", ["A"]))
    _write_manifest(remix_dir / "only-b", _minimal_manifest("only-b", ["B"]))

    for_a = {r["name"]: r["role"] for r in stem_remixer.list_remixes_for_track("A")}
    for_b = {r["name"]: r["role"] for r in stem_remixer.list_remixes_for_track("B")}

    assert set(for_a) == {"shared", "only-a"}
    assert for_a["only-a"] == "primary"
    # A mashup built from both tracks is a contributor from B's point of view.
    # Hiding it would make it look like it belonged to whichever track was listed
    # first, which is exactly the confusion lineage exists to prevent.
    assert for_b["shared"] == "contributor"
    assert for_b["only-b"] == "primary"


def test_unknown_track_returns_no_lineage(remix_dir):
    _write_manifest(remix_dir / "m", _minimal_manifest("m", ["A"]))
    assert stem_remixer.list_remixes_for_track("never-used") == []


def test_lineage_entry_carries_the_recipe(remix_dir):
    _write_manifest(remix_dir / "m", _minimal_manifest("m", ["A"]))
    rows = stem_remixer.list_remixes_for_track("A")
    assert len(rows) == 1
    assert rows[0]["recipe"] is not None
    assert rows[0]["recipe"]["target_bpm"] == 144.0
    assert sorted(rows[0]["stems"]) == ["bass", "drums", "other", "vocals"]


# ─── source listing: cached probe join (B3) ───────────────────────


def _stems_dir(tmp_path, track: str):
    """A track directory holding every stem, under a fake SEPARATION_DIR."""
    stems = tmp_path / "stems" / "htdemucs" / track
    stems.mkdir(parents=True)
    for stem_name in stem_remixer.STEM_NAMES:
        (stems / f"{stem_name}.wav").write_bytes(b"")
    return tmp_path / "stems"


def test_list_stem_sources_joins_cached_probe(tmp_path, monkeypatch):
    """The listing joins probe data that already exists on disk.

    B3's contract: bpm/duration/first-audible are a *join* against
    `output/remixes/.probes/`, not a re-analysis - so a probed
    track lists them and an unprobed one simply omits them.
    """
    separation = _stems_dir(tmp_path, "probed_track")
    probe_dir = tmp_path / "remixes" / ".probes"
    probe_dir.mkdir(parents=True)
    (probe_dir / "probed_track.json").write_text(
        json.dumps(
            {
                "cache_version": stem_remixer.PROBE_CACHE_VERSION,
                "track": "probed_track",
                "bpm": 143.555,
                "duration_sec": 182.4,
                "first_audible_sec": 7.06,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(stem_remixer, "SEPARATION_DIR", separation)
    monkeypatch.setattr(stem_remixer, "PROBE_CACHE_DIR", probe_dir)

    sources = {s["track"]: s for s in stem_remixer.list_stem_sources()}
    assert sources["probed_track"]["bpm"] == 143.555
    assert sources["probed_track"]["duration_sec"] == 182.4
    assert sources["probed_track"]["first_audible_sec"] == 7.06


def test_list_stem_sources_without_probe_omits_the_fields(
    tmp_path, monkeypatch
):
    separation = _stems_dir(tmp_path, "unprobed")
    monkeypatch.setattr(stem_remixer, "SEPARATION_DIR", separation)
    monkeypatch.setattr(
        stem_remixer, "PROBE_CACHE_DIR", tmp_path / "no-probes-yet"
    )

    sources = {s["track"]: s for s in stem_remixer.list_stem_sources()}
    assert "bpm" not in sources["unprobed"]
    assert "duration_sec" not in sources["unprobed"]
    assert "first_audible_sec" not in sources["unprobed"]


def test_list_stem_sources_survives_a_corrupt_probe_cache(
    tmp_path, monkeypatch
):
    separation = _stems_dir(tmp_path, "corrupt")
    probe_dir = tmp_path / "probes"
    probe_dir.mkdir(parents=True)
    (probe_dir / "corrupt.json").write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(stem_remixer, "SEPARATION_DIR", separation)
    monkeypatch.setattr(stem_remixer, "PROBE_CACHE_DIR", probe_dir)

    sources = {s["track"]: s for s in stem_remixer.list_stem_sources()}
    assert "bpm" not in sources["corrupt"]


# ─── preview: structured warnings (B7) ────────────────────────────


class _StubSourceCache:
    """Stands in for `_SourceCache` so no audio is loaded.

    `measured_rms_db` is the only input the warning logic reads,
    and the point under test is what the warning *says*, not how
    RMS is measured - so a fixed level per track is the honest
    stub. `bpm_for` feeds the stretch-ratio report.
    """

    def __init__(self, target_bpm: float) -> None:
        self.target_bpm = target_bpm
        self.stretch_ratios: dict[str, float] = {}

    def measured_rms_db(self, layer: RemixLayer) -> float:
        return -60.0 if layer.track == "quiet" else -20.0

    def bpm_for(self, track: str) -> float:
        return 120.0


def _one_slot_recipe(track: str) -> RemixRecipe:
    return RemixRecipe(
        name="t",
        target_bpm=120.0,
        slots=[
            RemixSlot(bars=4, layers=[RemixLayer(track=track, stem="vocals")])
        ],
    )


def test_preview_structures_near_silent_warnings(tmp_path, monkeypatch):
    """The structured warning names the field and the fix.

    `first_audible_sec` comes from the probe cache (7.06 s here,
    the measured Ad-Nauseam intro), and at 120 BPM a bar is 2 s,
    so the suggestion must point at bar 4 - the first bar that
    can contain audible material.
    """
    probe_dir = tmp_path / "probes"
    probe_dir.mkdir(parents=True)
    (probe_dir / "quiet.json").write_text(
        json.dumps({"track": "quiet", "bpm": 120.0, "first_audible_sec": 7.06}),
        encoding="utf-8",
    )
    monkeypatch.setattr(stem_remixer, "PROBE_CACHE_DIR", probe_dir)
    monkeypatch.setattr(stem_remixer, "_SourceCache", _StubSourceCache)

    data = stem_remixer.preview_recipe(_one_slot_recipe("quiet"))

    assert len(data["warnings"]) == 1
    assert len(data["warnings_detail"]) == 1
    detail = data["warnings_detail"][0]
    assert detail["code"] == "near_silent"
    assert detail["layer_ref"] == "quiet/vocals"
    assert detail["field"] == "source_start_bar"
    assert detail["measured_rms_db"] == -60.0
    assert detail["suggestion"] == (
        "first_audible_sec is 7.06; try source_start_bar >= 4"
    )


def test_preview_warning_detail_matches_the_free_text_count(
    tmp_path, monkeypatch
):
    """Both forms report the same facts: one warning, one detail."""
    probe_dir = tmp_path / "probes"
    probe_dir.mkdir(parents=True)
    monkeypatch.setattr(stem_remixer, "PROBE_CACHE_DIR", probe_dir)
    monkeypatch.setattr(stem_remixer, "_SourceCache", _StubSourceCache)

    recipe = RemixRecipe(
        name="t",
        target_bpm=120.0,
        slots=[
            RemixSlot(
                bars=4,
                layers=[
                    RemixLayer(track="quiet", stem="vocals"),
                    RemixLayer(track="loud", stem="drums"),
                ],
            )
        ],
    )
    data = stem_remixer.preview_recipe(recipe)
    assert len(data["warnings"]) == 1
    assert len(data["warnings_detail"]) == 1
    assert data["warnings_detail"][0]["layer_ref"] == "quiet/vocals"


def test_preview_near_silent_without_probe_gets_generic_suggestion(
    tmp_path, monkeypatch
):
    """No probe data means no bar to point at - say so, don't guess."""
    monkeypatch.setattr(
        stem_remixer, "PROBE_CACHE_DIR", tmp_path / "no-probes"
    )
    monkeypatch.setattr(stem_remixer, "_SourceCache", _StubSourceCache)

    data = stem_remixer.preview_recipe(_one_slot_recipe("quiet"))
    assert data["warnings_detail"][0]["suggestion"] == "check source_start_bar"


def test_preview_audible_layers_warn_about_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(
        stem_remixer, "PROBE_CACHE_DIR", tmp_path / "no-probes"
    )
    monkeypatch.setattr(stem_remixer, "_SourceCache", _StubSourceCache)

    data = stem_remixer.preview_recipe(_one_slot_recipe("loud"))
    assert data["warnings"] == []
    assert data["warnings_detail"] == []

# ─── B4 tone shaping ─────────────────────────────────────────────────────────


def _band_energy(y: np.ndarray, lo: float, hi: float, sr: int = REMIX_SR) -> float:
    """Energy of the signal inside [lo, hi] Hz, via one STFT frame sum."""
    import librosa

    stft = librosa.stft(y.astype(np.float32), n_fft=4096, hop_length=1024)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    band = (freqs >= lo) & (freqs < hi)
    return float(np.sum(np.abs(stft[band, :]) ** 2))


def test_low_pass_keeps_low_band_and_removes_high():
    y = _sine(300.0, 8192) + _sine(6000.0, 8192)
    filtered = _low_pass(y, REMIX_SR, 1000.0)
    low_before = _band_energy(y, 100, 500)
    high_before = _band_energy(y, 4000, 8000)
    low_after = _band_energy(filtered, 100, 500)
    high_after = _band_energy(filtered, 4000, 8000)
    # The low band survives (within STFT reconstruction loss); the high band
    # is essentially gone.
    assert low_after > 0.5 * low_before
    assert high_after < 0.01 * high_before


def test_low_pass_is_a_noop_when_the_cutoff_is_above_nyquist():
    y = _sine(1000.0, 4096)
    assert np.allclose(_low_pass(y, REMIX_SR, 20000.0), y, atol=1e-3)


def test_brightness_tilt_darkens_and_brightens():
    y = _sine(4000.0, 8192) + _sine(500.0, 8192)
    darker = _brightness_tilt(y, REMIX_SR, -6.0)
    brighter = _brightness_tilt(y, REMIX_SR, 6.0)
    high_ref = _band_energy(y, 2000, 8000)
    low_ref = _band_energy(y, 100, 1000)
    # A negative shelf cuts the 4 kHz band well below reference (2 octaves
    # above the pivot at -6 dB/oct is ~-12 dB); a positive one lifts it.
    assert _band_energy(darker, 2000, 8000) < 0.4 * high_ref
    assert _band_energy(brighter, 2000, 8000) > 2.0 * high_ref
    # The shelf leaves the sub-pivot band alone in both directions — a
    # constant slope would have boosted it on the darkening pass, fighting
    # the layer's own bass gain.
    assert 0.85 * low_ref < _band_energy(darker, 100, 1000) < 1.15 * low_ref
    assert 0.85 * low_ref < _band_energy(brighter, 100, 1000) < 1.15 * low_ref


def test_brightness_tilt_zero_is_the_identity():
    y = _sine(2000.0, 2048)
    assert np.array_equal(_brightness_tilt(y, REMIX_SR, 0.0), y)


def test_layer_tone_fields_validate():
    base = {"track": "t", "stem": "drums"}
    assert RemixLayer(**base, lowpass_hz=900.0, brightness_db=-4.0).validate() is None
    assert RemixLayer(**base).lowpass_hz is None  # default leaves audio untouched
    with pytest.raises(ValueError, match="lowpass_hz out of range"):
        RemixLayer(**base, lowpass_hz=50.0).validate()
    with pytest.raises(ValueError, match="brightness_db out of range"):
        RemixLayer(**base, brightness_db=20.0).validate()


def test_recipe_with_tone_fields_round_trips_through_validate():
    recipe = RemixRecipe(
        name="r",
        target_bpm=120.0,
        slots=[RemixSlot(layers=[RemixLayer(track="t", stem="bass", lowpass_hz=600.0, brightness_db=-6.0)])],
    )
    recipe.validate()  # must not raise


# ─── A3: audible preview ─────────────────────────────────────────────────────


class _StubRenderCache:
    """Stands in for `_SourceCache`: silence, so nothing is loaded or stretched.

    The mix core's contract with the cache is one call, `get(layer)`, and the
    buffers only need to be long enough for the window `_render_slot` takes.
    """

    def __init__(self, target_bpm: float) -> None:
        self.target_bpm = target_bpm
        self.stretch_ratios: dict[str, float] = {}

    def get(self, layer: RemixLayer) -> np.ndarray:
        n = int(layer.source_start_bar * 44100) + 44100
        return np.zeros((2, n), dtype=np.float32)


def _preview_mix_stub(warnings: list[str] | None = None):
    """Stand-in for `_mix_recipe` returning a fixed-amplitude buffer.

    A 440 Hz tone rather than silence, so the peak-normalisation and the
    duration paths in `render_preview_audio` have a real signal to work on.
    """

    def _mix(recipe: RemixRecipe):
        plan = plan_timeline(recipe)
        t = np.arange(plan["total_n"], dtype=np.float32) / REMIX_SR
        tone = 0.25 * np.sin(2.0 * np.pi * 440.0 * t)
        mixed = {stem: np.stack([tone, tone]) for stem in stem_remixer.STEM_NAMES}
        return mixed, dict(plan), list(warnings or []), {}

    return _mix


@pytest.fixture
def preview_dir(tmp_path, monkeypatch):
    """Redirect PREVIEW_DIR at a tmp path so tests never touch real output."""
    fake = tmp_path / "previews"
    monkeypatch.setattr(stem_remixer, "PREVIEW_DIR", fake)
    return fake


def test_mix_recipe_plan_values_are_plain_ints(monkeypatch):
    """`seg_ns`/`xf_ns` are lists: cast each element, not the list.

    `_mix_recipe` is shared by `/build` and the preview, and its first
    version returned `{k: int(v) for k, v in plan.items()}` — a TypeError on
    the two list-valued entries that took both endpoints down at once.
    """
    monkeypatch.setattr(stem_remixer, "_SourceCache", _StubRenderCache)

    mixed, plan, warnings, ratios = stem_remixer._mix_recipe(_recipe())

    assert isinstance(plan["total_n"], int)
    assert isinstance(plan["bar_n"], int)
    # Buffer sizes match the plan, and the lists survived as lists.
    assert plan["seg_ns"] == [4 * plan["bar_n"], 4 * plan["bar_n"]]
    assert plan["xf_ns"] == [0, 2 * plan["bar_n"]]
    assert all(isinstance(v, int) for v in plan["seg_ns"])
    assert all(isinstance(v, int) for v in plan["xf_ns"])
    # 8 bars minus one 2-bar crossfade, at 120 BPM (2 s per bar) = 12 s.
    assert mixed["drums"].shape[1] == 6 * plan["bar_n"]
    assert warnings == []
    assert ratios == {}


def test_truncate_recipe_leaves_a_short_recipe_unchanged():
    # `_recipe()` renders 8 bars minus one 2-bar crossfade = 12 s.
    recipe = _recipe()
    bounded = stem_remixer.truncate_recipe(recipe, max_seconds=30.0)
    assert bounded.slots == recipe.slots
    assert sum(s.bars for s in bounded.slots) == 8


def test_truncate_recipe_drops_whole_slots_past_the_cap():
    # 120 BPM in 4/4 is 2 s per bar, so 30 s is 15 bars: two 8-bar slots fit
    # one bar short of three, and the third must go rather than be sliced.
    recipe = RemixRecipe(
        name="t",
        target_bpm=120.0,
        slots=[
            RemixSlot(bars=8, crossfade_bars=0, layers=[RemixLayer(track="a", stem="drums")])
            for _ in range(3)
        ],
    )
    bounded = stem_remixer.truncate_recipe(recipe)
    assert [s.bars for s in bounded.slots] == [8, 7]
    assert sum(s.bars for s in bounded.slots) == 15


def test_truncate_recipe_keeps_the_plan_valid():
    """A trimmed slot's crossfade must fit, or `plan_timeline` rejects it."""
    big_fade = [
        RemixSlot(
            bars=8,
            crossfade_bars=8,
            layers=[RemixLayer(track="a", stem="drums")],
        )
        for _ in range(3)
    ]
    recipe = RemixRecipe(name="t", target_bpm=120.0, slots=big_fade)

    bounded = stem_remixer.truncate_recipe(recipe)

    for slot in bounded.slots:
        assert slot.crossfade_bars <= slot.bars
    plan = plan_timeline(bounded)  # must not raise
    assert plan["total_n"] > 0


def test_truncate_recipe_rejects_a_recipe_with_no_playable_bars():
    with pytest.raises(ValueError, match="no playable bars"):
        stem_remixer.truncate_recipe(
            RemixRecipe(
                name="t",
                target_bpm=120.0,
                slots=[RemixSlot(bars=4, layers=[])],  # type: ignore[arg-type]
            )
        )


def test_preview_key_changes_when_the_recipe_changes():
    assert stem_remixer._preview_key(_recipe()) != stem_remixer._preview_key(
        _recipe(target_bpm=128.0)
    )
    # The name is not part of the audio, so it must not change the key.
    assert stem_remixer._preview_key(_recipe(name="one")) == stem_remixer._preview_key(
        _recipe(name="two")
    )


def test_render_preview_audio_writes_the_excerpt_and_reports_it(
    tmp_path, monkeypatch, preview_dir
):
    monkeypatch.setattr(
        stem_remixer,
        "_mix_recipe",
        _preview_mix_stub(warnings=["drums peaks at +0.50 dBFS before the limiter"]),
    )

    data = stem_remixer.render_preview_audio(_recipe())

    path = Path(data["path"])
    assert path.parent == preview_dir
    assert data["truncated"] is False
    # 12 s of material at 22050 Hz stereo 16-bit.
    assert data["duration_sec"] == pytest.approx(12.0, abs=0.01)
    assert data["warnings"] == ["drums peaks at +0.50 dBFS before the limiter"]
    # The sidecar exists because the written file is normalised: the
    # pre-normalisation warnings cannot be read back from it.
    meta = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
    assert meta["warnings"] == data["warnings"]
    # 12 s of 16-bit stereo at 22050 Hz, give or take the WAV header.
    assert path.stat().st_size == pytest.approx(12 * REMIX_SR * 4, rel=1e-3)


def test_render_preview_audio_replays_from_cache_without_remixing(
    tmp_path, monkeypatch, preview_dir
):
    calls: list[RemixRecipe] = []
    stub = _preview_mix_stub()

    def counting_mix(recipe: RemixRecipe):
        calls.append(recipe)
        return stub(recipe)

    monkeypatch.setattr(stem_remixer, "_mix_recipe", counting_mix)

    first = stem_remixer.render_preview_audio(_recipe())
    second = stem_remixer.render_preview_audio(_recipe())

    assert len(calls) == 1  # the second call came from disk
    assert first == second  # same input, same answer


def test_render_preview_audio_truncates_and_says_so(
    tmp_path, monkeypatch, preview_dir
):
    monkeypatch.setattr(stem_remixer, "_mix_recipe", _preview_mix_stub())
    recipe = RemixRecipe(
        name="t",
        target_bpm=120.0,
        slots=[
            RemixSlot(bars=8, crossfade_bars=0, layers=[RemixLayer(track="a", stem="drums")])
            for _ in range(4)
        ],
    )

    data = stem_remixer.render_preview_audio(recipe)

    assert data["truncated"] is True
    # Capped at 15 bars x 2 s, crossfades off.
    assert data["duration_sec"] == pytest.approx(30.0, abs=0.05)


def test_prune_previews_keeps_newest_and_drops_sidecars(preview_dir):
    preview_dir.mkdir(parents=True)
    for i in range(4):
        wav = preview_dir / f"{i}.wav"
        wav.write_bytes(b"")
        wav.with_suffix(".json").write_text('{"warnings": []}', encoding="utf-8")
        stamp = 1_000 + i
        os.utime(wav, (stamp, stamp))

    stem_remixer._prune_previews(keep=2)

    assert sorted(p.name for p in preview_dir.glob("*.wav")) == ["2.wav", "3.wav"]
    # The sidecar goes with its wav, or the next run orphans it.
    assert not (preview_dir / "0.json").exists()
    assert not (preview_dir / "1.json").exists()
    assert (preview_dir / "2.json").exists()


# ─── B6 either-key acceptance ────────────────────────────────────────────────


@pytest.fixture
def remix_dirs(tmp_path, monkeypatch):
    """A synthetic stems/ + output/audio/ tree for the key-resolution tests."""
    stems = tmp_path / "stems"
    audio = tmp_path / "audio"
    stems.mkdir()
    audio.mkdir()
    for track in ("SunoV6Mini-Ad-Nauseam", "take-the-crown", "demucs_test_input"):
        d = stems / "htdemucs" / track
        d.mkdir(parents=True)
        (d / "drums.wav").write_bytes(b"x")
    (audio / "SunoV6Mini-Ad-Nauseam.m4a").write_bytes(b"x")
    (audio / "2f9a5ced_SunoV6Mini-Ad-Nauseam.m4a").write_bytes(b"x")  # hash-prefixed copy
    (audio / "85a406ef_NeoCortext - Take the Crown.mp3").write_bytes(b"x")
    (audio / "Cold-Steel.m4a").write_bytes(b"x")  # library track with no stems
    monkeypatch.setattr(stem_remixer, "SEPARATION_DIR", stems)
    monkeypatch.setattr(stem_remixer, "AUDIO_DIR", audio)
    return stems, audio


def test_resolve_accepts_the_stem_key_unchanged(remix_dirs):
    assert stem_remixer.resolve_track_key("SunoV6Mini-Ad-Nauseam") == "SunoV6Mini-Ad-Nauseam"


def test_resolve_accepts_a_library_filename(remix_dirs):
    assert stem_remixer.resolve_track_key("SunoV6Mini-Ad-Nauseam.m4a") == "SunoV6Mini-Ad-Nauseam"
    # A hash-prefixed upload normalizes to the same identity.
    assert stem_remixer.resolve_track_key("2f9a5ced_SunoV6Mini-Ad-Nauseam.m4a") == "SunoV6Mini-Ad-Nauseam"


def test_resolve_accepts_a_library_path(remix_dirs):
    assert stem_remixer.resolve_track_key("Suno-V6-Mini/SunoV6Mini-Ad-Nauseam.m4a") == "SunoV6Mini-Ad-Nauseam"


def test_resolve_accepts_a_shortened_name_with_a_suffix_match(remix_dirs):
    # The stem directory is often a shortened form of the library filename.
    assert stem_remixer.resolve_track_key("take-the-crown.mp3") == "take-the-crown"


def test_resolve_rejects_unknown_and_ambiguous(remix_dirs):
    with pytest.raises(ValueError, match="not a separated source"):
        stem_remixer.resolve_track_key("Cold-Steel.m4a")  # library track, no stems
    with pytest.raises(ValueError, match="not a separated source"):
        stem_remixer.resolve_track_key("No Such Track")
    with pytest.raises(ValueError, match="empty"):
        stem_remixer.resolve_track_key("   ")


def test_library_file_join_is_reported_only_when_unambiguous(remix_dirs):
    # Ad Nauseam has two library copies (one hash-prefixed) of the same
    # basename -> still the same file identity after dedup.
    assert stem_remixer.library_file_for("SunoV6Mini-Ad-Nauseam") == "SunoV6Mini-Ad-Nauseam.m4a"
    # take-the-crown's normalised form is a suffix of the library name, not
    # an equality -> the join is refused, not guessed.
    assert stem_remixer.library_file_for("take-the-crown") is None
    assert stem_remixer.library_file_for("demucs_test_input") is None


def test_list_stem_sources_carries_the_library_file(remix_dirs, monkeypatch):
    monkeypatch.setattr(stem_remixer, "PROBE_CACHE_DIR", remix_dirs[0].parent / "probes")
    sources = {s["track"]: s for s in stem_remixer.list_stem_sources()}
    assert sources["SunoV6Mini-Ad-Nauseam"]["library_file"] == "SunoV6Mini-Ad-Nauseam.m4a"
    assert "library_file" not in sources["take-the-crown"]


def test_normalize_track_name_folds_extension_hash_and_separators():
    n = stem_remixer._normalize_track_name
    # The same identity in four spellings a caller may hold.
    assert n("SunoV6Mini-Ad-Nauseam") == n("SunoV6Mini-Ad-Nauseam.m4a")
    assert n("SunoV6Mini-Ad-Nauseam") == n("2f9a5ced_SunoV6Mini-Ad-Nauseam.wav")
    assert n("SunoV6Mini-Ad-Nauseam") == n("32129cfa_2f9a5ced_SunoV6Mini-Ad-Nauseam.mp3")
    # Separators and punctuation are not identity.
    assert n("Suno-V6-mini-Cold-Steel") == n("sunov6minicoldsteel")
