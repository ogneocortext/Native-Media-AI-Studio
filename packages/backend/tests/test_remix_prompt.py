"""Tests for the natural-language remix drafter (remix plan B2).

Everything here is pure: source tables are fixtures, no model is called
and no audio is decoded. What is under test is the contract the endpoint
sells — a prompt in, a *valid* recipe out — and the guardrails that make
it safe to hand a model's JSON to a renderer: unresolvable tracks and
missing stems are dropped with warnings, out-of-range values are
repaired rather than propagated, and the deterministic fallback always
produces something reviewable.
"""

from __future__ import annotations

import pytest
from app.services import remix_prompt
from app.services.stem_remixer import RemixLayer, RemixRecipe

SOURCES = [
    {
        "track": "SunoV6Mini-The Last-Original-V1",
        "model": "htdemucs",
        "stems": {"vocals": True, "drums": True, "bass": True, "other": True},
        "bpm": 130.0,
        "duration_sec": 176.06,
    },
    {
        "track": "SunoV6Mini-Ad-Nauseam",
        "model": "htdemucs",
        "stems": {"vocals": True, "drums": True, "bass": False, "other": True},
        "bpm": 143.6,
        "duration_sec": 95.2,
    },
    {
        "track": "Blind Architects (Vocals Forward Mix)",
        "model": "htdemucs",
        "stems": {"vocals": True, "drums": False, "bass": False, "other": False},
    },
]


# ── mention scoring ────────────────────────────────────────────────────


def test_score_mention_full_and_partial():
    assert remix_prompt.score_mention("The Last", "mash up The Last with Ad Nauseam") == 1.0
    assert remix_prompt.score_mention("The Last", "mash up the vocals") == 0.0
    # Coverage is set-based: half the distinctive tokens present is 0.5.
    assert remix_prompt.score_mention("The Last Stand", "only the last part") == 0.5


def test_score_mention_ignores_stopwords():
    # A name made only of stopwords must never "match" a prompt.
    assert remix_prompt.score_mention("The Mix", "the mix of everything") == 0.0


# ── prompt mention detection (abbreviation-friendly) ───────────────────


def test_mention_scores_a_shared_run_not_coverage():
    # The user's abbreviation drops the source name's tail; the shared
    # run "the last" is what identifies the track — one distinctive
    # token is enough for a reviewable draft.
    assert remix_prompt.mention_score(SOURCES[0], "make a darker version of The Last") >= 1
    assert remix_prompt.mention_score(SOURCES[1], "plus the vocals from Ad Nauseam") >= 2
    assert remix_prompt.mention_score(SOURCES[0], "no stems named here") == 0


def test_mention_ignores_stem_words_as_identity():
    # "vocals" is instrumentation, not identity: a prompt's vocal request
    # must not make a track called "Vocals Forward Mix" the subject.
    assert remix_prompt.mention_score(SOURCES[2], "sing me some vocals") == 0
    assert remix_prompt.mention_score(SOURCES[2], "the vocals from Blind Architects") >= 2


def test_mentioned_sources_orders_by_prompt_position():
    # Position beats strength: the first-named track leads the arrangement.
    hits = [s["track"] for s in remix_prompt.mentioned_sources(SOURCES, "darker version of The Last over Ad Nauseam")]
    assert hits == ["SunoV6Mini-The Last-Original-V1", "SunoV6Mini-Ad-Nauseam"]
    hits2 = [s["track"] for s in remix_prompt.mentioned_sources(SOURCES, "drums from Ad Nauseam over The Last")]
    assert hits2 == ["SunoV6Mini-Ad-Nauseam", "SunoV6Mini-The Last-Original-V1"]


def test_bracketed_mix_labels_are_not_identity():
    srcs = [{"track": "Blind Architects (Acid EDM Remix)", "stems": {}}]
    assert remix_prompt.mention_score(srcs[0], "use Blind Architects please") >= 2


# ── track matching ─────────────────────────────────────────────────────


