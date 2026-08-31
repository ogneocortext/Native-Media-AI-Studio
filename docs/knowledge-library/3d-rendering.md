---
tags:
  - 3d-rendering
  - gpu
  - optimization
  - blender
  - comfyui
  - webgpu
  - visualization
aliases:
  - 3D Rendering Guide
  - GPU Rendering
  - Rendering Optimization
cssclasses:
  - technical-guide
date: 2026-08-29
---

# 🧊 3D Rendering

> [!info] Scope
> GPU-accelerated 3D rendering for music video production.
> Covers Blender Cycles/EEVEE, CUDA optimization, and VRAM management.

---

## What Changed in 2026 — TL;DR for App

- **Blender 5.1:** GPU rendering +10% various benchmark scenes, CPU Windows +20%, AMD HIP RT default enabled — free perf if you upgrade from 5.2 LTS path. Docs: blender.org 5.1 release.
- **Blender 5.2 LTS EEVEE Next:** Ground-up rewrite — screen-space raytracing overhaul (energy-conserving), Fast GI, better probe lighting; ray-traced shadows/GI are slower → enable only when needed. Viewport rewrite fixes 3 fps stutter on heavy scenes; if <24 fps, optimize.
- **Backend choice is 30-50%:** Edit → Preferences → System → Cycles Render Devices. NVIDIA RTX → **OptiX** (fastest); GTX 1070 Ti → CUDA (no RT cores). Check GPU box + set Render Properties Device → GPU Compute; CPU+GPU combined helps only if CPU is high-core, else GPU alone.
- **Decimation matters:** `Collapse` = general/LOD target-ratio; `Un-Subdivide` only reverses Subsurf (no-op otherwise); `Planar` for flat surfaces. Use instances not duplicates, merge by distance, remove custom split normals, UDIM atlases.

---

## Hardware Reference

### GPU: NVIDIA GeForce GTX 1070 Ti (8GB VRAM)

| Task | Max Resolution | VRAM Usage | Notes |
|------|---------------|------------|-------|
| Image Generation (SD) | 512×512 | ~4 GB | Safe for 8GB VRAM |
| Image Generation (SDXL) | 768×768 | ~6 GB | Use `--disable-pinned-memory` |
| 3D Generation (Hunyuan3D-2mini) | Default | ~4 GB | Optimized for 8GB |
| Blender EEVEE Render | 1080p | ~2 GB | Real-time engine |
| Blender Cycles Render | 1080p | ~3-4 GB | CUDA acceleration |
| Video Decode/Encode | 1080p | ~1 GB | NVENC/NVDEC |

### VRAM Budget (8GB Total)

```
┌─────────────────────────────────────────────────────────┐
│ 8GB VRAM Budget                                         │
├─────────────────────────────────────────────────────────┤
│ OS + Desktop Compositor  │ ████████░░░░░░░░░░░░  ~1.5GB │
│ Available for Rendering  │ ██████████████░░░░░░  ~6.5GB │
│ Safety Margin            │ ██░░░░░░░░░░░░░░░░░░  ~1.0GB  │
│ Usable Peak              │ ████████████░░░░░░░░  ~5.5GB  │
└─────────────────────────────────────────────────────────┘
```

---

## Blender Rendering

### Cycles (CUDA) Settings for 8GB VRAM

> [!tip] Optimal Settings
> For music video frames at 1080p on GTX 1070 Ti:

```python
import bpy

# Render settings
bpy.context.scene.cycles.device = 'GPU'
bpy.context.scene.render.resolution_x = 1920
bpy.context.scene.render.resolution_y = 1080
bpy.context.scene.cycles.samples = 128  # Balance quality/speed
bpy.context.scene.cycles.use_denoising = True
bpy.context.scene.cycles.denoiser = 'OPENIMAGEDENOISE'

# Memory optimization
bpy.context.scene.cycles.use_auto_tile = True
bpy.context.scene.cycles.tile_size = 256  # Smaller tiles = less VRAM
bpy.context.scene.render.use_persistent_data = True  # Reuse data between frames
```

### EEVEE Next (Real-Time) Settings — 2026

> [!tip] Fast Previews (EEVEE Next is rewrite, not incremental)
> Use EEVEE for real-time preview and quick renders — now with screen-space raytracing + Fast GI:

