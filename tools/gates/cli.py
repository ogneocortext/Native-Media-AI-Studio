"""Command-line parser and main entry point for the gate runner."""

import argparse
import json
import os
import sys
import tempfile
import threading
import time as _time
from pathlib import Path

from .executor import _materialize, run_lane
from .gates import gates
from .interpreter import _describe, candidate_list, read_cache, resolve_pnpm, resolve_python
from .selection import changed_from_git, gate_relevant, select_gates


def _build_parser() -> argparse.ArgumentParser:
    """Command-line parser.

    argparse rather than hand-rolled index scanning: a bare ``--only`` used to
    select nothing and then run *every* gate, ``--help`` ran the whole suite,
    and a typo'd flag was ignored - each of which reads as success to whoever
    ran it. argparse makes a missing value an error and prints usage on -h.
    """
    p = argparse.ArgumentParser(
        prog="run-gates.py",
        description="Run every quality gate for the repository in one command "
                    "(cheapest first, two concurrent lanes: python | node). "
                    "Exit 0 = all selected gates passed.",
    )
    p.add_argument("--only", nargs="+", metavar="GATE",
                   help="run only these gates; a substring matches "
                        "(e.g. 'py' matches both pytest and tools-pytest)")
    p.add_argument("--group", nargs="+", metavar="GROUP",
                   help="run a predefined group of gates: 'py', 'node', 'fast', "
                        "'full' (all except e2e)")
    p.add_argument("--e2e", action="store_true",
                   help="include the opt-in Playwright gate")
    p.add_argument("--list", action="store_true",
                   help="list the gates and the resolved tools, then exit "
                        "(uses the cached interpreter; forces no probes)")
    p.add_argument("--which-python", action="store_true",
                   help="explain the interpreter choice with FULL re-"
                        "verification of every candidate, then exit")
    p.add_argument("--json", action="store_true",
                   help="machine-readable JSON report")
    p.add_argument("--save-json", metavar="PATH",
                   help="write the JSON report to a file")
    p.add_argument("--fail-fast", action="store_true",
                   help="stop at the first failing gate (the other lane "
                        "finishes its current gate, then stops)")
    p.add_argument("--retry", type=int, default=0, metavar="N",
                   help="retry each failed gate up to N extra times")
    p.add_argument("--fix", action="store_true",
                   help="auto-fix where supported: ruff --fix, eslint --fix "
                        "(corrections are applied in place before reporting)")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="also show the last lines of output for passing gates "
                        "(and run check-all.py's report-only doc checks)")
    p.add_argument("--no-stream", action="store_true",
                   help="buffer each gate's output and print it at the end "
                        "instead of streaming it line by line")
    p.add_argument("--serial", action="store_true",
                   help="run the lanes one after the other instead of in "
                        "parallel (deterministic output, slower)")
    p.add_argument("--changed", nargs="*", metavar="FILE",
                   help="only run gates that could be affected by these "
                        "changed file names (e.g. the unpushed commit batch). "
                        "Gates that cannot be affected are reported [SKIP]. "
                        "Without this, every selected gate runs as before. "
                        "When the list is long, paths are written to a temp "
                        "file and passed via --changed-from-file to avoid the "
                        "OS command-line length limit.")
    return p


