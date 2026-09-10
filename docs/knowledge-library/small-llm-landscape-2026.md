# Small Language Models for Fine-Tuning — September 2026

> **Scope:** consumer GPU, ≤8 GB VRAM, text-only or multimodal LLMs suitable for LoRA/QLoRA fine-tuning via Unsloth.
> **Last updated:** 2026-09-09

---

## 1. Current Generation Leaders (mid-2026)

### 1.1 Google Gemma 4 family (April 2026)

Gemma 4 is the current state-of-the-art open small-model family from Google DeepMind, released under **Apache 2.0**.

| Model | Effective Params | Total Params | Q4 VRAM | Context | Modalities | Best For |
|-------|-----------------|--------------|---------|---------|------------|----------|
| **Gemma 4 E2B** | 2.3 B | 5.1 B | ~2.9 GB | 128K | Text, Image, Audio | **Fits 8GB local QLoRA** — primary for GTX 1070 Ti |
| **Gemma 4 E4B** | 4.5 B | 8 B | ~4.5 GB + overhead = **10GB** | 128K | Text, Image, Audio | **Cloud-only on 8GB** (Unsloth Jul 18 2026: E4B requires 10GB VRAM) |
| Gemma 4 12B Unified | 12 B | 12 B | ~6.7 GB + 17GB LoRA | 256K | Text, Image, Audio | Needs 16 GB+ VRAM |
| Gemma 4 26B A4B MoE | 3.8 B active | 26 B total | ~14.4 GB | 256K | Text, Image | Needs 24 GB+ VRAM (all params loaded) |
| Gemma 4 31B Dense | 31 B | 31 B | ~17.5 GB | 256K | Text, Image | Needs 24 GB+ VRAM |

> **Sep 2026 correction for GTX 1070 Ti (8GB)**: E2B trains on 8GB VRAM, E4B now documented at **10GB VRAM** for QLoRA (was ~4.5GB estimate). On this GPU, **E2B is the 8GB ceiling**. E4B's `~4.5 GB` is model weight only; + LoRA + optimizer + activations pushes to 10GB — use E4B only via cloud/A40.

**Why Gemma 4 E2B for this project (8GB-capped):**
- Q4 ~2.9 GB + QLoRA overhead fits GTX 1070 Ti 8GB (E4B at 10GB does not)
- 60.0% MMLU Pro, 43.4% GPQA Diamond — best within 8GB envelope; E4B's 69.4%/58.6% is cloud-only here
- Multimodal base: text+image+audio, 128K context, native ComfyUI text-encoder (Sep 2026: ComfyUI ships Gemma 4 E2B/E4B native nodes)
- Pre-tuned variant: `artokun/gemma4-comfyui-mcp:e2b` (8GB) — QLoRA on **1,055 server-verified ComfyUI MCP tool-use trajectories**, Ollama `num_ctx 65536`, direct replacement for custom workflow training
- Apache 2.0 — no licensing friction

**Hugging Face / Ollama IDs (8GB-compatible first):**
- **E2B (8GB local)**: `unsloth/gemma-4-E2B-it-unsloth-bnb-4bit` (recommended QLoRA), `google/gemma-4-E2B-it`, Ollama `artokun/gemma4-comfyui-mcp:e2b`
- **E4B (10GB cloud)**: `unsloth/gemma-4-E4B-it-unsloth-bnb-4bit`, `google/gemma-4-E4B-it`, Ollama `artokun/gemma4-comfyui-mcp:e4b` — **not for GTX 1070 Ti local**
- Unsloth Docs: `unsloth.ai/docs/models/gemma-4/train` (E2B 8GB, E4B 10GB)

### 1.2 Microsoft Phi-4 Mini

| Spec | Value |
|------|-------|
| Parameters | 3.8 B |
| Q4 VRAM | ~2.5 GB |
| Context | 128K |
| License | MIT |
| Strengths | Reasoning, math, coding |

Best alternative if you prioritize reasoning density over multimodality.

### 1.3 Alibaba Qwen3 / Qwen3.5

| Spec | Value |
|------|-------|
| Parameters | 1.5 B – 4 B |
| Q4 VRAM | ~0.95 – 2.5 GB |
| Context | 262K |
| License | Apache 2.0 |
| Strengths | Coding, multilingual, function calling |

Qwen3.5-4B is particularly strong for agentic workflows and tool use.

### 1.4 Meta Llama 3.2

| Spec | Value |
|------|-------|
| Parameters | 1 B / 3 B |
| Q4 VRAM | ~1.3 – 2.5 GB |
| Context | 128K |
| License | Llama Community |
| Strengths | General use, widest community support |

Still solid in 2026, but benchmarked below Gemma 4 E4B and Phi-4 Mini.

### 1.5 Hugging Face SmolLM3

| Spec | Value |
|------|-------|
| Parameters | 3 B |
| License | Apache 2.0 |
| Strengths | Fully open recipe, good benchmarks for size |

