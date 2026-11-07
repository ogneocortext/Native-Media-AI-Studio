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
- **playwright (frontend E2E)** — `tests/ascii-reporter.ts` is registered in
  `playwright.config.ts`; supplies its own `pnpm test <file> -g "<title>"`
  repro lines and detects flaky tests via retries.

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
# RESULT: PASS | suite=pytest | total=N | passed=N | failed=N | errors=N | skipped=N | duration_s=X
# RESULT_JSON: {"verdict":"PASS","suite":"pytest", ...}   <- parse this, not the pipe line
```

Two machine-readable lines are emitted. Agents should parse
`# RESULT_JSON:` (strict JSON, unambiguous field names); the `# RESULT:`
pipe line is the human-scan-friendly summary of the same data.

When failures exist, `RESULT_JSON` also carries a `codes` histogram and
each failure row is prefixed `[E_XXX]`. Codes classify *what kind of fix*
is needed (single-sourced in `shared/cli-output-data.json`):

| Code | Class | Agent action |
|---|---|---|
| `E_ASSERT` | test-logic | Fix the assertion or code under test |
| `E_ERROR` | test-logic | Read the stack trace — likely a code bug |
| `E_TIMEOUT` | environment | Check service startup/load/timeout budgets |
| `E_ENV` | environment | Fix missing service/file/dep, not test logic |
| `E_SETUP` | test-infra | Inspect conftest/fixtures, not the test body |

Classification is keyword-based (`classify_failure` in `cli_output.py`,
`classifyFailure` in the TS formatter — same rules from the JSON).

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
`formatProgress`, `buildTestInsights`, `getAsciiArt`, plus
`summarizeTestResults` — the shared aggregator both frontend reporters use
to turn runner-native results into counts, failure rows, slowest tests,
and skip reasons identically.

The ASCII art and verdict strings are **not** duplicated: both languages
load `shared/cli-output-data.json` (Python via `json`, TypeScript via a
`with { type: 'json' }` import — the attribute is required because
Playwright loads reporters through native ESM). Edit the JSON to change
wording; it applies to every runner at once.

## Cross-platform notes

- Windows stdout is forced to UTF-8 (`errors="replace"`); `safe_print`
  falls back to ASCII if encoding still fails.
- Tables use plain `+ - |` characters; art uses block characters only.
- The formatter is cosmetic: all call sites wrap it so a formatter failure
  can never change a test run's exit code.
