---
tags:
  - performance
  - hardware-8gb
  - hardware-pascal
  - testing
aliases:
  - LTX/Mochi 8GB Test Protocol
  - Video Model Sweep Protocol
cssclasses:
  - performance-guide
date: 2026-09-29
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
| LTX 2.3 (GGUF Q4_K_S) | `ltx-2.3-22b-dev-Q4_K_S.gguf` | city96 GGUF mirrors |
| LTXV-2B distilled (FP8) | `ltxv-2b-0.9.8-distilled-fp8.safetensors` | `tools/scripts/download_ltx_2b.py` |
| LoRA (optional) | `ltx-video-2.3-lora.safetensors` | community |

Download to `ComfyUI/models/diffusion_models/`. The 2B checkpoint is fetched with:

```bash
# defaults to ../ComfyUI/models/diffusion_models (override with COMFYUI_ROOT or --dest)
python tools/scripts/download_ltx_2b.py [--dest PATH] [--filename NAME] [--repo ID]
```

`download_ltx_2b.py` targets `huggingface_hub` >= 1.x, where `hf_hub_download()`
no longer accepts `local_dir_use_symlinks` / `resume_download`; passing them
raises `TypeError`, so the script relies on the 1.x defaults.

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
`docs/knowledge-library/benchmarks/video-model-8gb-2026.json`. The table mirrors
`TEST_MATRIX` in `packages/backend/app/services/video_model_bench.py` — keep the
two in sync, because `--all` iterates the code-side matrix. Re-running a config
updates its row in place (one record per model / resolution / frames / precision /
format), it does not append a duplicate.

| Model key | Resolution | Frames | FPS | Precision | Format | Expected VRAM | Status |
|-----------|-----------|--------|-----|-----------|--------|---------------|--------|
| `ltxv_2b` | 512×512 | 24 | 12 | fp8 | safetensors | ~8GB | ⬜ pending |
| `ltxv_2b` | 832×480 | 24 | 12 | fp8 | safetensors | ~10GB | ⬜ pending |
| `ltx_2_3` | 512×512 | 24 | 12 | fp8 | safetensors | ~8GB | ⬜ pending |
| `ltx_2_3` | 832×480 | 24 | 12 | fp8 | safetensors | ~10GB | ⬜ pending |
| `ltx_2_3` | 512×512 | 24 | 12 | fp16 | safetensors | ~16GB | ⬜ pending |
| `ltx_2_3` | 512×512 | 24 | 12 | Q4_K_S | gguf | ~10GB | ⬜ pending |
| `mochi_1` | 512×512 | 24 | 12 | fp8 | safetensors | ~12GB | ⬜ pending |
| `mochi_2` | 512×512 | 24 | 12 | fp8 | safetensors | ~12GB | ⬜ pending |
| `mochi_1` | 512×512 | 24 | 12 | fp16 | safetensors | 16GB+ | ⬜ pending |

Tiling is no longer a matrix dimension: VAE tiling is enabled in the ComfyUI
launch flags and applies to every run.

## 4. ComfyUI Workflow Templates

The templates live in `tools/mcp/comfyui-workflows/ltx-2.3-test.json` and
`tools/mcp/comfyui-workflows/mochi-test.json`. Each file wraps the graph in a
`prompt` key, which is the body `POST /prompt` expects.
`packages/backend/tests/test_video_model_bench.py` validates every template and
every graph produced by `app.services.video_model_bench` against the installed
ComfyUI node signatures (required inputs, unknown inputs, and link slot ranges),
so a stale node name fails in the test suite instead of as `invalid_prompt` at
run time.

> [!warning] Node API rules (installed ComfyUI build, 2026-09)
> - `UNETLoader` takes `unet_name` + `weight_dtype`; there is **no** `model_file` input.
> - `DualCLIPLoader` takes only `clip_name1`, `clip_name2`, `type` and returns a
>   **single** CLIP slot — prompts must go through two `CLIPTextEncode` nodes.
> - `LTXVConditioning` takes `positive`, `negative`, `frame_rate` (not
>   `clip` / `latent` / `frame_count` / `fps`) and returns two CONDITIONING slots:
>   `[node, 0]` positive and `[node, 1]` negative.
> - Latent nodes are model-specific: `EmptyLTXVLatentVideo` and
>   `EmptyMochiLatentVideo`, each with `width`, `height`, `length`, `batch_size`.
>   There is no `EmptyLatentVideo` node.
> - `CLIPLoader` requires `type` (`"mochi"`, `"ltxv"`, `"t5xxl"`, …).
> - There is no `LTXVDecode` node — decode with `VAEDecode` fed by `VAELoader`.
> - Templates are JSON: `false` / `true`, never Python `False` / `True`.

### 4.1 LTX 2.3 (FP8, 512×512, 24 frames)

