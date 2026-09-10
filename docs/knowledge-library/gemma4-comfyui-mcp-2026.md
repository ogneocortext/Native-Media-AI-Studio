# Gemma 4 ComfyUI MCP Fine-Tune — September 2026 (8GB-Capped)

> **Scope:** QLoRA on ComfyUI MCP tool-use for GTX 1070 Ti 8GB strict.  
> **Date:** 2026-09-09  
> **Source:** `artokun/gemma4-comfyui-mcp` (Ollama), Unsloth Gemma 4 train docs

## Summary

`artokun/gemma4-comfyui-mcp` is a size ladder of **Google Gemma 4** models **QLoRA-trained on 1,055 server-verified tool-use trajectories** generated against a **live ComfyUI instance** — covering the **complete `comfyui-mcp` tool surface**. This is the closest public checkpoint to our task (ComfyUI workflow JSON generation).

- **Ollama**: `artokun/gemma4-comfyui-mcp:e2b` (8GB) / `:e4b` (10GB) / `:12b` / thinking variants
- **Params**: `num_ctx 65536` (ollama), `34B` pulled size for e4b (includes full context)
- **Base**: `unsloth/gemma-4-E2B-it` / `E4B-it` with Unsloth Sep 2026 fixes (grad-accum, `use_cache`, audio)
- **License**: Apache 2.0 (Gemma 4), artifact MIT

## Hardware Rule for This Studio

| Variant | Training VRAM | Inference VRAM | Fits GTX 1070 Ti 8GB? |
|---------|---------------|----------------|----------------------|
| `:e2b` / `E2B-it` | **8GB** (Unsloth Jul 18 2026) | ~2.9GB Q4 | ✅ **Yes — use this** |
| `:e4b` / `E4B-it` | **10GB** | ~4.5GB Q4 | ❌ **No — cloud/A40 only** |
| `:12b` / `:31b` | 17-22GB+ | 6.7-17.5GB | ❌ No |

> **Strict 8GB**: Only `:e2b` fits local QLoRA on this GPU. `:e4b` is reported in search results but **exceeds** 8GB — do not select it for local training on GTX 1070 Ti.

## Why This Matters for Native Media AI Studio

Our `golden_dataset.jsonl` teaches **ComfyUI API JSON** (`class_type`/`inputs`). The artokun checkpoint already learned **ComfyUI MCP tool calling** from 1,055 verified trajectories — a strictly harder version of our task.

- **Bootstrap**: Start from `artokun/gemma4-comfyui-mcp:e2b` instead of raw `google/gemma-4-E2B-it`
- **Delta**: Then continue fine-tuning on studio-specific `golden_dataset` (50 examples) with **low LR** (`2e-5` to `5e-6`) to avoid catastrophic forgetting — this is adapter continuation, not from-scratch.
- **Benefit**: 1,055 trajectories already taught valid node wiring; our 50 examples only need to teach studio-specific style (e.g., SDXL 1024, AnimateDiff 8GB, Hy3D 3.0).

## Ollama Usage (8GB E2B)

```bash
# Pull 8GB variant only
ollama pull artokun/gemma4-comfyui-mcp:e2b

# Run with ComfyUI MCP tool surface
ollama run artokun/gemma4-comfyui-mcp:e2b
# System: "You are a ComfyUI workflow assistant for Native Media AI Studio. Generate valid ComfyUI API JSON only."
```

Ollama params (from blob `dcaf83c203b7`):
```json
{"num_ctx": 65536, "temperature": 1.0, "top_p": 0.95, "top_k": 64}
```
Gemma 4 recommended sampling is `temp 1.0 / top_p 0.95 / top_k 64` — artokun inherits this.

## Unsloth Training from Artokun Base (8GB)

```python
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

# 8GB-only base
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/gemma-4-E2B-it-unsloth-bnb-4bit",  # or local artokun merged
    max_seq_length=2048,
    load_in_4bit=True,
)
tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")  # or "gemma-4-thinking" for thinking

# If starting from artokun E2B, use lower LR for continuation
# trainer args: learning_rate=2e-5, warmup_ratio=0.03, num_train_epochs=1-2
```

> Do not use `google/gemma-4-E4B-it` on this GPU — it needs 10GB per Unsloth Sep 2026 docs.

## Relationship to Existing Studio Stack

- **ComfyUI native Gemma 4**: Sep 2026 ComfyUI ships `Gemma4: Text Generation` template (`TextGenerate` + `CLIPLoader` for `models/text_encoders/gemma-4-E2B-it`). This runs inference without Ollama.
- **Unsloth Studio**: Aug 2026 no-code alternative (`unsloth studio -H 0.0.0.0 -p 8888`, install `irm https://unsloth.ai/install.ps1 | iex` on Windows). Pick `E2B` and upload `golden_dataset.jsonl` — it will respect 8GB if you stay on E2B.
- **Phi-4 mini fallback**: If Gemma 4 E2B OOMs with your context, fallback to `unsloth/Phi-4-mini-instruct-unsloth-bnb-4bit` (fixes: padding/EOS/`unk_token`), ~2.5GB Q4.

## ComfyUI MCP Tool Surface Covered

All tools in `comfyui-mcp` (image, img2img, controlnet, upscale, remove_background, queue, history, system stats). Trained against **live ComfyUI** so node names are **server-verified**, not hallucinated.

## Sources

- Artokun Ollama: https://ollama.com/artokun/gemma4-comfyui-mcp:e4b (1,086 downloads, 1 month ago, 1,055 trajectories)
- Params: https://ollama.com/artokun/gemma4-comfyui-mcp:e4b/blobs/dcaf83c203b7 (`num_ctx 65536`)
- Unsloth Gemma 4: https://unsloth.ai/docs/models/gemma-4/train (E2B 8GB / E4B 10GB, fixes)
- Unsloth artifacts: https://github.com/unslothai/unsloth/discussions/4921 (Apr 8 2026, grad-accum/`use_cache`/audio fixes)

*Last updated: 2026-09-09 — 8GB-capped; E4B is cloud-only*
