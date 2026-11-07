#!/usr/bin/env python3
"""Self-metrics trend report for test runs and quality gates.

Every ASCII test report (pytest conftest hook, vitest reporter, playwright
reporter, test_insights.py) appends one JSON line to
``tools/self-metrics/results.jsonl``; every gate run appends per-gate
records to ``tools/self-metrics/gates.jsonl``. This tool closes the loop:
it aggregates those streams into verdict/error-code/duration trends so
agents can see whether the suite is getting healthier or rotting — instead
of each run being a disposable snapshot.

Usage:
    python tools/report-self-metrics.py              # last 30 days
    python tools/report-self-metrics.py --days 7     # past week only
    python tools/report-self-metrics.py --suite vitest
    python tools/report-self-metrics.py --json       # machine-readable
    python tools/report-self-metrics.py --gates-only # skip test runs

Exit 0 always — this is a report, not a gate.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from cli_output import CLIOutput, safe_print  # noqa: E402

METRICS_DIR = ROOT / "tools" / "self-metrics"
RESULTS_JSONL = METRICS_DIR / "results.jsonl"
GATES_JSONL = METRICS_DIR / "gates.jsonl"


def _load_jsonl(path: Path) -> list[dict]:
    """Read a JSONL file, skipping malformed lines. Empty list if absent."""
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _parse_ts(row: dict) -> datetime | None:
    ts = row.get("ts")
    if not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def _within(row: dict, cutoff: datetime | None) -> bool:
    if cutoff is None:
        return True
    ts = _parse_ts(row)
    return ts is not None and ts >= cutoff


def test_run_trends(rows: list[dict], cutoff: datetime | None) -> dict:
    """Aggregate test-run records into per-suite stats."""
    by_suite: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if _within(r, cutoff) and r.get("suite"):
            by_suite[str(r["suite"])].append(r)

    suites = {}
    code_hist: Counter = Counter()
    verdict_hist: Counter = Counter()
    for suite, runs in sorted(by_suite.items()):
        runs_sorted = sorted(runs, key=lambda r: str(r.get("ts", "")))
        verdicts = [str(r.get("verdict", "?")) for r in runs_sorted]
        fails = sum(1 for v in verdicts if v == "FAIL")
        durs = [float(r.get("duration_s", 0)) for r in runs_sorted]
        for r in runs_sorted:
            verdict_hist[str(r.get("verdict", "?"))] += 1
            for code, n in (r.get("codes") or {}).items():
                code_hist[code] += int(n)
        # Fail streak: consecutive FAILs at the tail of the series.
        streak = 0
        for v in reversed(verdicts):
            if v == "FAIL":
                streak += 1
            else:
                break
        last5 = "".join({"PASS": ".", "PASS_WITH_SKIPS": "s",
                         "FAIL": "F"}.get(v, "?") for v in verdicts[-5:])
        suites[suite] = {
            "runs": len(runs_sorted),
            "pass_rate": round(100 * (len(runs_sorted) - fails)
                               / len(runs_sorted), 1),
            "fail_streak": streak,
            "avg_duration_s": round(sum(durs) / len(durs), 1),
            "last5": last5,
            "last_verdict": verdicts[-1],
            "last_ts": runs_sorted[-1].get("ts"),
        }
    return {"suites": suites, "code_hist": dict(code_hist),
            "verdict_hist": dict(verdict_hist)}


def gate_trends(rows: list[dict], cutoff: datetime | None) -> dict:
    """Aggregate per-gate records into stability/duration stats."""
    by_gate: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if _within(r, cutoff) and r.get("name"):
            by_gate[str(r["name"])].append(r)

    gates = {}
    for name, runs in sorted(by_gate.items()):
        runs_sorted = sorted(runs, key=lambda r: str(r.get("ts", "")))
        statuses = [str(r.get("status", "?")) for r in runs_sorted]
        fails = sum(1 for s in statuses if s != "PASS")
        durs = [float(r.get("elapsed", 0)) for r in runs_sorted
                if r.get("status") == "PASS"]
        med = median(durs) if durs else 0.0
        last5 = "".join({"PASS": ".", "FAIL": "F", "TIME": "T"}.get(s, "?")
                        for s in statuses[-5:])
        gates[name] = {
            "runs": len(runs_sorted),
            "pass_rate": round(100 * (len(runs_sorted) - fails)
                               / len(runs_sorted), 1),
            "median_duration_s": round(med, 1),
            "last5": last5,
            "last_status": statuses[-1],
            "last_ts": runs_sorted[-1].get("ts"),
        }
    return {"gates": gates}


def _fmt_report(test_data: dict, gate_data: dict, days: int | None) -> str:
    cli = CLIOutput()
    lines = [cli._section("SELF-METRICS TRENDS", "="), ""]
    window = f"last {days} days" if days else "all recorded history"
    lines.extend((f"  Window: {window}", ""))

    suites = test_data.get("suites", {})
    if suites:
        lines.append(cli._section("TEST RUNS BY SUITE", "-"))
        rows = []
        for name, s in suites.items():
            rows.append([
                name,
                str(s["runs"]),
                f"{s['pass_rate']}%",
                f"{s['avg_duration_s']}s",
                s["last5"] or "-",
                s["last_verdict"],
            ])
        lines.extend((cli.format_table(
            ["Suite", "Runs", "Pass%", "Avg dur",
             "Last5 (.=pass s=skips F=fail)", "Latest"], rows), ""))
        # Insights: fail streaks and chronic redness are the actionable part.
        streaks = {n: s["fail_streak"] for n, s in suites.items()
                   if s["fail_streak"] > 0}
        if streaks:
            lines.extend(("  ! Active fail streaks: " + ", ".join(
                f"{n} ({k} runs)" for n, k in streaks.items()), ""))
    else:
        lines.extend((
            "  No test-run records yet - run pytest/vitest/playwright "
            "and they will accumulate here.",
            "",
        ))

    codes = test_data.get("code_hist", {})
    if codes:
        lines.append(cli._section("ERROR CODE HISTOGRAM", "-"))
        code_rows = [[code, str(n)] for code, n in
                     sorted(codes.items(), key=lambda kv: -kv[1])]
        lines.extend((cli.format_table(["Code", "Failures"], code_rows), ""))

    gates = gate_data.get("gates", {})
    if gates:
        lines.append(cli._section("GATE STABILITY", "-"))
        gate_rows = []
        for name, g in gates.items():
            flag = " <-- investigate" if g["pass_rate"] < 90 else ""
            gate_rows.append([
                name, str(g["runs"]), f"{g['pass_rate']}%",
                f"{g['median_duration_s']}s", g["last5"] or "-",
                g["last_status"] + flag,
            ])
        lines.extend((cli.format_table(
            ["Gate", "Runs", "Pass%", "Median dur", "Last5", "Latest"],
            gate_rows), ""))
    elif not suites:
        lines.extend((
            "  No gate records yet - gates record automatically when "
            "tools/gates runs.",
            "",
        ))

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Trend report over self-metrics JSONL streams.")
    parser.add_argument("--days", type=int, default=30,
                        help="only include records from the last N days "
                             "(default 30; 0 = all history)")
    parser.add_argument("--suite", help="filter test runs to one suite name")
    parser.add_argument("--gates-only", action="store_true",
                        help="skip the test-run sections")
    parser.add_argument("--tests-only", action="store_true",
                        help="skip the gate sections")
    parser.add_argument("--json", action="store_true",
                        help="emit the aggregated data as JSON")
    args = parser.parse_args()

    cutoff = None
    if args.days:
        cutoff = datetime.now(UTC) - timedelta(days=args.days)

    test_rows = [] if args.gates_only else _load_jsonl(RESULTS_JSONL)
    if args.suite:
        test_rows = [r for r in test_rows if r.get("suite") == args.suite]
    gate_rows = [] if args.tests_only else _load_jsonl(GATES_JSONL)

    test_data = test_run_trends(test_rows, cutoff)
    gate_data = gate_trends(gate_rows, cutoff)

    if args.json:
        print(json.dumps({"test": test_data, "gates": gate_data},
                         indent=2))
        return 0

    safe_print(_fmt_report(test_data, gate_data,
                           args.days or None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
