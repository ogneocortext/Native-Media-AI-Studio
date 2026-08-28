---
tags:
  - comfyui
  - ai-generation
  - workflows
  - image-generation
  - video-generation
aliases:
  - ComfyUI Workflows
  - Custom Workflows
  - ComfyUI Integration
cssclasses:
  - technical-guide
date: 2026-08-24
---

# 🎨 ComfyUI Workflows

> [!info] Scope
> Custom ComfyUI workflows for music video production.
> Covers image generation, video generation, and 3D model creation.

---

## System Overview

> [!note] ComfyUI Instance
> - **Location:** `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`
> - **Port:** 8188
> - **API:** REST API for programmatic control
> - **MCP Integration:** Available via `comfyui-mcp`

---

## Model Inventory — Updated Aug 2026

### Installed Models

| Model | Type | Path | VRAM Usage | Status |
|-------|------|------|------------|--------|
| hunyuan3D-2mini | 3D Diffusion | `models/diffusion_models/hunyuan3d-2mini/` | ~4 GB | ✅ Active (geometry) |
| ~~Wan 2.2 5B~~ | Video T2V/I2V (MoE) | ~~`models/diffusion_models/wan2.2_ti2v_5B/`~~ | **~16 GB ❌ Needs 16GB+ GPU** | ⚠️ Deleted — too large for 8GB |
| Wan 2.2 14B | Video T2V/I2V MoE (dual: high+low noise) | `models/diffusion_models/wan2.2_t2v_14B/` | 24 GB+ (A6000/48GB) | Cloud option |
| [AnimateDiff Evolved] | Stylized motion 2-16s | `custom_nodes/ComfyUI-AnimateDiff-Evolved/models/` | 8GB with `--lowvram` | ✅ Active |
| [SVD] | Image→Video 2-4s | `models/checkpoints/` | 12GB+ | Optional |
| [Add your SD1.5/SDXL] | Checkpoint | `models/checkpoints/` | Varies | Add as needed |

> [!warning] Wan 2.2 5B/14B models deleted — too large for 8GB GPU
> The Wan 2.2 5B model (`wan2.2_ti2v_5B_fp16.safetensors`, 9.5GB), UMT5 XXL text encoder (`umt5_xxl_fp8_e4m3fn_scaled.safetensors`, 6.4GB), and associated text encoder (`model.safetensors`, 8.9GB) have been deleted. They require 16-24GB VRAM and will OOM on GTX 1070 Ti (8GB). **Do not re-download these models.** Use AnimateDiff Evolved for video generation instead — it works with your 8GB GPU using `--lowvram` mode.

### Model Management

> [!tip] Adding Models
> 1. Download model file (`.safetensors`, `.ckpt`)
> 2. Place in appropriate `models/` subdirectory
> 3. Restart ComfyUI or refresh model list
> 4. Verify in ComfyUI web UI

---

## Workflow Types

### 1. Text-to-Image (Txt2Img)

> [!example] Basic Image Generation
> Generate a single image from text prompt:

```python
# Via comfyui-mcp
comfyui_generate_image(
    action="image",
    prompt="a happy shrimp dancing, underwater disco, neon lights",
    negative_prompt="blurry, low quality",
    width=512,
    height=512,
    steps=20,
    cfg=7.0,
    sampler="euler",
    scheduler="normal"
)
```

**Parameters:**

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| width | 256-2048 | 512 | Image width (multiple of 64) |
| height | 256-2048 | 512 | Image height (multiple of 64) |
| steps | 1-100 | 20 | More = slower but better quality |
| cfg | 1-20 | 7.0 | Higher = more prompt-faithful |
| sampler | varies | euler | Affects style/quality |
| scheduler | varies | normal | Affects generation curve |

### 2. Image-to-Image (Img2Img)

> [!example] Style Transfer
> Transform an existing image with new prompt:

```python
comfyui_generate_image(
    action="img2img",
    prompt="underwater disco, neon lights",
    image_path="input_frame.png",
    denoise=0.6,  # 0=original, 1=completely new
    steps=20,
    cfg=7.0
)
```

