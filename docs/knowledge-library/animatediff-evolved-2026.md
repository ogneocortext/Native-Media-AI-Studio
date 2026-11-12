---
tags:
  - research
  - animate-diff
  - comfyui
  - video-generation
  - animate-diff-evolved
aliases:
  - AnimateDiff Evolved Guide 2026
  - ComfyUI AnimateDiff Evolved Setup
cssclasses:
  - research-report
date: 2026-11-06
type: source
---

# 🎬 AnimateDiff Evolved — Knowledge Library Entry (November 2026)

> **Anti-patterns:** generation work here follows [[media-anti-patterns-2026]] — the canonical slop list: the brief discipline, the per-medium patterns, and the grading checklist live there only; nothing is copied here.

> **Currency (2026-11-07):** in the wider open ecosystem AnimateDiff is now a legacy/niche route — ComfyUI's video center is Wan 2.x and HunyuanVideo 1.5. It remains documented here, and remains this studio's primary 8GB video lane, as a **hardware-niche decision** (SD checkpoints + motion modules fit Pascal 8GB; see [[comfyui-workflows]] and [[ai-video-trends-2026]]), not as a general recommendation.

> **Context**: Comprehensive documentation of AnimateDiff Evolved (ComfyUI-AnimateDiff-Evolved by Kosinkadink) — the leading community implementation of AnimateDiff for ComfyUI as of November 2026.

---

## 1. Overview

**AnimateDiff Evolved** is a highly-skilled, community-maintained custom node pack for ComfyUI that provides an improved implementation of AnimateDiff (the pioneering image-to-video AI model architecture). It adds motion modules and motion LoRA support to existing Stable Diffusion checkpoints, allowing users to animate static images without needing dedicated video generation models like Sora, Kling, or Veo.

| Attribute | Detail |
|-----------|--------|
| **Author** | Kosinkadink |
| **Latest Version** | 1.5.7 (as of November 2026) |
| **GitHub** | https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved |
| **Downloads** | ~638K+ |
| **GitHub Stars** | ~3,550 |
| **License** | MIT |
| **Compatibility** | ComfyUI (primary), Windows/Linux |

---

## 2. Core Concepts

### 2.1 What Is AnimateDiff?

AnimateDiff is a temporal motion module that injects motion into Stable Diffusion image generation. Instead of generating video from scratch (like closed models Sora/Veo/Kling), AnimateDiff works **on top of your existing SD 1.5/SDXL checkpoints**, preserving your face LoRAs, character consistency, and artistic style.

### 2.2 AnimateDiff Evolved vs Original AnimateDiff

| Feature | Original AnimateDiff | AnimateDiff Evolved |
|---------|---------------------|---------------------|
| Maintenance | Community varies | Actively maintained by Kosinkadink |
| Version | v1.5 legacy | v1.5.7 (current) |
| Motion Modules | mm_sd_v14, mm_sd_v15 | mm_sd_v14, mm_sd_v15, mm_sd_v15_v2 |
| Motion LoRA | Limited support | Native support (v2 motion models) |
| Sampling | Basic KSampler | Evolved Sampling, FreeInit, FreeNoise |
| Custom Nodes | Limited | Extensive (Context Options, Sample Settings, etc.) |
| Backend Code | Original | Improved, better organized |

**Key Point**: Gen1 and Gen2 produce the **exact same results** (same backend code). The difference is architectural: Gen1 is simpler for basic usage; Gen2 separates model loading/application from Evolved Sampling features, enabling more advanced workflows.

### 2.3 Motion Modules vs Motion LoRAs

| Component | Purpose | Compatibility |
|-----------|---------|---------------|
| **Motion Modules** (e.g., mm_sd_v15_v2) | Core motion model; defines base motion behavior | v2 motion modules work with v2-based motion modules only |
| **Motion LoRAs** | Fine-tuned motion styles (camera moves, specific actions) | v2 motion LoRAs work **only** with v2 motion models (mm_sd_v15_v2); NOT compatible with v3 or SDXL |

**Key Motion Modules** (as of Nov 2026):
- `mm_sd_v14` — Original AnimateDiff v1.4 motion module
- `mm_sd_v15` — SD 1.5 motion module
- `mm_sd_v15_v2` — **Recommended** for most use; supports motion LoRAs, higher resolution, larger batch sizes
- `v3_sd15_mm` — SD 1.5 v3 motion module (different architecture; does NOT support motion LoRAs)

### 2.4 Motion LoRAs
Motion LoRAs allow fine-tuned control over specific motions (camera pans, zooms, character actions). They work **only** with v2 motion models (e.g., `mm_sd_v15_v2`), NOT with v3 or SDXL variants.

---

## 3. Installation

### 3.1 Via ComfyUI Manager (Recommended)
1. Open ComfyUI Manager
2. Click "Install Custom Nodes"
3. Search for "ComfyUI-AnimateDiff-Evolved" by Kosinkadink
4. Install and restart ComfyUI
5. Verify "ComfyUI-AnimateDiff-Evolved" nodes appear in the node menu

