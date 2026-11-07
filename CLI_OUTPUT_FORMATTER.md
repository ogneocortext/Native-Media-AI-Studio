# CLI Output Formatter — Cross-Platform Terminal Output

## Overview

`cli_output.py` is the canonical terminal formatter for the repo. It produces
ASCII-art test reports with actionable insights so both humans and AI agents
can interpret test results without parsing raw runner output.

Every test surface prints the same report shape:

- **pytest (backend)** — `packages/backend/tests/conftest.py` →
  `pytest_terminal_summary` prints the report at the end of *every* run,
  including `pytest`, `pytest -k ...`, and `tools/test_insights.py`.
- **`tools/test_insights.py`** — appends the same report (stdout) after its
  feature-breakdown analysis; richer insights (flaky tests, trends,
  per-feature pass rates) are included. `--no-ascii` disables it.
- **vitest (frontend)** — `AsciiArtVitestReporter`
  (`packages/frontend/src/utils/ascii-test-reporter.ts`) is registered in
  `vitest.config.ts` alongside `verbose`.

## Report anatomy

```
================ TEST RESULTS ================
        <ASCII art: PASSED / FAILED / WARN>
  VERDICT: <one-line interpretation>

+---------+-------+-------+   counts + share %
  Duration: 1m 6s | commit abc1234 | branch main

--- FAILURES — reproduce individually ---
| Test | Location | Error (first line) |
  python -m pytest tests/test_x.py::test_y -x     <- ready-made repro commands

--- SLOWEST TESTS ---                        (hidden when all < 50ms)
--- INSIGHTS & NEXT STEPS ---                <- actionable bullets
# RESULT: PASS | suite=pytest | total=N | passed=N | failed=N | skipped=N | duration_s=X
```

The final `# RESULT:` line is the machine-readable verdict for agents:
`PASS`, `PASS_WITH_SKIPS`, or `FAIL`, plus counts and duration.

## Python API

```python
from cli_output import (
    CLIOutput, CLIResult, Status,
    build_test_insights, format_duration, format_progress,
    format_command_help, safe_print,
)

cli = CLIOutput()

# Generic command result
safe_print(cli.format_result(CLIResult(
    status=Status.SUCCESS, command="pytest tests/ -q",
    output="44 passed", duration_ms=65720, exit_code=0)))

# Tables / KV / JSON
safe_print(cli.format_table(["Endpoint", "Status"], [["/api/health", "[OK]"]], "API"))
safe_print(cli.format_kv_pairs({"backend_url": "http://127.0.0.1:8000"}, "Config"))
safe_print(cli.format_json({"ok": True}, "Response"))

# Test report (what the runners call)
safe_print(cli.format_test_results(
    passed=44, failed=0, skipped=2, duration_s=65.7,
    suite="pytest backend",
    failures=[{"name": "tests/test_x.py::test_y", "file": "tests/test_x.py",
               "line": 42, "message": "AssertionError: ..."}],
    slowest=[{"name": "tests/test_x.py::test_slow", "duration_s": 12.4}],
    insights=build_test_insights(failed=0, skipped=2, errors=0),
    meta={"commit": "abc1234", "branch": "main"},
    rerun_hint="python -m pytest",
))

safe_print(format_progress(42, 100, "Processing"))
safe_print(format_duration(65720))   # "1m 6s"
```

## TypeScript API (frontend mirror)

`packages/frontend/src/utils/cli-output-formatter.ts` exports the same
surface: `CLIOutput`, `Status`, `CLIResult`, `formatDuration`,
`formatProgress`, `buildTestInsights`, `getAsciiArt`. The reporter lives in
`ascii-test-reporter.ts`.

## Cross-platform notes

- Windows stdout is forced to UTF-8 (`errors="replace"`); `safe_print`
  falls back to ASCII if encoding still fails.
- Tables use plain `+ - |` characters; art uses block characters only.
- The formatter is cosmetic: all call sites wrap it so a formatter failure
  can never change a test run's exit code.
