# 3D Generation Models for GTX 1070 Ti (8GB VRAM)

*Research gathered 2026-08-23*

## Best Models for 8GB VRAM

### 1. Hunyuan3D-2mini (Tencent) — RECOMMENDED
- **VRAM**: ~5-6 GB for shape generation (fits comfortably on 8GB)
- **Architecture**: 0.6B parameter flow-based diffusion transformer
- **Modes**: text-to-3D, image-to-3D, multi-view
- **Variants**: Standard, Fast (2x faster), Turbo (10x faster)
- **GPU-Poor support**: `deepbeepmeep/Hunyuan3D-2GP` runs on 6GB with `--profile 4`
- **ComfyUI**: Native support + Kijai wrapper for textures
- **HuggingFace**: `tencent/Hunyuan3D-2mini`
- **License**: Permissive (Tencent)

### 2. Trellis 2 GG UF (Microsoft + ArrowX fork) — HIGH QUALITY
- **VRAM**: ~6 GB at Q4, ~8 GB at Q5-Q8
- **Architecture**: 4B parameter (GG UF compressed to ~half)
- **Modes**: Image-to-3D with PBR textures
- **Quality**: Near-identical to full model at Q4 (visually indistinguishable)
- **ComfyUI**: Custom fork by ArrowX with GGUF model loader
- **HuggingFace**: Search "Trellis 2 GGUF" for quantized versions
- **License**: Research (verify commercial use)

### 3. Cube3D INT4 (Roblox) — TOO LARGE
- **VRAM**: 14.3 GB at INT4 (does NOT fit on 8GB)
- Not suitable unless using cloud/offloading

## Recommended Pipeline for This Project

1. **Shape Generation**: Hunyuan3D-2mini Turbo via ComfyUI
   - Fast (turbo), fits in 5-6GB, good quality
   - Can run locally in `venv_backend` or `comfyui-cuda` conda env

2. **Texture/Refinement**: Trellis 2 GG UF at Q4 if VRAM allows
   - Otherwise use Hunyuan3D-Paint (needs ~16GB, run via cloud API)

3. **Blender Integration**: Import generated .glb/.obj into Blender scenes
   - Use for music video backgrounds, props, characters
   - GPU render with Cycles CUDA

## Installation Paths

- **ComfyUI location**: `<your-comfyui-root>`
- **Custom nodes**: `<your-comfyui-root>/custom_nodes/` (already has AnimateDiff, WanVideo)
- **Conda env with CUDA**: `<your-conda-envs>/comfyui-cuda` (PyTorch 2.5.1+cu124)
- **Project venv**: `<your-project-root>/runtime/venvs/.venvs/venv_backend` (PyTorch 2.5.1+cu124)

## Notes

- Hunyuan3D-2.1 (newer) needs 10GB+ for shape — too large for 8GB
- Hunyuan3D-2mini + GP (GPU Poor) profile 4 is the sweet spot
- ComfyUI-Hunyuan3DWrapper (Kijai) enables full texture pipeline
- For 8GB: generate shapes locally, use cloud API or CPU fallback for textures
