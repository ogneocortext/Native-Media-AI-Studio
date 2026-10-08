---
tags:
  - ai
aliases:
  - Ollama Thinking Mode
  - Structured Outputs
  - JSON Extraction
cssclasses:
  - ai-guide
date: 2026-09-29
---

# Ollama Thinking Mode & Structured Outputs

> **Last Updated:** 2026-10-08
> **Ollama Version:** 0.40.1 (server, verified via `GET /api/version`)
> **Relevant Models:** Qwen3.5, Qwen3, Gemma4, DeepSeek R1

## 2026-10-08: 0.40.1 — Windows serving fixes, no surface change

Server moved 0.40.0 → 0.40.1 (shipped 2026-10-07; CLI and server both
verified live at `0.40.1`). The delta is serving fixes, not API, and
the two that matter here are both Windows-specific: `llama: fix clef
head reads past 2GiB on windows` (>2 GiB weight reads) and `manifest:
avoid symlinks on Windows` (no more symlink reliance on NTFS). Also
shipped: `server: proxy cloud usage and balance APIs` (cloud billing
surface — this repo runs local-only, not applicable) and `cmd: remove
account step from CLI onboarding` (onboarding only). No new
introspection fields, no deprecations, no endpoint this repo calls
changed — so every 0.40.0 measurement below stands, and the `think:
false` guidance is unchanged. Decision-log D36 records the adoption.

## 2026-10-06: measured on Ollama 0.40.0

Server upgraded from 0.35.0 to 0.40.0 and re-measured with
`tools/probe-ollama.py` (now records the new fields). What
changed that matters to this repo:

- **`/api/show` advertises thinking controls and capabilities**
  (0.34.3+). For `gemma4:e2b-it-qat`:
  `thinking: {"values": [false, true], "default": true}` and
  `capabilities: ["completion", "vision", "audio", "tools",
  "thinking"]`. This is the authoritative answer to "does this
  model support `think`" — no more inferring from response
  shapes. `llama3.2:3b` reports `thinking: {"values": [false],
  "default": false}`: it has **no** thinking capability, so
  sending `think` to it is a no-op.
- **`/api/tags` entries carry `capabilities` and
  `details.runner`** (0.34.1+/0.40.0). Every local model on this
  Windows build reports `runner: "ggml"` (llama.cpp). The 0.40.0
  headline — MLX as the default engine — is **Apple-Silicon
  only** and does not apply here.
- **Structured outputs on thinking models apply in a single
  pass** (0.34.4), making `format` + `think: false` faster and
  more reliable than the two-pass behaviour measured below.
- **`typical_p` is deprecated** (0.34.1: cannot be set on new
  models; 0.35.0: sending it logs a warning). The backend never
  sends it (verified by grep), so nothing to change.
- **Decision models** arrived in 0.35.0 via `/v1/systemone`
  (Nimble, Tev1, Clef, Clef Flash) — a choice/probability API,
  not chat. Not integrated here; noted for completeness.
- Chat responses now include `prompt_eval_cached_count` (cached
  prompt tokens, 0.33.3) — visible in the probe output.

The `think: false` guidance below is unchanged and still the
single biggest win on this path.

## 2026-10-01: measured on Ollama 0.35.0

Confirmed on the running server and applied to the audio section-labelling call
(`app/api/audio.py::_generate_sections_llm`). This is the concrete cost of the
problem described below, measured rather than assumed.

Same request against `gemma4:e2b-it-qat` (the configured `default_model`),
GTX 1070 Ti / sm_61:

| Payload | Time | `message.content` | `message.thinking` |
|---------|------|-------------------|--------------------|
| as previously sent (no `think`) | **39.5s** | **0 chars** | **1738 chars** |
| `think: false` | **0.6s** | 67 chars | 0 |

`think: false` is worth **~65x** on this path. The entire cost was reasoning
tokens emitted before a one-line JSON answer, for a task that needs no
reasoning. `num_predict` 256 vs 512 made no measurable difference once
`think: false` was set, confirming the time was thinking, not generation.

**Why the key was missing.** The call site carried the comment *"Some Ollama
builds reject unknown keys like `think`; omit it."* That is the opposite of the
documented fix, and it meant `think` was never sent. If this symptom returns,
check whether a well-meant compatibility comment has reintroduced the omission.

### Per-model cost, same prompt

| Model | Time | Notes |
|-------|------|-------|
| `gemma4:e2b-it-qat` | 16.2s warm / 88.6s cold | configured `default_model` |
| `llama3.2:3b` | 59.4s | |
| `deepseek-r1:7b` | 89.1s | reasoning model; already ❌ in [[ollama-benchmarks]] |
| `qwen3.5:4b` | >120s (timeout) | |

Cold-load cost dominates, so **model ordering matters as much as `think`**. A
chain that leads with a cold model pays that cost on every request.

### Python client vs raw HTTP

Two different things, and only one of them is in play:

- **Server** — `ollama.exe serve`, listening on `127.0.0.1:11434`, reports
  **0.35.0**.
- **Python `ollama` package** — installed at **0.6.1**, but in
  `C:\Users\Aomega Imaging\AppData\Local\Programs\Python\Python311`
  (`base_prefix` only). It is **not** importable from
  `D:\conda-envs\nma-studio-cuda`, which is where the backend actually runs.

So the backend reaches Ollama through `core/ollama_client.py::chat_content`,
which POSTs to `/api/chat` directly with `aiohttp`. The 0.6.1 client is not in
that path. Anyone adding a dependency on `import ollama` in backend code will
hit `ModuleNotFoundError` — the package is not in `sys.path` for the env that
runs the server, and the venv's `base_prefix` does not put its site-packages on
the path.

