---
tags:
  - ai
  - hardware-8gb
aliases:
  - Vision Model Reliability 2026
  - Qwen3-VL Reasoning Loop
  - Ollama Vision Routing
cssclasses:
  - ai-guide
date: 2026-10-10
type: comparison
---

# 🖼️ Vision Model Reliability 2026 — qwen3-vl Reasoning Loop & the gemma4 Primary

> [!info] Purpose
> Records the measured failure mode that made every vision analysis
> mode hang 120 s+ (qwen3-vl degenerate reasoning loop, Ollama
> [#17978](https://github.com/ollama/ollama/issues/17978)), the
> routing fix in `tools/vision/analyze.mjs`, and the 2026-10-10
> model pruning that removed the affected family from this machine.
>
> **Rule of thumb:** on this workstation, `gemma4:e2b-it-qat` is the
> vision primary for every analysis mode. qwen3-vl models are gone;
> `minicpm-v:8b` is the only other surviving vision model and stays
> the OCR fallback.

## 1. The bug (measured, not inferred)

Same request, same `num_predict: 4096`, GTX 1070 Ti / sm_61:

| Model | Time | `done_reason` | `message.content` | `message.thinking` |
| ----- | ---- | ------------- | ----------------- | ------------------ |
| `qwen3-vl:2b` | **69.7 s** | `length` | **0 chars** | 11775 chars |
| `gemma4:e2b-it-qat` | **21.6 s** | `stop` | **1062 chars** | — |

qwen3-vl burns its entire output budget re-evaluating the prompt and
never emits `content`. gemma4 is both **faster and reliable** — it
terminates cleanly with a real answer. This is the same class of
defect as the `/api/generate` thinking leak in
[[ollama-thinking-structured-outputs]] (issue #10976), but on the
vision path and unfixable from the client side.

**The 120 s+ hang mechanism** (before the fix): `ui` mode routed to
`qwen3-vl:2b` (70 s degenerate) → the same-model retry at the same
4096 budget (another 70 s, same result) → finally fell back to
gemma4. Two wasted minutes per analysis.

## 2. What does NOT work (tested, do not retry)

- **`think: false` / `"none"` / `"minimal"`** — all three still
  return empty `content` + a full `thinking` trace on qwen3-vl.
  Both models advertise `thinking: {values: [false, true],
  default: true}` via `GET /api/show`, but the flag is not honored
  on this path.
- **The official #17978 workaround** (stream, count thinking
  tokens, abort at a threshold, resume with the thinking fed back
  plus a nudge) — **does not converge** on structured UI-audit
  prompts. The resume returns empty `content` + 6414 thinking
  chars again. A simple resume (feed thinking back + nudge) also
  fails.

## 3. The fix (in `tools/vision/analyze.mjs`)

1. **Mode routing** — every analysis mode (`ui`, `responsive`,
   `regression`, `compare`, `multicomp`, `ocr`, `table`, `chart`,
   `music-video`) maps to `gemma4:e2b-it-qat` in `MODE_MODEL`.
   qwen3-vl is reachable only via an explicit `--model` override.
   Resident-model stickiness still applies: a warm capable model is
   reused before the mode map (a model switch costs 30–60 s).
2. **Degenerate-skip guard** — `ollamaAttempt` records
   `lastFromThinking` (the attempt returned empty `content` and the
   text was recovered from `thinking`). The same-model 4096 retry
   is skipped when `emptyDegenerate = lastFromThinking || typeof
   analysis !== 'string' || !analysis.trim()` — re-rolling a
   degenerate model reproduces the same loop, so the code goes
   straight to the fallback model. Only a **non-empty** answer that
   hit the output budget is worth a re-roll (sampling may stop
   earlier).

**Verified after the fix:** `ui` mode → `gemma4:e2b-it-qat`
(`mode-map+resident`), 41.8 s, RC 0, a real 2890-char analysis, no
fallback needed. The planted-error readback test (a `[ERROR]
ComfyUI timeout after 300s` line in the screenshot) was correctly
transcribed — real content, no fallback.

## 4. Model pruning (2026-10-10)

Seven models deleted via `ollama rm` (the API `DELETE /api/model`
returns 404 on this build — use the CLI). **25.81 GB freed**
(53.39 → 27.58 GB; 17 → 10 models):

| Deleted model | Size | Why |
| ------------- | ---- | --- |
| `ornith-1.5:9b` | 6.55 GB | 9B, OOM-class on 8 GB, unused |
| `deepseek-r1:7b` | 4.68 GB | reasoning specialist, no vision, slow |
| `qwen3-vl:4b` | 3.34 GB | affected by the reasoning-loop bug |
| `qwen3-vl-optimized:latest` | 3.34 GB | same family, same bug |
| `qwen3-vl:2b` | 1.93 GB | the measured offender |
| `gemma4-vision-optimized:latest` | 4.34 GB | duplicate capability of gemma4:e2b-it-qat |
| `openbmb/minicpm-v4.6:q4_K_M` | 1.64 GB | superseded by `minicpm-v:8b` |

**Surviving (10 models, 27.58 GB):** `qwen3.5:9b` (6.60 GB, planner),
`minicpm-v:8b` (5.47 GB, OCR workhorse), `minicpm-v:latest` (alias
tag, same blob, 0 GB), `gemma4:e2b-it-qat` (4.34 GB, vision
primary), `qwen3.5:4b` (3.40 GB), `llama3.2:3b` (2.02 GB),
`nomic-embed-text:v1.5` (0.27 GB), plus three 0 GB cloud models.

**Code swept so nothing defaults to a deleted model** (13 edits,
11 files): `vision-common.mjs` (`DEFAULT_VISION_MODEL`),
`vision-mcp.mjs` (`DEFAULT_MODEL` + tool description),
`ollama-tools-mcp.mjs` (model description), `config.py`
(`vision_model`), `vision.py` (`FALLBACK_MODEL` → `minicpm-v:8b`,
the only other surviving vision model), `integrations_config.py`
(`VERIFIED_WORKING_MODELS`), `vision_analyze.py` (`DEFAULT_MODEL`),
`analyze-visualizer-frames.mjs` (help text), `AIVisualizerPrompt.tsx`
(`TOOL_CAPABLE_MODELS`), `Settings.tsx` and `MusicPromptGenerator.tsx`
(dead dropdown/datalist options).

## 5. Current vision routing

| Task | Primary | Fallback |
| ---- | ------- | -------- |
| Vision analysis (all modes) | `gemma4:e2b-it-qat` | `minicpm-v:8b` |
| OCR / table / chart | `gemma4:e2b-it-qat` (temp 0) | `minicpm-v:8b` |
| Multi-image compare | `gemma4:e2b-it-qat` | `minicpm-v:8b` |

See [[ollama-utilization-2026]] §3 for the full task → model map and
[[minicpm-v-best-practices]] for the OCR specialist's behavior.

## 6. Cross-References

- [[ollama-thinking-structured-outputs]] — the `think` flag's
  per-model reliability, `/api/chat` vs `/api/generate`
- [[ollama-utilization-2026]] — model inventory and routing tables
- [[minicpm-v-best-practices]] — `minicpm-v:8b` OCR behavior
- [[music-video-vision-prompts]] — mode-specific prompt skeletons
- [[gemma4-comfyui-mcp-2026]] — gemma4 tool-use on 8 GB VRAM
- D37 in `docs/architecture/decision-log.md` — the routing decision

---

_Last updated: 2026-10-10_

## Related
- [[small-llm-landscape-2026.md]] :see-also
- [[finetuning-best-practices-2026.md]] :see-also

- [[3d-generation-2026-updates.md]] :see-also
