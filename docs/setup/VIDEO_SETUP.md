# Video Generation Setup Guide

> [!info] Rewritten 2026-11 to match on-disk reality
> ComfyUI is an external install at `D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI`
> (there is no `stable-diffusion/` or `third_party/ComfyUI` tree, and
> `scripts\setup-video-models.bat` does not exist). All models listed below are
> already downloaded — this is a reference, not a setup checklist.

## Overview

Video generation runs through the external ComfyUI instance (`http://127.0.0.1:8188`)
driven by the backend's ComfyUI adapter (`POST /api/integrations/comfyui/generate-video`)
and the WanVideoWrapper / AnimateDiff-Evolved custom nodes.

## What's on disk (verified)

| Model | Location | Size | Role |
|-------|----------|------|------|
| Wan 2.2 TI2V-5B GGUF Q4_K_M | `models/diffusion_models/` | 3.2 GB | Primary 8 GB video model (T2V/I2V, 480p–720p) |
| Wan 2.2 VAE | `models/vae/wan2.2_vae.safetensors` | — | Wan 2.2 decode |
| umt5-xxl text encoder (fp8) | `models/text_encoders/` | — | Wan 2.2 prompt encoding |
| AnimateDiff v2 motion module | `models/animatediff_models/mm_sd_v15_v2.ckpt` | 1.7 GB | SD1.5 motion (`--lowvram` friendly) |
| AnimateDiff v3 motion module | `models/animatediff_models/mm_sd15_v3.safetensors` | 798 MB | Newer motion module |
| SD 1.5 base | `models/checkpoints/v1-5-pruned-emaonly.safetensors` | ~4 GB | AnimateDiff base |
| AnimateDiff motion LoRAs ×8 | `custom_nodes/ComfyUI-AnimateDiff-Evolved/motion_lora/` | ~74 MB each | Camera moves (pan/tilt/zoom/roll) |
| LTX-2B distilled (fp8) | `models/diffusion_models/ltxv-2b-0.9.8-distilled-fp8.safetensors` | 4.5 GB | Fast 768×512 video (~4× Wan speed) |
| Wan 2.1 T2V 1.3B fp16 | `models/diffusion_models/` | ~3 GB | Lightweight fallback |
| Kandinsky5 lite i2v | `models/checkpoints/` | — | Alternate i2v path |

**Custom nodes installed:** `ComfyUI-AnimateDiff-Evolved`, `ComfyUI-VideoHelperSuite`,
`ComfyUI-GGUF`, `ComfyUI-WanVideoWrapper`, `ComfyUI-LTX-Video`, `ComfyUI-Hunyuan3DWrapper`,
`comfyui-feynobg`, `kandinsky`. (`ComfyUI-Manager` is present but disabled.)

**Not on disk (and not runnable on 8 GB anyway):** SVD (needs 12 GB+), Wan 2.2 14B
(needs 24 GB+), Wan 2.5/2.6 (API-only), all closed models.

## Hardware notes (GTX 1070 Ti 8 GB)

- Wan 2.2 5B GGUF is the quality path: Q4_K_M + CPU T5 offload ≈ 6–8 GB at 480p.
- AnimateDiff on SD1.5 stays the fast daily driver; keep `--lowvram` behavior in mind.
- LTX-2B distilled is the speed option for short 768×512 clips.
- ControlNet suite on disk: canny / depth / openpose / lineart / scribble (SD1.5).

## Using video generation

```powershell
# Backend is already running on :8000; ComfyUI on :8188
curl -X POST http://localhost:8000/api/integrations/comfyui/generate-video `
  -H "Content-Type: application/json" `
  -d '{ "prompt": "a cat dancing", "steps": 20, "width": 512, "height": 512, "num_frames": 16, "fps": 8 }'
```

Generated videos land under `output/video/` (see `GET /api/outputs/video`).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `CUDA out of memory` | Drop to 512×512 / fewer frames; prefer the 5B GGUF or AnimateDiff over FP16 packs |
| `AnimateDiffLoaderWithContext not found` | `ComfyUI-AnimateDiff-Evolved` is installed — restart ComfyUI |
| Wan 2.2 nodes missing | Requires `ComfyUI-GGUF` + `ComfyUI-WanVideoWrapper` (both installed) |
| ComfyUI unreachable | Start it separately; the backend never auto-starts it |
