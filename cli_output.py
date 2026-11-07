#!/usr/bin/env python3
"""
CLI Output Formatter - Cross-platform terminal output presentation.

Works on Windows (cp1252/UTF-8), Linux, and macOS. Produces ASCII-art test
summaries with actionable insights so both humans and AI agents can interpret
results without parsing raw pytest/vitest output.

Usage:
    from cli_output import CLIOutput, safe_print, format_duration
    cli = CLIOutput()
    safe_print(cli.format_test_results(passed=44, failed=0, skipped=2,
                                       duration_s=65.7, suite="pytest"))
"""

import json
import random
import sys
from dataclasses import dataclass
from enum import Enum
from typing import Any

# Force UTF-8 stdout on Windows
if sys.platform == "win32":
    try:
        import io
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        else:
            sys.stdout = io.TextIOWrapper(
                sys.stdout.buffer, encoding="utf-8", errors="replace"
            )
    except Exception:
        pass


class Status(Enum):
    SUCCESS = "[OK]"
    ERROR = "[ERR]"
    WARNING = "[WARN]"
    INFO = "[INFO]"
    RUNNING = "[RUN]"
    PENDING = "[...]"


@dataclass
class CLIResult:
    status: Status
    command: str
    output: str
    duration_ms: float
    exit_code: int = 0


# ---------------------------------------------------------------------------
# ASCII art library
# ---------------------------------------------------------------------------

ASCII_ART_LIBRARY = {
    "success": [
        r"""
   _____ _____ _____ _____ _____
  |_   _|_   _|_   _|_   _|_   _|
    | |   | |   | |   | |   | |
    | |   | |   | |   | |   | |
    |_|   |_|   |_|   |_|   |_|
""",
        r"""
  _______________________
 /_  __/ ____/ ___/_  __/
 / / / __/  \__ \ / /
 / / / /___ ___/ // /
/_/ /_____//____//_/
""",
        """
+------------------------------------------+
|        ALL TESTS PASSED!                 |
+------------------------------------------+
""",
    ],
    "failure": [
        """
+------------------------------------------+
|        SOME TESTS FAILED!                |
+------------------------------------------+
""",
        r"""
  _______________________
 /_  __/ ____/ ___/_  __/
 / / / __/  \__ \ / /
 / / / /___ ___/ // /
/_/ /_____//____//_/
""",
        """
!  !  !  !  !  !  !  !  !  !  !  !
!        SOME TESTS FAILED!         !
!  !  !  !  !  !  !  !  !  !  !  !
""",
    ],
    "warning": [
        """
+------------------------------------------+
|     WARNING: TESTS SKIPPED / FLAKY       |
+------------------------------------------+
""",
        """
?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
?      SOME TESTS WERE SKIPPED        ?
?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
""",
    ],
    "running": [
        """
+------------------------------------------+
|             TESTS RUNNING...             |
+------------------------------------------+
""",
    ],
}

# Deterministic, professional verdict lines — interpretation first, jokes last.
VERDICT_LINES = {
    "success": [
        "ALL TESTS PASSED — suite is green; safe to proceed.",
        "0 failures — nothing to fix; ship it.",
    ],
    "failure": [
        "FAILURES PRESENT — fix the failing tests before merging.",
        "One or more tests failed; see FAILURES section for repro commands.",
    ],
    "warning": [
        "PASSED WITH SKIPS — verify skipped tests are intentionally excluded.",
        "Suite passed but coverage is incomplete; skipped != verified.",
    ],
}


def get_ascii_art(category: str) -> str:
    art_list = ASCII_ART_LIBRARY.get(category, [""])
    return random.choice(art_list).strip("\n")


def get_verdict(category: str) -> str:
    lines = VERDICT_LINES.get(category, ["Test run complete."])
    return random.choice(lines)


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------


