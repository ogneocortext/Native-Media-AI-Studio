"""Tests for tools/check-decision-index.py.

The Quick index is the navigation layer for a 190 KB decision log: AGENTS.md and
the log header both send agents to it instead of the whole file. It only works
while it lists every entry, so the gate exists to stop it drifting — and a gate
nothing tests can drift itself.

These call the checker's pure ``audit()`` on synthetic logs, so they run in
milliseconds and are collected by the ``tools-pytest`` gate.

Run:  python -m pytest tools/tests/unit/test_decision_index.py -v
"""

import importlib.util
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "check_decision_index", TOOLS / "check-decision-index.py"
)
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


def build(entries, indexed=None, extra=""):
    """A synthetic log: the given body entries plus an index over `indexed`."""
    body = ["# Log", "", "## Quick index", ""]
    for ident in indexed if indexed is not None else entries:
        body.append(f"- `{ident}` **Title {ident}** \u2014 decision {ident}.")
    body += ["", "## Decided", ""]
    for ident in entries:
        body += [
            f"### {ident} \u2014 Title {ident}",
            "",
            "- **Decision:** decision text for " + ident + ".",
            "",
        ]
    return "\n".join(body) + extra


def test_in_step_index_passes():
    missing, stale, dupes, indexed, total = mod.audit(build(["D1", "D2", "Q1"]))
    assert (missing, stale, dupes) == ([], [], [])
    assert (indexed, total) == (3, 3)


def test_missing_line_is_reported():
    missing, stale, dupes, _, _ = mod.audit(build(["D1", "D2"], indexed=["D1"]))
    assert missing == ["D2"]
    assert stale == [] and dupes == []


def test_stale_line_is_reported():
    missing, stale, dupes, _, _ = mod.audit(build(["D1"], indexed=["D1", "D9"]))
    assert missing == []
    assert stale == ["D9"]


def test_duplicate_line_is_reported():
    _, _, dupes, _, _ = mod.audit(build(["D1"], indexed=["D1", "D1"]))
    assert dupes == ["D1"]


def test_missing_section_is_reported():
    missing, stale, dupes, indexed, _ = mod.audit("# Log\n\n## Decided\n\n### D1 \u2014 x\n")
    assert (missing, stale, dupes) == (None, None, None)
    assert indexed == 0


def test_question_entries_are_indexed_too():
    missing, _, _, _, total = mod.audit(build(["Q1", "Q2"]))
    assert missing == [] and total == 2


def test_fix_repairs_both_directions():
    """--fix appends the missing entry and drops the stale line."""
    text = build(["D1", "D2"], indexed=["D1", "D9"])
    fixed = mod.apply_fix(text, ["D2"], ["D9"])
    missing, stale, dupes, indexed, total = mod.audit(fixed)
    assert (missing, stale, dupes) == ([], [], [])
    assert (indexed, total) == (2, 2)
    assert "D9" not in fixed
    assert "- `D2` **Title D2**" in fixed


def test_real_log_is_in_step():
    """The shipped log must satisfy the same rule the gate enforces."""
    missing, stale, dupes, indexed, total = mod.audit(mod.LOG.read_text(encoding="utf-8"))
    assert (missing, stale, dupes) == ([], [], [])
    assert indexed == total > 0