```python
bpy.context.scene.render.engine = 'EEVEE_NEXT'  # or 'BLENDER_EEVEE_NEXT' in 4.x API
bpy.context.scene.eevee.taa_render_samples = 64  # 64 is typically sufficient; ray-tracing adds cost
bpy.context.scene.eevee.use_ssr = True  # Screen Space Reflections (new raytracing path — disable if not needed)
bpy.context.scene.eevee.use_ssao = True  # Ambient Occlusion
bpy.context.scene.eevee.use_gtao = True  # Ground Truth AO
# New 5.2 toggles: raytracing, shadow maps, probe volume — enable selectively (each adds seconds/frame)
# Performance killers to check if frame >1 min: high samples, high-res shadows × many lights, volumetrics
```

> [!warning] EEVEE Next trade-off: enabling ray-traced shadows/GI makes it behave like Cycles (slower). Use for finals, skip for previz if targeting mid-tier Android FPS budget (drop <5%). See `VISUAL_STORYTELLING_2026.md:79` mindful layering budget.

### Render Time Estimates (1080p, 24fps, 10s clip = 240 frames)

| Engine | Samples | Per Frame | Total (240 frames) |
|--------|---------|-----------|-------------------|
| EEVEE | 64 | ~2s | ~8 min |
| Cycles (Fast) | 64 | ~15s | ~60 min |
| Cycles (Quality) | 128 | ~30s | ~120 min |
| Cycles (Max) | 256 | ~60s | ~240 min |

---

## CUDA Optimization

### PyTorch/CUDA Best Practices

> [!warning] Memory Management
> Always free VRAM between large operations:

```python
import torch

# Clear cached memory
torch.cuda.empty_cache()

# Check available VRAM
free = torch.cuda.mem_get_info()[0] / (1024**3)
print(f"Free VRAM: {free:.2f} GB")
```

### Common OOM Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `CUDA out of memory` | Model too large | Reduce resolution or batch size |
| `CUBLAS error` | Matrix too big | Reduce image dimensions |
| Slow generation | CPU fallback | Check `torch.cuda.is_available()` |

---

## 3D Model Generation

### Hunyuan3D-2mini Pipeline

> [!note] Model Location
> `ComfyUI/models/diffusion_models/hunyuan3D-2mini`

**Workflow:**
1. Text prompt → Image generation (512×512)
2. Generated image → 3D mesh generation
3. Mesh export as `.glb` or `.obj`

**Prompt Structure for 3D Assets:**
```
[object], [material], [style], [orientation], [detail_level]
```

**Examples:**
- `a futuristic robot, chrome metallic, standing pose, highly detailed`
- `a neon microphone, cyberpunk style, floating, glowing accents`
- `a DJ console, modern minimalist, LED indicators, top-down view`

---

## Beat-Synced Rendering

### Animation Timing

> [!tip] Sync to Music
> Render frames aligned to beat timestamps for automatic sync:

```python
# Beat times from audio analysis
beat_times = [0.0, 0.5, 1.0, 1.5, 2.0, ...]

# Camera cuts on beats
for frame in range(total_frames):
    time = frame / fps
    if time in beat_times:
        # Trigger camera change or effect
        pass
```

### Keyframe Animation for Music Videos

1. **Beat Cuts** → Frame cuts on strong beats
2. **Energy Builds** → Camera movement accelerates
3. **Chorus Peak** → Maximum visual impact
4. **Outro Wind-down** → Slow defocus, fade out

---

## Export Settings

### Video Export for YouTube

```python
bpy.context.scene.render.image_settings.file_format = 'FFMPEG'
bpy.context.scene.render.ffmpeg.format = 'MPEG4'
bpy.context.scene.render.ffmpeg.codec = 'H264'
bpy.context.scene.render.ffmpeg.constant_rate_factor = 'MEDIUM'
bpy.context.scene.render.ffmpeg.ffmpeg_preset = 'GOOD'
```

### Resolution Guide

| Platform | Resolution | Aspect Ratio | Bitrate |
|----------|------------|--------------|---------|
| YouTube | 1920×1080 | 16:9 | 16 Mbps |
| YouTube 4K | 3840×2160 | 16:9 | 44 Mbps |
| YouTube Shorts | 1080×1920 | 9:16 | 12 Mbps |
| TikTok | 1080×1920 | 9:16 | 12 Mbps |

---

## Troubleshooting

### Rendering Too Slow
- Reduce samples (128 → 64)
- Use EEVEE instead of Cycles
- Lower resolution (1080p → 720p)
- Enable tile rendering (256px tiles)

### Out of Memory
- Close other GPU applications
- Reduce render resolution
- Use smaller batch sizes
- Clear CUDA cache between operations

