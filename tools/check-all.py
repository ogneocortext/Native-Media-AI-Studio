"""Run every documentation and repository check in one command.

Several checkers exist, each runnable alone, but there is no single command
that runs them all. That gap is easy to miss: a new checker gets added, nobody
notices the aggregate is incomplete, and the pre-commit hook quietly runs a
subset. This runner is the single entry point, and `tools/tests/` covers it.

Checks, in order of cost (cheapest first, so a fast failure surfaces early):
  1. tools/check-docs-map.py            - docs/README.md is an accurate map
  2. tools/check-text-encoding.py       - rejects UTF-16 / NUL / invalid UTF-8
  3. tools/check-subprocess-encoding.py - rejects text=True with no encoding=
  4. tools/check-banned-chars.py        - control/invisible/mojibake chars
  5. tools/validate-knowledge-tags.py   - frontmatter, tags, tracker, index
  6. tools/check-consistency.py         - R1-R4 task-block/library consistency
  7. tools/check-skill-mirrors.py       - .kilo/.devin/.agents == .claude/skills
  8. tools/check-repo-layout.py         - generated output, duplicates, collisions
  9. tools/check-path-references.py     - stale repo-relative path references
 10. tools/report-nesting.py            - control-flow nesting vs baseline
 11. tools/check-db-integrity.py        - studio.db + newest backup quick_check
 12. tools/check-secrets.py             - credential patterns in tracked files
 13. tools/check-staged-hygiene.py      - scratch files / over-broad staging
 14. tools/docs-triage.py               - report-only untagged-doc grouping
 15. tools/docs-tracker.py              - report-only doc provenance
 16. tools/report-path-orphans.py       - report-only dangling references
 17. tools/check-hooks-installed.py     - report-only git hooks state

Run:  python tools/check-all.py     (-v also runs the report-only checks)
      python tools/check-all.py --changed docs/x.md packages/backend/app/y.py
Exit 0 = all pass, 1 = at least one failed.

Output is streamed line by line while each check runs, so a long check
(check-subprocess-encoding walking thousands of Python files, or
validate-knowledge-tags parsing the whole library) shows progress instead
of disappearing for its entire duration.

Concurrency: active checks are independent, read-only file scans, so they run
concurrently (ThreadPoolExecutor) and wall time is bounded by the slowest
check instead of the sum. Pass --serial to force the old one-at-a-time order
(useful for debugging a flaky check).

Changed-file scoping: pass --changed <file> ... to run only checks that could
be affected by the named files (e.g. the unpushed commit batch). Checks that
cannot be affected are reported [SKIP]. With no --changed, every check runs
as before.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (label, script, extra args, report_only). Ordered cheapest-first by measured
# runtime. Report-only checkers exit 0 by design (they cannot fail), so they
# cost seconds on every gate run while adding nothing to the verdict; they are
# skipped unless the runner passes -v, at which point they are still labelled
# [SKIP] rather than [PASS] so nobody mistakes "not run" for "ran clean".
CHECKS = [
    ("docs map", "check-docs-map.py", [], False),
    ("text encoding", "check-text-encoding.py", [], False),
    ("subprocess encoding", "check-subprocess-encoding.py", [], False),
    # Control/invisible/mojibake characters: C-escape accidents (BEL for 'a',
    # BS for 'b', ESC for 'e') and cp1252 mojibake have both shipped to main.
    ("banned chars", "check-banned-chars.py", [], False),
    ("knowledge tags", "validate-knowledge-tags.py", [], False),
    # R1-R4 organizational consistency (task-block format, one category per
    # doc, meta-file class). Hard gate since the 2026-11-06 census reached
    # zero - drift now fails instead of accumulating (T-LIB-06).
    ("consistency", "check-consistency.py", [], False),
    # Canonical .claude/skills vs the .kilo/.devin/.agents mirrors: a skill
    # that exists in only one mirror means agents on different tools load
    # different instructions. Mirrors are gitignored, so drift is invisible
    # to git — this is the only check that sees it.
    ("skill mirrors", "check-skill-mirrors.py", [], False),
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
    # DB + secrets + staging guards: cheap scans for failure modes the
    # content checks cannot see (corrupt backups, leaked keys, scratch
    # files swept up by `git add -A`).
    ("db integrity", "check-db-integrity.py", [], False),
    ("secrets scan", "check-secrets.py", [], False),
    ("staged hygiene", "check-staged-hygiene.py", [], False),
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

# Per-check timeouts in seconds. None means the checker's own default.
CHECK_TIMEOUTS = {
    "check-subprocess-encoding.py": 60,
    "check-banned-chars.py": 30,
    "validate-knowledge-tags.py": 60,
    "check-repo-layout.py": 60,
    "check-path-references.py": 120,
    "report-nesting.py": 60,
    "check-db-integrity.py": 90,  # WAL read can stall behind the live backend under gate concurrency
    "check-secrets.py": 60,
    "check-staged-hygiene.py": 30,
    "check-skill-mirrors.py": 30,
}

# Max concurrent check workers. Checks are independent read-only scans, so
# more workers just bounds wall time by the slowest check.
_MAX_WORKERS = 6


def _kill_tree(proc):
    """Kill the child and anything it spawned."""
    try:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass
    try:
        proc.kill()
    except OSError:
        pass


def run(label, script, args, *, timeout=None, stream=True, out_file=None):
    """Run one checker with line-by-line streaming output.

    Like run-gates.py's run_gate, this uses a reader thread + queue so a
    silent child never blocks the deadline, and the process tree is killed
    on timeout instead of orphaned.

    When `stream` is False the output is captured and returned (not printed
    live), which lets concurrent checks print their output atomically once
    they complete instead of interleaving line-by-line.
    """
    path = os.path.join(ROOT, "tools", script)
    if not os.path.exists(path):
        print(f"MISSING: tools/{script}")
        return 1, 0.0, ""
    argv = [sys.executable, path] + args
    start = time.time()
    try:
        proc = subprocess.Popen(
            argv, cwd=str(ROOT),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
    except OSError as e:
        out = (f"could not run: {e}").encode("utf-8", "replace")
        return 1, time.time() - start, out.decode("utf-8", "replace")

    stop_event = threading.Event()
    hb_thread = None
    if stream and timeout:
        hb_thread = threading.Thread(
            target=_heartbeat, args=(stop_event, label), daemon=True
        )
        hb_thread.start()

    chunks: queue.Queue[bytes | None] = queue.Queue()

    def _reader() -> None:
        try:
            assert proc.stdout is not None
            for raw in iter(proc.stdout.readline, b""):
                chunks.put(raw)
        finally:
            chunks.put(None)

    reader = threading.Thread(target=_reader, daemon=True)
    reader.start()

    dest = out_file or sys.stdout
    deadline = start + timeout if timeout else None
    lines: list[str] = []
    code = 1
    timed_out = False

    while True:
        remaining = None
        if deadline:
            remaining = deadline - time.time()
            if remaining <= 0:
                timed_out = True
                break
        try:
            raw = chunks.get(timeout=min(remaining, 1.0) if remaining else 1.0)
        except queue.Empty:
            continue
        if raw is None:
            break
        text = raw.decode("utf-8", "replace").rstrip("\r\n")
        if not text:
            continue
        lines.append(text)
        if stream:
            print(f"[{label}] {text}", file=dest, flush=True)

    if timed_out:
        _kill_tree(proc)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        stop_event.set()
        if hb_thread is not None:
            hb_thread.join(timeout=1)
        body = "\n".join(lines)
        msg = (
            f"TIMED OUT after {timeout:d}s. Check: {script}\n"
            "  If this repeats, investigate the check itself rather than "
            "re-running blindly."
        )
        return 124, time.time() - start, (body + "\n" + msg) if body else msg

    try:
        code = proc.wait(timeout=max(1.0, deadline - time.time()) if deadline else None)
    except subprocess.TimeoutExpired:
        _kill_tree(proc)
        code = 124

    stop_event.set()
    if hb_thread is not None:
        hb_thread.join(timeout=1)
    return code, time.time() - start, "\n".join(lines)


def _heartbeat(stop_event: threading.Event, label: str, interval: float = 10.0):
    """Print a heartbeat every `interval` seconds while a check runs."""
    start = time.time()
    while not stop_event.is_set():
        stop_event.wait(interval)
        if not stop_event.is_set():
            elapsed = int(time.time() - start)
            print(f"[{label} {elapsed}s] still running...",
                  file=sys.stderr, flush=True)


def _check_relevant(script: str, changed: set[str]) -> bool:
    """Return True if `script` can be affected by the changed file names.

    All checks are read-only scans of the whole tree, so a check cannot
    introduce a new violation in a file it did not touch. With no changed
    files known, every check runs (conservative default).
    """
    if not changed:
        return True
    py_changed = any(f.endswith(".py") for f in changed)
    text_changed = any(
        f.lower().endswith(
            (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".md",
             ".json", ".yaml", ".yml", ".toml", ".ps1", ".sh", ".css",
             ".html", ".txt", ".cfg", ".ini"))
        for f in changed
    )
    docs_changed = any(
        f.startswith(("docs/", "config/")) or f == "AGENTS.md"
        for f in changed
    )
    kl_changed = any(f.startswith("docs/knowledge-library/") for f in changed)
    backend_app_changed = any(
        f.startswith("packages/backend/app/") and f.endswith(".py")
        for f in changed
    )

    if script == "check-subprocess-encoding.py":
        # A locale-decoding bug can only be introduced in a Python file.
        return py_changed
    if script == "check-banned-chars.py":
        # Any tracked text file can carry a bad character.
        return text_changed
    if script == "validate-knowledge-tags.py":
        # Cross-refs span the library, but only knowledge-library edits can
        # break them.
        return kl_changed
    if script == "check-docs-map.py":
        return docs_changed
    if script == "check-consistency.py":
        # Scopes are docs/plans/tasks/ + docs/knowledge-library/ - both
        # under docs/.
        return docs_changed
    if script == "check-skill-mirrors.py":
        # Only canonical skills or the checker itself can change the verdict;
        # mirrors are gitignored so they never appear in a changed list.
        return any(
            f.startswith((".claude/skills/", "tools/check-skill-mirrors.py"))
            for f in changed
        )
    if script == "check-text-encoding.py":
        return text_changed
    if script == "check-repo-layout.py":
        # Structural (duplicates, collisions, ignores) - keep running when
        # the docs gate is selected; cheap enough and catches layout drift.
        return True
    if script == "check-path-references.py":
        # Catches moved-file signatures; keep running when docs gate on.
        return True
    if script == "report-nesting.py":
        # Control-flow nesting of backend app code only.
        return backend_app_changed
    if script in ("docs-triage.py", "docs-tracker.py",
                  "report-path-orphans.py", "check-hooks-installed.py"):
        # Report-only: only worth running when docs were touched.
        return docs_changed
    return True


def _run_one(c, timeout_map=CHECK_TIMEOUTS):
    """Run one check tuple; return (label, script, code, elapsed, out)."""
    label, script, args_list, _report_only = c
    timeout = timeout_map.get(script)
    return label, script, *run(
        label, script, args_list, timeout=timeout,
        stream=False, out_file=None,
    )


def main():
    # Child check output is decoded utf-8/replace upstream, so it can carry
    # U+FFFD; on a cp1252 console printing that raises UnicodeEncodeError
    # and kills the whole run. Degrade glyphs instead of crashing.
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(errors="replace")
        except (OSError, ValueError):
            pass
    parser = argparse.ArgumentParser(
        description="Run every documentation and repository check in one command "
                    "(cheapest first, output streamed per check). "
                    "Exit 0 = all selected checks passed.")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="also run the report-only doc checks")
    parser.add_argument("--json", action="store_true",
                        help="machine-readable JSON report")
    parser.add_argument("--save-json", metavar="PATH",
                        help="write the JSON report to a file")
    parser.add_argument("--no-stream", action="store_true",
                        help="buffer each check's output and print it at the end "
                             "instead of streaming it line by line")
    parser.add_argument("--changed", nargs="*", metavar="FILE",
                        help="only run checks that could be affected by these "
                             "changed file names (default: run every check)")
    parser.add_argument("--changed-from-file", metavar="PATH",
                        help="read changed file names from a file, one per "
                             "line (used instead of --changed when the list "
                             "is long enough to exceed the OS command-line "
                             "limit); can be combined with --changed")
    parser.add_argument("--serial", action="store_true",
                        help="run checks sequentially instead of concurrently")
    args = parser.parse_args()

    verbose = args.verbose
    changed = set(args.changed) if args.changed else None
    if args.changed_from_file:
        try:
            from_file = {
                line.strip() for line in Path(args.changed_from_file).read_text(
                    encoding="utf-8").splitlines() if line.strip()
            }
        except OSError as e:
            print(f"could not read --changed-from-file {args.changed_from_file}: {e}", file=sys.stderr)
            return 1
        changed = from_file if changed is None else changed | from_file
    serial = args.serial

    # Categorise every check: run, skip as report-only, or skip due to
    # --changed irrelevance.
    run_checks = []
    skip_report_only = []
    skip_changed = []
    for c in CHECKS:
        label, script, args_list, report_only = c
        if report_only and not verbose:
            skip_report_only.append(c)
            continue
        if changed is not None and not _check_relevant(script, changed):
            skip_changed.append(c)
            continue
        run_checks.append(c)

    running = len(run_checks)
    total = len(CHECKS)
    parts = [f"Running {running:d}/{total:d} checks"]
    if skip_changed:
        parts.append(f"({len(skip_changed):d} skipped by --changed)")
    if not verbose and skip_report_only:
        parts.append(f"({len(skip_report_only):d} report-only, use -v)")
    print(" ".join(parts))
    print("=" * 68)
    sys.stdout.flush()

    json_mode = bool(args.json or args.save_json)

    failures = []
    print_lock = threading.Lock()

    def report(label, script, code, elapsed, out, why=""):
        status = "PASS" if code == 0 else "FAIL"
        tag = f"  {why}" if why else ""
        with print_lock:
            print(f"[{status}] {label:<22} {elapsed * 1000:5.0f} ms  ({script}){tag}")
            sys.stdout.flush()
            if code != 0:
                failures.append(label)
                for line in out.split("\n"):
                    if line.strip():
                        print(f"         {line}")
            elif verbose:
                for line in out.strip().split("\n")[-1:]:
                    if line.strip():
                        print(f"         {line}")

    if serial or running <= 1:
        for c in run_checks:
            label, script, code, elapsed, out = _run_one(c)
            report(label, script, code, elapsed, out)
    else:
        workers = min(running, _MAX_WORKERS)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_run_one, c): c for c in run_checks}
            for fut in as_completed(futures):
                label, script, code, elapsed, out = fut.result()
                report(label, script, code, elapsed, out)

    # Skipped checks, for transparency.
    for c in skip_report_only:
        label, script, _, _ = c
        with print_lock:
            print(f"[SKIP] {label:<22}     0 ms  ({script})  report-only")
    for c in skip_changed:
        label, script, _, _ = c
        with print_lock:
            print(f"[SKIP] {label:<22}     0 ms  ({script})  not affected by --changed")

    print("=" * 68)
    if failures:
        print("FAILED: {}".format(", ".join(failures)))
        if json_mode or args.save_json:
            report = {
                "results": [{"name": label, "status": "FAIL"}
                            for label in failures],
                "failed": failures,
                "all_passed": False,
            }
            if args.save_json:
                try:
                    Path(args.save_json).write_text(
                        json.dumps(report, indent=2), encoding="utf-8")
                except OSError as e:
                    print(f"could not write {args.save_json}: {e}",
                          file=sys.stderr)
            if args.json:
                print(json.dumps(report, indent=2))
        return 1
    print("all checks passed")
    if json_mode or args.save_json:
        report = {"results": [], "failed": [], "all_passed": True}
        if args.save_json:
            try:
                Path(args.save_json).write_text(
                    json.dumps(report, indent=2), encoding="utf-8")
            except OSError as e:
                print(f"could not write {args.save_json}: {e}",
                      file=sys.stderr)
        if args.json:
            print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
