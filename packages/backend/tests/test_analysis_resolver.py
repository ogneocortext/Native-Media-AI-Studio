"""Tests for the deterministic analysis resolver.

The candidate names below are copied from the real
``output/audio_analysis/`` directory, so these assert behaviour against the
actual mess rather than an idealised one. Found there:

  * bare hash      ``32129cfa``            (current, v2)
  * hash + slug    ``85a406ef-NeoCortext-Take-the-Crown``  (stale, unstamped)
  * slug only      ``NeoCortext-Take-the-Crown``          (stale, unstamped)
  * test-prefixed  ``test-NeoCortext___Take_the_Crown``   (stale, unstamped)
  * orphan         ``orphan-143bpm-209s``                  (stale, unstamped)
"""

import os
from pathlib import Path
from typing import ClassVar

import pytest
from app.services.analysis_resolver import (
    ANALYSIS_SUFFIX,
    AnalysisCandidate,
    choose_keeper,
    clear_scan_cache,
    content_diff,
    content_fingerprint,
    hash_prefix,
    resolve_analysis,
    resolve_by_job_id,
    scan_analysis_dir,
    scan_analysis_dir_cached,
    slugify,
    strip_prefix,
)

CURRENT = 2


def cand(name: str, version: int | None) -> AnalysisCandidate:
    return AnalysisCandidate(path=Path(name), schema_version=version)


@pytest.fixture
def store(tmp_path):
    """A temp analysis dir plus a counting `schema_of`, and an empty scan cache."""
    clear_scan_cache()
    versions = {"a_analysis.json": CURRENT, "b_analysis.json": None}
    for name in versions:
        (tmp_path / name).write_text("{}")
    calls = []

    def schema_of(p: Path) -> int | None:
        calls.append(p.name)
        return versions.get(p.name)

    yield tmp_path, schema_of, calls, versions
    clear_scan_cache()


# The real store, as found on disk.
REAL_STORE = [
    cand("32129cfa_analysis.json", CURRENT),
    cand("29449045_analysis.json", None),
    cand("85a406ef-NeoCortext-Take-the-Crown_analysis.json", None),
    cand("NeoCortext-Take-the-Crown_analysis.json", None),
    cand("orphan-143bpm-209s_analysis.json", None),
    cand("SunoV6Mini-Ad-NauseamV2_analysis.json", None),
]


class TestPrefixHelpers:
    def test_hash_prefix_reads_the_content_hash(self):
        assert hash_prefix("85a406ef_NeoCortext - Take the Crown") == "85a406ef"
        assert hash_prefix("85a406ef-NeoCortext-Take-the-Crown") == "85a406ef"
        assert hash_prefix("NeoCortext - Take the Crown") is None

    def test_strip_prefix_removes_hash_and_test_prefix(self):
        assert strip_prefix("85a406ef_NeoCortext") == "NeoCortext"
        assert strip_prefix("test-NeoCortext") == "NeoCortext"
        assert strip_prefix("orphan-143bpm-209s") == "143bpm-209s"
        assert strip_prefix("NeoCortext") == "NeoCortext"

    def test_slugify_absorbs_spacing_and_case(self):
        # All three must collapse to one key, or the same track resolves
        # differently depending on which convention wrote its analysis.
        a = slugify("NeoCortext - Take the Crown")
        b = slugify("NeoCortext-Take-the-Crown")
        c = slugify("85a406ef_NeoCortext - Take the Crown")
        assert a == b == c == "neocortext-take-the-crown"


