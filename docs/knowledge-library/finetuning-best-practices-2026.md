# Small LLM Fine-Tuning Best Practices — September 2026

> Compiled from current Unsloth docs, Phi-4 guidance, and community consensus as of September 2026.

## 1. Method Selection

| Method | VRAM (7B) | VRAM (3B) | Quality vs Full | When to Use |
|--------|-----------|-----------|-----------------|-------------|
| Full fine-tuning | 28 GB | 8 GB | 100% | Rare; only when LoRA fails |
| LoRA (16-bit base) | 16 GB | 8 GB | ~97% | 16 GB+ VRAM |
| QLoRA (4-bit base) | 8 GB | 3.5 GB | ~95% | **Default for consumer GPUs** |

**QLoRA is the default for local fine-tuning on 8 GB VRAM in 2026.** The ~2% quality gap vs full fine-tuning is negligible for domain/style tasks.

Tooling:
- **Unsloth**: fastest single-GPU fine-tuning (2–5× vs vanilla HF), best for 1 GPU, low setup complexity.
- **Axolotl**: more configurable, better for production pipelines and multi-GPU.
- **HF TRL**: baseline, research/custom objectives.

## 2. Base Model Selection — September 2026 Update

For **8 GB VRAM**:
- **unsloth/gemma-4-E2B-it** (~5.1B total, 2.3B effective, ~2.9 GB Q4) — **primary for ComfyUI tool-use** (see §13); trains on 8GB VRAM, vision+text+audio capable, 128K context. Use `unsloth/gemma-4-E2B-it-unsloth-bnb-4bit` for QLoRA.
- **unsloth/gemma-4-E4B-it** (~8B total, 4.5B effective, ~4.5 GB Q4) — **recommended if you have 10GB+** (Unsloth Jul 18 2026: E2B trains on 8GB, E4B requires 10GB VRAM; E4B QLoRA > E2B LoRA). Also available as `artokun/gemma4-comfyui-mcp:e4b` pre-fine-tuned on 1,055 ComfyUI tool-use trajectories.
- **unsloth/Phi-4-mini-instruct** (~3.8B params, ~3.5 GB Q4) — strong reasoning fallback; **use Unsloth bug-fixed repo** (not `microsoft/`) — fixes: padding/EOS same, extra EOS in chat template, EOS `<|end|>` not `<|endoftext|>`, `unk_token` fix.
- **microsoft/phi-4-mini** (base) — if you want to control post-training yourself
- **Llama 3.2 3B** — similar size, strong general capability
- **Qwen3.5-4B** — ~2.5 GB Q4, good multilingual

> **Sep 2026 (8GB constraint)**: For this studio's 8GB GTX 1070 Ti, **Gemma 4 E2B (8GB)** is now preferred over Phi-4 mini for ComfyUI workflow generation — native ComfyUI text-encoder support, tool-use training data (1055 trajectories), multimodal grounding, and proven 8GB QLoRA. E4B (10GB+) is **cloud-only** on this hardware; see `gemma4-comfyui-mcp-2026.md` for the 8GB-compatible E2B path.

**Rule**: Use **instruct** variants when available. They allow direct fine-tuning with chat templates and need less data than base models.

## 3. Dataset Size Guidelines

| Dataset Size | Expected Outcome |
|-------------|------------------|
| < 100 examples | Weak signal; model memorizes priors |
| 100–300 examples | Measurable style/format change possible |
| **300–1,000** | **Sweet spot for narrow tasks on consumer GPUs** |
| 1,000–5,000 | Strong, reliable results; diminishing returns after 5k |
| > 10,000 | Only useful if data is clean and diverse; noisy data hurts |

**Key finding (LIMA, 2023; confirmed through 2026)**: 1,000 carefully curated examples beats 50,000 noisy ones. Quality dominates quantity.

## 4. Dataset Format

Phi-4 and most instruct models expect **conversational chat format** with system/user/assistant turns.

### Preferred: ChatML / Messages Format

```json
{"messages": [
  {"role": "system", "content": "You are a ComfyUI workflow assistant for Native Media AI Studio."},
  {"role": "user", "content": "Generate a JSON workflow for text-to-image with neon cyberpunk style."},
  {"role": "assistant", "content": "{\"nodes\": [{\"class_type\": \"KSampler\", \"inputs\": {\"seed\": 42, \"steps\": 20, \"cfg\": 7.0, \"sampler_name\": \"euler\", \"scheduler\": \"normal\"}}], \"links\": []}"}
]}
```