def test_match_track_exact_then_normalised():
    assert remix_prompt.match_track("SunoV6Mini-Ad-Nauseam", SOURCES)["track"] == "SunoV6Mini-Ad-Nauseam"
    assert remix_prompt.match_track("sunov6mini-ad-nauseam", SOURCES)["track"] == "SunoV6Mini-Ad-Nauseam"
    # Separator-insensitive normalised equality.
    assert remix_prompt.match_track("Suno V6 Mini Ad Nauseam", SOURCES)["track"] == "SunoV6Mini-Ad-Nauseam"


def test_match_track_abbreviation_and_rejection():
    assert remix_prompt.match_track("Ad Nauseam", SOURCES)["track"] == "SunoV6Mini-Ad-Nauseam"
    # An abbreviation of the main name resolves despite the bracketed label.
    assert remix_prompt.match_track("Blind Architects", SOURCES)["track"] == "Blind Architects (Vocals Forward Mix)"
    assert remix_prompt.match_track("Nonexistent Song", SOURCES) is None
    assert remix_prompt.match_track("", SOURCES) is None


def test_match_track_prefers_full_coverage_on_ties():
    # Both contain "the last"; only the full distinctive set should win at 1.0.
    srcs = [
        {"track": "The Last", "stems": {}},
        {"track": "The Last Stand", "stems": {}},
    ]
    assert remix_prompt.match_track("The Last", srcs)["track"] == "The Last"


# ── stem and mood detection ────────────────────────────────────────────


def test_detect_stems_words_and_aliases():
    assert remix_prompt.detect_stems("use the drums and bass from it") == {"drums", "bass"}
    assert remix_prompt.detect_stems("just the vocal") == {"vocals"}
    assert remix_prompt.detect_stems("a capella please") == {"vocals"}
    assert remix_prompt.detect_stems("no stems named here") == set()


def test_detect_stems_respects_word_boundaries():
    # "drum" must not fire inside an unrelated word.
    assert remix_prompt.detect_stems("drumstick soup") == set()


def test_detect_genres_longest_tag_wins():
    assert remix_prompt.detect_genres("make it drift phonk") == ["phonk"]
    assert remix_prompt.detect_genres("phonk") == ["phonk"]
    assert remix_prompt.detect_genres("r&b slow jam") == ["rb"]


def test_detect_genres_word_boundaries():
    assert remix_prompt.detect_genres("popular song") == []
    assert remix_prompt.detect_genres("nothing special") == []


def test_apply_genre_gains_sets_starting_balance():
    layer = remix_prompt.apply_genre_gains(RemixLayer(track="t", stem="drums"), ["phonk"])
    assert layer.gain_db == pytest.approx(2.0)
    layer = remix_prompt.apply_genre_gains(RemixLayer(track="t", stem="vocals"), ["phonk"])
    assert layer.gain_db == pytest.approx(-1.0)


def test_apply_genre_gains_first_genre_wins_and_clamps():
    layer = remix_prompt.apply_genre_gains(
        RemixLayer(track="t", stem="bass", gain_db=11.0), ["dubstep", "grime"])
    # dubstep bass +2.5 on top of 11.0 -> clamped to 12.0; grime not stacked.
    assert layer.gain_db == pytest.approx(12.0)


def test_system_prompt_mentions_genre_balance():
    system = remix_prompt.build_system_prompt(SOURCES)
    assert "Genre words set the starting balance" in system


def test_detect_moods_longest_match_wins():
    assert remix_prompt.detect_moods("make it punchier") == ["punchier"]
    assert remix_prompt.detect_moods("dark and punchy")[0] == "punchy"
    assert remix_prompt.detect_moods("nothing special") == []


# ── bpm clamping ───────────────────────────────────────────────────────


def test_clamp_bpm_range_and_garbage():
    assert remix_prompt._clamp_bpm(143.9) == 143.9
    assert remix_prompt._clamp_bpm(999) == 120.0
    assert remix_prompt._clamp_bpm(20) == 120.0
    assert remix_prompt._clamp_bpm("not a number") == 120.0
    assert remix_prompt._clamp_bpm(None, 96.0) == 96.0


# ── heuristic fallback: the plan's target scenario ─────────────────────


