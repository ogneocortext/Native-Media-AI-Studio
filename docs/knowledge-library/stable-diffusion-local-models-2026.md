---
tags:
  - technical
  - platform-stable-diffusion
aliases:
  - Stable Diffusion Models
cssclasses:
  - technical-guide
date: 2026-11-12
type: entity
---

> [!info] Purpose
> Inventory of Stable Diffusion models in the repo-local `stable-diffusion/models/` directory (not ComfyUI). These are used by legacy/standalone SD scripts and AnimateDiff-Evolved camera LoRA testing.

---

## Overview

**Location:** `stable-diffusion/models/`  
**Total Size:** 4.75 GB  
**Last Audited:** 2026-11-12

This is a minimal SD 1.5 + AnimateDiff v3 setup used for testing camera motion LoRAs outside ComfyUI. It does not contain the full ComfyUI model set.

## Model Inventory

| Model | Type | Path | Size | Purpose |
|-------|------|------|------|---------|
| v1-5-pruned-emaonly.safetensors | SD 1.5 Checkpoint | `checkpoints/v1-5-pruned-emaonly.safetensors` | 3.97 GB | Base SD 1.5 model for txt2img/img2img |
| mm_sd15_v3.safetensors | AnimateDiff v3 Motion Module | `animatediff/mm_sd15_v3.safetensors` | 0.78 GB | Motion module for AnimateDiff-Evolved camera LoRA testing |

## Usage Context

- **Used by:** Standalone Python scripts, AnimateDiff camera LoRA validation
- **Not used by:** ComfyUI (which has its own models at `D:\...\ComfyUI\models\`)
- **VRAM requirement:** ~5-6 GB for SD 1.5 + AnimateDiff v3 on GTX 1070 Ti (8 GB)

## Related

- [[comfyui-workflows]]:see-also — ComfyUI model inventory (131.9 GB, separate location)
- [[hardware-verified-models]]:see-also — VRAM tier list for 8 GB GPU
- [[animatediff-evolved-2026]]:see-also — AnimateDiff-Evolved node contract and motion LoRAs