def _prepare_console() -> None:
    """Reconfigure stdout/stderr to UTF-8 with replace errors.

    The console's code page on this machine is cp1252, which cannot encode
    the U+2713 check mark that vitest prints for every passing test. Without
    this, streaming the unit gate dies with UnicodeEncodeError the moment
    the first test passes - the exact failure the streaming feature exists
    to prevent. errors="replace" degrades an unencodable character instead
    of aborting the run.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass  # not a real file object (e.g. captured by a test harness)


def main(argv=None) -> int:
    # Prepare console encoding before anything else.
    _prepare_console()

    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.retry < 0:
        parser.error("--retry must be >= 0")

    if args.list:
        # Fast: uses the TTL cache when it is warm, but never probes. This is
        # the command an agent runs to check spelling of gate names, so it
        # must cost nothing.
        pnpm = resolve_pnpm()
        cached, ts = read_cache()
        if cached and Path(cached).exists():
            py_label = (f"{_describe(cached)} (cached, TTL-warm)"
                        if ts else f"{_describe(cached)} (cached, pre-TTL schema)")
        elif cached:
            py_label = f"{cached} (cached, missing on disk)"
        else:
            py_label = "(not yet verified; probed when a python gate runs)"
        all_gates = gates()
        pnpm_resolved = resolve_pnpm()
        for g in all_gates:
            argv_shown = _materialize(g.argv, "(python)", pnpm_resolved)
            tag = f"  [lane:{g.lane}]" + ("  (opt-in)" if g.optional else "")
            print(f"{g.name:<12} {' '.join(argv_shown[1:])}{tag}")
        print()
        print(f"python (cache): {py_label}")
        print(f"pnpm:           {pnpm_resolved}")
        return 0

    if args.which_python:
        # Diagnostic: show every candidate and why it was or was not chosen.
        # Full verification is forced (allow_cached=False): a diagnostic that
        # prints a TTL-warm cached value without probing would be reporting
        # yesterday's answer.
        probed = {}
        chosen = resolve_python(quiet=True, collect=probed, allow_cached=False)
        print(f"chosen: {_describe(chosen)}")
        print(f"pnpm:   {resolve_pnpm()}")
        print(f"override ($NMA_PYTHON): {os.environ.get('NMA_PYTHON') or '(unset)'}")
        print()
        print("candidates, in preference order:")
        for cand in candidate_list():
            ok = probed.get(cand)
            mark = "SELECTED" if cand == chosen else \
                   ("ok" if ok else "rejected")
            print(f"  {mark:<8} {_describe(cand)}")
        return 0

    all_gates = gates(fix=args.fix, verbose=args.verbose)

    # --group expands to a predefined set of gates, applied before --only.
    _groups = {
        "py": ["docs", "ruff", "arch", "routes", "pytest", "tools-pytest"],
        "node": ["type", "lint", "unit", "build"],
        "fast": ["docs", "ruff", "arch", "routes", "type", "lint", "unit"],
        "full": ["docs", "ruff", "arch", "routes", "type", "lint", "unit",
                 "pytest", "tools-pytest", "build"],
    }
    if args.group:
        expanded = []
        for gname in args.group:
            if gname not in _groups:
                available = ", ".join(sorted(_groups))
                print(f"unknown group '{gname}'; available: {available}")
                return 1
            expanded.extend(_groups[gname])
        # Dedupe while preserving order
        seen = set()
        expanded = [g for g in expanded if not (g in seen or seen.add(g))]
        args.only = expanded

    selected = select_gates(all_gates, args.only, include_e2e=args.e2e)
    if not selected:
        available = ", ".join(g.name for g in all_gates)
        print(f"no gate matched {args.only}; available: {available}")
        return 1

    # Changed-file scoping: skip gates that cannot be affected by the named
    # files. Pass --changed through to check-all.py (docs gate) so it scopes
    # its own internal checks too.
    changed_arg = args.changed
    if changed_arg is None:
        changed = None  # --changed not given: run every gate
    elif len(changed_arg) == 0:
        changed = changed_from_git()  # bare --changed: auto-detect from git
    else:
        changed = set(changed_arg)

    run_selected = []
    skipped = []
    changed_temp_files: list[str] = []
    for g in selected:
        if changed is not None:
            is_relevant, reason = gate_relevant(g, changed)
            if not is_relevant:
                skipped.append({"gate": g, "reason": reason})
                continue
        run_selected.append(g)
        if g.name in ("docs", "glsl") and changed:
            # check-all.py / check-glsl-compile.py scope via --changed.
            # Write changed paths to a temp file and pass it via
            # --changed-from-file instead of as individual args: Windows'
            # CreateProcessW command-line limit (32,767 chars) is easily
            # exceeded by a large unpushed batch (e.g. a vendored package
            # removal lists hundreds of deleted files).
            fd, tmp_path = tempfile.mkstemp(
                prefix="nma-changed-", suffix=".txt", text=True)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                for fpath in sorted(changed):
                    f.write(fpath + "\n")
            g.argv = g.argv + ["--changed-from-file", tmp_path]
            changed_temp_files.append(tmp_path)

    if not run_selected:
        available = ", ".join(g.name for g in all_gates)
        print(f"no gate matched {args.only}; available: {available}")
        print("  (all selected gates skipped by --changed: "
              + ", ".join(s["gate"].name for s in skipped) + ")")
        for tmp_path in changed_temp_files:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        return 0

    # In JSON mode stdout must stay pure JSON, so the streamed lines AND the
    # per-gate status lines go to stderr instead.
    json_mode = bool(args.json or args.save_json)
    stream_to = sys.stderr if json_mode else None

    py_gates = [g for g in run_selected if g.lane == "py"]
    node_gates = [g for g in run_selected if g.lane == "node"]
    lane_count = (1 if py_gates else 0) + (1 if node_gates else 0)

    # Build a structured summary for AI agents
    summary = {
        "total_gates": len(selected),
        "ran_gates": len(run_selected),
        "skipped_gates": len(skipped),
        "lanes": lane_count,
        "changed_files": sorted(changed) if changed else None,
        "environment": {
            "python_version": None,  # filled after resolution
            "pnpm_version": None,
        },
    }

    print(f"Running {len(run_selected):d} gate(s) on {lane_count} lane(s): "
          + ", ".join(g.name for g in run_selected))
    if skipped:
        print("  skipped by --changed: " + ", ".join(s["gate"].name for s in skipped))
        summary["skipped_details"] = [
            {"gate": s["gate"].name, "reason": s["reason"]}
            for s in skipped
        ]
    print("=" * 68)
    sys.stdout.flush()

    # Lane-scoped tool resolution, applied ONLY when a lane that needs the
    # tool is about to run — so `--only unit` costs no interpreter probing
    # and `--only ruff` costs no pnpm lookup.
    setup_start = _time.time()
    python = pnpm = None
    if py_gates:
        t0 = _time.time()
        python = resolve_python()
        # Setup time is reported, not hidden: the probe cost used to precede
        # gate 1 and sat outside every timing number, which is exactly why a
        # run felt slower than its summary claimed.
        from .interpreter import _describe as _describe_py
        print(f"[setup] interpreter: {_describe_py(python)} "
              f"({_time.time() - t0:.1f} s)")
        # Extract Python version for summary
        try:
            import subprocess
            result = subprocess.run(
                [python, "-c", "import sys;print('.'.join(map(str,sys.version_info[:3])))"],
                capture_output=True, text=True, encoding="utf-8", timeout=5
            )
            if result.returncode == 0:
                summary["environment"]["python_version"] = result.stdout.strip()
        except Exception:
            pass
    else:
        print("[setup] no python gate selected - interpreter verification "
              "skipped")
    if node_gates:
        pnpm = resolve_pnpm()
        # Get pnpm version for summary
        try:
            import subprocess
            result = subprocess.run(
                [pnpm, "--version"],
                capture_output=True, text=True, encoding="utf-8", timeout=5
            )
            if result.returncode == 0:
                summary["environment"]["pnpm_version"] = result.stdout.strip()
        except Exception:
            pass
    setup_seconds = _time.time() - setup_start
    sys.stdout.flush()

    shared = {
        "stop": threading.Event(),
        "print_lock": threading.Lock(),
        "results": {},
        "failed_output": {},
        "stream": not args.no_stream,
        "out_file": stream_to,
        "fail_fast": bool(args.fail_fast),
        "retry": args.retry,
        "verbose": args.verbose,
    }
    threads = []
    if args.serial:
        # Serial mode: both lanes in this thread, one after the other, so
        # output order is fully deterministic and identical to the old
        # single-lane runner.
        for lane_name, lane_gates_ in (("py", py_gates), ("node", node_gates)):
            if lane_gates_:
                run_lane(lane_name, lane_gates_, python, pnpm, shared)
    else:
        if py_gates:
            threads.append(threading.Thread(
                target=run_lane, args=("py", py_gates, python, pnpm, shared)))
        if node_gates:
            threads.append(threading.Thread(
                target=run_lane, args=("node", node_gates, python, pnpm,
                                       shared)))
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    results = [shared["results"].get(g.name, {
        "name": g.name, "status": "SKIP", "elapsed": 0.0,
        "attempts": 0, "lane": g.lane,
    }) for g in selected]
    failed = [r["name"] for r in results
              if r["status"] not in ("PASS", "SKIP")]

    # Build final summary for AI agents
    final_summary = {
        "gates_run": [r["name"] for r in results if r["status"] == "PASS"],
        "gates_failed": failed,
        "gates_skipped": [s["gate"].name for s in skipped],
        "total_time_seconds": round(sum(r["elapsed"] for r in results), 1),
        "setup_time_seconds": round(setup_seconds, 1),
        "environment": summary["environment"],
        "changed_files_count": len(changed) if changed else 0,
    }

    if args.json or args.save_json:
        # Enhanced JSON report for AI agents
        report = {
            "results": results,
            "failed": failed,
            "setup_seconds": round(setup_seconds, 1),
            "total_seconds": round(sum(r["elapsed"] for r in results), 1),
            "all_passed": len(failed) == 0,
            "summary": summary,
            "final_summary": final_summary,
            "recommendations": [],
        }
        if shared["failed_output"]:
            report["failed_output"] = shared["failed_output"]

        # Add recommendations for common failure patterns
        if failed:
            recommendations = []
            for name in failed:
                gate = next((g for g in selected if g.name == name), None)
                if gate:
                    # Provide gate-specific recommendations
                    if name == "docs":
                        recommendations.append(f"{name}: Run 'python tools/check-all.py -v' for detailed docs check output")
                    elif name == "ruff":
                        recommendations.append(f"{name}: Run 'python -m ruff check . --fix' to auto-fix lint issues")
                    elif name == "type":
                        recommendations.append(f"{name}: Run 'pnpm --filter=native-media-ai-studio-frontend type-check' for detailed TypeScript errors")
                    elif name == "lint":
                        recommendations.append(f"{name}: Run 'pnpm --filter=native-media-ai-studio-frontend lint' for detailed ESLint errors")
                    elif name == "unit":
                        recommendations.append(f"{name}: Run 'pnpm --filter=native-media-ai-studio-frontend test' for detailed test failures")
                    elif name == "pytest":
                        recommendations.append(f"{name}: Run 'cd packages/backend && python -m pytest -v' for detailed test output")
                    elif name == "build":
                        recommendations.append(f"{name}: Run 'pnpm --filter=native-media-ai-studio-frontend build' for detailed build errors")
                    else:
                        recommendations.append(f"{name}: Check the gate output above for specific error messages")
            report["recommendations"] = recommendations

        if args.save_json:
            try:
                Path(args.save_json).write_text(
                    json.dumps(report, indent=2), encoding="utf-8")
            except OSError as e:
                print(f"could not write {args.save_json}: {e}", file=sys.stderr)
        if args.json:
            print(json.dumps(report, indent=2))
    else:
        print("=" * 68)
        summary_line = "  ".join(f"{r['name']} {r['status']}" for r in results)
        print(summary_line)
        total = sum(r["elapsed"] for r in results)
        print(f"{total:.1f} s gates + {setup_seconds:.1f} s setup")
        if failed:
            print("FAILED: {}".format(", ".join(failed)))
            print("\n--- Recommendations ---")
            for name in failed:
                gate = next((g for g in selected if g.name == name), None)
                if gate:
                    if name == "docs":
                        print(f"  {name}: Run 'python tools/check-all.py -v' for detailed docs check output")
                    elif name == "ruff":
                        print(f"  {name}: Run 'python -m ruff check . --fix' to auto-fix lint issues")
                    elif name == "type":
                        print(f"  {name}: Run 'pnpm --filter=native-media-ai-studio-frontend type-check' for detailed TypeScript errors")
                    elif name == "lint":
                        print(f"  {name}: Run 'pnpm --filter=native-media-ai-studio-frontend lint' for detailed ESLint errors")
                    elif name == "unit":
                        print(f"  {name}: Run 'pnpm --filter=native-media-ai-studio-frontend test' for detailed test failures")
                    elif name == "pytest":
                        print(f"  {name}: Run 'cd packages/backend && python -m pytest -v' for detailed test output")
                    elif name == "build":
                        print(f"  {name}: Run 'pnpm --filter=native-media-ai-studio-frontend build' for detailed build errors")
                    else:
                        print(f"  {name}: Check the gate output above for specific error messages")
        else:
            print("all gates passed")

        # Add final summary for AI agents
        print("\n--- Summary for AI Agents ---")
        print(f"Gates passed: {len(final_summary['gates_run'])}")
        print(f"Gates failed: {len(final_summary['gates_failed'])}")
        if final_summary["gates_failed"]:
            print(f"Failed gates: {', '.join(final_summary['gates_failed'])}")
        print(f"Gates skipped: {len(final_summary['gates_skipped'])}")
        if final_summary["gates_skipped"]:
            print(f"Skipped gates: {', '.join(final_summary['gates_skipped'])}")
        print(f"Total time: {final_summary['total_time_seconds']}s")
        print(f"Setup time: {final_summary['setup_time_seconds']}s")
        if final_summary["environment"].get("python_version"):
            print(f"Python: {final_summary['environment']['python_version']}")
        if final_summary["environment"].get("pnpm_version"):
            print(f"pnpm: {final_summary['environment']['pnpm_version']}")
        if final_summary["changed_files_count"] > 0:
            print(f"Changed files: {final_summary['changed_files_count']}")

    # Clean up temp files used for --changed-from-file.
    for tmp_path in changed_temp_files:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