class TestResolution:
    def test_finds_a_current_schema_file_by_exact_stem(self):
        r = resolve_analysis("32129cfa.mp3", REAL_STORE, CURRENT)
        assert r.match is not None
        assert r.match.path.name == "32129cfa_analysis.json"

    def test_refuses_a_stale_match_and_says_why(self):
        # The track is stored as `85a406ef_NeoCortext - Take the Crown.mp3`
        # and its analysis exists under three naming conventions — all unstamped.
        r = resolve_analysis("85a406ef_NeoCortext - Take the Crown.mp3", REAL_STORE, CURRENT)
        assert r.match is None
        assert "re-analyzed" in r.reason

    def test_prefers_a_current_schema_file_over_a_stale_one(self):
        store = [
            cand("NeoCortext-Take-the-Crown_analysis.json", None),  # stale, first
            cand("NeoCortext_Take_the_Crown_analysis.json", CURRENT),  # current
        ]
        r = resolve_analysis("NeoCortext - Take the Crown.mp3", store, CURRENT)
        assert r.match is not None
        assert r.match.schema_version == CURRENT

    def test_never_returns_an_unstamped_file(self):
        for c in REAL_STORE:
            if c.schema_version is None:
                r = resolve_analysis(c.stem + ".mp3", REAL_STORE, CURRENT)
                assert r.match is None, f"served stale file {c.path.name}"

    def test_reports_a_useful_reason_on_miss(self):
        r = resolve_analysis("Nothing Like This.mp3", REAL_STORE, CURRENT)
        assert r.match is None
        assert r.reason
        assert r.considered  # explains what it looked at

    def test_empty_reference_is_handled(self):
        r = resolve_analysis("", REAL_STORE, CURRENT)
        assert r.match is None
        assert "empty" in r.reason

    def test_subfolder_and_windows_references_resolve(self):
        store = [cand("32129cfa_analysis.json", CURRENT)]
        assert resolve_analysis("Suno-V6-Mini/32129cfa.mp3", store, CURRENT).match
        assert resolve_analysis(r"Suno-V6-Mini\32129cfa.mp3", store, CURRENT).match

    def test_extensionless_reference_resolves(self):
        store = [cand("32129cfa_analysis.json", CURRENT)]
        assert resolve_analysis("32129cfa", store, CURRENT).match is not None

    def test_different_hash_does_not_match(self):
        store = [cand("32129cfa_analysis.json", CURRENT)]
        assert resolve_analysis("deadbeef_whatever.mp3", store, CURRENT).match is None


class TestScan:
    def test_scan_finds_files_and_reads_versions(self, tmp_path):
        seen = {"a_analysis.json": CURRENT, "b_analysis.json": None}

        (tmp_path / "a_analysis.json").write_text("{}")
        (tmp_path / "b_analysis.json").write_text("{}")
        (tmp_path / "ignored.txt").write_text("x")

        found = scan_analysis_dir(tmp_path, lambda p: seen.get(p.name))
        assert [c.path.name for c in found] == ["a_analysis.json", "b_analysis.json"]
        assert found[0].schema_version == CURRENT
        assert found[1].schema_version is None

    def test_scan_of_missing_dir_is_empty(self, tmp_path):
        assert scan_analysis_dir(tmp_path / "nope", lambda _p: None) == []


    def test_suffix_constant_is_what_files_use(self):
        assert ANALYSIS_SUFFIX == "_analysis.json"


class TestContentDiff:
    """The safety gate before anything is deleted.

A matching fingerprint proves the *audio* is the same; it does not prove the
two *documents* carry the same data. `sections`, suggestions and confidence
values are all ignored by the fingerprint, so a copy that carries
LLM-refined sections looks identical to one that does not — and deleting it
would lose work the fingerprint cannot see.
"""

    def base(self, **over):
        doc = {
            "beat_times": [0.5, 1.0],
            "energy_curve": [0.1, 0.9],
            "tempo_bpm": 150.6,
            "sections": [{"start": 0.0, "end": 10.0, "label": "intro"}],
            "suggested_visualization": "aurora",
            "suggested_visualization_confidence": 0.8,
            "confidence": 0.986,
        }
        doc.update(over)
        return doc

    def test_identical_documents_have_no_diff(self):
        assert content_diff(self.base(), self.base()) == []

    def test_provenance_differences_are_ignored(self):
        a = self.base(job_id="aaa", relative_path="x1.mp3", computed_on="GPU")
        b = self.base(job_id="bbb", relative_path="x2.mp3", stored_path="D:/other")
        assert content_diff(a, b) == []

    def test_sections_difference_is_detected(self):
        a = self.base()
        b = self.base(sections=[{"start": 0.0, "end": 10.0, "label": "VERSE"}])
        assert "sections" in content_diff(a, b)

    def test_suggestion_difference_is_detected(self):
        a = self.base()
        b = self.base(suggested_visualization="nebula")
        assert "suggested_visualization" in content_diff(a, b)

    def test_confidence_difference_is_detected(self):
        assert "confidence" in content_diff(self.base(), self.base(confidence=0.4))

    def test_missing_key_counts_as_a_difference(self):
        a = self.base()
        b = self.base()
        b.pop("sections")
        assert "sections" in content_diff(a, b)

    def test_a_differing_document_is_not_a_duplicate_for_deletion(self):
        """The exact scenario the gate exists for: same audio, richer sections."""
        a = self.base()
        b = self.base(sections=[{"start": 0.0, "end": 30.0, "label": "chorus"}])
        # Fingerprint matches — same audio, same tempo...
        assert content_fingerprint(a) == content_fingerprint(b)
        # ...but the documents differ, so the second must not be deleted.
        assert content_diff(a, b) != []

    def test_non_dicts_are_never_equivalent(self):
        assert content_diff("x", "x") == ["<not a dict>"]





