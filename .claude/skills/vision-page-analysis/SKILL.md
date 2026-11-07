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
- `--mode ui|responsive|regression|compare|consistency|music-video|ocr|table|chart` — analysis mode
- `--viewport WxH` — intended viewport size
- `--label "name"` — screen/label name
- `--json` — machine-readable output

**Default model:** `gemma4:e2b-it-qat` (override with `VISION_MODEL=...`)

**VRAM management:** The vision script automatically unloads any other currently running Ollama models before loading the vision model, preventing OAM errors on GPUs with limited VRAM. The backend VRAM manager has been refactored to use proper async patterns with `asyncio.to_thread()` for GPU operations.