### 3. ControlNet

> [!tip] Controlled Generation
> Use ControlNet for pose/depth/edge guidance:

```python
comfyui_generate_image(
    action="controlnet",
    prompt="a shrimp dancing",
    control_image="pose_skeleton.png",
    controlnet_model="openpose",
    prompt="a happy shrimp dancing, colorful background"
)
```

### 4. 3D Model Generation (Hunyuan3D-2mini — existing)

> [!example] Text-to-3D
> Generate 3D models from text or images:

```python
# Via API endpoint
POST /api/health/3d/generate
{
    "prompt": "a futuristic robot",
    "steps": 15
}
```

### 4b. Video Generation — Wan 2.2 (New, 2026, fits 8GB)

> [!important] Open-Weights, Apache 2.0 — weights on Hugging Face. MoE: high-noise expert (layout/motion) + low-noise expert (detail), handoff by SNR. +65.6% images / +83.2% videos training vs 2.1. Fixes motion artifacts, character drift, camera responsiveness.

**Modes (all via official ComfyUI templates ≥0.3.46):**

| Mode | Input | Template | Frames | Notes |
|------|-------|----------|--------|-------|
| **T2V 5B** | Text | `TI2V-5B` | 81f @ 480p | Single file `wan2.2_ti2v_5B_fp16` + `wan2.2_vae` + `umt5_xxl_fp8_e4m3fn_scaled` |
| **T2V 14B** | Text | `T2V 14B` | 81f @ 480-720p | Dual: `wan2.2_t2v_high_noise_14B_fp8_scaled` + `wan2.2_t2v_low_noise_14B_fp8_scaled` + `wan_2.1_vae` |
| **I2V 5B/14B** | Image | `I2V` | 81f | Image-conditioned; better character consistency |
| **FLF2V (First-Last-Frame)** | 2 images | `FLF2V` | Interp | Smooth continuous transforms; conservative on distant keyframes |
| **ControlNet (WanFunControl)** | Video reference | `VideoX-Fun` node | — | Canny/Depth/OpenPose/MLSD drives motion, prompt drives appearance |

**ComfyUI install (5B path) — ⚠️ NOT FOR 8GB GPUs:**
```bash
# ⚠️ WARNING: These models require 16-24GB VRAM and will OOM on GTX 1070 Ti (8GB)
# DO NOT DOWNLOAD — they have been deleted from this machine
# text_encoder/umt5_xxl_fp8_e4m3fn_scaled.safetensors  (6.4GB - TOO LARGE)
# text_encoder/model.safetensors  (8.9GB - TOO LARGE)
# vae/wan2.2_vae.safetensors (5B) or vae/wan_2.1_vae.safetensors (14B)
# diffusion_models/wan2.2_ti2v_5B_fp16.safetensors  (9.5GB - TOO LARGE)
# or diffusion_models/wan2.2_t2v_high_noise_14B... + low_noise_14B...
```
**For 8GB video generation:** Use AnimateDiff Evolved instead (see section 4c).

**For 8GB rig:** Wan 2.2 5B was previously listed as an option but has been removed — it requires ~16GB VRAM with all components. Use **AnimateDiff Evolved** for video generation on 8GB GPUs (works with `--lowvram`). For Wan 2.2, use cloud (RTX A6000 48GB ~8-15 min/720p). More offloading = slower but feasible — on 6GB GPU it is a learning tool, not production.

### 4c. Animation Alternatives — AnimateDiff & SVD (Stylized vs Realistic)

| Method | Duration | Style | Input | VRAM Comfort | Use For |
|--------|----------|-------|-------|--------------|---------|
| **AnimateDiff Evolved** | 2-16s | Stylized artistic | Text/image + motion model `mm_sd15_v3` / `mm_sd_v15_v2` | ✅ 8GB with `--lowvram` | Character loops, motion graphics — **primary video method for 8GB** |
| **SVD** | 2-4s | Realistic natural | Static image | 12GB+ | Product/scene subtle motion |
| **Frame-by-frame + FILM/RIFE interp** | Unlimited | Depends on base | Prompts + prev frames | Base model VRAM | Long-form precise control |