Strong choice if you want reproducible training details.

### 1.6 Mistral Ministral 3

| Spec | Value |
|------|-------|
| Parameters | 3.4 B + 0.4 B vision |
| Q4 VRAM | ~2–3 GB |
| Context | Not specified |
| License | Unknown |
| Strengths | Multimodal edge model |

### 1.7 Tencent Hunyuan-4B

| Spec | Value |
|------|-------|
| Parameters | 4 B |
| Context | 256K |
| License | Unknown |
| Strengths | Long context, agentic tasks |

### 1.8 Nanbeige4.2-3B

| Spec | Value |
|------|-------|
| Parameters | 3 B non-embedding |
| Context | 256K |
| License | Unknown |
| Strengths | Agentic capabilities, outperforms larger models on tool use |

Notable for code-agent and office-agent benchmarks.

---

## 2. Recommendation for This Project (GTX 1070 Ti 8GB — strictly 8GB-local)

**Primary target (8GB local):** `unsloth/gemma-4-E2B-it-unsloth-bnb-4bit` / Ollama `artokun/gemma4-comfyui-mcp:e2b`

- Fits 8GB QLoRA on GTX 1070 Ti (Unsloth Sep 2026: E2B 8GB, E4B 10GB)
- Tool-use pre-tuned on 1,055 ComfyUI MCP trajectories — closest to workflow generation task
- Apache 2.0, native ComfyUI text-encoder

**Fallback target (8GB local):** `unsloth/Phi-4-mini-instruct-unsloth-bnb-4bit`
- 3.8B, ~2.5GB Q4, strong reasoning; use Unsloth bug-fixed repo (fixes padding/EOS/`unk_token`)
- MIT, slightly better headroom than E2B

**Cloud-only (not 8GB local):** `google/gemma-4-E4B-it` / `artokun/gemma4-comfyui-mcp:e4b`
- Needs 10GB VRAM for QLoRA — exceeds GTX 1070 Ti; use only via cloud A40/24GB or for inference

---

## 3. Download Sizes (Q4_0)

| Model | Download Size |
|-------|---------------|
| Gemma 4 E2B | ~2.9 GB |
| Gemma 4 E4B | ~4.5 GB |
| Phi-4 Mini | ~2.5 GB |
| Qwen3.5-4B | ~2.5 GB |

---

## 4. Unsloth Compatibility Notes (Sep 2026)

- Unsloth `>=2026.8.6` (`unsloth-zoo>=2026.8.5`) required for Gemma 4 (grad-accum + `use_cache` fixes)
- Use **Unsloth bug-fixed repos**: `unsloth/gemma-4-E2B-it-unsloth-bnb-4bit`, `unsloth/Phi-4-mini-instruct-unsloth-bnb-4bit` (not `microsoft/` direct)
- For Gemma 4 E2B on 8GB: `FastLanguageModel.from_pretrained("unsloth/gemma-4-E2B-it-unsloth-bnb-4bit", load_in_4bit=True)` or `FastVisionModel` for vision+text
- LoRA rank 8–16 recommended for 8GB VRAM; Gemma 4 thinking mode: `get_chat_template(tokenizer, chat_template="gemma-4")` vs `"gemma-4-thinking"`
- Max sequence length: start at 2048, increase if VRAM allows
- **Unsloth Studio** (`unsloth studio -H 0.0.0.0 -p 8888`) available since Aug 2026 — no-code training, supports GGUF/MLX/Qwen3.8/DeepSeek-V4/MiniMax-H3/Gemma 4/FLUX, runs on Windows (install: `irm https://unsloth.ai/install.ps1 | iex`)

---

## 5. Sources (Updated Sep 2026)

- Unsloth Gemma 4 train: https://unsloth.ai/docs/models/gemma-4/train (E2B 8GB, E4B 10GB, grad-accum/`use_cache` fixes, Jul 18 2026)
- Google Gemma 4 blog: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ (2026-04-02)
- Gemma 4 HF announcement: https://huggingface.co/blog/gemma4 (2026-04-02)
- Gemma 4 model cards: https://huggingface.co/google/gemma-4-E4B-it / https://huggingface.co/unsloth/gemma-4-E2B-it
- Artokun ComfyUI MCP: https://ollama.com/artokun/gemma4-comfyui-mcp:e2b (1,055 trajectories, QLoRA on ComfyUI MCP, Sep 2026)
- Gemma 4 technical report: arXiv:2607.02770
- Phi-4 Mini bug fixes: https://huggingface.co/unsloth/Phi-4-mini-instruct (padding/EOS/`unk_token`, Sep 2026)
- Qwen3.5: https://huggingface.co/Qwen/Qwen3.5-4B-Instruct
- Nanbeige4.2-3B: https://arxiv.org/pdf/2607.22083
- Unsloth Studio: https://unsloth.ai/docs/new/studio.md (Aug 2026 launch)
- Gradient accumulation bug fix: https://unsloth.ai/blog/gradient (Apr 2026)
