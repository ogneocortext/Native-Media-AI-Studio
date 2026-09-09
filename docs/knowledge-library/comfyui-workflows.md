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

## Model Inventory — Updated Sep 2026 (8GB GTX 1070 Ti capped)

> **Sep 2026 add**: Native ComfyUI now ships **Gemma 4** (E2B/E4B/31B) as built-in text encoder with `TextGenerate` node (128K E2B/E4B, 256K 31B, multimodal text+image+audio+video, thinking mode). Hunyuan3D updated to **3.0** (see §4d). New Sep 2026 API nodes: **VOID** (video object deletion) & **BiRefNet** (hair/fur segmentation). **Subgraphs** beta (June 2026) replaces group nodes. Model table respects **8GB local** limit:

### Installed Models (8GB-local only)

### Installed Models

| Model | Type | Path | VRAM Usage | Status |
|-------|------|------|------------|--------|
| hunyuan3D-2mini / **3.0 8GB** | 3D Diffusion | `models/diffusion_models/hunyuan3d-2mini/` or `hunyuan3d-3.0/` | ~4-5 GB | ✅ Active (geometry, 3.0 adds segmentation/UV/optimization) |
| ~~Wan 2.2 5B~~ | Video T2V/I2V (MoE) | ~~`models/diffusion_models/wan2.2_ti2v_5B/`~~ | **~16 GB ❌ Exceeds 8GB** | ⚠️ Deleted — too large for 8GB |
| Wan 2.2 14B | Video T2V/I2V MoE (dual) | `models/diffusion_models/wan2.2_t2v_14B/` | 24 GB+ (A6000/48GB) | **Cloud-only** — not for GTX 1070 Ti |
| **Gemma 4 E2B** | LLM text encoder (ComfyUI native) | `models/text_encoders/gemma-4-E2B-it` | ~2.9 GB | ✅ New Sep 2026 — fits 8GB, TextGenerate node |
| [AnimateDiff Evolved] | Stylized motion 2-16s | `custom_nodes/ComfyUI-AnimateDiff-Evolved/models/` | 8GB with `--lowvram` | ✅ Active — **primary video for 8GB** |
| [SVD] | Image→Video 2-4s | `models/checkpoints/` | 12GB+ | ❌ Not for 8GB — exceeds |
| [Add SD1.5/SDXL/SD3] | Checkpoint | `models/checkpoints/` | 2-7 GB | ✅ Add as needed (8GB-safe) |
| **BiRefNet** | Background removal (hair/fur) | `models/background_removal/birefnet.safetensors` | <2 GB | ✅ New Sep 2026 — fits 8GB |
| **VOID** | Video object deletion | API node | <4 GB | ✅ New Sep 2026 — fits 8GB |

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
POST /api/3d/generate
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

### 4d. Native Hunyuan3D 3.0 (Sep 2026 — 8GB-compatible)

> Hunyuan3D 3.0 adds production post-processing in ComfyUI: **asset segmentation** (split into plates/attachments), **UV map preparation**, **intelligent mesh optimization**. Templates in ComfyUI ≥0.34 nightly: `HunYuan3D: Text to Model`, `HY 3D: Image to Model` (2-4 multi-view). Local 8GB geometry + segmentation fits; full PBR texture still needs 12GB+ (cloud). Download `hunyuan3d-dit-v2-0-fp16.safetensors` to `models/unet/`, `hunyuan3d-delight/paint-v2-0` to `models/diffusers/`.

### 4e. Gemma 4 Native LLM (Sep 2026 — 8GB E2B)

> ComfyUI now includes Gemma 4 as built-in text encoder: `CLIPLoader` + `TextGenerate` node. **E2B (2.9GB) fits 8GB**; E4B (10GB) is cloud-only. Use for workflow description → JSON, image captioning (8 presets: tags/simple/detailed/cinematic/OCR), multimodal reasoning (image+audio+video context). Workflow: `Gemma4: Text Generation` template. Ollama alternative: `artokun/gemma4-comfyui-mcp:e2b` (8GB) for fine-tuning.

### 4f. Subgraphs & API Nodes (Sep 2026)

> **Subgraphs** (beta June 2026): collapse workflow to super-node with Input/Output slots, widget integration — replaces group nodes. **62 New API Nodes** (Flux Ultra, Veo2, etc.) — not for 8GB local but available via Comfy Cloud.

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

### Safe Settings — Updated Sep 2026 (8GB GTX 1070 Ti)