class TestContentFingerprint:
    """Dedup must key on acoustic content, not on provenance fields.

    The real store has three copies of one "Take the Crown" analysis whose
    `relative_path` values differ (`29449045_85a406ef_...`, `06846059_...`,
    `85a406ef_...`). If provenance counted, none of them would be duplicates.
    """

    def base(self, **over):
        doc = {
            "beat_times": [0.5, 1.0, 1.5],
            "energy_curve": [0.1, 0.9, 0.4],
            "onset_times": [0.1, 0.7],
            "tempo_bpm": 150.6,
            "duration_seconds": 124.0,
        }
        doc.update(over)
        return doc

    def test_identical_content_fingerprints_equal(self):
        assert content_fingerprint(self.base()) == content_fingerprint(self.base())

    def test_provenance_differences_do_not_break_the_match(self):
        a = self.base(job_id="aaa", relative_path="29449045_85a406ef_x.mp3")
        b = self.base(job_id="bbb", relative_path="85a406ef_x.mp3", computed_on="GPU")
        assert content_fingerprint(a) == content_fingerprint(b)

    def test_different_audio_fingerprints_differ(self):
        a = self.base(beat_times=[0.5, 1.0, 1.5])
        b = self.base(beat_times=[0.5, 1.1, 1.5])
        assert content_fingerprint(a) != content_fingerprint(b)

    def test_tempo_difference_is_detected(self):
        assert content_fingerprint(self.base(tempo_bpm=143.0)) != content_fingerprint(
            self.base(tempo_bpm=143.6)
        )

    def test_sparse_document_is_not_fingerprinted(self):
        # Must return None so a truncated file is never merged with a good one.
        assert content_fingerprint({"beat_times": [1.0]}) is None
        assert content_fingerprint({}) is None
        assert content_fingerprint("not a dict") is None

    def test_same_duration_different_bpm_is_not_a_duplicate(self):
        # The real orphan pair: same 209s duration, different tempo.
        assert content_fingerprint(
            self.base(tempo_bpm=143.0, duration_seconds=209.0)
        ) != content_fingerprint(self.base(tempo_bpm=143.6, duration_seconds=209.13))


class TestChooseKeeper:
    def _mk(self, tmp_path, name, version, age):
        p = tmp_path / f"{name}_analysis.json"
        p.write_text("{}")
        os.utime(p, (age, age))
        return AnalysisCandidate(path=p, schema_version=version)

    def test_prefers_a_current_schema_file(self, tmp_path):
        stale = self._mk(tmp_path, "stale", None, 200)
        current = self._mk(tmp_path, "current", CURRENT, 100)
        assert choose_keeper([stale, current]).path.name == "current_analysis.json"

    def test_prefers_the_newest_when_schema_ties(self, tmp_path):
        older = self._mk(tmp_path, "older", CURRENT, 100)
        newer = self._mk(tmp_path, "newer", CURRENT, 200)
        assert choose_keeper([older, newer]).path.name == "newer_analysis.json"

    def test_is_order_independent(self, tmp_path):
        a = self._mk(tmp_path, "aaa", CURRENT, 100)
        b = self._mk(tmp_path, "bbb", None, 300)
        assert choose_keeper([a, b]).path == choose_keeper([b, a]).path

    def test_single_candidate_is_its_own_keeper(self, tmp_path):
        only = self._mk(tmp_path, "solo", None, 1)
        assert choose_keeper([only]) is only


