# Hardware-Vetted Model Inventory & Expansion Guide

> **Last Updated:** 2026-09-04  
> **Status:** Active reference for model selection, quantization, and AnimateDiff expansion on the local workstation  
> **Hardware baseline:** GTX 1070 Ti 8 GB VRAM / Ryzen 5 5500 / 32 GB RAM / Windows 11

---

## 1. Ollama Model Quantization Audit

### 1.1 Finding: Local 9B models are NOT quantized

| Model | Size | Format | Quantized? |
|---|---|---|---|
| `qwen3.5:9b` | 6.6 GB | Full precision (fp16/bf16 blobs) | ❌ No |
| `ornith-1.5:9b` | 6.6 GB | Full precision (fp16/bf16 blobs) | ❌ No |
| `deepseek-r1:7b` | 4.7 GB | Full precision | ❌ No |
| `qwen3.5:4b` | 3.4 GB | Full precision | ❌ No |
| `gemma4:e2b-it-qat` | 4.3 GB | QAT-trained, but stored as full precision in Ollama | Partial |
| `qwen3-vl:4b` | 3.3 GB | Full precision | ❌ No |
| `qwen3-vl:2b` | 1.9 GB | Full precision | ❌ No |
| `llama3.2:3b` | 2.0 GB | Full precision | ❌ No |