**Critical rules**:
- Always include `system` messages to anchor behavior.
- Always include `assistant` responses — never leave them empty.
- Keep field names consistent across every example (`messages`, `role`, `content`).
- Append EOS token when using plain text format.
- No raw workflow dumps as standalone training text; wrap them in instruction → response pairs.

## 5. Data Quality Checklist

Before training, manually inspect **50–100 random examples** and check:

- [ ] Outputs are factually correct and match the requested format
- [ ] JSON is valid and parseable
- [ ] No leakage from eval/test into train
- [ ] No raw artifacts, code dumps, or unrelated content
- [ ] Consistent schema across all examples
- [ ] Diverse intents/styles represented (avoid >5% single-pattern dominance)
- [ ] Length within model context (trim or drop too-long examples)
- [ ] No empty or near-empty responses

### Automated Filters
- Exact and near-duplicate removal (MinHash-LSH or embedding cosine >0.95)
- Length filters (drop outputs below min useful length, above context limit)
- Language/encoding checks
- Refusal-pattern removal for synthetic data
- PII redaction if using real logs

## 6. Train / Validation / Test Split

- **Train**: 80–90%
- **Validation**: 5–10% (used during training for early stopping / best-model selection)
- **Test**: 5–10% (held out until final evaluation; never trained on)

**Never** use the same data for training and evaluation. If eval accuracy is >95% but test is much lower, you have leakage or overfitting.

## 7. Hyperparameters (Unsloth, 8 GB VRAM)

| Parameter | Recommended | Notes |
|-----------|-------------|-------|
| `load_in_4bit` | `True` | QLoRA |
| `max_seq_length` | 1024–2048 | Drop to 1024 if OOM |
| `r` (LoRA rank) | 16 | 8 for small datasets, 32 if >2k examples |
| `lora_alpha` | 32 | Standard heuristic: 2× r |
| `lora_dropout` | 0.05 | 0 is optimized in Unsloth; use 0.05–0.1 if overfitting suspected |
| `bias` | `"none"` | Optimized |
| `target_modules` | All major linear layers | `q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj` |
| `use_gradient_checkpointing` | `"unsloth"` | Saves ~30% VRAM |
| `per_device_train_batch_size` | 2 | Primary VRAM driver |
| `gradient_accumulation_steps` | 4–8 | Simulate larger batch without OOM |
| `effective_batch_size` | 4–16 | `batch_size × grad_accum` |
| `learning_rate` | 2e-4 | Standard for LoRA; lower for full fine-tuning |
| `lr_scheduler_type` | `"cosine"` or `"linear"` | Cosine often smoother |
| `warmup_ratio` | 0.05–0.1 | Stabilizes early training |
| `weight_decay` | 0.01 | Regularization |
| `num_train_epochs` | 2–3 | Max 5; overfitting risk beyond that |
| `optim` | `"adamw_8bit"` | Saves ~2 GB VRAM vs standard Adam |
| `fp16` | `True` if BF16 unsupported | Match training/serving precision |
| `packing` | `True` | Concatenates short sequences to fill context window; cuts training time |
| `dataset_text_field` | `"text"` or use `formatting_func` | Must match actual field name |
| `seed` | 3407 or 42 | Reproducibility |
| `eval_dataset` | Provide one | **Required** for overfitting detection |
| `evaluation_strategy` | `"steps"` | Monitor eval loss during training |
| `load_best_model_at_end` | `True` | Return best checkpoint, not last |
| `metric_for_best_model` | `"eval_loss"` | Lower is better |

### GTX 1070 Ti Specific (8GB Pascal, CC 6.1) — Sep 2026 update
- CUDA 6.1 → **Triton unsupported** → set `TORCHDYNAMO_DISABLE=1`, `UNSLOTH_DISABLE_CUSTOM_KERNELS=1`
- Use **Unsloth bug-fixed repos**: `unsloth/Phi-4-mini-instruct-unsloth-bnb-4bit` and `unsloth/gemma-4-E2B-it-unsloth-bnb-4bit` (fixes padding/EOS/`unk_token`). Do not use `microsoft/` direct for QLoRA.
- **Gemma 4 Sep 2026 fixes applied in Unsloth**: gradient accumulation correctly accounted (previously losses 100-300, now 10-15 for E2B/E4B), `use_cache=False` gibberish fix (`num_kv_shared_layers` 20/18), audio float16 overflow (`-1e9`→fp16 max). Loss 13-15 for E2B/E4B is **normal** for multimodal models (vision E2B/E4B loss 2× text).
- Target **effective batch size 4–8** (prefer `per_device=1, grad_accum=4-8` on 8GB). Unsloth Sep 2026 warns: `batch_size × grad_accum` combos are now equivalent after fix, but keep batch 1-2 for OOM safety.
- Expect **5–10 s/it** for 3B QLoRA on this card; Gemma 4 E2B ~1.5× faster / ~60% less VRAM than FA2 setup.
- **8GB rule**: Gemma 4 E2B QLoRA fits 8GB; E4B QLoRA needs 10GB (Sep 2026 Unsloth docs) → **not for GTX 1070 Ti local**. Use E2B locally, E4B only via cloud/A40.

