"""Tests for the structure-aware chunker.

The chunker's contract is that it does not break the things that only make
sense whole: a code fence, a table, a heading's association with its
content. These tests pin that contract.

`kb-chunk.py` has a hyphen in its name, so it is loaded by path rather
than imported by name.

Run:  python -m pytest tools/tests/unit -v
"""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))


def _load_chunker():
    spec = importlib.util.spec_from_file_location(
        "kb_chunk", ROOT / "tools" / "kb-chunk.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kb = _load_chunker()


class Counter:
    """A deterministic stand-in for the real tokenizer (4 chars/token)."""

    def count(self, text):
        return max(1, len(text) // 4)


COUNTER = Counter()


class TestSplitSections:
    def test_splits_at_headings(self):
        sections = kb.split_sections("# One\n\na\n\n## Two\n\nb")
        assert len(sections) == 2
        assert sections[0]["heading_path"] == "One"
        # The path is cumulative: a chunk carries the whole heading trail.
        assert sections[1]["heading_path"] == "One > Two"

    def test_keeps_the_heading_path(self):
        sections = kb.split_sections("# A\n\n## B\n\n### C\n\ntext")
        assert sections[-1]["heading_path"] == "A > B > C"

    def test_a_heading_inside_a_fence_is_not_a_heading(self):
        body = "# Real\n\n```\n# not a heading\n```\n"
        sections = kb.split_sections(body)
        assert len(sections) == 1

    def test_preamble_becomes_its_own_section(self):
        sections = kb.split_sections("preamble\n\n# H\n\nbody")
        assert sections[0]["heading_path"] == ""


class TestAtomicUnits:
    def test_a_code_fence_is_one_unit(self):
        units = kb.split_atomic_units("before\n\n```\ncode\n```\n\nafter")
        fences = [u for u, atomic in units if atomic]
        assert len(fences) == 1
        assert "code" in fences[0]

    def test_an_indented_fence_is_still_atomic(self):
        units = kb.split_atomic_units("   ```bash\n   x\n   ```")
        assert any(atomic for _u, atomic in units)

    def test_a_table_with_a_separator_is_atomic(self):
        units = kb.split_atomic_units("| a | b |\n| --- | --- |\n| 1 | 2 |")
        assert any(atomic for _u, atomic in units)

    def test_pipe_aligned_prose_without_a_separator_is_not_a_table(self):
        units = kb.split_atomic_units("| a | b |\n| 1 | 2 |")
        assert not any(atomic for _u, atomic in units)

    def test_a_table_broken_by_a_blank_line_is_rejoined(self):
        text = ("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| 3 | 4 |")
        units = kb.split_atomic_units(text)
        tables = [u for u, atomic in units if atomic]
        assert len(tables) == 1
        assert "3" in tables[0]


class TestChunking:
    def test_a_small_section_is_one_chunk(self):
        section = {"text": "short text", "heading_path": "H"}
        assert len(kb.split_oversized(section, COUNTER, 400, 0)) == 1

    def test_a_large_prose_section_is_split(self):
        body = " ".join(f"sentence number {i}." for i in range(400))
        section = {"text": body, "heading_path": "H"}
        chunks = kb.split_oversized(section, COUNTER, 400, 0)
        assert len(chunks) > 1

    def test_a_single_unsplittable_sentence_is_kept_whole(self):
        """A sentence with no internal boundary is not cut in half.

        The same principle that protects code fences protects a sentence:
        a chunk that starts mid-sentence is harder to read than a long one.
        """
        body = "word " * 2000
        section = {"text": body, "heading_path": "H"}
        chunks = kb.split_oversized(section, COUNTER, 400, 0)
        assert len(chunks) == 1

    def test_a_code_fence_is_never_split(self):
        body = "intro\n\n```\n" + "\n".join(f"line {i}" for i in range(400)) + "\n```\n"
        section = {"text": body, "heading_path": "H"}
        chunks = kb.split_oversized(section, COUNTER, 400, 0)
        for c in chunks:
            assert kb.fence_markers(c["text"]) % 2 == 0

    def test_a_section_containing_a_table_is_kept_whole(self):
        body = ("## H\n\n| a | b |\n| --- | --- |\n"
                + "\n".join(f"| {i} | {'x' * 200} |" for i in range(12)))
        section = {"text": body, "heading_path": "H"}
        chunks = kb.split_oversized(section, COUNTER, 400, 0)
        assert len(chunks) == 1

    def test_overlap_is_off_by_default(self):
        section = {"text": " ".join(["word"] * 2000), "heading_path": "H"}
        a = kb.split_oversized(section, COUNTER, 400, 0)
        b = kb.split_oversized(section, COUNTER, 400, 50)
        assert len(b) >= len(a)


class TestMergeTiny:
    def test_a_tiny_chunk_is_merged_into_its_neighbour(self):
        """A heading with no body is absorbed by the content that follows."""
        chunks = [
            {"text": "## H", "tokens": 2, "heading_path": "H", "doc": "d"},
            {"text": "a real chunk of prose " * 10, "tokens": 50,
             "heading_path": "H", "doc": "d"},
        ]
        merged = kb.merge_tiny_chunks(chunks, COUNTER, 40)
        assert len(merged) == 1
        # The merged chunk carries both texts, and its token count is
        # recomputed from the text rather than summed from the parts.
        assert "## H" in merged[0]["text"]
        assert "a real chunk of prose" in merged[0]["text"]
        assert merged[0]["tokens"] == COUNTER.count(merged[0]["text"])
        assert merged[0]["tokens"] > chunks[1]["tokens"]

    def test_a_trailing_run_of_fragments_folds_back(self):
        """Fragments at the end of a document fold into the last chunk."""
        chunks = [
            {"text": "substantial " * 30, "tokens": 60,
             "heading_path": "H", "doc": "d"},
            {"text": "## Empty", "tokens": 2, "heading_path": "H", "doc": "d"},
        ]
        merged = kb.merge_tiny_chunks(chunks, COUNTER, 40)
        assert len(merged) == 1
        assert "## Empty" in merged[0]["text"]

    def test_chunks_above_the_minimum_are_untouched(self):
        chunks = [
            {"text": "a" * 400, "tokens": 100, "heading_path": "H", "doc": "d"},
            {"text": "b" * 400, "tokens": 100, "heading_path": "H", "doc": "d"},
        ]
        assert len(kb.merge_tiny_chunks(chunks, COUNTER, 40)) == 2

    def test_an_empty_list_is_safe(self):
        assert kb.merge_tiny_chunks([], COUNTER, 40) == []


class TestSourceDefects:
    def test_an_unbalanced_fence_is_reported(self):
        problems = kb.check_source_defects(Path("x.md"), "```\ncode\n")
        assert any("fence" in p for p in problems)

    def test_balanced_fences_are_not_reported(self):
        problems = kb.check_source_defects(Path("x.md"), "```\ncode\n```\n")
        assert not any("fence" in p for p in problems)

    def test_a_table_broken_by_a_blank_line_is_reported(self):
        text = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| 3 | 4 |\n"
        problems = kb.check_source_defects(Path("x.md"), text)
        assert any("blank line" in p for p in problems)

    def test_a_table_fragment_is_reported(self):
        problems = kb.check_source_defects(Path("x.md"), "| 1 | 2 |\n| 3 | 4 |\n")
        assert any("without a header" in p for p in problems)