class TestCachedScan:
    """The cache exists because reading schema_version means parsing the whole
    document — ~2.5 MB / ~42 ms across the real 17-file store, paid on every
    cache miss. These tests pin the invariant that makes it safe: a changed file
    is always re-read."""

    def test_second_scan_does_not_reparse(self, store):
        d, schema_of, calls, _ = store
        scan_analysis_dir_cached(d, schema_of)
        first = len(calls)
        scan_analysis_dir_cached(d, schema_of)
        assert len(calls) == first, "cached scan re-parsed unchanged files"

    def test_results_match_the_uncached_scan(self, store):
        d, schema_of, _, _ = store
        assert scan_analysis_dir_cached(d, schema_of) == scan_analysis_dir(d, schema_of)

    def test_adding_a_file_invalidates_the_cache(self, store):
        d, schema_of, calls, versions = store
        scan_analysis_dir_cached(d, schema_of)
        before = len(calls)

        versions["c_analysis.json"] = CURRENT
        (d / "c_analysis.json").write_text("{}")
        found = scan_analysis_dir_cached(d, schema_of)

        assert len(calls) > before
        assert any(c.path.name == "c_analysis.json" for c in found)

    def test_rewriting_a_file_invalidates_the_cache(self, store):
        d, schema_of, calls, versions = store
        scan_analysis_dir_cached(d, schema_of)
        before = len(calls)

        # Same name, different content *and* size so the fingerprint moves.
        versions["a_analysis.json"] = None
        (d / "a_analysis.json").write_text('{"schema_version": null, "pad": 1}')
        found = {c.path.name: c.schema_version for c in scan_analysis_dir_cached(d, schema_of)}

        assert len(calls) > before
        assert found["a_analysis.json"] is None

    def test_deleting_a_file_invalidates_the_cache(self, store):
        d, schema_of, _, _ = store
        scan_analysis_dir_cached(d, schema_of)
        (d / "b_analysis.json").unlink()
        found = [c.path.name for c in scan_analysis_dir_cached(d, schema_of)]
        assert "b_analysis.json" not in found

    def test_missing_dir_is_empty(self, tmp_path):
        clear_scan_cache()
        assert scan_analysis_dir_cached(tmp_path / "nope", lambda _p: None) == []


class TestResolveByJobId:
    """`glob(f"{job_id}*")[0]` was order-dependent and had no schema check."""

    JOBS: ClassVar[list] = [
        cand("32129cfa_analysis.json", CURRENT),
        cand("32129cfa-longer-suffix_analysis.json", CURRENT),
        cand("85a406ef_analysis.json", None),
    ]

    def test_exact_stem_wins(self):
        r = resolve_by_job_id("32129cfa", self.JOBS, CURRENT)
        assert r.match.path.name == "32129cfa_analysis.json"

    def test_prefix_match_is_deterministic(self):
        # Shortest stem wins, so the answer cannot depend on directory order.
        r = resolve_by_job_id("32129cfa", [self.JOBS[1], self.JOBS[0]], CURRENT)
        assert r.match.path.name == "32129cfa_analysis.json"

    def test_never_returns_a_stale_job(self):
        r = resolve_by_job_id("85a406ef", self.JOBS, CURRENT)
        assert r.match is None
        assert "pre-v2" in r.reason

    def test_unknown_job_reports_why(self):
        r = resolve_by_job_id("deadbeef", self.JOBS, CURRENT)
        assert r.match is None
        assert r.reason

    def test_empty_job_id(self):
        r = resolve_by_job_id("", self.JOBS, CURRENT)
        assert r.match is None
        assert "empty" in r.reason