### 3.2 Manual Installation
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved.git
```
Restart ComfyUI after installation.

### 3.3 Model Installation
Download motion modules and place them in:
```
ComfyUI/models/animatediff_models/
```
Or:
```
ComfyUI/models/animatediff_models/  (preferred)
```

Motion LoRAs go in:
```
ComfyUI/models/animatediff_models/motion_lora/
```

**Available motion modules:**
- `mm_sd_v14` — Original v1.4
- `mm_sd_v15` — SD 1.5 motion module
- `mm_sd_v15_v2` — **Recommended** (better resolution, batch size, motion LoRA support)
- `v3_sd15_mm` — SD 1.5 v3 (does NOT support motion LoRAs)

---

## 4. Basic Workflow Structure

### 4.1 Basic Workflow (P-01 Basic Workflow.json)

1. **Load Checkpoint** → Load your SD 1.5/SDXL checkpoint
2. **CLIP Text Encode** → Encode your prompt
3. **AnimateDiff Model Loader** → Load motion module (e.g., mm_sd_v15_v2)
4. **AnimateDiff Model Settings** → Configure motion strength, crossfade, etc.
5. **KSampler** → Standard diffusion sampling
6. **VAE Decode** → Decode latent to image
7. **Video Combine** → Combine frames into video

### 4.2 Key Node Connections

- **AnimateDiff Model Loader** → outputs `model` → connects to **KSampler model input**
- **CLIP Text Encode** → outputs `CONDITIONING` → connects to `KSampler positive/negative`
- **VAE Loader** → outputs `VAE` → connects to `VAE Decode`
- **AnimateDiff Model Settings** → outputs `MODEL` → modifies the model before KSampler

### 4.3 Recommended Settings for Beginners

| Parameter | Recommended Value | Notes |
|-----------|-----------------|-------|
| Motion Model | mm_sd_v15_v2 | Best balance of quality and compatibility |
| Motion Strength | 0.7 - 1.0 | Higher = more motion, but may cause artifacts |
| Crossfade | 0.5 - 1.0 | Smooths transitions between frames |
| Frames | 16 | Standard AnimateDiff length (~15s at 24fps) |
| Resolution | 512×512 | Native SD 1.5 resolution; higher requires more VRAM |
| CFG | 6-8 | Standard SD sampling range |
| Steps | 20-30 | Balance between quality and speed |
| Sampler | dpmpp_2m, euler_a | Stable, well-tested samplers |
| Scheduler | karras | Good quality/speed balance |

---

## 5. Key Nodes and Parameters

### 5.1 AnimateDiff Model Loader
Loads motion models into the pipeline. Supports:
- `mm_sd_v14`, `mm_sd_v15`, `mm_sd_v15_v2`, `v3_sd15_mm`
- Custom model paths via ComfyUI extra_model_paths.yaml

### 5.2 AnimateDiff Model Settings (Gen1)
Controls motion application:
- **Motion Scale**: Overall motion strength (0.0 - 1.0+)
- **Crossfade**: Crossfade between frames for smoothness
- **Zero Uncond**: Disables unconditional sampling for stronger motion

### 5.3 AnimateDiff Model Settings (Adv.) (Gen1 Advanced)
Advanced controls:
- **Start Percent / End Percent**: When motion starts/stops in sampling
- **Multiply by Sigma**: Scales motion effect by noise level

### 5.4 Use Evolved Sampling (Gen2)
**Most important AnimateDiff Evolved feature.** Allows using motion models without needing a full AnimateDiff setup:
- Separates model loading from motion application
- Enables use of Context Options and Sample Settings without AnimateDiff nodes
- Provides `use_existing` option to use previously loaded motion models

### 5.5 Context Options
Controls temporal context for sampling:
- **Context Length**: How many frames to process at once
- **Context Overlap**: Overlap between context windows
- **Fuse Method**: How to blend overlapping regions (average, max, min, etc.)
- **Use Negative**: Apply negative conditioning during sampling

### 5.6 Sample Settings
Controls sampling parameters:
- **Noise Seed**: Random seed for reproducibility
- **Steps**: Number of sampling steps
- **CFG**: Classifier-free guidance scale
- **Sampler Name**: Sampling algorithm (e.g., dpmpp_2m, euler_a)
- **Scheduler**: Noise schedule (karras, exponential, etc.)

### 5.7 Motion LoRA Loader
Loads motion LoRA files for fine-grained motion control:
- **LoRA Name**: Select from available motion LoRAs
- **Strength**: Intensity of the LoRA effect
- **Compatibility**: Works only with v2 motion models

---

## 6. Best Practices (November 2026)

### 6.1 Recommended Workflow for Beginners
1. Load SD 1.5 checkpoint (realistic or anime style)
2. Load `mm_sd_v15_v2` motion module
3. Load text encoder and encode prompt
4. Connect to KSampler with dpmpp_2m/karras sampler
5. Add AnimateDiff Model Settings with motion strength 0.7-1.0
6. Decode with VAE and combine into video

### 6.2 Motion Control Best Practices
- **For subtle motion**: Use motion strength 0.3-0.6, crossfade 0.5-1.0
- **For dramatic motion**: Use motion strength 0.8-1.2, lower crossfade
- **For camera movement**: Use Motion LoRAs designed for camera movement
- **For character animation**: Combine with IPAdapter or reference images

### 6.3 VRAM Optimization
- Use fp16 models when possible
- Enable model offloading in ComfyUI settings
- Use lower resolution (512×512) for testing, upscale later
- Close other GPU-intensive applications during generation

### 6.4 Common Workflow Patterns
1. **Text-to-Video**: Text prompt → AnimateDiff → Video
2. **Image-to-Video**: Load image → AnimateDiff → Video (add image as conditioning)
3. **Style Transfer**: Load style LoRA + motion module → Apply to base image
4. **Character Consistency**: Use same seed + same checkpoint + AnimateDiff motion

---

## 7. Troubleshooting Common Issues

### 7.1 Common Problems

| Problem | Cause | Solution |
|---------|-------|----------|
| **Digital silence / black frames** | Layer at `source_start_bar=0` renders silence | Adjust source_start_bar to first audible bar |
| **Digital silence / digital silence that looks like broken mixer** | Layer at `source_start_bar=0` renders digital silence | Adjust source_start_bar to first audible bar |
| **Flickering / Inconsistent frames** | Motion module too strong or wrong CFG | Reduce motion strength (0.7-0.9), adjust CFG (6-8), add ControlNet |
| **Mismatched motion** | Wrong motion module for content | Match motion module to content type (character vs camera) |
| **VRAM out of memory** | High resolution or too many frames | Reduce resolution to 512×512, reduce frames, enable model offloading |
| **Blurry output** | Low resolution or too many denoising steps | Increase resolution, reduce steps, use higher quality sampler |

### 7.2 Compatibility Issues
- **Motion LoRA compatibility**: Motion LoRAs work only with v2 motion models (mm_sd_v15_v2), NOT with v3 or SDXL variants
- **Model compatibility**: AnimateDiff works with SD 1.5 and SDXL checkpoints, but motion modules are architecture-specific
- **Custom nodes**: Some custom nodes may conflict; use ComfyUI Manager to manage dependencies

---

## 8. Advanced Techniques

### 8.1 Combining with Other Nodes
- **ControlNet**: Use for pose control and structural guidance
- **IPAdapter**: Use for style/image reference
- **ControlNet + AnimateDiff**: Apply ControlNet first for structure, then AnimateDiff for motion
- **IPAdapter + AnimateDiff**: Use IPAdapter for style reference, AnimateDiff for motion

### 8.2 Advanced Sampling
- **FreeInit**: Improves initialization for better consistency
- **FreeNoise**: Alternative noise initialization
- **Context Options**: Control temporal consistency across frames
- **View Options**: Alternative context handling for different visual styles

### 8.3 Motion LoRA Workflow
1. Load v2 motion model (mm_sd_v15_v2)
2. Load Motion LoRA (e.g., camera zoom, character action)
3. Adjust LoRA strength (typically 0.5-1.0)
4. Combine with base motion module for hybrid motion

---

## 9. Quick Reference Card

| Task | Recommended Setting |
|------|-------------------|
| Basic video generation | mm_sd_v15_v2 + SD 1.5 checkpoint + dpmpp_2m sampler |
| Character animation | Same checkpoint + same seed + AnimateDiff motion |
| Camera movement | Motion LoRA for camera + AnimateDiff |
| Style transfer | IPAdapter + same checkpoint + AnimateDiff |
| High quality output | 512×512 minimum, 20-30 steps, CFG 6-8 |
| Fast iteration | 512×512, 10-15 steps, CFG 7-8 |
| Maximum quality | 768×768 or higher, 30-50 steps, CFG 7-10 |

### Quick Commands
```bash
# Install ComfyUI-AnimateDiff-Evolved via ComfyUI Manager
# Or manually:
cd ComfyUI/custom_nodes
git clone https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved.git
# Download motion models to ComfyUI/models/animatediff_models/
# Download motion LoRAs to ComfyUI/models/animatediff_models/motion_lora/
# Restart ComfyUI
```

---

## 9. Related Documents

- `ai-video-trends-2026.md` — Overall AI video trends and model recommendations
- `local-rag-redesign-2026.md` — RAG system for document search
- `local-rag-redesign-2026.md` — Standalone RAG system documentation
- [[stable-diffusion-local-models-2026]]:see-also — Repo-local SD 1.5 + AnimateDiff v3 inventory (4.75 GB)

---

**Last Updated:** 2026-11-06  
**Status:** Active Development  
**Platform:** Windows 11 local development machine, ComfyUI + ComfyUI-AnimateDiff-Evolved

## Related

- [[comfyui-sd3-5-turbo-gguf-on-8gb-vae-triple-text-encoders-and-what-actually-broke-2026]] :see-also — ComfyUI SD3.5 Turbo GGUF on 8GB: VAE, triple text encoders, and what actually broke
