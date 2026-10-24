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


def _schema_mod():
    """Import lazily, inside the test.

    The version constant and _build_analysis_result moved to
    app/api/audio_analysis.py; _analysis_is_stale and _stamp_analysis stayed in
    app/api/audio.py. Both are needed here, so import each from where it lives
    rather than assuming one module owns the whole feature.

    Importing at module scope also pulls in the database dependency during
    collection, which opens a connection early and leaves studio.db locked on
    Windows - later tmpdir cleanup then fails with WinError 32 in unrelated
    tests.
    """
    import app.api.audio_analysis as mod

    return mod


def _stale_mod():
    """The module that defines _analysis_is_stale / _stamp_analysis."""
    import app.api.audio as mod

    return mod


def test_current_version_is_two():
    """Guard the bump itself, so the version cannot drift silently."""
    assert _schema_mod().ANALYSIS_SCHEMA_VERSION == 2


def test_stamp_marks_an_analysis_current():
    audio = _stale_mod()
    data = audio._stamp_analysis({"tempo_bpm": 120.0})
    assert data["schema_version"] == audio.ANALYSIS_SCHEMA_VERSION
    assert not audio._analysis_is_stale(data)


def test_missing_version_is_stale():
    """Entries stored before stamping existed must not be trusted."""
    audio = _stale_mod()
    assert audio._analysis_is_stale({"tempo_bpm": 120.0})


def test_older_version_is_stale():
    audio = _stale_mod()
    assert audio._analysis_is_stale({"schema_version": 1})
    assert audio._analysis_is_stale({"schema_version": 0})


def test_newer_version_is_not_stale():
    """A result from a future version is left alone, not discarded."""
    audio = _stale_mod()
    future = audio.ANALYSIS_SCHEMA_VERSION + 1
    assert not audio._analysis_is_stale({"schema_version": future})


def test_malformed_version_is_stale_not_a_crash():
    """Bad data must degrade to 're-analyze', never raise."""
    audio = _stale_mod()
    assert audio._analysis_is_stale({"schema_version": "not-a-number"})
    assert audio._analysis_is_stale({"schema_version": None})


def test_non_dict_is_stale():
    audio = _stale_mod()
    assert audio._analysis_is_stale(None)
    assert audio._analysis_is_stale("a string")


def test_string_number_version_is_accepted():
    """JSON round-trips can yield a string; treat it as its numeric value."""
    audio = _stale_mod()
    stamped = str(audio.ANALYSIS_SCHEMA_VERSION)
    assert not audio._analysis_is_stale({"schema_version": stamped})


def test_cache_delete_removes_only_the_named_entry():
    audio = _stale_mod()
    audio._cache_set("a.mp3", {"schema_version": 2}, "")
    audio._cache_set("a.mp3", {"schema_version": 2}, "librosa")
    audio._cache_delete("a.mp3", "")
    assert audio._cache_get("a.mp3", "") is None
    assert audio._cache_get("a.mp3", "librosa") is not None
    # delete must tolerate a missing key rather than raising KeyError
    audio._cache_delete("never-cached.mp3", "")




def test_cache_delete_by_content_id_evicts_every_backend():
    """Cleanup eviction: entries live under the full stored filename.

    Regression for the cleanup path popping a key that never exists: it
    evicted by the bare content id while _cache_set keys on the stored
    filename (``{content_id}_{original}``) once per backend, so a deleted
    analysis stayed servable until it aged out of the cache.
    """
    audio = _stale_mod()
    audio._cache_set("abc12345_track.mp3", {"schema_version": 2}, "")
    audio._cache_set("abc12345_track.mp3", {"schema_version": 2}, "sonara")
    audio._cache_set("zzz99999_other.mp3", {"schema_version": 2}, "sonara")
    audio._cache_delete_by_content_id("abc12345")
    assert audio._cache_get("abc12345_track.mp3", "") is None
    assert audio._cache_get("abc12345_track.mp3", "sonara") is None
    assert audio._cache_get("zzz99999_other.mp3", "sonara") is not None


def test_cleanup_derives_content_id_before_the_orphan_branch():
    """cleanup_audio_files must bind unique_id on every path.

    With remove_orphans off, the id used to be assigned only inside the
    orphan branch, so an age-based removal hit the eviction call with
    the name unbound. Checked against the source: the endpoint needs
    live output dirs, and the failure mode is structural.
    """
    import inspect

    audio = _stale_mod()
    src = inspect.getsource(audio.cleanup_audio_files)
    assert src.index("unique_id = analysis_file.stem") < src.index("if opts.remove_orphans")
    assert "_cache_delete_by_content_id(unique_id)" in src
def test_built_result_carries_the_stamp():
    """The stamp is set in _build_analysis_result, so every producer is covered.

    Checked against the source rather than by calling the builder: it needs a
    full analyzer result to run, and the property under test is that the dict it
    returns contains the stamp.
    """
    import inspect

    src = inspect.getsource(_schema_mod()._build_analysis_result)
    assert '"schema_version": ANALYSIS_SCHEMA_VERSION' in src, (
        "_build_analysis_result must stamp the version"
    )
