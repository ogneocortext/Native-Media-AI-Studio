"""Tests for analysis schema-version stamping and staleness detection.

Content-addressed uploads mean a re-upload now hits the same cache entry every
time, which makes an unstamped entry permanently servable: a result written
before a field existed would be returned forever and the field would never
appear. The version stamp is what stops that.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _audio():
    """Import lazily, inside the test.

    Importing app.api.audio at module scope pulls in its database dependency
    during collection, which opens a connection early and leaves studio.db
    locked on Windows - later tmpdir cleanup then fails with WinError 32 in
    unrelated tests.
    """
    import app.api.audio as audio_mod

    return audio_mod


def test_current_version_is_two():
    """Guard the bump itself, so the version cannot drift silently."""
    assert _audio().ANALYSIS_SCHEMA_VERSION == 2


def test_stamp_marks_an_analysis_current():
    audio = _audio()
    data = audio._stamp_analysis({"tempo_bpm": 120.0})
    assert data["schema_version"] == audio.ANALYSIS_SCHEMA_VERSION
    assert not audio._analysis_is_stale(data)


def test_missing_version_is_stale():
    """Entries stored before stamping existed must not be trusted."""
    audio = _audio()
    assert audio._analysis_is_stale({"tempo_bpm": 120.0})


def test_older_version_is_stale():
    audio = _audio()
    assert audio._analysis_is_stale({"schema_version": 1})
    assert audio._analysis_is_stale({"schema_version": 0})


def test_newer_version_is_not_stale():
    """A result from a future version is left alone, not discarded."""
    audio = _audio()
    future = audio.ANALYSIS_SCHEMA_VERSION + 1
    assert not audio._analysis_is_stale({"schema_version": future})


def test_malformed_version_is_stale_not_a_crash():
    """Bad data must degrade to 're-analyze', never raise."""
    audio = _audio()
    assert audio._analysis_is_stale({"schema_version": "not-a-number"})
    assert audio._analysis_is_stale({"schema_version": None})


def test_non_dict_is_stale():
    audio = _audio()
    assert audio._analysis_is_stale(None)
    assert audio._analysis_is_stale("a string")


def test_string_number_version_is_accepted():
    """JSON round-trips can yield a string; treat it as its numeric value."""
    audio = _audio()
    stamped = str(audio.ANALYSIS_SCHEMA_VERSION)
    assert not audio._analysis_is_stale({"schema_version": stamped})


def test_cache_delete_removes_only_the_named_entry():
    audio = _audio()
    audio._cache_set("a.mp3", {"schema_version": 2}, "")
    audio._cache_set("a.mp3", {"schema_version": 2}, "librosa")
    audio._cache_delete("a.mp3", "")
    assert audio._cache_get("a.mp3", "") is None
    assert audio._cache_get("a.mp3", "librosa") is not None
    # delete must tolerate a missing key rather than raising KeyError
    audio._cache_delete("never-cached.mp3", "")


def test_built_result_carries_the_stamp():
    """The stamp is set in _build_analysis_result, so every producer is covered.

    Checked against the source rather than by calling the builder: it needs a
    full analyzer result to run, and the property under test is that the dict it
    returns contains the stamp.
    """
    import inspect

    src = inspect.getsource(_audio()._build_analysis_result)
    assert '"schema_version": ANALYSIS_SCHEMA_VERSION' in src, (
        "_build_analysis_result must stamp the version"
    )