- ControlNet for animation: OpenPose (pose), Canny (structure), Depth (3D), Temporal variants.
- Motion LoRAs: camera, gesture, loop. Stack on motion model.
- FPS: 12 anime, 24 film, 30 smooth. Use closed-loop setting for perfect loops.

> [!note] Audio: ComfyUI doesn't handle audio — export video then add audio in Remotion/FFmpeg. See [[technical-reference#audio-analysis-service]].

### 5. Upscaling

> [!note] Super-Resolution
> Upscale generated images for higher quality output:

```python
comfyui_generate_image(
    action="upscale",
    image="generated_image.png",
    model="4x-ClearRealityV1",
    scale=2  # or 4
)
```

### 6. Background Removal

> [!tip] Transparent Cutouts
> Remove backgrounds for compositing:

```python
comfyui_generate_image(
    action="remove_background",
    image="character_image.png"
)
```

---

## Sampler & Scheduler Guide

### Samplers

| Sampler | Speed | Quality | Best For |
|---------|-------|---------|----------|
| euler | Fast | Good | General purpose |
| euler_ancestral | Fast | Artistic | Stylized images |
| dpmpp_2m | Medium | Very Good | Balanced |
| dpmpp_3m_sde | Slow | Excellent | Maximum quality |
| ddim | Fast | Good | Quick iterations |
| uni_pc | Fast | Good | Fast preview |

### Schedulers

| Scheduler | Effect |
|-----------|--------|
| normal | Standard generation |
| karras | Smoother noise curve |
| exponential | More detail at end |
| sgm_uniform | Improved consistency |
| simple | Fast, simple curve |

---

## Memory Optimization

> [!warning] VRAM Management
> For 8GB VRAM (GTX 1070 Ti):

### Safe Settings — Updated for 2026 Models

```python
# Images
# 512x512 - Always safe       ~4 GB  (hunyan3D, SD1.5)
# 768x768 - With optimization ~6 GB  (use --disable-pinned-memory)
# 1024x1024 - Risky            ~8+ GB (only if nothing else on GPU)

# Video (Wan 2.2)
# 480p 832x480 81f — 5B ~6-8GB ✅ primary on 1070 Ti (GGUF+offload)
# 720p 1280x720 81f — 5B ~8GB tight / 14B 24GB+ (needs cloud A6000)
# 720p on A6000 — 3-5 min (480p) / 8-15 min (720p); $0.02-0.09/clip
```

### Optimization Flags

```bash
# Start ComfyUI with memory optimization
python main.py --port 8188 --disable-pinned-memory

# For low VRAM (<8GB)
python main.py --lowvram

# For very low VRAM (<4GB)
python main.py --novram
```

---

## Batch Generation

> [!example] Generate Multiple Variations
> Create multiple versions to choose from:

```python
comfyui_batch(
    action="submit",
    workflow=base_workflow,
    sweep=[
        {"6.text": "happy shrimp dancing"},
        {"6.text": "happy shrimp singing"},
        {"6.text": "happy shrimp celebrating"},
    ]
)
```

---

## API Reference

### Queue Management

```python
# Check queue status
comfyui_queue(action="list")  # Show all jobs
comfyui_queue(action="status", prompt_id="...")  # Single job status
comfyui_queue(action="cancel", prompt_id="...")  # Cancel job
```

### History & Outputs

```python
# Get generation history
comfyui_get_history(action="list")  # All completed jobs

# Get specific output image
comfyui_get_image(action="get", filename="output_00001_.png")
```

### System Stats

```python
# Check GPU/CPU status
comfyui_get_system_stats(action="stats")
# Returns: GPU name, VRAM usage, PyTorch version, etc.
```

---