```python
# Images (8GB local)
# 512x512 - Always safe       ~4 GB  (Hunyuan3D 3.0, SD1.5, Gemma 4 E2B)
# 768x768 - With optimization ~6 GB  (use --disable-pinned-memory)
# 1024x1024 - Risky            ~8+ GB (only if nothing else on GPU)

# Video (8GB local ONLY AnimateDiff; Wan is cloud)
# 512x512 32f @8fps — AnimateDiff ~5GB ✅ primary on 1070 Ti (--lowvram)
# 480p 832x480 81f — Wan 5B ~16GB ❌ NOT for 8GB (deleted)
# 720p on A6000 cloud — 3-5 min (480p) / 8-15 min (720p); $0.02-0.09/clip

# LLM (8GB local)
# Gemma 4 E2B QLoRA — 8GB ✅ (E4B 10GB ❌)
# Phi-4 mini QLoRA — ~5-6.5GB ✅
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

## Backend Integration Fixes — 2026-09-04

> [!note] Scope
> Hardening pass over the ComfyUI integration: adapter, manager, API routes,
> workflow handler, and frontend service. All fixes verified with
> `packages/backend/tests/test_comfyui_manager.py`.

### Adapter (`app/adapters/comfyui.py`)

- **Path traversal fixed**: `/view` filenames from ComfyUI history are sanitized
  via `_sanitize_filename()` before download; the video writer additionally
  verifies the resolved output path stays inside `output/video/`.
- **Video timeout fixed**: was `num_frames * fps * 2` (the clip duration —
  guaranteed timeout for any real generation); now `max(600, num_frames * fps * 2)`.
- **Seed handling**: `seed = 0` is respected as a fixed seed (`_resolve_seed`),
  not silently treated as "random". Sampler names are normalized via
  `_map_sampler()` / `SAMPLER_MAP`.
- **Dead AnimateDiff node removed**: the unused
  `ADE_AnimateDiffUniformContextOptions` node ("6") is no longer emitted.
- **`_wait_for_video_result`** also checks output under `"videos"`
  (VideoHelperSuite nodes don't always report under `"gifs"`).
- **Prompt submit errors** include the response body (first 500 chars).

### Manager (`app/services/comfyui_manager.py`)

- **`start(extra_args=...)` is honored** — appended after the built-in
  `EXTRA_ARGS`.
- **Git executable discovery cached** (`_find_git()`); version checks no longer
  fail when `git` is only available at a known install path.
- **Version info cached 30s** (`VERSION_CACHE_TTL`) — the UI polls `/status`
  frequently and each check previously spawned git subprocesses including a
  network `git fetch`.
- **Ahead/behind fixed**: now `HEAD...@{upstream}` (with `origin/master`
  fallback) — the previous `origin/master...HEAD` comparison labeled "behind"
  as "ahead".
- **stderr reader task is stored** (`self._stderr_task`) and cancelled on stop —
  unreferenced asyncio tasks can be garbage-collected mid-flight.
- **`is_running()` recovers**: after a managed process dies, the dead handle is
  cleared and the port check runs, so an externally-started ComfyUI is
  detected again.
- **Video download fixed**: `/view` uses proper query params
  (filename/subfolder/`type=output`) instead of a raw unencoded URL, and keeps
  the real file extension instead of forcing `.mp4`.

### API (`app/api/comfyui.py`)

- All blocking calls (`get_status`, `get_version`, `stop`, restart's stop step)
  run via `asyncio.to_thread` — previously they blocked the event loop on every
  UI status poll.

### Workflow Handler (`app/services/comfyui_workflow_handler.py`)

- **Images are written to disk**: the adapter's base64 result is decoded to
  `output/images/<timestamp>_<uuid>.png`. Previously the job reported an
  `output_path` that was never created.
- **Videos honor the adapter's `video_path`** (the file actually written by
  `_fetch_video`) instead of fabricating a nonexistent `.mp4` path.
- Raises a clear error when the adapter returns no image data.

### Frontend (`services/comfyui.ts`)

- **`queuePrompt` surfaces ComfyUI's error JSON**: `error` and a per-node
  summary of `node_errors` are included in the thrown `ComfyUIError`.
- **Object URL leak fixed**: `revokeImage()` helper added for `useEffect`
  cleanup of URLs created by `getImage()`.

### Test Suite

- `packages/backend/tests/test_comfyui_manager.py` is now tracked in git
  (the blanket `test_*.py` ignore rule was hiding it) and mocks
  `is_running()` so it passes even while ComfyUI is running on port 8188.

---

*Last updated: 2026-09-09 — Sep 2026 sweep: Gemma 4 native (E2B 8GB), Hunyuan3D 3.0, VOID/BiRefNet, Subgraphs, 8GB-capped tables*
