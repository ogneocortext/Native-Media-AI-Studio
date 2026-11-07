---
name: visual-qa-loop
description: >-
  The screenshot → vision-analyze → web-research → improve → re-verify loop for
  visual work. Use when improving any rendered output (UI pages, shaders, 3D
  visualization styles, video frames) where "looks better" must be measured, not
  asserted. Captures the real rendered state, gets vision-model feedback with
  task-specific prompts, researches current best practices, applies concrete
  fixes, and re-captures the weakest cases to confirm the loop closed.
---

# Visual QA Loop

> [!warning] CRITICAL: Never send generic placeholder prompts to the vision model.
> "describe this image" / "what do you see" produce non-actionable output.
> Always use a mode-specific or task-specific prompt that asks for concrete,
> prioritized fixes the coding agent can implement immediately.

> [!warning] Measure before you name a defect. Read the code to form a hypothesis,
> then run something that could disprove it. A claim from reading alone is not a
> finding. A clean measurement is worth as much as a confirming one.

This is the closed loop for visual improvement work. It exists because visual
quality cannot be verified by reading source — only by looking at the rendered
result. Every iteration must end with a re-capture that proves the change worked.

## When to use

- Improving shader presets, 3D visualization styles, or any rendered visual
- Reviewing a UI page after frontend changes
- Checking for visual regressions before commit
- Any task where the acceptance criterion is "looks better / more dynamic / less cluttered"
- Batch-improving a family of visuals (all styles, all pages) — capture all, analyze all, fix, re-verify the weakest

## The Loop

### 1. CAPTURE the real rendered state

Drive the app to the state you want to evaluate, then screenshot. For the
Visualizer, use the `__VIZ_TEST__` dev hook to select a track and mode so the
canvas is actually animating (a paused/empty canvas hides motion defects):

```js
// Playwright (load via absolute path — repo path contains spaces)
const { chromium } = require("D:\\...\\packages\\frontend\\node_modules\\playwright");
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5173/visualizer", { waitUntil: "networkidle" });
await page.evaluate(() => window.__VIZ_TEST__.selectTrack("SomeTrack.mp3"));
await page.evaluate(() => window.__VIZ_TEST__.setMode("3d"));
await page.evaluate(() => window.__VIZ_TEST__.set2DMode("<style-id>"));
await page.waitForTimeout(4000); // let animation progress past first frames
await page.screenshot({ path: "out/<style>.png" });
```

For a plain web page, `await page.screenshot({ path, fullPage: true })`.
Save captures to a scratch dir outside the repo (e.g. `%TEMP%\kilo\`) or
`packages/frontend/tests/browser/out/` (gitignored).

> **⚠️ Service management: Use `background_process` for dev server/backend.**
> ```python
> # Start services before capturing
> background_process(
>     action="start",
>     command="pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\\manage-servers.ps1 -Action start -Services all",
>     description="Start all services for visual QA",
>     ready={"pattern": "All requested services started"}
> )
> ```
> The `bash` tool leaks wrapper noise when starting services. Use `background_process` for service lifecycle.

For a plain web page, `await page.screenshot({ path, fullPage: true })`.

### 2. ANALYZE with the vision model (task-specific prompt)

```bash
node tools/vision/analyze.mjs <image> "<task-specific prompt>" --mode ui
# or via MCP: vision_describe / vision_batch_analyze with a custom prompt
```

- Default model: `gemma4:e2b-it-qat` (detailed, reliable). Takes ~30–60s/image.
- **Pre-warm the model** if cold: a direct `curl` POST to `/api/generate` first,
  or the MCP call times out (300s inner budget in `tools/vision/vision-common.mjs`).
- Batch with `vision_batch_analyze` for many images in one call.
- Ask for scored dimensions + a ranked "top 3 improvements" list, not prose.

**Prompt template (visual style review):**
```
Analyze this rendered visualization for:
1. MOTION: Does it look dynamic or frozen/static? (a single frame can hide this — note what suggests motion)
2. COMPOSITION: Is it cluttered or organized? Any visual noise / overlapping elements?
3. COLOR: Is the palette cohesive or flat/monochrome? Does it have energy?
4. DEPTH: Are there foreground/background layers or is it flat?
5. BEAT: Does anything read as rhythmically locked to music, or is it smooth-but-lifeless?
6. TOP 3 IMPROVEMENTS: ranked, concrete, implementable.
```

### 3. RESEARCH current best practices

Web-search the domain before inventing fixes. For audio-reactive visuals, the
2026 consensus: beat-*quantized* snaps beat smooth band-following; attack/release
envelopes; energy-driven palettes (cool at rest → warm at full energy); highlight
rolloff (`1 − exp(−color·k)`); shaders never go fully static (idle motion);
declutter (fewer, larger elements beat many tiny ones).

### 4. IMPROVE — concrete, shared, measured

- Extract shared primitives into one module (e.g. `vizMotion.ts`) rather than
  copy-pasting the same math into every style. Pure functions are unit-testable.
- Prefer frame-rate-independent math (`dt`-scaled envelopes, not per-frame multipliers).
- Declutter before adding effects: cut element counts first.
- State the evidence: name the command, the measured value, or the `file:line`.

### 5. VERIFY — re-capture the weakest cases

Re-run the capture on the styles/pages that scored worst. Confirm each named
defect is actually closed in the new screenshot. If a fix did not change the
render, the fix is wrong — not the screenshot. Do not claim success without
the after-image.

### 6. COMMIT

Run gates, then commit with a conventional message and the Co-authored-by trailer:
```bash
python tools/run-gates.py --only docs ruff type lint unit
git add <intended files>
git commit -m "feat(scope): summary" -m "Co-authored-by: Ling 3.1 Flash"
```

## Worked example

The 15 Three.js 3D visualization styles (`packages/frontend/src/features/visualizer/viz-styles/`)
were improved with exactly this loop: captured all 15 mid-track, vision-analyzed
all 15, researched 2026 Three.js audio-viz patterns, built a shared `vizMotion.ts`
(attackRelease / beatSnap / energyHue / rolloff), applied it across all 15, then
re-captured and vision-verified the six weakest (geometric, neural, storm, vinyl,
aurora, three-particles). Committed as `5d6ac8b`.

## See Also

- [[vision-page-analysis]] — single-page screenshot analysis (the capture+analyze half)
- [[music-video-vision]] — frame analysis for music-video production
- [[gates-commit-push]] — the commit/push protocol that closes the loop
- [[ollama-model-ops]] — model selection, pre-warm, and VRAM management