## Wan 2.2 Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Needs C compiler + python3-devel | Wan 2.2 build on Linux | `sudo zypper install gcc python3-devel` |
| OOM at default 720×1280 | 14B default res | Reduce to 832×480 for 8GB |
| Want flash-attention speed | Not installed | Add flash-attn → 2-3× faster (see ComfyUI discussion 2026-01) |
| Two model nodes empty | 14B MoE needs both | Load high_noise + low_noise fp8_scaled |

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `CUDA out of memory` | Image too large | Reduce resolution |
| `Model not found` | Wrong path | Check model location |
| Slow generation | CPU fallback | Verify CUDA installation |
| Black output | Wrong model | Check model compatibility |
| Import error | Missing dependency | Install in correct env |

### Debug Commands

```bash
# Check CUDA availability
python -c "import torch; print(torch.cuda.is_available())"

# Check VRAM
python -c "import torch; print(f'{torch.cuda.mem_get_info()[0]/1024**3:.2f} GB free')"

# List ComfyUI models
curl http://localhost:8188/models
```

---

## See Also

- [[music-video-production]] — Full production workflow
- [[3d-rendering]] — GPU rendering optimization
- [[prompt-engineering]] — Better prompts for generation
- [[technical-reference]] — System architecture
- [[blender-mcp]] — Blender integration

---

## Backend API Integration

### Architecture

The application interacts with ComfyUI through multiple layers:

```
Frontend (React) → Backend (FastAPI) → ComfyUI REST API (port 8188)
                 ↘ Direct (browser) → ComfyUI REST API (port 8188)
```

**Frontend paths:**
- `packages/frontend/src/services/comfyui.ts` — Direct ComfyUI calls (image generation, model listing)
- `packages/frontend/src/services/api.ts` — Backend-proxied calls (job queue, progress)

**Backend paths:**
- `packages/backend/app/adapters/comfyui.py` — Core adapter (health, generation, workflow building)
- `packages/backend/app/services/comfyui_manager.py` — Process lifecycle (start/stop/update)
- `packages/backend/app/services/gen3d/gen3d_service.py` — 3D generation via Kijai Wrapper
- `packages/backend/app/api/integrations_generation.py` — REST endpoints for generation
- `packages/backend/app/api/comfyui.py` — REST endpoints for process management

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/services/comfyui/status` | GET | Process status (installed, running, version) |
| `/api/services/comfyui/start` | POST | Start ComfyUI headlessly |
| `/api/services/comfyui/stop` | POST | Stop ComfyUI |
| `/api/services/comfyui/restart` | POST | Restart ComfyUI |
| `/api/services/comfyui/update` | POST | Git pull + restart |
| `/api/services/comfyui/version` | GET | Git version info |
| `/api/integrations/{service}/generate` | POST | Submit image generation job |
| `/api/integrations/{service}/result/{prompt_id}` | GET | Get completed result |
| `/api/integrations/comfyui/progress/{prompt_id}` | GET | Poll generation progress |
| `/api/integrations/{service}/generate-video` | POST | Submit video generation job |
| `/api/integrations/comfyui/checkpoints` | GET | List available checkpoints |
| `/api/integrations/comfyui/video-models` | GET | List video motion modules |

### Input Validation

Generation requests are validated at the API layer:

| Parameter | Range | Notes |
|-----------|-------|-------|
| steps | 1-150 | Sampler steps |
| cfg_scale | 0.0-30.0 | Classifier-free guidance |
| width, height | 64-4096, multiple of 8 | Image dimensions |
| num_frames | 1-256 | Video frames |
| fps | 1-60 | Video frame rate |

### Error Handling

- All ComfyUI API calls use `async`/`await` with proper timeout handling
- Failed requests return structured error responses with `status: "error"`
- The `ComfyUIError` class (frontend) provides typed error handling
- Blocking I/O is avoided in async contexts
- External ComfyUI processes (not started by manager) are detected and reported

---

*Last updated: 2026-08-28*
