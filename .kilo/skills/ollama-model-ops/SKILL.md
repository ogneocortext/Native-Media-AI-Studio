---
name: ollama-model-ops
description: >-
  Operating the local Ollama stack: which model to pick for which task, health
  checks, pre-warming the vision model to avoid MCP timeouts, VRAM management on
  the 8 GB GTX 1070 Ti, and the timeout budgets that make cold loads succeed.
  Use before any vision analysis, local inference, or when a model call times out.
---

# Ollama Model Ops

> [!warning] MCP vision tools time out on cold model loads. The inner fetch
> budget is 300s (`tools/vision/vision-common.mjs`), but a cold `minicpm-v:8b`
> load alone can take ~183s. Pre-warm the model before an MCP vision call, or
> run `node tools/vision/analyze.mjs` from the shell with a 300s+ timeout.

> [!warning] An interpreter having packages installed is not the same as it
> working. Verify by running the gate, never by inspecting imports.

## Environment

- Ollama v0.40.5 (background model upgrades paused in this version — do not try to
  force them; that is what wedged the stack before).
- GPU: GTX 1070 Ti, 8 GB (Pascal sm_61). 3 resident models ≈ 6.8 GB VRAM.
- Env (set in `.kilo/kilo.jsonc` MCP servers): `OLLAMA_CONTEXT_LENGTH=16384`,
  `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_GPU=true`, `OLLAMA_GPU_HOST=cuda`,
  `OLLAMA_GPU_LAYERS=999`, `OLLAMA_NUM_GPU=999`, `OLLAMA_KEEP_ALIVE=30m`,
  `OLLAMA_NEW_ENGINE=false`, `OLLAMA_MODELS=D:\AI\Models\Ollama\.ollama\models`.

## Model selection (measured, GPU-resident)

| Model | Size | Engine | Use | Speed |
|-------|------|--------|-----|-------|
| `gemma4:e2b-it-qat` | 4.3 GB | ggml | primary chat + vision | 49 tok/s, 30s load |
| `qwen3.5:4b` / `:9b` | — | llamacpp | coding / reasoning | 36 tok/s (4b) |
| `llama3.2:3b` | — | ggml | section-chain fallback | 17 tok/s |
| `minicpm-v:8b` | 5.5 GB | ggml | OCR specialist | 183s cold load |
| `moondream` | ~1.8 GB | ggml | **fast vision iterate tier** | ~1.5s warm describe |
| `nomic-embed-text:v1.5` | — | — | embeddings | — |

Cloud stubs (not local): `glm-5.3:cloud`, `deepseek-v4-flash:cloud`, `deepseek-v4.1:flash:cloud`.

## Vision task routing (measured 2026-11-08 on mesh-QA renders)

Pick the model for the task, not the biggest one available:

| Tier | Model | Warm latency | Use for | Do NOT use for |
|------|-------|--------------|---------|----------------|
| fast iterate | `gemma4:e2b-it-qat` (`--mode fast`/`describe`, default) | ~7 s | "did it render", gross composition, smoke checks | — |
| workhorse | `gemma4:e2b-it-qat` (default, `--mode ui`) | ~7 s | mesh/UI QA, structured findings, OCR-adjacent | — |
| deep reasoning | `qwen3.5:4b` (`--model qwen3.5:4b`) | ~27 s warm / ~133 s cold | subtle defect hunts (caught thin-limb + disjointed-part issues gemma4 missed) | back-to-back iteration loops |
| opt-in only | `moondream` (`model:"moondream"` or `VISION_MODEL_FAST=moondream`) | ~1.5 s | trivial caption smoke checks | everything else — auto-routing excludes it (`AUTO_EXCLUDED_VISION_MODELS`): it loops on compound prompts and emits raw bbox coords (measured 2026-11-12/13) |

Routing mechanics: `tools/vision/analyze.mjs` `MODE_MODEL` maps modes
to models with resident-stickiness; `fast`/`describe` modes resolve to
`VISION_MODEL_FAST` env or the default workhorse — moondream is never
auto-selected (mode-map, resident-sticky, and fallback pools all filter
`AUTO_EXCLUDED_VISION_MODELS` in `tools/vision/vision-common.mjs`).
The MCP `vision_describe` tool accepts `mode:"fast"|"describe"` or an
explicit `model` param (forwarded as `--model`, and that model is warmed
instead of the primary). Override anything with `--model`/`VISION_MODEL`.

## Health check

```bash
# Ollama is up? /api/health returns 404 on v0.40.x (top-level status via backend gateway works fine)
curl -s http://127.0.0.1:11434/api/tags   # model inventory + capabilities (always works; residentVisionModels() reads this)
# Backend overall health
curl -s http://127.0.0.1:8000/api/health  # expect overall: healthy
```

## Pre-warm the vision model (avoid MCP timeout)

```bash
# Direct generate to load the model into VRAM before an MCP vision call
curl -s http://127.0.0.1:11434/api/generate -H "Content-Type: application/json" -d "{\"model\":\"gemma4:e2b-it-qat\",\"prompt\":\"warm\",\"stream\":false}"
# Or run the analyzer from the shell (300s+ timeout):
node tools/vision/analyze.mjs <image> "<prompt>" --backend ollama
```

## VRAM management

- The vision script auto-unloads other running models before loading the vision
  model (prevents OAM errors on 8 GB).
- Only 2–3 models can be resident at once. If you hit OAM, unload with
  `curl -X DELETE http://127.0.0.1:11434/api/ps` style eviction or wait for
  `OLLAMA_KEEP_ALIVE=30m` to expire.
- Windows WDDM reports `[N/A]` for compute apps in `nvidia-smi --query-compute-apps`
  on this machine — **VRAM deltas are the only reliable GPU signal**, not process lists.

## Timeout budgets (raised 2026-10-11, commit `1031891`)

Cold loads are slow on this hardware; these were raised from 120s → 300s:
- `adapters/ollama.py:489` — `generate()` timeout
- `api/vision.py:52` — OCR `_ollama_chat` timeout
- `tools/vision/vision-common.mjs:128` — MCP vision inner fetch

If a model call still times out, check whether the model is cold (first load)
versus wedged (Ollama process stuck). A wedge needs an Ollama restart; a cold
load just needs patience within the 300s budget.

## See Also

- [[visual-qa-loop]] — the loop that depends on vision analysis
- [[vision-page-analysis]] — the capture + analyze commands
- [[gates-commit-push]] — commit protocol
