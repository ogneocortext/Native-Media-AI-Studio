# ruff: noqa: N999
"""Check that the decision log's Quick index stays in step with its entries.

The log is ~190 KB, so AGENTS.md and the log header both point agents at the
98-line Quick index instead of the whole file. That only works while the index
lists every entry — and nothing kept it honest: a decision added without its
line silently makes the index incomplete, which is the exact failure the index
exists to prevent.

Checks:
  - a `## Quick index` section exists;
  - every `### D<n>` / `### Q<n>` entry in the body has a matching
    ``- `D<n>` `` line inside the index (missing);
  - every index line names an entry that still exists in the body (stale);
  - no id is indexed twice.

Run:  python tools/check-decision-index.py [--fix]
Exit 0 = index in step, 1 = drift (unless --fix repaired it).
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "docs" / "architecture" / "decision-log.md"

INDEX_HEADING = "## Quick index"
ENTRY_RE = re.compile(r"^###\s+([DQ]\d+)\s+[\u2014-]", re.MULTILINE)
INDEX_LINE_RE = re.compile(
    r"^- `([DQ]\d+)`\s+\*\*(.+?)\*\*(?:\s+\(([^)]*)\))?\s+\u2014\s+(.+)$",
    re.MULTILINE,
)


def split_sections(text):
    """Return (index_text, body_text) — the index block and everything else."""
    lines = text.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines) if line.strip() == INDEX_HEADING), None)
    if start is None:
        return None, text
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    return "".join(lines[start:end]), "".join(lines[:start] + lines[end:])


def first_sentence(blob, limit=150):
    blob = re.sub(r"\s+", " ", blob).strip()
    if not blob:
        return ""
    sentence = re.split(r"(?<=[.!?])\s+", blob)[0].strip()
    if len(sentence) > limit:
        sentence = sentence[: limit - 1].rsplit(" ", 1)[0] + "\u2026"
    return sentence


def entry_summary(text, ident):
    """The first sentence of an entry's **Decision:** (or **Status:** for Q)."""
    lines = text.splitlines()
    head = re.compile(rf"^###\s+{re.escape(ident)}\s+[\u2014-]")
    start = next((i for i, line in enumerate(lines) if head.match(line)), None)
    if start is None:
        return ""
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("### "):
            break
        keys = ("**Decision:**", "**Status:**") if ident.startswith("Q") else ("**Decision:**",)
        for key in keys:
            if key in lines[j]:
                buf = [lines[j].split(key, 1)[1]]
                k = j + 1
                while (
                    k < len(lines) and lines[k].strip() and not lines[k].lstrip().startswith("- **")
                ):
                    buf.append(lines[k])
                    k += 1
                return first_sentence(" ".join(buf))
    return ""


def audit(text):
    """Return (missing, stale, dupes, indexed_count, body_count) for a log.

    ``missing/stale/dupes`` are None when there is no Quick index section at
    all. Pure, so the gate's logic is testable without the real file — see
    tools/tests/unit/test_decision_index.py.
    """
    index_text, body_text = split_sections(text)
    if index_text is None:
        return None, None, None, 0, 0

    body_ids = ENTRY_RE.findall(body_text)
    index_ids = [m[0] for m in INDEX_LINE_RE.findall(index_text)]
    index_set = set(index_ids)

    missing = [i for i in dict.fromkeys(body_ids) if i not in index_set]
    stale = sorted(index_set - set(body_ids))
    dupes = sorted({i for i in index_set if index_ids.count(i) > 1})
    return missing, stale, dupes, len(index_set), len(set(body_ids))


def apply_fix(text, missing, stale):
    """Return the log with missing entries appended and stale lines dropped."""
    index_text, body_text = split_sections(text)
    if index_text is None:
        return text
    lines = index_text.splitlines()
    for ident in missing:
        m = re.search(rf"^###\s+{re.escape(ident)}\s+[\u2014-]\s*(.*)$", body_text, re.MULTILINE)
        title = re.sub(r"\s*\([^()]*\)\s*$", "", m.group(1)).strip() if m else ident
        summary = entry_summary(body_text, ident) or "(see entry)"
        lines.append(f"- `{ident}` **{title}** \u2014 {summary}")
    kept = [
        line
        for line in lines
        if not (INDEX_LINE_RE.match(line) and INDEX_LINE_RE.match(line).group(1) in stale)
    ]
    return text.replace(index_text, "\n".join(kept) + "\n", 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix", action="store_true", help="append missing lines, drop stale ones")
    args = ap.parse_args()

    if not LOG.exists():
        print(f"FAIL: {LOG} not found")
        return 1

    text = LOG.read_text(encoding="utf-8")
    index_text, body_text = split_sections(text)
    if index_text is None:
        print(f"FAIL: no '{INDEX_HEADING}' section in {LOG.relative_to(ROOT)}")
        return 1

    missing, stale, dupes, indexed, _ = audit(text)

    problems = []
    if missing:
        problems.append(f"{len(missing)} entries missing from the index: {', '.join(missing)}")
    if stale:
        problems.append(f"{len(stale)} index lines name no such entry: {', '.join(stale)}")
    if dupes:
        problems.append(f"indexed twice: {', '.join(dupes)}")

    if problems and args.fix:
        LOG.write_text(apply_fix(text, missing, stale), encoding="utf-8", newline="\n")
        print(f"FIXED: added {len(missing)}, dropped {len(stale)}")
        return 0

    if problems:
        for problem in problems:
            print(f"FAIL: {problem}")
        print(f"      {LOG.relative_to(ROOT)}: add the line or fix the entry, or run with --fix")
        return 1

    body_total = len(set(ENTRY_RE.findall(body_text)))
    print(f"PASS: index in step ({indexed} entries indexed, {body_total} in the body)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
