---
name: vision-page-analysis
description: Capture a browser page screenshot and analyze it with the local Ollama vision model (gemma4-e2b) for UI/layout feedback. Use when reviewing web pages, checking for visual regressions, or verifying that UI changes render correctly.
---

# Vision Page Analysis

> [!warning] CRITICAL: Do not send generic placeholder prompts to Ollama.
> Prompts like "describe this image" or "what is in this screenshot" produce
> non-actionable output. Always use a mode-specific or task-specific prompt that
> asks for concrete, prioritized fixes the coding agent can implement immediately.

This model cannot see image attachments directly, so every screenshot must be routed through
the local Ollama vision model to get feedback. Use this loop for UI review, layout/regression checks,
and verifying that dashboards/charts render correctly.

## When to use
- After making frontend changes and wanting a visual review
- When the user asks to "look at" or "review" a page
- After capturing a browser screenshot of a UI you want reviewed
- Any time you need an independent visual sanity check of rendered output

## Steps

1. **Navigate to the page** and take a full-page screenshot:
    ```js
    await page.screenshot({ path: "packages/frontend/tests/browser/out/shot.png", fullPage: true });
    ```

2. **Analyze with the project script** (resizes + sends to Ollama gemma4):

    ```bash
    node tools/vision/analyze.mjs shot.png "optional prompt"
    # or for code-grounded analysis:
    node tools/vision/analyze.mjs shot.png src/components/Foo.tsx --mode regression
    ```

    For MCP-driven analysis (agents), the `vision-mcp.mjs` server exposes `vision_describe`, `vision_compare`, `vision_ocr`, and `vision_batch_analyze` tools.

3. **Verify before acting.** Vision models misread off-screen / overlapping elements.
   Cross-check against ground truth using Playwright snapshots.

4. **Act** on the verified findings (fix layout, add missing data, improve empty states, etc.).

5. **Re-capture + re-analyze** to confirm the improvement closed the loop.

**Vision script options:**

- `--low` — resize to 640px max (faster, smaller payload)
- `--high` — resize to 1280px max (higher detail)
- `--mode ui|responsive|regression|compare|consistency|music-video|ocr|table|chart|video` — analysis mode
- `--viewport WxH` — intended viewport size
- `--label "name"` — screen/label name
- `--json` — machine-readable output

**Video analysis (`--video`):** for defects that only exist *over time* —
layers colliding mid-transition, controls drifting during panel open/close,
snap-vs-animate jank — a still cannot see them. Record a short interaction
clip (Playwright `recordVideo`, ~10–15 s of real clicks/mode switches), then:

```bash
node tools/vision/analyze.mjs --video clip.webm --json
# tune with: --video-fps 2 --video-frames 30 --video-keyframes 8
```

The tool ffprobes duration, extracts frames at `--video-fps`, pixel-diffs
consecutive frames, and sends only the strongest change boundaries (plus
first/last) to the model as a chronological keyframe strip with a
temporal-analysis prompt and a `video` JSON schema (`per_frame`,
`transitions`, `overlaps`). Requires ffmpeg/ffprobe on PATH. Provenance
records every keyframe timestamp, so findings map back to video time.

**Pair video with geometry sampling:** the VLM sees semantics; the DOM sees
geometry. While recording, run a rAF sampler that logs
`getBoundingClientRect()` + `elementFromPoint()` for the chrome zones —
transient overlaps (e.g. a centered bar colliding with a telemetry stack
only while the inspector is open) are caught deterministically, not by
asking the model to squint at frames.

**Multi-page walkthroughs (`tools/vision/walkthrough.mjs`):** for "audit the
first N sidebar pages" tasks, do NOT hand-roll a capture script per run —
the orchestrator does capture → per-page analysis → video analysis →
consolidated report in one command:

```bash
node tools/vision/walkthrough.mjs --pages "/,/library,/create/video" --analyze --out ./walkthrough-out
# or a spec file for per-page control:
node tools/vision/walkthrough.mjs --spec pages.json --analyze
# spec: {"base":"http://127.0.0.1:5173","dwellMs":6000,"waitUntil":"networkidle",
#        "pages":[{"path":"/library","label":"media-library","waitFor":".file-grid"}]}
```

It records video, screenshots each page, attributes console errors and
>=400 responses to the producing page, feeds those errors back into each
page's analysis as `--context`, feeds page-navigation marks into the video
analysis so transitions can be correlated with routes, runs `--mode ui`
per shot plus a `--video` pass (32 frames / 8 keyframes), and writes `report.md` + `report.json`.
`--json` output now includes
`analysis_parsed` (schema modes return JSON text; consumers no longer
double-parse). Spec pages may set `"prompt"` to override the per-page
analysis prompt for pages whose target the generic ui prompt mislabels.

**Capture hygiene learned the hard way:**
- `waitUntil:"networkidle"` can **time out** on apps holding persistent
  connections (SSE, polling) — the goto itself fails at 30 s. Prefer
  `"waitUntil":"load"` + `dwellMs` ≥ 5000, or per-page `waitFor` selectors.
- Data-heavy pages (media library, admin dashboards) still show "Loading…"
  at 3 s — analyses of mid-load screenshots produce confident findings
  about a loading spinner. Verify the page actually rendered (waitFor or
  longer dwell) before trusting findings.
- Playwright `.webm` recordings may lack container duration; the tool
  falls back to counting packets. Always check `provenance.video.duration_s`
  — a truncated/stale recording silently analyzes only its first seconds.
- **Model ceiling on dense video:** gemma4:e2b-it-qat can collapse to
  describing one frame repeatedly when handed ~10 keyframes of a
  multi-page walkthrough (observed: claimed "Loading..." on every frame of
  a 49 s recording that visibly navigated 5 pages). Treat video analysis
  as supplementary — the per-page screenshot analyses are the reliable
  signal, and geometry sampling stays authoritative for overlaps.

**Default model:** `gemma4:e2b-it-qat` (override with `VISION_MODEL=...`)

**VRAM management:** The vision script automatically unloads any other currently running Ollama models before loading the vision model, preventing OAM errors on GPUs with limited VRAM. The backend VRAM manager has been refactored to use proper async patterns with `asyncio.to_thread()` for GPU operations.