class CLIOutput:
    def __init__(self, width: int = 80):
        self.width = width

    def _hr(self, char: str = "-") -> str:
        return char * self.width

    def _section(self, title: str, char: str = "=") -> str:
        return f"\n{char * self.width}\n{title}\n{char * self.width}\n"

    def _status_icon(self, status: Status) -> str:
        return status.value

    def format_result(self, result: CLIResult) -> str:
        icon = self._status_icon(result.status)
        duration = (
            f"{result.duration_ms:.0f}ms"
            if result.duration_ms < 1000
            else f"{result.duration_ms / 1000:.2f}s"
        )
        exit_info = f" (exit {result.exit_code})" if result.exit_code != 0 else ""
        header = f"{icon} {result.command} {duration}{exit_info}"
        output = result.output.strip()
        if len(output) > 500:
            output = output[:500] + "\n... (truncated)"
        return f"{header}\n{self._hr('─')}\n{output}\n"

    def format_table(self, headers: list[str], rows: list[list[str]],
                     title: str = "") -> str:
        if not rows:
            return f"{self._section(title)}_No data_\n" if title else "_No data_\n"

        col_widths = [len(h) for h in headers]
        for row in rows:
            for i, cell in enumerate(row):
                if i < len(col_widths):
                    col_widths[i] = max(col_widths[i], len(str(cell)))

        def format_row(cells: list[str]) -> str:
            padded = [
                str(c)[: col_widths[i]].ljust(col_widths[i])
                for i, c in enumerate(cells)
            ]
            return "| " + " | ".join(padded) + " |"

        sep = "+" + "+".join("-" * (w + 2) for w in col_widths) + "+"

        lines = []
        if title:
            lines.append(self._section(title))
        lines.extend((sep, format_row(headers), sep))
        for row in rows:
            lines.append(format_row([str(c) for c in row]))
        lines.append(sep)
        return "\n".join(lines)

    def format_json(self, data: Any, title: str = "") -> str:
        output = json.dumps(data, indent=2, default=str, ensure_ascii=False)
        if title:
            return f"{self._section(title)}\n```json\n{output}\n```\n"
        return f"```json\n{output}\n```\n"

    def format_summary(self, results: list[CLIResult],
                       title: str = "Summary") -> str:
        if not results:
            return ""
        passed = sum(1 for r in results if r.status == Status.SUCCESS)
        failed = sum(1 for r in results if r.status == Status.ERROR)
        total = len(results)
        total_time = sum(r.duration_ms for r in results)

        lines = [
            self._section(title, "="),
            f"Total: {total} | [OK] {passed} | [ERR] {failed} | "
            f"{format_duration(total_time)}",
            "",
        ]
        status_counts: dict[Status, int] = {}
        for r in results:
            status_counts[r.status] = status_counts.get(r.status, 0) + 1
        for status, count in status_counts.items():
            lines.append(f"  {status.value} {status.name}: {count}")
        return "\n".join(lines)

    def format_kv_pairs(self, data: dict[str, Any], title: str = "") -> str:
        headers = ["Key", "Value"]
        rows = [[k, str(v)] for k, v in data.items()]
        return self.format_table(headers, rows, title)

    # ------------------------------------------------------------------
    # Test report — the flagship output for pytest / vitest / any runner
    # ------------------------------------------------------------------

    def format_test_results(
        self,
        passed: int,
        failed: int,
        skipped: int,
        duration_s: float,
        *,
        suite: str = "tests",
        total: int | None = None,
        errors: int = 0,
        failures: list[dict[str, Any]] | None = None,
        slowest: list[dict[str, Any]] | None = None,
        insights: list[str] | None = None,
        meta: dict[str, str] | None = None,
        rerun_hint: str = "pytest",
    ) -> str:
        """Professional ASCII test report with actionable insights.

        failures: [{"name": nodeid-or-title, "file": path, "line": int|None,
                    "message": one-line error}]
        slowest:  [{"name": ..., "duration_s": float}]
        insights: human/agent-readable action items, printed verbatim.
        meta:     optional {"commit": ..., "branch": ...} provenance line.
        """
        total = total if total is not None else passed + failed + skipped + errors
        bad = failed + errors

        if bad > 0:
            category = "failure"
        elif skipped > 0:
            category = "warning"
        else:
            category = "success"

        lines: list[str] = [
            self._section(f"{suite.upper()} RESULTS", "="),
            "",
            get_ascii_art(category),
            "",
            f"  VERDICT: {get_verdict(category)}",
            "",
        ]

        # Counts table
        def pct(n: int) -> str:
            return f"{100.0 * n / total:.1f}%" if total else "0%"

        rows = [
            ["[OK]  Passed", str(passed), pct(passed)],
            ["[ERR] Failed", str(failed), pct(failed)],
        ]
        if errors:
            rows.append(["[ERR] Errors", str(errors), pct(errors)])
        if skipped:
            rows.append(["[...] Skipped", str(skipped), pct(skipped)])
        rows.append(["TOTAL", str(total), "100%"])
        lines.extend((
            self.format_table(["Status", "Count", "Share"], rows),
            "",
        ))

        # Duration + provenance
        dur_bits = [f"Duration: {format_duration(duration_s * 1000)}"]
        if meta:
            if meta.get("commit"):
                dur_bits.append(f"commit {meta['commit']}")
            if meta.get("branch"):
                dur_bits.append(f"branch {meta['branch']}")
        lines.extend(("  " + " | ".join(dur_bits), ""))

        # Failures — the actionable core
        if failures:
            lines.append(self._section("FAILURES — reproduce individually", "-"))
            fail_rows = []
            for f in failures[:20]:
                name = str(f.get("name", "?"))
                loc = name
                if f.get("file"):
                    loc = f"{f['file']}" + (
                        f":{f['line']}" if f.get("line") else ""
                    )
                msg = str(f.get("message", "")).splitlines()
                msg = msg[0][:80] if msg else ""
                fail_rows.append([name.split("::")[-1][:40], loc[:40], msg])
            lines.extend((
                self.format_table(
                    ["Test", "Location", "Error (first line)"], fail_rows),
                "",
                "  Reproduce one failure:",
            ))
            for f in failures[:5]:
                nid = str(f.get("name", ""))
                if nid:
                    lines.append(f"    {rerun_hint} {nid} -x")
            if len(failures) > 5:
                lines.append(f"    ... and {len(failures) - 5} more")
            lines.append("")

        # Slowest tests (skip the section when everything is sub-50ms noise)
        if slowest and max(
            float(s.get("duration_s", 0)) for s in slowest
        ) >= 0.05:
            lines.append(self._section("SLOWEST TESTS", "-"))
            slow_rows = [
                [str(s.get("name", "?"))[:50],
                 f"{float(s.get('duration_s', 0)):.2f}s"]
                for s in slowest[:10]
            ]
            lines.extend((
                self.format_table(["Test", "Duration"], slow_rows),
                "",
            ))

        # Insights — interpretation + next actions
        if insights:
            lines.append(self._section("INSIGHTS & NEXT STEPS", "-"))
            for item in insights:
                lines.append(f"  * {item}")
            lines.append("")

        # Agent-facing one-liner: unambiguous machine-readable verdict
        agent_bits = [
            f"RESULT: {'FAIL' if bad else ('PASS_WITH_SKIPS' if skipped else 'PASS')}",
            f"suite={suite}",
            f"total={total}",
            f"passed={passed}",
            f"failed={bad}",
            f"skipped={skipped}",
            f"duration_s={duration_s:.1f}",
        ]
        lines.append("# " + " | ".join(agent_bits))

        return "\n".join(lines)

    def format_test_suite_start(self, suite_name: str,
                                test_count: int = 0) -> str:
        lines = [self._section(f"TEST SUITE: {suite_name}", "="), "",
                 get_ascii_art("running"), ""]
        if test_count:
            lines.append(f"  Running {test_count} tests...")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def safe_print(text: str) -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))


