"""Run every documentation and repository check in one command.

Several checkers exist, each runnable alone, but there is no single command
that runs them all. That gap is easy to miss: a new checker gets added, nobody
notices the aggregate is incomplete, and the pre-commit hook quietly runs a
subset. This runner is the single entry point, and `tools/tests/` covers it.

Checks, in order of cost (cheapest first, so a fast failure surfaces early):
  1. tools/check-docs-map.py            - docs/README.md is an accurate map
  2. tools/check-text-encoding.py       - rejects UTF-16 / NUL / invalid UTF-8
  3. tools/check-subprocess-encoding.py - rejects text=True with no encoding=
  4. tools/validate-knowledge-tags.py   - frontmatter, tags, tracker, index
  5. tools/check-repo-layout.py         - generated output, duplicates, collisions
  6. tools/check-path-references.py     - stale repo-relative path references
  7. tools/report-nesting.py            - control-flow nesting vs baseline
  8. tools/docs-triage.py               - report-only untagged-doc grouping

Run:  python tools/check-all.py
Exit 0 = all pass, 1 = at least one failed.
"""

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (label, script, extra args). Ordered cheapest-first by measured runtime.
CHECKS = [
    ("docs map", "check-docs-map.py", []),
    ("text encoding", "check-text-encoding.py", []),
    ("subprocess encoding", "check-subprocess-encoding.py", []),
    ("knowledge tags", "validate-knowledge-tags.py", []),
    ("repo layout", "check-repo-layout.py", []),
    # Dangling repo-relative path references: the moved-file signature
    # (target gone, same basename still tracked elsewhere). The only
    # check that catches documentation pointing at files that moved.
    ("path references", "check-path-references.py", []),
    # Fails if a function's control-flow nesting got deeper than the committed
    # baseline. Deep nesting is a proxy for "hard to navigate", and this is the
    # only check that stops it coming back. Re-baseline deliberately:
    #   python tools/report-nesting.py --write-baseline \
    #       tools/nesting-baseline.json packages/backend/app
    ("nesting", "report-nesting.py",
     ["--baseline", "tools/nesting-baseline.json", "packages/backend/app"]),
    # Report-only: exits 0 by design, so it cannot fail the run. Kept here so
    # one command gives the whole picture, including the outside-library view.
    ("docs triage (report)", "docs-triage.py", []),
    # Report-only: regenerates output/docs-tracker.json (per-doc date, author,
    # tags) so doc provenance stays visible without manual bookkeeping.
    ("docs tracker (report)", "docs-tracker.py", []),
]


def run(label, script, args):
    path = os.path.join(ROOT, "tools", script)
    if not os.path.exists(path):
        print(f"MISSING: tools/{script}")
        return 1, 0.0, ""
    start = time.time()
    try:
        proc = subprocess.Popen([sys.executable, path] + args,
                                cwd=ROOT, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT)
        out, _ = proc.communicate()
        code = proc.returncode
    except OSError as e:
        out = (f"could not run: {e}").encode("utf-8", "replace")
        code = 1
    return code, time.time() - start, out.decode("utf-8", "replace")


def main():
    verbose = "-v" in sys.argv or "--verbose" in sys.argv
    failures = []
    print(f"Running {len(CHECKS):d} checks")
    print("=" * 68)

    for label, script, args in CHECKS:
        code, elapsed, out = run(label, script, args)
        status = "PASS" if code == 0 else "FAIL"
        print(f"[{status}] {label:<22} {elapsed * 1000:5.0f} ms  ({script})")
        if code != 0:
            failures.append(label)
            for line in out.split("\n"):
                if line.strip():
                    print(f"         {line}")
        elif verbose:
            for line in out.strip().split("\n")[-1:]:
                if line.strip():
                    print(f"         {line}")

    print("=" * 68)
    if failures:
        print("FAILED: {}".format(", ".join(failures)))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