def test_heuristic_builds_the_target_scenario():
    prompt = "make a darker version of The Last using its drums and bass plus the vocals from Ad Nauseam"
    recipe, warnings, explanation = remix_prompt.build_heuristic_recipe(prompt, SOURCES)

    assert isinstance(recipe, RemixRecipe)
    assert len(recipe.slots) == 2
    first, second = recipe.slots
    assert [layer.stem for layer in first.layers] == ["drums", "bass"]
    assert [layer.stem for layer in second.layers] == ["vocals"]
    assert first.layers[0].track == "SunoV6Mini-The Last-Original-V1"
    assert second.layers[0].track == "SunoV6Mini-Ad-Nauseam"
    # "darker" applied: bass +2.5, drums -0.5 on slot one.
    assert first.layers[0].gain_db == -0.5
    assert first.layers[1].gain_db == 2.5
    # Target BPM comes from the first mentioned track's probe.
    assert recipe.target_bpm == 130.0
    assert "darker" in explanation
    recipe.validate()


def test_heuristic_falls_back_to_the_arrangement_backbone():
    prompt = "mash up The Last with Ad Nauseam"
    recipe, _warnings, _explanation = remix_prompt.build_heuristic_recipe(prompt, SOURCES)
    # No stems named -> drums/bass/vocals/other order, per available stems.
    assert [layer.stem for layer in recipe.slots[0].layers] == ["drums", "bass", "vocals", "other"]
    assert [layer.stem for layer in recipe.slots[1].layers] == ["drums", "vocals", "other"]  # no bass in this source
    recipe.validate()


# ── fixture guard (B6) ─────────────────────────────────────────────────


def test_fixture_sources_are_recognised():
    assert remix_prompt.is_fixture_source("demucs_test_input")
    assert remix_prompt.is_fixture_source("DEMUCS_TEST_INPUT")
    assert remix_prompt.is_fixture_source("test_input_2")
    assert remix_prompt.is_fixture_source("fixture_anything")
    # Library tracks with hash names are NOT fixtures.
    assert not remix_prompt.is_fixture_source("ec2c167538d44391af7d14d57fede26d")
    assert not remix_prompt.is_fixture_source("SunoV6Mini-The Last-Original-V1")
    assert not remix_prompt.is_fixture_source("take-the-crown")