### Black Frames
- Check lighting setup
- Verify camera position
- Ensure materials are not pure black
- Check render layers

---

## WebGPU & Modern Web Rendering — 2026 Update

> [!info] New companion: [[visualization-effects|✨ Visualization Effects]] covers the full shader/particle/post-processing library. This section summarizes the browser-side pipeline for `three-js-studio`.

### WebGPURenderer (Three.js r185)

- **Import path**: `import * as THREE from 'three/webgpu'` + `await renderer.init()` — WebGPU is async; `setAnimationLoop` awaits automatically, custom RAF must await manually. Fallback to WebGL2 is automatic (`forceWebGL:true` only for debug).
- **TSL**: Replaces GLSL `ShaderMaterial`/`onBeforeCompile` — write `Fn()` nodes once, compiled to WGSL or GLSL. Never mix `from 'three'` + `from 'three/webgpu'` (bundles 2× renderer).
- **Post-processing**: `EffectComposer` → `RenderPipeline` node graph — built-in MRT, new **SSGI/SSS/DoF** exclusive to WebGPU, 2× faster merge. Bloom now via `RenderPipeline` node, not `UnrealBloomPass`.
- **Compressed textures**: `KTX2Loader.detectSupport(renderer)` must run *after* `renderer.init()` — before = silent black meshes.

### Compute Particles — Why 1M is Now Possible

WebGL copied CPU positions every frame (~50k ceiling). WebGPU keeps `StorageBufferAttribute` in VRAM + `renderer.compute()` — **100k in <2ms, 1M+ with tuning** (workgroup 256–512). See [[visualization-effects#4. Particle Systems|Visualization Effects §4]] for full recipe.

### Clustered Lighting

WebGPU adds **Forward+ clustered shading** — hundreds of dynamic lights without the forward-renderer cliff. Critical for concert-stage scenes with many spot/point lights.

### Performance Checklist (Utsubo 100 Tips distilled)

- Draw calls <100, 60fps locked, profile `renderer.info` + `stats-gl`
- `InstancedMesh` for repeats, Draco+KTX2 via `gltf-transform`, DPR capped 1.5–2.0
- Proper dispose traversal on removal (`geometry/material.dispose()`)
- Keep audio updates outside React (`useFrame` + refs, reuse `Float32Array`)

---

## Blender 5.2 LTS — Expanded Notes (Aug 2026)

Supplement to [[visualization-effects#6. Blender 5.2 LTS|Visualization Effects §6]]:

- **2× instancing perf** for CPU-bottlenecked scenes (HandleRange PR, Vulkan+GL)
- **Screen-tracing overhaul**: `Backface` slider to cut GI light leaks, removed `Far Thickness` (halo fix), energy-conserving darker look may need thickness tweak
- **Fast GI**: faster + less noise at `precision <1`, fixed AO leakage/pixelation/1-frame reproject lag
- **Raycast Node**: precise intersections, no false positives toward camera
- **Shadow budget**: 1.5/2 GB options — tune per-light shadow maps (1024→4096), not globally
- **Hybrid workflow**: lookdev in EEVEE Next (raytracing ON) → finals in Cycles (OptiX denoise) → comp via AOVs. If scene has no glass/caustics/off-screen mirrors, EEVEE *is* final.

---

## Gaussian Splatting & NeRF (3DGS)

- **What**: Photoreal scans as splat clouds — import via `@mkkellogg/gaussian-splats-3d` in Three.js, native support emerging in Blender 5.x
- **When to use**: Real environments/objects scanned with phone, not modeled; far cheaper than manual geometry for music-video B-roll
- **Cost**: VRAM-heavy (each splat = position+scale+rotation+SH), but rasterized fast on WebGPU; no compute needed

---

## See Also

- [[visualization-effects|✨ Visualization Effects & 3D Rendering Techniques]] — Full 2026 effects library (shaders, particles, post, volumetrics, audio mapping, 8 engines)
- [[music-video-production]] — Full production workflow
- [[blender-mcp]] — Blender MCP integration
- [[comfyui-workflows]] — ComfyUI for image/video generation
- [[three-js-studio]] — Browser studio implementation
- [[technical-reference]] — System architecture
- [[prompt-engineering]] — Better prompts for 3D assets

---

*Last updated: 2026-08-29 — expanded with WebGPU/TSL compute path, Blender 5.2 LTS, 3DGS, and link to new Visualization Effects library*
