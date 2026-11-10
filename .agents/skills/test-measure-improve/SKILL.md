---
name: test-measure-improve
description: >-
  The test → measure → improve loop for backend/frontend features. Use when
  implementing or fixing an API endpoint, service, or UI feature and you need
  to verify it works end-to-end through the browser or HTTP, measure the actual
  results, and iterate on improvements based on what you observe. Every
  iteration ends with a re-test that proves the change worked.
---

# Test → Measure → Improve

> [!warning] Measure before you name a defect. Read the code to form a
> hypothesis, then run something that could disprove it. A claim from reading
> alone is not a finding. A clean measurement is worth as much as a confirming
> one.

> [!warning] Never assert a fix worked without re-running the test. If the
> re-test doesn't change the measured result, the fix is wrong — not the test.

This is the closed loop for feature verification work. It exists because code
correctness cannot be verified by reading source — only by exercising the real
code path through the browser or HTTP and measuring the actual output. Every
iteration must end with a re-test that proves the change worked.

## When to use

- Implementing a new backend API endpoint or service
- Fixing a bug in an existing endpoint, service, or frontend component
- Verifying a frontend feature works end-to-end through the browser
- Any task where the acceptance criterion is a measurable value (loudness,
  latency, status code, frame count, etc.)
- After making changes that could affect a previously-working feature
(regression check)

## The Loop

### 1. CAPTURE the real runtime state

Drive the app to the state you want to evaluate, then exercise the real code
path. For backend APIs, call the endpoint via `curl` or Python `urllib`. For
frontend features, use Playwright to navigate and interact.

```python
# Python — call a backend endpoint
import urllib.request, json
url = "http://127.0.0.1:8000/api/audio/master/measure/Track.m4a"
with urllib.request.urlopen(url, timeout=30) as r:
    data = json.loads(r.read().decode())
print(data)
```

```js
// Playwright — drive a frontend feature
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/visualizer", { waitUntil: "networkidle" });
await page.click('button[aria-label="Analyze track"]');
await page.waitForResponse(response => response.url().includes("/api/audio/analyze"));
```

Save any captures to a scratch dir outside the repo (e.g. `%TEMP%\kilo\`) or
`packages/frontend/tests/browser/out/` (gitignored).

### 2. MEASURE the actual results

Extract concrete, numeric values from the response or rendered output. Don't
just check "it works" — capture the exact values so you can compare before/after.

Examples:
- Audio mastering: `integrated_lufs`, `true_peak_dbtp`, `lra_lu` before/after
- API: HTTP status code, response time, error codes
- Frontend: element visibility, text content, network response body
- Video: frame count, duration, file size

Assert against acceptance criteria, not intentions:
```python
# BAD: "gain was applied" (asserts intent)
assert applied["gain_db"] != 0

# GOOD: "loudness is within tolerance of target" (asserts artifact)
diff = abs(after_lufs - target_lufs)
assert diff <= 0.5, f"Loudness {after_lufs} LUFS is {diff} LU from target {target_lufs}"
```

### 3. ANALYZE the gap

Compare measured values against acceptance criteria. Identify the specific
cause of any gap:

- Is the measurement itself wrong? (e.g. ebur128 doesn't report true_peak for
  short tones)
- Is the gain calculation wrong? (e.g. tone fixes shift the measurement)
- Is the limit/clamp preventing the target from being reached?
- Is the frontend not sending the right request body?

State the evidence: name the command, the measured value, or the `file:line`.

### 4. IMPROVE — concrete, shared, measured

Make the smallest change that closes the gap. Prefer:

- Iterative correction over one-shot calculation (e.g. measure → gain →
  re-measure → correct until within tolerance)
- Extracting shared primitives into one module rather than copy-pasting
- Frame-rate-independent math, not per-frame multipliers
- Measuring the written artifact, not the intent (D17's lesson)

State what changed and why, referencing the measurement that motivated it.

### 5. VERIFY — re-test the same path

Re-run the exact same test against the same endpoint/feature. Confirm the
measured value is now within tolerance. If the fix did not change the
measurement, the fix is wrong — not the test. Do not claim success without
the after-measurement.

Test across multiple scenarios:
- Different targets (Spotify -14, Apple -16, Competitive -11)
- With and without optional features (tone fixes on/off)
- Edge cases (missing file, silent track, extreme target)

### 6. COMMIT

Run gates, then commit with a conventional message and the Co-authored-by
trailer:

```bash
python tools/run-gates.py --only docs ruff type lint unit
git add <intended files>
git commit -m "feat(scope): summary" -m "Co-authored-by: <agent>"
```

## Worked example: Audio mastering endpoint

Implemented `POST /api/audio/master` + `GET /api/audio/master/measure/{filename}`
(M1 from `audio-mastering-stem-quality-2026-10.md`).

**First measurement (before fix):**
- Source: -13.8 LUFS → target: -14.0 → after: -13.0 LUFS (1.0 LU off, FAIL)
- Cause: tone fixes (+2 dB presence shelf at 4 kHz) shift ebur128's
  K-weighted measurement, so single-pass gain landed off-target

**Improvement:** Added iterative gain adjustment — measure → gain → encode →
re-measure → correct until within `LOUDNESS_TOLERANCE_LU` (0.5 LU) or
`MAX_GAIN_PASSES` (3). See `packages/backend/app/services/mastering.py`.

**Re-measurement (after fix):**
- Apple -16 + tone: -16.00 LUFS, 0.00 diff, 2 passes ✓
- Competitive -11, no tone: -11.30 LUFS, 0.30 diff, 1 pass ✓
- Amazon -2 + tone: -8.90 LUFS (expected — hits -1 dBTP ceiling, honest QC)

## See Also

- [[visual-qa-loop]] — the visual variant (screenshot → vision-analyze →
  improve → re-verify) for rendered output
- [[vision-page-analysis]] — single-page screenshot analysis
- [[gates-commit-push]] — the commit/push protocol that closes the loop
- [[ollama-model-ops]] — model selection, pre-warm, VRAM management

---

## Service Management During Testing: Use `background_process`

When running Playwright tests or testing backend APIs, you need services running (Vite dev server, backend, etc.). **Always use `background_process`** — not `bash` — to start/stop services.

### ✅ Correct: Start services via `background_process`
```python
# Start backend + frontend for E2E tests
background_process(
    action="start",
    command="pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\\manage-servers.ps1 -Action start -Services all",
    description="Start all services for testing",
    ready={"pattern": "All requested services started"}
)

# Wait a moment, then verify
import requests
requests.get("http://localhost:5173/").raise_for_status()
requests.get("http://localhost:8000/api/health").raise_for_status()
```

### ❌ Wrong: Using `bash` for services
```bash
# Leaks wrapper noise: "ChildProcess.kill... [Console]::InputEncoding..."
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services all
```

### Checking status (OK in `bash`)
```bash
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action status
curl -s http://localhost:5173/
```

### Stop services after testing
```python
background_process(
    action="stop",
    command="pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\\manage-servers.ps1 -Action stop -Services all",
    description="Stop all services"
)
```