## Problem

When using Qwen3.5:9b (and other Qwen3/DeepSeek reasoning models) via `/api/generate`, the model operates in **thinking mode by default**. Even with `think: false` in options, the model may still:

- Route all output to the `thinking` field
- Leave the `response` field empty
- Return `done_reason: length` without producing usable JSON in `response`

This breaks prompt-based JSON extraction for code generation and planning tools.

## Root Cause

Ollama's `/api/generate` endpoint does not honor `think: false` consistently for all models. The thinking/reasoning behavior is controlled at the chat-template level, and `think` in options is not a reliable override for Qwen3.5.

Reference: https://github.com/ollama/ollama/issues/10976

## Solution: Use `/api/chat` with `think: false`

The reliable way to disable thinking on Qwen3/Qwen3.5 is via the `/api/chat` endpoint with `think: false`.

### Working Request Pattern

```json
{
  "model": "qwen3.5:9b",
  "messages": [
    {
      "role": "system",
      "content": "You are a Blender Python (bpy) expert. Return ONLY valid JSON."
    },
    {
      "role": "user",
      "content": "Create a Blender Python script for: a low-poly stone obelisk"
    }
  ],
  "stream": false,
  "keep_alive": "60s",
  "think": false,
  "options": { "num_ctx": 8192, "num_predict": 2048, "temperature": 0.2 }
}
```

### Response Fields

| Field              | Description                                    |
| ------------------ | ---------------------------------------------- |
| `message.content`  | Final answer text                              |
| `message.thinking` | Reasoning trace (empty when thinking disabled) |
| `done_reason`      | `stop` when generation completed fully         |

## Structured Outputs

Ollama supports constrained JSON generation via the `format` parameter.

### JSON Mode

```json
{
  "model": "llama3.2",
  "messages": [...],
  "format": "json",
  "stream": false
}
```

### JSON Schema Mode

```json
{
  "model": "llama3.2",
  "messages": [...],
  "format": {
    "type": "object",
    "properties": {
      "name": {"type": "string"},
      "capital": {"type": "string"},
      "languages": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["name", "capital", "languages"]
  },
  "stream": false
}
```

**Note:** Structured outputs may not work with all thinking models.
Since 0.34.3, `GET /api/show` reports each model's `thinking`
controls and `capabilities` — check there before assuming a model
accepts `think` or `format`. Test with your target model.

## Model Behavior Matrix (Tested 2026-09-18)

| Model             | Endpoint                    | Thinking Disabled | JSON in Response | Notes                                  |
| ----------------- | --------------------------- | ----------------- | ---------------- | -------------------------------------- |
| qwen3.5:9b        | `/api/generate`             | No                | No               | Outputs to `thinking` field            |
| qwen3.5:9b        | `/api/chat` + `think:false` | Yes               | Yes              | **Recommended for code gen**           |
| qwen3.5:4b        | `/api/generate`             | No                | No               | Same issue as 9b                       |
| qwen3.5:4b        | `/api/chat` + `think:false` | Partial           | Partial          | Smaller model, less reliable           |
| llama3.2:3b       | `/api/generate`             | N/A               | Yes              | No thinking mode, reliable JSON        |
| llama3.2:3b       | `/api/chat`                 | N/A               | Yes              | Good fallback for simple tasks         |
| gemma4:e2b-it-qat | `/api/generate`             | N/A               | Partial          | JSON parse failures on complex output  |
| gemma4:e2b-it-qat | `/api/chat`                 | N/A               | Partial          | Better but still inconsistent for code |

## Recommendations

1. **Primary:** Use `/api/chat` with `think: false` for Qwen3.5
2. **Fallback:** Use `llama3.2:3b` via `/api/chat` for simpler structured outputs
3. **Alternative:** Use `format: "json"` or JSON schema with `/api/chat` for schema enforcement
4. **Avoid:** `/api/generate` with `think: false` for Qwen3.5 - it does not work reliably

## 2026-09-24 integration correction

- `/api/generate` is retained only for legacy/text-specific routes. New multimodal, reasoning, structured-output, and tool-using paths should use `/api/chat` so `message.content`, `message.thinking`, and `message.tool_calls` are handled consistently.
- The browser AI Tools path uses `/api/chat` SSE. If a small model only describes a requested tool instead of emitting native `tool_calls`, the backend narrows the registry to one explicitly named tool and executes a guarded fallback; ambiguous requests fail visibly rather than guessing.
- The adapter applies an 8 GB workstation ceiling of `num_ctx: 8192` even when a caller requests a larger context.

## Implementation Notes

### For Planning Tools (`plan_blender_script`, `plan_unity_scene`)

- Switch from `/api/generate` to `/api/chat`
- Add `think: false`
- Keep `num_ctx: 8192`, `num_predict: 2048`, `temperature: 0.2`
- Parse `data.message.content` instead of `data.response`
- Check `data.message.thinking` only for debugging

### For Vision/Analysis Tools

- Continue using `/api/generate` or `/api/chat` with `think: true` when reasoning is beneficial
- For vision tasks, thinking mode can improve analysis quality

## References

- [Ollama Thinking Docs](https://docs.ollama.com/capabilities/thinking)
- [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [GitHub Issue #10976](https://github.com/ollama/ollama/issues/10976)
- [GitHub Issue #10538](https://github.com/ollama/ollama/issues/10538)
