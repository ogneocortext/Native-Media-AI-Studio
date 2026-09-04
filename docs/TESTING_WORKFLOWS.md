# Automated Testing Workflows

This document describes the three new testing systems added to Native Media AI Studio that go beyond simple pass/fail validation and actively hunt for hidden issues.

---

## 1. AI Test Generation (`scripts/ai-test-generator.py`)

**Purpose:** Uses your local Ollama coding model to inspect backend source files, identify untested branches and edge cases, and generate pytest tests for uncovered paths.

**How it works:**
- Parses Python AST to find functions with conditional branches (`if/elif/else`, `for`, `while`, `try/except`)
- Builds a structured prompt describing the module, existing tests, and branch points
- Sends the prompt to Ollama (`qwen2.5:7b` by default, configurable via `--model` or `OLLAMA_TEST_MODEL`)
- Extracts Python code from the response and writes it to `tests/test_ai_generated_<module>.py`
- Optionally runs `pytest` on the generated file to verify it passes (`--verify`)

**Usage:**

```bash
# Dry-run: see what would be generated without writing files
python scripts/ai-test-generator.py --dry-run

# Generate tests for a specific file
python scripts/ai-test-generator.py --path app/api/jobs.py --verify

# Generate tests for all high-value backend modules
python scripts/ai-test-generator.py --all --verify

# Use a different Ollama model
python scripts/ai-test-generator.py --all --model qwen2.5:14b
```

**Output:** New test files in `packages/backend/tests/` named `test_ai_generated_<module>.py`.

**Caveats:**
- Requires Ollama running locally with the specified model pulled
- Generated tests may need manual tweaking to match exact API contracts
- Use `--verify` to catch generated tests that don't compile/pass before committing

---

## 2. Visual Regression (`tests/visual/run_visual_tests.py`)

**Purpose:** Captures screenshots of every frontend page and uses a local Ollama vision model to detect UI breakage, missing components, and rendering regressions that unit tests miss.

**How it works:**
- Launches headless Chromium via Playwright
- Navigates to each route defined in `PAGES` (Dashboard, Queue, Health, ImageGeneration, etc.)
- Waits for React hydration + lazy-loaded chunks
- Captures a viewport screenshot per page
- Runs a pixel-diff against the baseline screenshot (if one exists)
- Sends the screenshot to Ollama vision (`gemma4:e2b-it-qat` by default) with a structured QA prompt
- Parses the vision model's JSON response for `status: pass|fail|warn` and `issues[]`
- Writes a timestamped JSON report to `tests/visual/reports/`

**Usage:**

```bash
# First run: capture baselines (do this when UI is known-good)
python tests/visual/run_visual_tests.py --update-baselines

# Subsequent runs: compare against baselines + vision analysis
python tests/visual/run_visual_tests.py

# Use a different vision model
python tests/visual/run_visual_tests.py --model qwen3-vl:4b
```

**Output:**
- `tests/visual/baselines/<PageName>.png` — reference screenshots
- `tests/visual/reports/visual_report_<timestamp>.json` — per-page results with pixel-diff percentages and vision model findings

**Interpreting results:**
- `pixel_diff < 2%` → pass
- `2% ≤ pixel_diff < 10%` → warn (check diff image)
- `pixel_diff ≥ 10%` → fail (major visual change)
- Vision model `status: fail` with `issues[]` → inspect the listed UI problems

**Caveats:**
- Requires Playwright + Chromium (`playwright install chromium`)
- Requires Ollama vision model running
- First run will fail until baselines are captured with `--update-baselines`
- Pixel diff is sensitive to font rendering differences between runs; use vision analysis as the primary signal

---

## 3. Backend Integration Harness (`tests/integration/run_integration_tests.py`)

**Purpose:** Exercises real end-to-end flows against the FastAPI app that unit tests can't cover — job lifecycle, SSE streaming under load, health endpoint resilience, WebSocket fallback, concurrent job creation, and queue stats accuracy.

**How it works:**
- Uses `httpx.AsyncClient` with `ASGITransport` to hit the app in-process (no network)
- `temp_db` fixture swaps the SQLite DB to a throwaway file per test and resets the global queue manager
- Tests create jobs via the REST API (not direct DB writes) to exercise the real contract
- Mock adapters (`SlowAdapter`, `MockAdapter`) simulate slow/flaky external services
- Concurrent tests use `asyncio.gather` and `threading` to surface race conditions

**Current test classes:**

| Class | What it tests |
|-------|---------------|
| `TestJobLifecycleIntegration` | Create, retrieve, cancel, retry, delete, filter, clear jobs via API |
| `TestQueueEventDrivenIntegration` | Event-driven processor wake via `asyncio.Event` |
| `TestSSEStreamingIntegration` | Concurrent SSE subscribers + capacity rejection |
| `TestHealthResilienceIntegration` | Health timeout behavior with slow/flaky adapters |
| `TestWebSocketIntegration` | WS HTTP fallback 426 + root endpoint |
| `TestConcurrentJobCreation` | 20 concurrent enqueues — no duplicate IDs |
| `TestSSEKeepaliveIntegration` | Connect/disconnect lifecycle |
| `TestQueueStatsAccuracy` | Stats reflect DB state after mutations |
| `TestAdapterThreadSafety` | Concurrent `_ensure_init` from 5 threads |

**Usage:**

```bash
# Run all integration tests
pytest tests/integration/run_integration_tests.py -v

# Run a specific class
pytest tests/integration/run_integration_tests.py::TestJobLifecycleIntegration -v

# Run with coverage
pytest tests/integration/run_integration_tests.py --cov=app --cov-report=term-missing
```

**Output:** 20 passing integration tests (as of current run). Failures indicate real behavioral regressions.

---

## 4. AI Test Failure Analyzer (`scripts/ai-test-analyzer.py`)

**Purpose:** When pytest fails, sends the failure output to Ollama and gets a structured diagnosis with root cause, affected code, suggested fix, and prevention strategy.

**Usage:**

```bash
# Run pytest and analyze the last failure
python scripts/ai-test-analyzer.py --last-failure

# Analyze a saved pytest output file
python scripts/ai-test-analyzer.py --pytest-output /path/to/pytest_output.txt

# Use a different model
python scripts/ai-test-analyzer.py --last-failure --model qwen2.5:14b
```

**Output:** Text analysis printed to stdout with:
1. ROOT CAUSE
2. AFFECTED CODE
3. SUGGESTED FIX
4. PREVENTION

---

## Quick Start: Full Automated Testing Pipeline

```bash
# 1. Unit tests (existing)
cd packages/backend
pytest tests/ -v --tb=short

# 2. Integration tests (new)
pytest tests/integration/run_integration_tests.py -v --tb=short

# 3. AI-generated tests (new)
python ../../scripts/ai-test-generator.py --all --verify

# 4. Visual regression (new, requires frontend server on :5173)
python ../../tests/visual/run_visual_tests.py

# 5. If any test fails, analyze with AI
python ../../scripts/ai-test-analyzer.py --last-failure
```

---

## Requirements

- **Python:** 3.10+ (project standard)
- **Ollama:** Running locally with models pulled:
  - `qwen2.5:7b` (test generation + failure analysis)
  - `gemma4:e2b-it-qat` or `qwen3-vl:4b` (visual regression)
- **Playwright:** `pip install playwright && playwright install chromium`
- **Backend:** Running or testable via ASGI transport (no external services needed for most tests)