```jsonc
// tools/mcp/comfyui-workflows/ltx-2.3-test.json
{
  "prompt": {
    "1": {
      "class_type": "UNETLoader",
      "inputs": { "unet_name": "ltx-video-2.3-fp8.safetensors", "weight_dtype": "default" }
    },
    "2": {
      "class_type": "DualCLIPLoader",
      "inputs": {
        "clip_name1": "gemma_3_12B_it_fp4_mixed.safetensors",
        "clip_name2": "ltx-2.3_text_projection_bf16.safetensors",
        "type": "ltxv"
      }
    },
    "3": {
      "class_type": "CLIPTextEncode",
      "inputs": { "text": "positive prompt here", "clip": ["2", 0] }
    },
    "4": {
      "class_type": "CLIPTextEncode",
      "inputs": { "text": "negative prompt here", "clip": ["2", 0] }
    },
    "5": {
      "class_type": "LTXVConditioning",
      "inputs": {
        "positive": ["3", 0],
        "negative": ["4", 0],
        "frame_rate": 12
      }
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
        "positive": ["5", 0],
        "negative": ["5", 1],
        "latent_image": ["7", 0]
      }
    },
    "7": {
      "class_type": "EmptyLTXVLatentVideo",
      "inputs": { "width": 512, "height": 512, "length": 24, "batch_size": 1 }
    },
    "8": {
      "class_type": "VAEDecode",
      "inputs": { "samples": ["6", 0], "vae": ["9", 0] }
    },
    "9": {
      "class_type": "VAELoader",
      "inputs": { "vae_name": "LTX23_video_vae_bf16.safetensors" }
    },
    "10": {
      "class_type": "VHS_VideoCombine",
      "inputs": {
        "images": ["8", 0],
        "frame_rate": 12,
        "loop_count": 0,
        "filename_prefix": "NativeMediaAI_LTX",
        "format": "image/gif",
        "pingpong": false,
        "save_output": true
      }
    }
  }
}
```

### 4.2 Mochi (FP8, 512×512, 24 frames)

```jsonc
// tools/mcp/comfyui-workflows/mochi-test.json
{
  "prompt": {
    "1": {
      "class_type": "UNETLoader",
      "inputs": { "unet_name": "mochi-1-fp8.safetensors", "weight_dtype": "default" }
    },
    "2": {
      "class_type": "CLIPTextEncode",
      "inputs": { "text": "positive prompt here", "clip": ["3", 0] }
    },
    "3": {
      "class_type": "CLIPLoader",
      "inputs": { "clip_name": "umt5_xxl_fp16.safetensors", "type": "mochi" }
    },
    "4": {
      "class_type": "CLIPTextEncode",
      "inputs": { "text": "negative prompt here", "clip": ["3", 0] }
    },
    "5": {
      "class_type": "EmptyMochiLatentVideo",
      "inputs": { "width": 512, "height": 512, "length": 24, "batch_size": 1 }
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
        "pingpong": false,
        "save_output": true
      }
    }
  }
}
```

## 5. Execution Script

Run the module from `packages/backend` with the CUDA env active:

```bash
# Dry run — builds every graph and validates it, no ComfyUI needed
python -m app.services.video_model_bench --dry-run --all

# Live run — submits to ComfyUI and measures VRAM + time
python -m app.services.video_model_bench --model ltxv_2b --resolution 512x512 --frames 24

# GGUF variant of LTX 2.3
python -m app.services.video_model_bench --model ltx_2_3 --precision Q4_K_S --format gguf

# Full matrix
python -m app.services.video_model_bench --all
```

From the repo root, `quick_bench.py` runs the single 512×512 / 24-frame LTXV-2B
config without the VRAM sampler and writes the same results file:

```bash
python tools/scripts/quick_bench.py [--comfy-url http://127.0.0.1:8188] [--timeout 1800]
```

It polls `/history/{prompt_id}` until `status.status_str` leaves `running`, and on
failure pulls the exception from `status.messages` (`["execution_error", {...}]`).

```bash
# Regression check for the graphs, the upsert key, and the status parsing
python -m pytest tests/test_video_model_bench.py
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
  "format": "safetensors",
  "status": "success",
  "peak_vram_mb": 7200,
  "generation_time_s": 180,
  "output_path": "output/video/NativeMediaAI_LTX_...",
  "quality_rating": 3,
  "notes": "Motion smooth, minor artifacts at frame boundaries",
  "timestamp": "2026-09-28T20:00:00Z"
}
```

`status` is `success`, `error`, or `timeout`; failed runs keep the row with the
ComfyUI exception text in `error` so a aborted sweep is still auditable. Rows are
keyed on model / resolution / frames / precision / format — `format` may be
omitted by older rows and is read as `safetensors`.

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
