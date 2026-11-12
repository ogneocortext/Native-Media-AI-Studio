---
tags:
  - technical
  - platform-tools
aliases:
  - Tools Checkpoints Models
cssclasses:
  - technical-guide
date: 2026-11-12
type: entity
---

> [!info] Purpose
> Inventory of model checkpoints in the repo-local `tools/checkpoints/` directory. These are used by ACE-Step music generation, Qwen3 embedding service, and TripoSR 3D reconstruction tools.

---

## Overview

**Location:** `tools/checkpoints/`  
**Total Size:** 13.80 GB  
**Last Audited:** 2026-11-12

This directory contains models for standalone tooling outside the main ComfyUI pipeline: ACE-Step (music generation), Qwen3 (embeddings), and a shared VAE.

## Model Inventory

| Model | Type | Path | Size | Used By |
|-------|------|------|------|---------|
| acestep-v15-sft/model.safetensors | ACE-Step v1.5 SFT | `acestep-v15-sft/model.safetensors` | 4.46 GB | `tools/music-gen/ACE-Step-1.5/` music generation |
| acestep-v15-turbo/model.safetensors | ACE-Step v1.5 Turbo | `acestep-v15-turbo/model.safetensors` | 4.46 GB | `tools/music-gen/ACE-Step-1.5/` fast music generation |
| acestep-5Hz-lm-1.7B/model.safetensors | ACE-Step 5Hz LM 1.7B | `acestep-5Hz-lm-1.7B/model.safetensors` | 3.45 GB | `tools/music-gen/ACE-Step-1.5/` language model |
| Qwen3-Embedding-0.6B/model.safetensors | Qwen3 Embedding 0.6B | `Qwen3-Embedding-0.6B/model.safetensors` | 1.11 GB | `tools/checkpoints/Qwen3-Embedding-0.6B/` embedding service |
| vae/diffusion_pytorch_model.safetensors | Shared VAE | `vae/diffusion_pytorch_model.safetensors` | 0.31 GB | Shared by ACE-Step and other tools |

### Supporting Files (tokenizers, configs)
| File | Size | Purpose |
|------|------|---------|
| `acestep-5Hz-lm-1.7B/tokenizer.json` | 0.023 GB | ACE-Step LM tokenizer |
| `acestep-5Hz-lm-1.7B/tokenizer_config.json` | 0.013 GB | Tokenizer config |
| `Qwen3-Embedding-0.6B/tokenizer.json` | 0.011 GB | Qwen3 tokenizer |
| `acestep-v15-sft/silence_latent.pt` | 0.004 GB | Silence latent for ACE-Step |
| `acestep-v15-turbo/silence_latent.pt` | 0.004 GB | Silence latent for ACE-Step Turbo |
| Various `config.json`, `vocab.json`, `special_tokens_map.json` | <0.01 GB each | Model configurations |

## Usage Context

- **ACE-Step models:** Music generation via `tools/music-gen/ACE-Step-1.5/` (Python, requires CUDA). The SFT and Turbo variants are different training checkpoints; Turbo is faster but lower quality.
- **Qwen3-Embedding-0.6B:** Lightweight embedding model (768-dim) used for local retrieval tasks; alternative to Ollama `nomic-embed-text`.
- **Shared VAE:** Standard SD VAE used by ACE-Step decoder and potentially other diffusion tools.

## VRAM Requirements (GTX 1070 Ti, 8 GB)

| Model | Est. VRAM | Notes |
|-------|-----------|-------|
| ACE-Step v1.5 SFT | ~6-7 GB | Full model + VAE + text encoder |
| ACE-Step v1.5 Turbo | ~6-7 GB | Same architecture, different weights |
| ACE-Step 5Hz LM 1.7B | ~2-3 GB | Language model only |
| Qwen3-Embedding-0.6B | ~1-2 GB | Very lightweight |

**Note:** Running ACE-Step alongside ComfyUI requires the Atomic Chat ↔ ComfyUI mutual exclusion (see [[comfyui-workflows]]:see-also).

## Related

- [[comfyui-workflows]]:see-also — ComfyUI model inventory (131.9 GB) and VRAM mutual exclusion
- [[hardware-verified-models]]:see-also — VRAM tier list for 8 GB GPU
- [[ai-music-mastering-stems-2026]]:see-also — Audio/mastering pipeline context