def format_progress(current: int, total: int, prefix: str = "",
                    width: int = 40) -> str:
    if total == 0:
        return ""
    pct = current / total
    filled = int(width * pct)
    bar = "#" * filled + "-" * (width - filled)
    return f"{prefix} [{bar}] {pct * 100:.1f}% ({current}/{total})"


def format_duration(ms: float) -> str:
    if ms < 1000:
        return f"{ms:.0f}ms"
    if ms < 60000:
        return f"{ms / 1000:.1f}s"
    if ms < 3600000:
        minutes = int(ms / 60000)
        seconds = (ms % 60000) / 1000
        return f"{minutes}m {seconds:.0f}s"
    hours = int(ms / 3600000)
    minutes = int((ms % 3600000) / 60000)
    return f"{hours}h {minutes}m"


def format_command_help(commands: dict[str, str],
                        title: str = "Commands") -> str:
    cli = CLIOutput()
    return cli.format_table(
        ["Command", "Description"],
        [[cmd, desc] for cmd, desc in commands.items()],
        title,
    )


def build_test_insights(*, failed: int, skipped: int, errors: int,
                        slowest: list[dict[str, Any]] | None = None,
                        suite: str = "tests") -> list[str]:
    """Default actionable insights derived purely from counts/perf data.

    Callers may append or replace these with domain-specific items.
    """
    insights: list[str] = []
    bad = failed + errors
    if bad:
        insights.extend((
            f"{bad} test(s) failed — treat the run as RED. Fix failures "
            f"before merging; each failure above has a ready-made "
            f"reproduce command.",
            "If a failure looks environmental (missing service, GPU, "
            "network), confirm with a single-test rerun before assuming "
            "a code regression.",
        ))
    if skipped:
        insights.append(
            f"{skipped} test(s) skipped — skipped tests provide NO "
            f"coverage. If the skip is intentional (marker, missing "
            f"optional dep), document why; otherwise investigate."
        )
    if slowest and float(slowest[0].get("duration_s", 0)) >= 1.0:
        top = slowest[0]
        insights.append(
            f"Slowest test: {top.get('name', '?')} at "
            f"{float(top.get('duration_s', 0)):.2f}s — if the suite feels "
            f"slow, optimize fixtures/mocks here first."
        )
    if not insights and not bad and not skipped:
        insights.append(
            "All green — no action needed. Safe to commit or proceed to "
            "the next task."
        )
    return insights


if __name__ == "__main__":
    cli = CLIOutput()

    safe_print(cli.format_test_results(
        passed=44, failed=0, skipped=2, duration_s=65.7,
        suite="pytest",
        slowest=[{"name": "test_audio_analysis.py::test_long_track",
                  "duration_s": 12.4}],
        meta={"commit": "abc1234", "branch": "main"},
    ))
    safe_print("")
    safe_print(cli.format_test_results(
        passed=10, failed=2, skipped=0, duration_s=8.2,
        suite="pytest",
        failures=[
            {"name": "tests/test_audio.py::test_tempo_detect",
             "file": "tests/test_audio.py", "line": 142,
             "message": "AssertionError: expected 120.0, got 98.3"},
            {"name": "tests/test_queue.py::test_dead_letter",
             "file": "tests/test_queue.py", "line": 88,
             "message": "RuntimeError: queue not draining"},
        ],
        insights=build_test_insights(failed=2, skipped=0, errors=0),
        rerun_hint="python -m pytest",
    ))
