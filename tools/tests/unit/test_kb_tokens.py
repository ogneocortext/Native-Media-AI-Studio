"""Tests for the shared token counter and markdown primitives.

`tools/_kb_tokens.py` and `tools/_kb_markdown.py` exist so that the
knowledge-library tools count tokens and read markdown the same way. A
second copy of either is how the tools drifted apart in the first place.

Run:  python -m pytest tools/tests/unit -v
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _kb_markdown import (  # noqa: E402
    fence_markers,
    has_table,
    is_separator_row,
    is_table_line,
)
from _kb_tokens import (  # noqa: E402
    CHARS_PER_TOKEN_MARKDOWN,
    CONTEXT_CLIFF_TOKENS,
    MODEL_TOKENIZERS,
    PRACTICAL_CHUNK_CEILING,
    humanize_tokens,
    resolve_counter,
    split_sentences,
)


class TestTokenCounter:
    """The counter resolves a tokenizer by searching a root; the root need
    not exist, so these tests need no temporary directory."""

    def test_falls_back_to_an_estimate(self):
        counter = resolve_counter(Path("/nonexistent"), "estimate")
        assert counter.exact is False
        assert counter.model == "estimate"
        assert counter.chars_per_token == CHARS_PER_TOKEN_MARKDOWN

    def test_estimate_scales_with_length(self):
        counter = resolve_counter(Path("/nonexistent"), "estimate")
        short = counter.count("hello world")
        long = counter.count("hello world " * 100)
        assert long > short

    def test_estimate_never_returns_zero(self):
        counter = resolve_counter(Path("/nonexistent"), "estimate")
        assert counter.count("") >= 1

    def test_unknown_name_falls_back_to_the_estimate(self):
        counter = resolve_counter(Path("/nonexistent"), "no-such-tokenizer")
        assert counter.exact is False

    def test_empty_root_yields_an_estimate(self):
        counter = resolve_counter(Path("/nonexistent"), None)
        assert counter.exact in (True, False)
        assert counter.count("some text") > 0


class TestHumanizeTokens:
    def test_small_numbers_are_verbatim(self):
        assert humanize_tokens(999) == "999"

    def test_thousands(self):
        assert humanize_tokens(1500) == "1.5k"

    def test_millions(self):
        assert humanize_tokens(329_670) == "329.7k"
        assert humanize_tokens(1_048_576) == "1.0M"


class TestSplitSentences:
    def test_splits_on_terminal_punctuation(self):
        parts = split_sentences("One. Two! Three?")
        assert len(parts) == 3

    def test_keeps_the_punctuation(self):
        assert split_sentences("Done.")[0] == "Done."

    def test_abbreviations_do_not_split(self):
        parts = split_sentences("Use e.g. this approach. Then stop.")
        assert len(parts) == 2

    def test_empty_text_yields_nothing(self):
        assert split_sentences("") == []
        assert split_sentences("   \n  ") == []


class TestTableDetection:
    def test_a_pipe_row_is_a_table_line(self):
        assert is_table_line("| a | b |")

    def test_a_separator_row_is_a_table_line(self):
        assert is_table_line("| --- | --- |")
        assert is_table_line("--- | ---")

    def test_prose_is_not_a_table_line(self):
        assert not is_table_line("just a sentence")

    def test_is_separator_row(self):
        assert is_separator_row("| --- | --- |")
        assert is_separator_row("| :--- | ---: |")
        assert not is_separator_row("| a | b |")

    def test_has_table_needs_a_separator(self):
        assert has_table("| a | b |\n| --- | --- |\n| 1 | 2 |")
        # Rows without a separator are not a table markdown renders.
        assert not has_table("| a | b |\n| 1 | 2 |")


class TestFenceMarkers:
    def test_counts_delimiters(self):
        assert fence_markers("```\ncode\n```") == 2

    def test_counts_indented_fences(self):
        assert fence_markers("   ```bash\n   x\n   ```") == 2

    def test_an_odd_count_means_unterminated(self):
        assert fence_markers("```\ncode") % 2 == 1


class TestBudgetConstants:
    def test_context_cliff_is_under_the_practical_ceiling(self):
        assert CONTEXT_CLIFF_TOKENS < PRACTICAL_CHUNK_CEILING

    def test_the_values_match_the_research(self):
        # The context cliff: ~2.5k tokens of retrieved context
        # (arXiv:2601.14123, 2026).
        assert CONTEXT_CLIFF_TOKENS == 2_500
        assert PRACTICAL_CHUNK_CEILING == 8_000


def test_repo_local_tokenizer_is_discoverable():
    """The studio's own model tokenizer should be found on a real checkout."""
    root = Path(__file__).resolve().parents[3]
    counter = resolve_counter(root, "gemma-4-e2b-it")
    if counter.exact:
        # Exact counting must agree with the estimate closely enough that the
        # routing index is not misleading.
        sample = "The studio is a full-stack music-video creation suite."
        exact = counter.count(sample)
        estimate = len(sample) / CHARS_PER_TOKEN_MARKDOWN
        assert abs(exact - estimate) / max(1, exact) < 0.35
    else:
        pytest.skip("no local tokenizer on this machine")


class TestPerModelSizing:
    """A token count belongs to a tokenizer, so each model gets its own."""

    def test_gemma_is_mapped_to_its_own_tokenizer(self):
        name, basis = MODEL_TOKENIZERS["gemma4:e2b-it-qat"]
        assert name == "gemma-4-e2b-it"
        assert basis == "exact"

    def test_qwen_is_mapped_to_its_family(self):
        name, basis = MODEL_TOKENIZERS["qwen3.5:4b"]
        assert name == "qwen3"
        assert basis == "family"

    def test_models_without_a_local_tokenizer_are_estimates(self):
        for model in ("llama3.2:3b", "minicpm-v:8b"):
            name, basis = MODEL_TOKENIZERS[model]
            assert name is None
            assert basis == "estimate"

    def test_tokenizers_disagree_on_the_same_text(self):
        """The whole point: one number cannot serve every model.

        A haystack sized for one tokenizer under- or over-fills another's
        (arXiv:2605.02173, 2026).
        """
        root = Path(__file__).resolve().parents[3]
        gemma = resolve_counter(root, "gemma-4-e2b-it")
        qwen = resolve_counter(root, "qwen3")
        estimate = resolve_counter(root, "estimate")
        if not (gemma.exact and qwen.exact):
            pytest.skip("tokenizers not available on this machine")
        sample = ("# Knowledge library\n\nThe studio is a full-stack "
                  "music-video creation suite with a FastAPI backend.\n")
        counts = {gemma.count(sample), qwen.count(sample), estimate.count(sample)}
        assert len(counts) > 1, "tokenizers should not agree exactly"
