"""Tests for the lyric safety scanner (contamination + pronunciation)."""

from app.services.lyric_safety import parse_bpm, scan_lyrics


def kinds(findings):
    return [f["kind"] for f in findings]


def test_instruction_preface_flagged():
    lyrics = "Do not change any words. Sing exactly as written.\n[Verse]\nHello world"
    found = scan_lyrics(lyrics)
    assert "instruction_text" in kinds(found)
    assert found[0]["line"] == 1


def test_instruction_preface_variants():
    assert "instruction_text" in kinds(scan_lyrics("Here are the lyrics:\nla la"))
    assert "instruction_text" in kinds(scan_lyrics("NOTE: keep it sad\nla la"))


def test_production_direction_words():
    lyrics = "[Chorus]\nHear the wobble in my tone\nFeel the bass"
    found = scan_lyrics(lyrics)
    assert "production_direction" in kinds(found)
    assert any("wobble" in f["text"] for f in found)


def test_take_marker():
    found = scan_lyrics("[Verse]\nTake 3, here we go\nSinging loud")
    assert "production_direction" in kinds(found)


def test_bracket_tags_are_not_flagged():
    lyrics = "[Verse]\n[Chorus] (belted, open vowels)\nSteady singing here"
    assert scan_lyrics(lyrics) == []


def test_caps_chant_line():
    lyrics = "[Chorus]\nWE ARE NEVER GOING HOME\nsoftly now"
    found = scan_lyrics(lyrics)
    assert "caps_chant" in kinds(found)


def test_abbreviation_with_periods():
    lyrics = "[Verse]\nMeet me at the A.C. tonight\nBring a friend"
    found = scan_lyrics(lyrics)
    assert "abbreviation_periods" in kinds(found)
    assert "AC" in found[0]["suggestion"]


def test_plain_abbreviation_ok():
    assert scan_lyrics("[Verse]\nMeet me at the AC tonight") == []


def test_dense_vocals_at_high_bpm():
    lines = ["[Verse]"] + [
        "running down the boulevard with every single light ablaze tonight"
        for _ in range(14)
    ]
    found = scan_lyrics("\n".join(lines), bpm=140)
    assert "dense_vocals" in kinds(found)


def test_dense_vocals_not_flagged_at_low_bpm():
    lines = ["[Verse]"] + [
        "running down the boulevard with every single light ablaze tonight"
        for _ in range(14)
    ]
    assert "dense_vocals" not in kinds(scan_lyrics("\n".join(lines), bpm=120))


def test_clean_lyrics_pass():
    lyrics = "[Verse]\nMidnight oil burning low\n[Chorus]\nWe ride till morning light"
    assert scan_lyrics(lyrics) == []


def test_findings_carry_messages():
    found = scan_lyrics("Do not change any words.\nla")
    assert found and all(f["message"] for f in found)


def test_parse_bpm():
    assert parse_bpm("140") == 140
    assert parse_bpm("140 BPM") == 140
    assert parse_bpm(None) is None
    assert parse_bpm("fast") is None
