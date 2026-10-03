"""The tokenised index must not reproduce the substring matcher's false positives.

`/api/docs/search` previously scored with `query in text`. Measured against the
real corpus, that produced confidently wrong results: `og` matched documents
containing "log"/"dialog", `vr` matched "VRAM" and "over", `jobid` matched
"video" - and those outranked genuine matches, because a rare substring scores
higher than a common exact token.

These tests pin the behaviour that fixes it.
"""

from app.services.doc_search_index import DocIndex, tokenize


class TestTokenizer:
    def test_splits_snake_case(self):
        assert "queue" in tokenize("queue_manager.py")
        assert "manager" in tokenize("queue_manager.py")
        assert "queue_manager" in tokenize("queue_manager.py")

    def test_splits_camel_case(self):
        """`ComfyUIAdapter` must yield parts, not stay one opaque token.

        The boundary is the conventional one (Comfy / UI / Adapter), so
        `adapter` is findable. Note it yields `comfy`, not `comfyui` - the same
        rule keeps `UI` intact, which is what lets a search for "ui" work.
        """
        toks = tokenize("ComfyUIAdapter")
        assert "comfyuiadapter" in toks, "the whole token is kept too"
        assert "adapter" in toks
        assert "comfy" in toks

    def test_drops_stopwords(self):
        toks = tokenize("the job is not done")
        assert "the" not in toks
        assert "not" not in toks
        assert "job" in toks

    def test_strips_accents(self):
        assert tokenize("naïve café") == ["naive", "cafe"]

    def test_empty_or_punctuation_only(self):
        assert tokenize("") == []
        assert tokenize("!!! ???") == []


class TestFalsePositives:
    """The exact failures measured against the real corpus."""

    def _index(self):
        idx = DocIndex()
        idx.add(
            "video-generation.md", "Video Generation", ["video"], [], True,
            "vault", "VRAM usage over every video render and the decoder.",
        )
        idx.add(
            "backend-debugging.md", "Backend Debugging", ["backend"], [], True,
            "vault", "The catalog and dialog logic live in the logger.",
        )
        idx.finalize()
        return idx

    def test_substring_query_vr_matches_nothing(self):
        """"VRAM" and "over" contain "vr"; neither is the token "vr"."""
        assert self._index().search("vr") == []

    def test_substring_query_jobid_matches_nothing(self):
        """"jobid" was a substring of nothing, but matched 'video' by accident."""
        assert self._index().search("jobid") == []

    def test_two_letter_query_og_does_not_match_catalog(self):
        """"og" is inside "catalog"/"dialog"; as a token it is not present."""
        assert self._index().search("og") == []

    def test_real_token_still_matches(self):
        hits = self._index().search("vram")
        assert hits and hits[0]["path"] == "video-generation.md"


class TestRanking:
    def _index(self):
        idx = DocIndex()
        idx.add("queue-manager.md", "Queue Manager", ["queue"], [], True,
                "vault", "Brief.")
        idx.add("unrelated.md", "Audio Notes", ["audio"], [], True, "vault",
                "The queue of pending jobs is a queue of work items in the queue.")
        idx.finalize()
        return idx

    def test_title_match_outranks_repeated_prose_mention(self):
        """"queue" 4x in prose must not beat a document titled "Queue Manager"."""
        hits = self._index().search("queue")
        assert hits[0]["path"] == "queue-manager.md"

    def test_reports_which_terms_matched(self):
        """A result should be explainable, not just ranked."""
        hit = self._index().search("queue")[0]
        assert "queue" in hit["matched_terms"]

    def test_head_matches_are_flagged(self):
        hits = self._index().search("queue")
        by_path = {h["path"]: h for h in hits}
        assert "queue" in by_path["queue-manager.md"]["matched_in_head"]

    def test_vault_only_filter(self):
        idx = DocIndex()
        idx.add("in.md", "In Vault", ["x"], [], True, "vault", "content here")
        idx.add("out.md", "Outside Vault", ["x"], [], False, "guide", "content here")
        idx.finalize()
        paths = {h["path"] for h in idx.search("content", vault_only=True)}
        assert paths == {"in.md"}

    def test_limit_respected(self):
        idx = DocIndex()
        for i in range(10):
            idx.add(f"d{i}.md", f"Doc {i}", ["t"], [], True, "vault", "shared term body")
        idx.finalize()
        assert len(idx.search("shared", limit=3)) == 3

    def test_no_match_returns_empty(self):
        idx = DocIndex()
        idx.add("a.md", "A", [], [], True, "vault", "alpha")
        idx.finalize()
        assert idx.search("zzzznotpresent") == []


class TestIndexStats:
    def test_counts(self):
        idx = DocIndex()
        idx.add("a.md", "Alpha Doc", ["t"], [], True, "vault", "alpha body")
        idx.add("b.md", "Beta Doc", ["t"], [], True, "vault", "beta body")
        idx.finalize()
        assert len(idx) == 2
        assert idx.doc_count == 2
        assert idx.term_count > 0
