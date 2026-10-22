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
   9. tools/docs-tracker.py              - report-only doc provenance
  10. tools/report-path-orphans.py       - report-only dangling references
  11. tools/check-hooks-installed.py     - report-only git hooks state

Run:  python tools/check-all.py     (-v also runs the report-only checks)
Exit 0 = all pass, 1 = at least one failed.
"""

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (label, script, extra args, report_only). Ordered cheapest-first by measured
# runtime. Report-only checkers exit 0 by design (they cannot fail), so they
# cost seconds on every gate run while adding nothing to the verdict; they are
# skipped unless the runner passes -v, at which point they are still labelled
# [SKIP] rather than [PASS] so nobody mistakes "not run" for "ran clean".
CHECKS = [
    ("docs map", "check-docs-map.py", [], False),
    ("text encoding", "check-text-encoding.py", [], False),
    ("subprocess encoding", "check-subprocess-encoding.py", [], False),
    ("knowledge tags", "validate-knowledge-tags.py", [], False),
    ("repo layout", "check-repo-layout.py", [], False),
    # Dangling repo-relative path references: the moved-file signature
    # (target gone, same basename still tracked elsewhere). The only
    # check that catches documentation pointing at files that moved.
    ("path references", "check-path-references.py", [], False),
    # Fails if a function's control-flow nesting got deeper than the committed
    # baseline. Deep nesting is a proxy for "hard to navigate", and this is the
    # only check that stops it coming back. Re-baseline deliberately:
    #   python tools/report-nesting.py --write-baseline \
    #       tools/nesting-baseline.json packages/backend/app
    ("nesting", "report-nesting.py",
     ["--baseline", "tools/nesting-baseline.json", "packages/backend/app"],
     False),
    # Report-only: exits 0 by design, so it cannot fail the run. Kept here so
    # one command gives the whole picture, including the outside-library view.
    ("docs triage (report)", "docs-triage.py", [], True),
    # Report-only: regenerates output/docs-tracker.json (per-doc date, author,
    # tags) so doc provenance stays visible without manual bookkeeping.
    ("docs tracker (report)", "docs-tracker.py", [], True),
    # Report-only: dangling references in operational docs whose targets
    # exist nowhere in the tree. The gate above (check-path-references)
    # covers the moved-file signature; this covers the residue it
    # deliberately cannot decide -- deletion orphans and never-existed
    # names in the docs agents actually follow.
    ("path orphans (report)", "report-path-orphans.py", [], True),
    # Report-only: .git/hooks is not tracked, so a fresh clone silently runs
    # the whole guard suite (D10: hooks ARE the CI here) on nothing. Report,
    # do not fail: scratch clones used for hook E2E tests legitimately have
    # none. The 2026-10-22 trailerless-commit escape happened on a clone
    # missing commit-msg; run this directly to see the live state.
    ("hooks installed (report)", "check-hooks-installed.py", [], True),
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
    active = [c for c in CHECKS if verbose or not c[3]]
    print(f"Running {len(active):d}/{len(CHECKS):d} checks"
          + ("" if verbose else " (report-only ones need -v)"))
    print("=" * 68)

    for label, script, args, report_only in CHECKS:
        if report_only and not verbose:
            print(f"[SKIP] {label:<22}     0 ms  ({script})  report-only")
            continue
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