## 8. Overfitting Detection

Watch these signals:
- Training loss keeps dropping, but **eval loss rises** → overfitting
- Training loss drops to **<0.5** on a small dataset → memorization
- Model perfectly recites training examples but fails on new prompts
- Grad norm spikes or becomes NaN

**Fixes**:
- Reduce epochs to 2–3 max
- Increase `lora_dropout` to 0.1
- Increase `weight_decay` to 0.1
- Reduce LoRA rank `r`
- Add more diverse data
- Use early stopping via `load_best_model_at_end=True`

## 9. Synthetic Data Guidance

- Use a stronger model (e.g., GPT-5, Claude Opus) to generate candidate pairs for your task.
- **Always human-review** a sample of synthetic data before training.
- Use synthetic data to cover edge cases your real data misses.
- Do not let any single synthetic pattern dominate (>5% of dataset).
- Synthetic data is best for **behavior/format** tasks, not for injecting factual knowledge (use RAG instead).

## 10. Common Anti-Patterns

1. **Too few examples** — <300 examples for a non-trivial task is usually insufficient.
2. **Wrong format** — forgetting system messages, inconsistent field names, malformed JSON.
3. **Over-training** — >3 epochs on a small dataset causes memorization.
4. **No validation set** — you cannot detect overfitting without held-out eval data.
5. **Mixed topics** — training on unrelated tasks degrades general capability.
6. **Skipping chat template** — template mismatch is the #1 cause of poor inference after successful training.
7. **Large model on small GPU without offloading** — leads to silent crashes or OOM mid-training.

## 11. Quick Validation Before Full Run

Always run a smoke test first:
```python
args=SFTConfig(
    max_steps=60,  # ~5–10 minutes on consumer GPU
    num_train_epochs=1,
    # ... rest of config
)
```
Verify:
- Loss descends from initial value
- No OOM or CUDA errors
- Data loads correctly
- Adapter saves successfully

Only then commit to a full 1,000-example, multi-hour run.

## 12. Export / Deployment

- Unsloth can export directly to GGUF: `model.save_pretrained_gguf("output", tokenizer, quantization_method="q4_k_m")`
- Q4_K_M is the default sweet spot (~4.5 GB for 8B, ~95% quality retention)
- For Ollama/LM Studio: create a Modelfile with the **correct chat template** (template mismatch is the most common post-training bug)
- **Sep 2026**: Unsloth Studio (`unsloth studio -H 0.0.0.0 -p 8888`) offers no-code training + `Compare Mode` + export to GGUF/safetensors — respects 8GB VRAM if you pick E2B.

## 13. September 2026 — ComfyUI Tool-Use Fine-Tuning (8GB-Capped)

> **New option for this studio**: `artokun/gemma4-comfyui-mcp:e4b` (and `:e2b`) — QLoRA on **1,055 server-verified tool-use trajectories** against live ComfyUI MCP. Trained on `unsloth/gemma-4-E2B/E4B-it` with full `comfyui-mcp` tool surface. Ollama-ready (`num_ctx 65536`). **For GTX 1070 Ti, use `:e2b` (8GB) only**; `:e4b` needs 10GB.

- **Use case**: Instead of training ComfyUI JSON generation from scratch, start from a checkpoint already taught ComfyUI tool calling. Then continue fine-tuning on studio-specific golden_dataset (50 examples) with lower LR (`5e-6` to `2e-5` for adapter continuation).
- **Hardware**: E2B variant fits 8GB QLoRA; E4B is cloud-only for this GPU.
- See `gemma4-comfyui-mcp-2026.md` for usage.

## 14. September 2026 — Unsloth Version Pins (Pascal-safe)

| Package | Version | Notes |
|---------|---------|-------|
| Unsloth | `>=2026.8.6` / `unsloth-zoo>=2026.8.5` | Sep 2026: Grad accum fix, Gemma 4 `use_cache` fix, GGUF re-uploads |
| PyTorch | `2.14.0+cu126` | **Last Pascal-compatible**; cu128+ drops CC 6.1 |
| CUDA Toolkit | 12.6.x | Match cu126 |
| Transformers | `>=4.52` | Gemma 4 `transformers#45242` fix required |