def test_draftable_sources_filters_and_names_exclusions():
    srcs = [
        {"track": "demucs_test_input", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
        {"track": "SunoV6Mini-Ad-Nauseam", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
    ]
    kept, excluded = remix_prompt.draftable_sources(srcs)
    assert [s["track"] for s in kept] == ["SunoV6Mini-Ad-Nauseam"]
    assert excluded == ["demucs_test_input"]


def test_fixture_never_survives_the_repair_path():
    # Even if a model names the fixture, repair cannot resolve it once the
    # guarded table excludes it — the layer is dropped with a warning.
    kept, _excluded = remix_prompt.draftable_sources(
        [
            {"track": "demucs_test_input", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
            {"track": "SunoV6Mini-Ad-Nauseam", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
        ]
    )
    payload = {
        "slots": [
            {
                "bars": 8,
                "layers": [
                    {"track": "demucs_test_input", "stem": "drums"},
                    {"track": "demucs_test_input", "stem": "bass"},
                ],
            }
        ]
    }
    with pytest.raises(ValueError, match="resolved against"):
        remix_prompt.repair_recipe(payload, kept)


def test_repair_does_not_fuzzy_match_a_fixture_name():
    kept, _excluded = remix_prompt.draftable_sources(
        [
            {"track": "demucs_test_input", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
            {"track": "SunoV6Mini-Ad-Nauseam", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
        ]
    )
    # "demucs_test_input" is no longer a source, and nothing else in the
    # table shares its distinctive tokens.
    assert remix_prompt.match_track("demucs_test_input", kept) is None


def test_system_prompt_excludes_fixtures_after_guarding():
    srcs = [
        {"track": "demucs_test_input", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
        {"track": "SunoV6Mini-Ad-Nauseam", "stems": {"vocals": True, "drums": True, "bass": True, "other": True}},
    ]
    kept, _excluded = remix_prompt.draftable_sources(srcs)
    system = remix_prompt.build_system_prompt(kept)
    assert "demucs_test_input" not in system
    assert "SunoV6Mini-Ad-Nauseam" in system


# ── per-source stem attribution ────────────────────────────────────────


def test_attribute_stems_hands_each_source_its_own_stems():
    # The plan's target scenario, verbatim in shape.
    prompt = "make a darker version of The Last using its drums and bass plus the vocals from Ad Nauseam"
    mentioned = remix_prompt.mentioned_sources(SOURCES, prompt)
    assert [s["track"] for s in mentioned] == [
        "SunoV6Mini-The Last-Original-V1",
        "SunoV6Mini-Ad-Nauseam",
    ]
    per_source = remix_prompt.attribute_stems(prompt, mentioned)
    assert per_source[0] == {"drums", "bass"}  # corridor of "The Last"
    assert per_source[1] == {"vocals"}  # "vocals from Ad Nauseam" handoff


def test_attribute_stems_from_phrase_before_any_mention():
    prompt = "drums from The Last over the bass from Ad Nauseam"
    mentioned = remix_prompt.mentioned_sources(SOURCES, prompt)
    per_source = remix_prompt.attribute_stems(prompt, mentioned)
    assert per_source[0] == {"drums"}
    assert per_source[1] == {"bass"}


def test_attribute_stems_corridor_covers_unnamed_stems():
    prompt = "The Last with its drums, and then Ad Nauseam for a bridge"
    mentioned = remix_prompt.mentioned_sources(SOURCES, prompt)
    per_source = remix_prompt.attribute_stems(prompt, mentioned)
    assert per_source[0] == {"drums"}  # in The Last's corridor
    assert per_source[1] == set()  # Ad Nauseam's corridor names no stems


def test_heuristic_errors_on_unknown_and_stemless_tracks():
    with pytest.raises(ValueError, match="No library track"):
        remix_prompt.build_heuristic_recipe("make something with a song I cannot name", SOURCES)


def test_heuristic_warns_when_requested_stem_is_missing():
    # Ad Nauseam has no separated bass; the request names its bass. The
    # draft substitutes the backbone and says so, rather than 400ing.
    recipe, warnings, _explanation = remix_prompt.build_heuristic_recipe("bass from Ad Nauseam", SOURCES)
    stems = [layer.stem for layer in recipe.slots[0].layers]
    assert stems == ["drums", "vocals", "other"]  # backbone, bass absent
    assert any("bass not separated" in w and "used drums, vocals, other" in w for w in warnings)
    recipe.validate()


def test_heuristic_skips_a_source_with_no_stems_at_all():
    srcs = [{"track": "Stemless Demo", "stems": {"vocals": False, "drums": False, "bass": False, "other": False}}]
    with pytest.raises(ValueError, match="stems separated"):
        remix_prompt.build_heuristic_recipe("drums from Stemless Demo", srcs)


# ── model-output repair ────────────────────────────────────────────────


def _model_payload(**overrides):
    payload = {
        "name": "dark-mashup",
        "target_bpm": 128,
        "explanation": "drums+bass under borrowed vocals",
        "slots": [
            {
                "bars": 8,
                "crossfade_bars": 4,
                "layers": [
                    {"track": "SunoV6Mini-The Last-Original-V1", "stem": "drums", "gain_db": 0},
                    {"track": "SunoV6Mini-The Last-Original-V1", "stem": "bass", "gain_db": 1.5},
                    {"track": "SunoV6Mini-Ad-Nauseam", "stem": "vocals", "gain_db": -1},
                ],
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_repair_accepts_a_clean_payload():
    recipe, warnings = remix_prompt.repair_recipe(_model_payload(), SOURCES)
    assert warnings == []
    assert recipe.name == "dark-mashup"
    assert recipe.target_bpm == 128
    assert len(recipe.slots) == 1
    assert [layer.stem for layer in recipe.slots[0].layers] == ["drums", "bass", "vocals"]
    recipe.validate()


def test_repair_drops_unknown_track_and_missing_stem():
    payload = _model_payload(
        slots=[
            {
                "bars": 8,
                "layers": [
                    {"track": "Not-A-Track", "stem": "drums"},
                    {"track": "SunoV6Mini-Ad-Nauseam", "stem": "bass"},  # not separated
                    {"track": "SunoV6Mini-The Last-Original-V1", "stem": "drums"},
                ],
            }
        ]
    )
    recipe, warnings = remix_prompt.repair_recipe(payload, SOURCES)
    assert [layer.track for layer in recipe.slots[0].layers] == ["SunoV6Mini-The Last-Original-V1"]
    assert len(warnings) == 2
    assert "not a separated source" in warnings[0]
    assert "not available" in warnings[1]


def test_repair_repairs_out_of_range_values():
    payload = _model_payload(
        target_bpm=999,
        slots=[{"bars": 8, "crossfade_bars": 2, "layers": [{"track": "Ad Nauseam", "stem": "drums", "gain_db": 40}]}],
    )
    recipe, warnings = remix_prompt.repair_recipe(payload, SOURCES)
    assert recipe.target_bpm == 120.0
    assert recipe.slots[0].layers[0].gain_db == 12.0  # clamped
    assert any("outside 40-240" in w for w in warnings)


def test_repair_applies_model_mood_notes():
    payload = _model_payload(
        mood_notes=["darker", "punchy"],
        slots=[
            {
                "bars": 4,
                "layers": [{"track": "SunoV6Mini-The Last-Original-V1", "stem": "bass", "gain_db": 0}],
            }
        ],
    )
    recipe, _warnings = remix_prompt.repair_recipe(payload, SOURCES)
    # Adjectives add: darker gives bass +2.5, punchy adds +1.0.
    assert recipe.slots[0].layers[0].gain_db == 3.5


def test_repair_rejects_payloads_with_no_resolvable_layer():
    with pytest.raises(ValueError, match="at least one"):
        remix_prompt.repair_recipe({"slots": []}, SOURCES)
    with pytest.raises(ValueError, match="resolved against"):
        remix_prompt.repair_recipe(
            {"slots": [{"bars": 8, "layers": [{"track": "Ghost", "stem": "drums"}]}]}, SOURCES
        )
    with pytest.raises(ValueError):
        remix_prompt.repair_recipe(["not", "an", "object"], SOURCES)


def test_repair_truncates_to_schema_limits():
    layers = [{"track": "SunoV6Mini-The Last-Original-V1", "stem": "drums"} for _ in range(10)]
    payload = _model_payload(slots=[{"bars": 8, "layers": layers} for _ in range(70)])
    recipe, warnings = remix_prompt.repair_recipe(payload, SOURCES)
    assert len(recipe.slots) == 64
    assert len(recipe.slots[0].layers) == 8  # layers capped at 8, matching the prompt contract
    # Both caps announce themselves rather than dropping silently:
    # 70 - 64 slots, and 2 excess layers in each of the 64 kept slots.
    assert any("capped at the schema's 64" in w for w in warnings)
    assert any("dropped 128 excess layers" in w for w in warnings)


def test_repair_survives_unreadable_slot_shape():
    payload = _model_payload(
        slots=[{"bars": "many", "crossfade_bars": None, "layers": [{"track": "Ad Nauseam", "stem": "drums"}]}]
    )
    recipe, warnings = remix_prompt.repair_recipe(payload, SOURCES)
    assert recipe.slots[0].bars == 8
    assert recipe.slots[0].crossfade_bars == 2.0
    assert any("unreadable bars" in w for w in warnings)


# ── request serialisation ──────────────────────────────────────────────


def test_recipe_to_request_shape_and_safe_overwrite_default():
    recipe, _warnings = remix_prompt.repair_recipe(_model_payload(), SOURCES)
    body = remix_prompt.recipe_to_request(recipe)
    assert body["overwrite"] is False  # A5: a draft never clobbers silently
    assert body["name"] == "dark-mashup"
    assert body["target_bpm"] == 128
    assert body["slots"][0]["layers"][0]["track"] == "SunoV6Mini-The Last-Original-V1"
    assert set(body["slots"][0]["layers"][0]) == {
        "track", "stem", "gain_db", "key_shift_semitones", "source_start_bar",
        "lowpass_hz", "brightness_db",
    }


# ── B4 tone shaping ───────────────────────────────────────────────────


def test_moods_apply_lowpass_and_tilt():
    layer = remix_prompt.apply_moods_to_layer(
        remix_prompt.RemixLayer(track="t", stem="bass"), ["dark"]
    )
    assert layer.lowpass_hz == 900.0
    assert layer.brightness_db == -4.0


def test_stronger_mood_wins_the_lowpass_while_tilts_add():
    # "darker" and "punchy" together: the lowpass is the stronger mood's
    # (600 Hz), the tilts sum (-6 + 0), the gains sum.
    layer = remix_prompt.apply_moods_to_layer(
        remix_prompt.RemixLayer(track="t", stem="drums"), ["darker", "punchy"]
    )
    assert layer.lowpass_hz == 600.0
    assert layer.brightness_db == -6.0
    assert layer.gain_db == 2.5  # punchy +3.0, darker -0.5


def test_tone_is_none_or_zero_by_default():
    layer = remix_prompt.apply_moods_to_layer(
        remix_prompt.RemixLayer(track="t", stem="other"), ["punchy"]  # no tone in punchy
    )
    assert layer.lowpass_hz is None
    assert layer.brightness_db == 0.0  # tilt defaults to 0, not None


def test_heuristic_draft_carries_tone_fields():
    recipe, _warnings, _explanation = remix_prompt.build_heuristic_recipe(
        "darker version of The Last", SOURCES
    )
    layer = recipe.slots[0].layers[0]
    assert layer.lowpass_hz == 600.0
    assert layer.brightness_db == -6.0
    body = remix_prompt.recipe_to_request(recipe)
    assert body["slots"][0]["layers"][0]["lowpass_hz"] == 600.0


def test_recipe_to_request_omits_tone_when_unset():
    recipe, _w, _e = remix_prompt.build_heuristic_recipe("mash up The Last", SOURCES)
    body = remix_prompt.recipe_to_request(recipe)
    assert body["slots"][0]["layers"][0]["lowpass_hz"] is None
    # 0.0 is a no-op in the renderer (`if layer.brightness_db`), so an
    # un-tilted layer serialises as zero rather than null.
    assert body["slots"][0]["layers"][0]["brightness_db"] == 0.0


def test_repair_carries_model_tone_fields():
    payload = _model_payload(
        slots=[
            {
                "bars": 8,
                "layers": [
                    {
                        "track": "SunoV6Mini-The Last-Original-V1",
                        "stem": "bass",
                        "lowpass_hz": 800.0,
                        "brightness_db": -5.0,
                    }
                ],
            }
        ]
    )
    recipe, warnings = remix_prompt.repair_recipe(payload, SOURCES)
    layer = recipe.slots[0].layers[0]
    assert layer.lowpass_hz == 800.0
    assert layer.brightness_db == -5.0
    assert warnings == []


def test_repair_clamps_out_of_range_tone_with_warnings():
    payload = _model_payload(
        slots=[
            {
                "bars": 8,
                "layers": [
                    {
                        "track": "SunoV6Mini-The Last-Original-V1",
                        "stem": "bass",
                        "lowpass_hz": 99999.0,
                        "brightness_db": 40.0,
                    }
                ],
            }
        ]
    )
    recipe, warnings = remix_prompt.repair_recipe(payload, SOURCES)
    layer = recipe.slots[0].layers[0]
    assert layer.lowpass_hz == 20000.0
    assert layer.brightness_db == 12.0
    assert sum("clamped" in w for w in warnings) == 2


def test_revision_prompt_includes_mix_report_when_given():
    """The last build's measured levels reach the revision model."""
    report = {"stems": {"vocals": {"integrated_lufs": -14.0, "clipping": True}},
              "mix": {"integrated_lufs": -12.0, "clipping": True}}
    system = remix_prompt.build_revision_system_prompt(SOURCES, {}, report)
    assert "-14.0" in system
    assert "already near clipping" in system


def test_revision_prompt_omits_mix_report_when_absent():
    system = remix_prompt.build_revision_system_prompt(SOURCES, {})
    assert "mix report" not in system.lower()


def test_system_prompt_carries_arrangement_theory():
    """Stretch-ratio, phrase-alignment and slotting rules (knowledge article)."""
    system = remix_prompt.build_system_prompt(SOURCES)
    assert "within 5% of the sources" in system  # stretch ratio, not BPM delta
    assert "half-time (0.5x)" in system
    assert "multiples of 4 bars" in system  # phrase alignment
    assert "never stack two" in system  # frequency slotting


def test_system_prompt_documents_the_tone_fields():
    system = remix_prompt.build_system_prompt(SOURCES)
    assert "lowpass_hz" in system
    assert "brightness_db" in system
    assert "'dark' means lowpass plus a negative" in system


# ── prompt construction ────────────────────────────────────────────────


def test_system_prompt_carries_the_source_table():
    system = remix_prompt.build_system_prompt(SOURCES)
    assert "SunoV6Mini-The Last-Original-V1" in system
    assert "bpm 130" in system  # probe join visible to the model
    assert "SunoV6Mini-Ad-Nauseam" in system
    assert "Blind Architects (Vocals Forward Mix): vocals" in system  # stems-only source says what it has
    assert '"slots"' in system


def test_user_prompt_wraps_the_request():
    assert "drums from X" in remix_prompt.build_user_prompt("drums from X")


# ── R1 revision loop ─────────────────────────────────────────────────


def _base_recipe(**overrides):
    recipe = {
        "name": "rev-base",
        "target_bpm": 130.0,
        "beats_per_bar": 4,
        "key": None,
        "overwrite": False,
        "slots": [
            {
                "bars": 8,
                "crossfade_bars": 2.0,
                "layers": [
                    {"track": "SunoV6Mini-The Last-Original-V1", "stem": "drums", "gain_db": 0.0, "key_shift_semitones": 0.0, "source_start_bar": 0, "lowpass_hz": None, "brightness_db": 0.0},
                    {"track": "SunoV6Mini-The Last-Original-V1", "stem": "bass", "gain_db": 1.5, "key_shift_semitones": 0.0, "source_start_bar": 0, "lowpass_hz": None, "brightness_db": 0.0},
                ],
            },
            {
                "bars": 4,
                "crossfade_bars": 1.0,
                "layers": [
                    {"track": "SunoV6Mini-Ad-Nauseam", "stem": "vocals", "gain_db": -1.0, "key_shift_semitones": 0.0, "source_start_bar": 0, "lowpass_hz": None, "brightness_db": 0.0},
                ],
            },
        ],
    }
    recipe.update(overrides)
    return recipe


def test_parse_gain_deltas_signed_and_bare():
    assert remix_prompt.parse_gain_deltas("vocals up 2 dB") == [("vocals", 2.0)]
    assert remix_prompt.parse_gain_deltas("drums down 3") == [("drums", -3.0)]
    assert remix_prompt.parse_gain_deltas("bass +1.5db") == [("bass", 1.5)]
    assert remix_prompt.parse_gain_deltas("vocals up") == [("vocals", 1.0)]
    assert remix_prompt.parse_gain_deltas("make the vocal louder") == [("vocals", 2.0)]
    assert remix_prompt.parse_gain_deltas("drums a bit quieter please") == [("drums", -2.0)]
    assert remix_prompt.parse_gain_deltas("make it darker") == []


def test_parse_drop_stems_scoped_and_global():
    assert remix_prompt.parse_drop_stems("drop the bass in slot 2") == [("bass", 1)]
    assert remix_prompt.parse_drop_stems("remove vocals from slot 1") == [("vocals", 0)]
    assert remix_prompt.parse_drop_stems("cut drums") == [("drums", None)]


def test_parse_slot_bars_absolute_and_relative():
    assert remix_prompt.parse_slot_bars("slot 2: 16 bars") == [(1, 16, True)]
    assert remix_prompt.parse_slot_bars("make slot 1 twice as long") == [(0, 2, False)]
    assert remix_prompt.parse_slot_bars("halve slot 2") == [(1, 0, False)]


def test_request_to_recipe_round_trips():
    base = remix_prompt.request_to_recipe(_base_recipe())
    assert base.name == "rev-base"
    assert base.target_bpm == 130.0
    assert len(base.slots) == 2
    assert [layer.stem for layer in base.slots[0].layers] == ["drums", "bass"]
    assert base.slots[0].layers[1].gain_db == 1.5
    base.validate()


def test_heuristic_gain_delta_changes_only_that_layer():
    base = remix_prompt.request_to_recipe(_base_recipe())
    revised, _warnings = remix_prompt.revise_heuristic_recipe("vocals up 2 dB", base, SOURCES)
    by_stem = {layer.stem: layer.gain_db for slot in revised.slots for layer in slot.layers}
    assert by_stem["vocals"] == 1.0  # -1.0 + 2.0
    assert by_stem["drums"] == 0.0
    assert by_stem["bass"] == 1.5
    changes = remix_prompt.diff_recipes(base, revised)
    assert changes == ["slot 2: vocals gain -1 -> 1 dB"]


def test_heuristic_gain_delta_scoped_to_named_track():
    base = remix_prompt.request_to_recipe(_base_recipe())
    revised, _warnings = remix_prompt.revise_heuristic_recipe(
        "vocals from Ad Nauseam up 2 dB", base, SOURCES
    )
    assert revised.slots[1].layers[0].gain_db == 1.0


def test_heuristic_drop_removes_only_that_layer():
    base = remix_prompt.request_to_recipe(_base_recipe())
    revised, _warnings = remix_prompt.revise_heuristic_recipe("drop the bass in slot 1", base, SOURCES)
    assert [layer.stem for layer in revised.slots[0].layers] == ["drums"]
    assert [layer.stem for layer in revised.slots[1].layers] == ["vocals"]
    changes = remix_prompt.diff_recipes(base, revised)
    assert any("removed bass" in c for c in changes)


def test_heuristic_slot_length_change():
    base = remix_prompt.request_to_recipe(_base_recipe())
    revised, _warnings = remix_prompt.revise_heuristic_recipe("make slot 1 twice as long", base, SOURCES)
    assert revised.slots[0].bars == 16
    assert revised.slots[1].bars == 4
    revised2, _w2 = remix_prompt.revise_heuristic_recipe("slot 2: 16 bars", base, SOURCES)
    assert revised2.slots[1].bars == 16


def test_heuristic_empty_revision_returns_base_unchanged():
    base = remix_prompt.request_to_recipe(_base_recipe())
    revised, warnings = remix_prompt.revise_heuristic_recipe("looks good", base, SOURCES)
    assert remix_prompt.diff_recipes(base, revised) == []
    assert any("unchanged" in w for w in warnings)


def test_unknown_track_revision_leaves_recipe_unchanged():
    base = remix_prompt.request_to_recipe(_base_recipe())
    revised, warnings = remix_prompt.revise_heuristic_recipe(
        "vocals from The Vow up 2 dB", base, SOURCES
    )
    # Repair-before-return: the delta is NOT applied to every vocals layer
    # just because the named track is missing.
    assert remix_prompt.diff_recipes(base, revised) == []
    assert any("unknown track" in w for w in warnings)


def test_unknown_track_references_resolution_rules():
    # A name no source resolves to is a claim; library abbreviations are not.
    assert remix_prompt.unknown_track_references("vocals from The Vow up 2 dB", SOURCES) == ["The Vow"]
    assert remix_prompt.unknown_track_references("vocals from Ad Nauseam up 2 dB", SOURCES) == []
    assert (
        remix_prompt.unknown_track_references(
            "vocals from SunoV6Mini-The Last-Original-V1 up 2 dB", SOURCES
        )
        == []
    )
    # Lowercase filler is ordinary language, not a track claim.
    assert remix_prompt.unknown_track_references("vocals from the top up 2 dB", SOURCES) == []
    assert remix_prompt.unknown_track_references("drop the bass on slot 2", SOURCES) == []
    # Operand words around the name are trimmed off it.
    assert remix_prompt.unknown_track_references("vocals from The Vow", SOURCES) == ["The Vow"]
    assert remix_prompt.unknown_track_references("vocals from The Vow's intro", SOURCES) == ["The Vow's"]


def test_diff_names_tempo_change():
    base = remix_prompt.request_to_recipe(_base_recipe())
    import copy as _copy

    other = _copy.deepcopy(base)
    other.target_bpm = 140.0
    assert remix_prompt.diff_recipes(base, other) == ["target tempo 130 -> 140 BPM"]


def test_revision_system_prompt_carries_recipe_and_sources():
    system = remix_prompt.build_revision_system_prompt(SOURCES, _base_recipe())
    assert "rev-base" in system  # recipe verbatim
    assert "SunoV6Mini-Ad-Nauseam" in system  # source table
    assert "FULL revised recipe, not a diff" in system