**Evidence:** `ollama show <model> --modelfile` reveals single `FROM` blob paths under `D:\AI\Models\Ollama\.ollama\models\blobs\` with no GGUF quantization suffix. The 9B models each occupy ~6.6 GB, confirming they are unquantized fp16 weights.

### 1.2 VRAM impact on 8 GB GPU

| Model class | Typical VRAM usage | Verdict |
|---|---|---|
| 2B–3B | ~1.9–2.5 GB | ✅ Safe |
| 4B | ~3.3–3.4 GB | ✅ Good |
| 7B | ~4.7 GB | ⚠️ Tight but runnable |
| 9B | ~6.6 GB | ❌ Poor fit; will OOM under moderate KV-cache load |

### 1.3 Recommendations

- **Primary coding model:** `qwen3.5:4b` — best speed/quality balance, fits with headroom.
- **Vision tasks:** `qwen3-vl:2b` or `qwen3-vl:4b` — both fit comfortably.
- **Avoid for routine use:** 9B models in current Ollama format. If 9B quality is needed, convert to **GGUF Q4_K_S / Q5_K_S** via llama.cpp; this reduces size to ~3.5–4.5 GB and makes them 8 GB VRAM–friendly.
- **QAT models:** `gemma4:e2b-it-qat` is quantized-aware trained but still served as full precision by Ollama; no runtime quantization benefit until converted to GGUF.

---

## 2. AnimateDiff Expansion — Motion LoRAs

### 2.1 What was installed

**Location:** `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI\custom_nodes\ComfyUI-AnimateDiff-Evolved\motion_lora\`

**8 official camera-motion LoRAs** from the AnimateDiff team (guoyww), each ~73.9 MB:

| File | Camera Motion | Typical Use |
|---|---|---|
| `v2_lora_ZoomIn.ckpt` | Gradual zoom into center | Focus pull, detail reveal |
| `v2_lora_ZoomOut.ckpt` | Gradual zoom away | Establishing shot, context |
| `v2_lora_PanLeft.ckpt` | Horizontal pan left | Scene reveal left-to-right |
| `v2_lora_PanRight.ckpt` | Horizontal pan right | Scene reveal right-to-left |
| `v2_lora_TiltUp.ckpt` | Vertical tilt up | Reveal height, sky |
| `v2_lora_TiltDown.ckpt` | Vertical tilt down | Reveal ground, subject |
| `v2_lora_RollingClockwise.ckpt` | Barrel roll clockwise | Dynamic action, spiral |
| `v2_lora_RollingAnticlockwise.ckpt` | Barrel roll counter-clockwise | Dynamic action, spiral |

**Source:** HuggingFace `guoyww/animatediff` + CivitAI mirror  
**Compatibility:** Designed for **AnimateDiff v2 motion module** (`mm_sd_v15_v2.ckpt`). They may have reduced effect on v3 but are still usable.  
**Weight recommendation:** 0.7–1.0 in the AnimateDiff motion-LoRA slot.

### 2.2 How to use in ComfyUI

1. Ensure motion LoRAs are in one of:
   - `ComfyUI/custom_nodes/ComfyUI-AnimateDiff-Evolved/motion_lora/`
   - `ComfyUI/models/animatediff_motion_lora/`
2. In the **AnimateDiff Loader** node, set `motion_lora` to the desired LoRA filename.
3. Adjust `motion_lora_strength` (0.7–1.0 is a good starting range).
4. Use **mm_sd_v15_v2.ckpt** as the motion model for best LoRA compatibility, or experiment with v3.

### 2.3 VRAM impact

Motion LoRAs are tiny (~74 MB each) and load into the motion-module parameter space. They add **negligible VRAM overhead** on top of SD 1.5 + AnimateDiff.

---

## 3. ControlNet Options for AnimateDiff

### 3.1 Available ControlNet families

| ControlNet variant | Size (fp32) | Size (fp16) | Size (LoRA) | 8 GB VRAM fit with AnimateDiff? |
|---|---|---|---|---|
| Official SD1.5 ControlNet 1.1 (canny/depth/openpose/etc.) | 1.45 GB each | 723 MB each | 136 MB each | ❌ fp32 too heavy; ⚠️ fp16 tight; ✅ LoRA safe |
| ControlNet++ (better alignment) | ~1.5 GB | ~750 MB | N/A | ❌ Too heavy |
| T2I-Adapters (lightweight conditioning) | Varies | Varies | Small | ✅ Usually safe |

### 3.2 Recommended ControlNet strategy for 8 GB VRAM

**Current AnimateDiff base load:** SD 1.5 (~2 GB) + motion module (~1 GB) + VAE + UNet cache ≈ **4–5 GB**.

**Headroom remaining:** ~3–4 GB.

**Safe choices:**
- **ControlNet LoRA variants** (~136 MB each) — can fit one or two alongside AnimateDiff.
- **T2I-Adapters** — lightweight conditioning layers; some are <200 MB.

**Risky choices:**
- Full fp16 ControlNet models (~723 MB each) — may OOM when combined with AnimateDiff + SD 1.5.
- Full fp32 ControlNet models (~1.45 GB each) — will OOM.

### 3.3 Recommended ControlNet models to install (if needed)

For structure/pose guidance on AnimateDiff clips:
- **ControlNet LoRA - Canny** (`comfyanonymous/ControlNet-v1-1_fp16_safetensors` LoRA subset, ~136 MB)
- **ControlNet LoRA - OpenPose** (~136 MB)
- **ControlNet LoRA - Depth** (~136 MB)

**Installation path:** `ComfyUI/models/ControlNet/`

**Usage note:** ControlNet in AnimateDiff is typically applied per-frame or via the adapter nodes in AnimateDiff-Evolved (`nodes_conditioning.py`). Stacking multiple ControlNets is possible but increases VRAM usage linearly.

---

## 4. Hardware-Fit Summary

### 4.1 Confirmed specs

| Component | Spec | Notes |
|---|---|---|
| GPU | NVIDIA GTX 1070 Ti | 8 GB GDDR5, driver 582.66 |
| VRAM free | ~6.34 GB | At time of measurement |
| CPU | AMD Ryzen 5 5500 | 6C/12T |
| RAM | 32 GB | Ample for CPU-bound tasks |
| ComfyUI | Not running | `localhost:8188` refused |

### 4.2 Safe-to-run model tiers

| Tier | Model examples | VRAM estimate | Status |
|---|---|---|---|
| **Tier 1 — Safe** | 2B–3B LLMs, 4B VL, AnimateDiff SD1.5 + motion LoRA | <4 GB | ✅ Run now |
| **Tier 2 — Workable** | 4B LLMs, SD1.5 + AnimateDiff + 1× ControlNet LoRA | 4–6 GB | ✅ Run now |
| **Tier 3 — Tight** | 7B LLMs, SD1.5 + AnimateDiff + fp16 ControlNet | 6–8 GB | ⚠️ May OOM under load |
| **Tier 4 — Infeasible** | 9B LLMs unquantized, WAN 14B, LTX 22B, SDXL AnimateDiff | >8 GB | ❌ Skip or quantize |

### 4.3 Recommended daily-driver stack

1. **LLM:** `qwen3.5:4b` for coding/reasoning; `qwen3-vl:2b` for vision.
2. **Video:** SD 1.5 + AnimateDiff v3 (`mm_sd15_v3.safetensors`) + motion LoRAs as needed.
3. **Control:** Start with **no ControlNet**; add one ControlNet LoRA only when specific structure guidance is required.
4. **Audio:** Demucs for stem separation (CPU-bound, 32 GB RAM is plenty).

---

## 5. What Was Installed This Session

| Asset | Location | Count | Size |
|---|---|---|---|
| AnimateDiff motion LoRAs | `ComfyUI\custom_nodes\ComfyUI-AnimateDiff-Evolved\motion_lora\` | 8 files | ~591 MB |
| SD 1.5 checkpoint | `ComfyUI\models\checkpoints\` | 1 | Pre-existing |
| AnimateDiff v3 motion module | `ComfyUI\models\animatediff\` | 1 | Pre-existing |
| AnimateDiff v2 motion module | `ComfyUI\models\animatediff_models\` | 1 | Pre-existing |
| AnimateDiff stabilized motion module | `ComfyUI\models\animatediff_models\` | 1 | Pre-existing |

---

## 6. Next Steps

1. **Test motion LoRAs** end-to-end in the AnimateDiff-Evolved UI with `mm_sd_v15_v2.ckpt` for best compatibility.
2. **If ControlNet is needed**, download the LoRA variants (~136 MB each) rather than full models.
3. **If 9B LLM quality is required**, convert `qwen3.5:9b` or `ornith-1.5:9b` to GGUF Q4_K_S using llama.cpp; this is the only way to fit 9B-class models in 8 GB VRAM.
4. **Avoid downloading** WAN 2.2, LTX 2.3, or SDXL AnimateDiff packs — they require 12–24 GB VRAM and will not run on this hardware.
