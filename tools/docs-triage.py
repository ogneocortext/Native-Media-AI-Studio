"""Inventory markdown outside the knowledge library, grouped by disposition.

The tag checks in validate-knowledge-tags.py only see docs/knowledge-library/.
This reports the rest, classified so triage is a short list of decisions rather
than 65 filenames.

Why the grouping matters: docs/knowledge/ is **application content**, not a
shadow library. packages/backend/app/api/docs.py does
``DOCS_ROOT.rglob("*.md")`` over all of docs/, and packages/frontend's DocsPage
displays and searches each document's ``tags``. A document outside the vault with
no frontmatter therefore renders with an empty tag list and cannot be found by
tag search in the app - which is a user-visible gap, not just untidy metadata.

Report-only by design. This applies no checks, changes no files, and never
affects an exit code: the right disposition differs per document (migrate into
the library, keep as a separate doc set with its own conventions, or archive),
and that is a deliberate decision rather than a lint fix.

Run:  python tools/docs-triage.py
"""


import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gitutil import git_lines  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ordered by how much a decision is needed, most urgent first.
GROUPS = [
    ("app-served, no frontmatter",
     "Reachable from the frontend Docs page with an empty tag list: rendered, "
     "but not findable by tag search.",
     lambda r: (r.startswith("docs/knowledge/") and "notes" not in r
                and "scratch" not in r and "visual-storytelling" not in r)),
    ("production docs (storyboards, visual storytelling)",
     "Real production documents. Decide whether they belong in the library or "
     "stay as their own set.",
     lambda r: ("visual-storytelling" in r or "STORYBOARD" in r
                or "VISUAL_STORYTELLING" in r or "MINDFUL" in r)),
    ("project docs (guides, setup, api, architecture)",
     "Operator and reference docs. A different genre from the library and "
     "arguably fine untagged, since they are read by path, not browsed by tag.",
     lambda r: (r.startswith("docs/") and "/notes/" not in r
                and "/scratch/" not in r and "visual-storytelling" not in r
                and "STORYBOARD" not in r and not r.startswith("docs/knowledge/"))),
    ("notes and scratch",
     "Working material. Most likely archive candidates.",
     lambda r: "/notes/" in r or "/scratch/" in r or r.endswith("notes.md")),
    ("generated copies under packages/",
     "Mirrors of docs/ content, or per-package READMEs. Duplicated basenames "
     "here are usually deliberate; the divergent ones are worth a look.",
     lambda r: r.startswith("packages/")),
    ("root and tool READMEs",
     "Project-level entry points. Not library material.",
     lambda r: True),
]


def tracked_md():
    files = git_lines("ls-files", "*.md", cwd=ROOT)
    if not files:
        # run_git decodes rather than raises, so a non-checkout (or git
        # missing from PATH) surfaces as an empty listing instead of a
        # CalledProcessError. Empty is still an error here: this repo
        # tracks hundreds of .md files.
        print("error: not a git checkout, or git unavailable", file=sys.stderr)
        sys.exit(2)
    return files


def has_frontmatter(rel):
    with open(os.path.join(ROOT, rel.replace("/", os.sep)), "rb") as f:
        return f.read(3) == b"---"


def main():
    all_md = tracked_md()
    untagged = [r for r in all_md
                if not r.startswith("docs/knowledge-library/")
                and not has_frontmatter(r)]

    buckets = [[] for _ in GROUPS]
    for rel in untagged:
        for i, (_, _, match) in enumerate(GROUPS):
            if match(rel):
                buckets[i].append(rel)
                break
        else:
            buckets[-1].append(rel)

    print("Markdown outside docs/knowledge-library/ with no frontmatter")
    print("=" * 74)
    print(f"  {len(untagged):d} of {len(all_md):d} tracked .md files")
    print("")
    for (title, why, _), files in zip(GROUPS, buckets, strict=True):
        print(f"{title}  ({len(files):d})")
        print(f"    {why}")
        for f in files:
            print(f"      {f}")
        print("")

    print("Suggested next step: decide a rule per group rather than per file.")
    print("The app-served group is the one with a user-visible cost - start there.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
