---
tags:
  - video-generation
  - gpu-test
  - ltx
  - mochi
  - 8gb-vram
  - protocol
aliases:
  - LTX/Mochi 8GB Test Protocol
  - Video Model Sweep Protocol
date: 2026-09-24
---

# 🧪 LTX / Mochi 8GB Viability Test Protocol

> [!info] Purpose
> Concrete, repeatable test protocol for validating LTX Video 2.3 and
> Mochi-1/Mochi-2 on GTX 1070 Ti (8GB VRAM, Pascal sm_61).
> This document addresses the research gaps
> **🔴 LTX Video 2.3 on 8GB** and **🔴 Mochi-1 / Mochi-2 8GB viability**
> from [[app-research-gaps-2026#1-video-generation-models-gtx-1070-ti--8gb-vram|App Research Gaps 2026]].

## 1. Pre-flight Checklist

| Check | Command | Expected |
|-------|---------|----------|
| CUDA toolkit installed | `nvcc --version` | 12.x |
| NVIDIA driver | `nvidia-smi` | 582.66+ |
| PyTorch CUDA | `python -c "import torch; print(torch.version.cuda)"` | 12.4 |
| ComfyUI running | `curl http://127.0.0.1:8188/system_stats` | 200 OK |
| Model files present | see §2 | files exist |

## 2. Model Acquisition

### 2.1 LTX Video 2.3

| Variant | Expected filename | Source |
|---------|-------------------|--------|
| LTX 2.3 base (FP8) | `ltx-video-2.3-fp8.safetensors` | HuggingFace / ComfyUI custom node |
| LoRA (optional) | `ltx-video-2.3-lora.safetensors` | community |

Download to `ComfyUI/models/diffusion_models/`.

### 2.2 Mochi-1 / Mochi-2

| Variant | Expected filename | Source |
|---------|-------------------|--------|
| Mochi-1 | `mochi-1.safetensors` | Genmo / community |
| Mochi-2 | `mochi-2.safetensors` | Genmo / community |

> [!warning]
> Mochi checkpoints may not exist in GGUF form. If only FP16 weights are
> available, expect 16GB+ VRAM and **skip** the 8GB test.

Download to `ComfyUI/models/diffusion_models/`.

## 3. Test Matrix

Run each model through the following matrix. Record results in
`docs/knowledge-library/benchmarks/video-model-8gb-2026.json`.

| Model | Resolution | Frames | FPS | Precision | Tiling | Expected VRAM | Status |
|-------|-----------|--------|-----|-----------|--------|---------------|--------|
| LTX 2.3 | 512×512 | 24 | 12 | fp8 | auto | 6-8GB | ⬜ pending |
| LTX 2.3 | 832×480 | 24 | 12 | fp8 | auto | 8-10GB | ⬜ pending |
| LTX 2.3 | 512×512 | 24 | 12 | fp16 | auto | 12-16GB | ⬜ pending |
| Mochi-1 | 512×512 | 24 | 12 | fp8 | auto | 8-12GB | ⬜ pending |
| Mochi-2 | 512×512 | 24 | 12 | fp8 | auto | 8-12GB | ⬜ pending |
| Mochi-1 | 512×512 | 24 | 12 | fp16 | auto | 16GB+ | ⬜ pending |

## 4. ComfyUI Workflow Templates

Save these as `tools/mcp/comfyui-workflows/ltx-2.3-test.json` and
`tools/mcp/comfyui-workflows/mochi-test.json`.

### 4.1 LTX 2.3 (FP8, 512×512, 24 frames)

```jsonc
{
  "prompt": {
    "1": {
      "class_type": "UNETLoader",
      "inputs": { "unet_name": "ltx-video-2.3-fp8.safetensors", "model_file": "diffusion_models" }
    },
    "2": {
      "class_type": "DualCLIPLoader",
      "inputs": {
        "text": "positive prompt here",
        "text2": "negative prompt here",
        "clip_name1": "clip-l",
        "clip_name2": "umt5_xxl_fp16.safetensors",
        "type": "ltxv"
      }
    },
    "3": {
      "class_type": "LTXVConditioning",
      "inputs": {
        "clip": ["2", 0],
        "latent": ["5", 0],
        "frame_count": 24,
        "fps": 12
      }
    },
    "4": {
      "class_type": "KSampler",
      "inputs": {
        "seed": 0,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
        "model": ["1", 0],
        "positive": ["3", 0],
        "negative": ["3", 1],
        "latent_image": ["5", 0]
      }
    },
    "5": {
      "class_type": "EmptyLatentVideo",
      "inputs": { "width": 512, "height": 512, "frame_count": 24, "batch_size": 1 }
    },
    "6": {
      "class_type": "LTXVDecode",
      "inputs": { "samples": ["4", 0], "vae": ["7", 0] }
    },
    "7": {
      "class_type": "VAELoader",
      "inputs": { "vae_name": "ltxvae.safetensors" }
    },
    "8": {
      "class_type": "VHS_VideoCombine",
      "inputs": {
        "images": ["6", 0],
        "frame_rate": 12,
        "loop_count": 0,
        "filename_prefix": "NativeMediaAI_LTX",
        "format": "image/gif",
        "pingpong": False,
        "save_output": True
      }
    }
  }
}
```

### 4.2 Mochi (FP8, 512×512, 24 frames)

```jsonc
{
  "prompt": {
    "1": {
      "class_type": "UNETLoader",
      "inputs": { "unet_name": "mochi-1-fp8.safetensors", "model_file": "diffusion_models" }
    },
    "2": {
      "class_type": "CLIPTextEncode",
      "inputs": { "text": "positive prompt here", "clip": ["3", 0] }
    },
    "3": {
      "class_type": "CLIPLoader",
      "inputs": { "clip_name": "umt5_xxl_fp16.safetensors" }
    },
    "4": {
      "class_type": "CLIPTextEncode",
      "inputs": { "text": "negative prompt here", "clip": ["3", 0] }
    },
    "5": {
      "class_type": "EmptyLatentVideo",
      "inputs": { "width": 512, "height": 512, "frame_count": 24, "batch_size": 1 }
    },
    "6": {
      "class_type": "KSampler",
      "inputs": {
        "seed": 0,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
        "model": ["1", 0],
        "positive": ["2", 0],
        "negative": ["4", 0],
        "latent_image": ["5", 0]
      }
    },
    "7": {
      "class_type": "VAEDecode",
      "inputs": { "samples": ["6", 0], "vae": ["8", 0] }
    },
    "8": {
      "class_type": "VAELoader",
      "inputs": { "vae_name": "mochi-vae.safetensors" }
    },
    "9": {
      "class_type": "VHS_VideoCombine",
      "inputs": {
        "images": ["7", 0],
        "frame_rate": 12,
        "loop_count": 0,
        "filename_prefix": "NativeMediaAI_Mochi",
        "format": "image/gif",
        "pingpong": False,
        "save_output": True
      }
    }
  }
}
```

## 5. Execution Script

Run from the backend venv with CUDA available:

```bash
# Dry run — validates workflow JSON without submitting to ComfyUI
python -m packages.backend.services.video_model_bench --dry-run

# Live run — submits to ComfyUI and measures VRAM + time
python -m packages.backend.services.video_model_bench --model ltx_2_3 --resolution 512x512 --frames 24

# Full matrix
python -m packages.backend.services.video_model_bench --all
```

## 6. Measurement Protocol

For each successful run, record:

```jsonc
{
  "model": "ltx_2_3",
  "resolution": "512x512",
  "frames": 24,
  "fps": 12,
  "precision": "fp8",
  "peak_vram_mb": 7200,
  "generation_time_s": 180,
  "output_path": "output/video/NativeMediaAI_LTX_...",
  "quality_rating": 3,
  "notes": "Motion smooth, minor artifacts at frame boundaries",
  "timestamp": "2026-09-24T20:00:00Z"
}
```

### 6.1 VRAM Measurement

```python
import nvidia_smi
nvidia_smi.nvmlInit()
handle = nvidia_smi.nvmlDeviceGetHandleByIndex(0)
info = nvidia_smi.nvmlDeviceGetMemoryInfo(handle)
peak_mb = info.used // (1024 * 1024)
```

### 6.2 Quality Rating (1-5)

| Rating | Criteria |
|--------|----------|
| 5 | Photorealistic, no artifacts |
| 4 | Good motion, minor compression |
| 3 | Usable for music video, some frame issues |
| 2 | Distorted motion, visible artifacts |
| 1 | Unusable (red frames, noise) |

## 7. Decision Criteria

After running the matrix:

| Outcome | Action |
|---------|--------|
| LTX 2.3 FP8 ≤ 8GB, rating ≥ 3 | Add `ltx_2_3_fp8` to `VRAM_REQUIREMENTS`, enable in adapter |
| Mochi-1 FP8 ≤ 8GB, rating ≥ 3 | Add `mochi_1_fp8` tier, build ComfyUI workflow |
| Either model > 8GB or rating < 3 | Document in `video-generation-vram-2026.md`, mark `🟢 Monitor` |
| No FP8 checkpoint available | Mark as `🔴 Requires 16GB+`, skip for this hardware |

## 8. Integration Path (Post-Validation)

If a model passes:

1. Add tier to `core/model_tiers.py` `VRAM_REQUIREMENTS`
2. Add routing in `adapters/comfyui.py` `_generate_video`
3. Add workflow builder method (`_build_ltx_fp8_workflow`, `_build_mochi_workflow`)
4. Expose via `/video-models` API endpoint
5. Update frontend `VideoGenerationPage.tsx` model selector

## See Also

- [[video-generation-vram-2026]] — Current VRAM research
- [[app-research-gaps-2026]] — Prioritized backlog
- [[hardware-verified-models]] — Validated model list
- `core/model_tiers.py` — Single source of truth for VRAM requirements
