# Video Generation Setup Guide

## Overview

This guide covers setting up video generation capabilities using ComfyUI with AnimateDiff.

## Current Status

### ✅ What's Implemented:
1. **Media Library** - Browse all generated images/videos/audio
2. **Video Generation API** - Backend endpoint for video generation
3. **ComfyUI Adapter** - Supports video workflows
4. **Video Model Setup Script** - Automated download script

### ⚠️ What's Needed:
1. **AnimateDiff Motion Module** (~1.6GB)
2. **Video Helper Suite** custom node for ComfyUI
3. **ComfyUI-AnimateDiff-Evolved** custom node

## Hardware Requirements

**Your System (GTX 1070 Ti 8GB):**
- ✅ Supported with limitations
- ✅ Use 512x512 resolution max
- ✅ Use 16-24 frames max per video
- ✅ Enable --lowvram flag for ComfyUI

## Setup Steps

### 1. Download Video Models

Run the setup script:
```powershell
cd scripts
.\setup-video-models.bat
```

Or download manually:
1. **AnimateDiff Motion Module** (required)
   - Download: https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.safetensors
   - Place in: `stable-diffusion/models/animatediff/`
   - Size: ~1.6GB

2. **Stable Video Diffusion (SVD)** - Optional, needs 9GB VRAM
   - Download: https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt
   - Place in: `stable-diffusion/models/svd/`
   - Size: ~9.3GB

### 2. Install ComfyUI Custom Nodes

**Option A: Using ComfyUI Manager (if installed)**
1. Open ComfyUI web interface
2. Click "Manager" → "Install Custom Nodes"
3. Search and install:
   - `ComfyUI-AnimateDiff-Evolved`
   - `ComfyUI-VideoHelperSuite`

**Option B: Manual Installation**
```powershell
cd third_party/ComfyUI/custom_nodes

# Install AnimateDiff Evolved
git clone https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved.git

# Install Video Helper Suite
git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git

# Restart ComfyUI
```

### 3. Restart Services

```powershell
# Restart ComfyUI with low VRAM mode
cd third_party/ComfyUI
python main.py --port 8188 --listen 127.0.0.1 --lowvram

# Restart backend
cd backend
python -c "from app.main import run; run()"
```

## Using Video Generation

### Via API

```bash
curl -X POST http://localhost:8000/api/integrations/comfyui/generate-video \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a cat dancing, beautiful, high quality",
    "negative_prompt": "blurry, low quality",
    "steps": 20,
    "width": 512,
    "height": 512,
    "num_frames": 16,
    "fps": 8
  }'
```

### Via Media Library

1. Navigate to **Media Library** in the sidebar
2. Generated videos will appear in the library
3. Click to preview, download, or view metadata

## Video Generation Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `num_frames` | 16 | 8-32 | Number of frames in video |
| `fps` | 8 | 1-30 | Frames per second |
| `width` | 512 | 256-1024 | Video width (use 512 for 8GB) |
| `height` | 512 | 256-1024 | Video height (use 512 for 8GB) |
| `steps` | 20 | 10-50 | Sampling steps |
| `motion_module` | mm_sd_v15_v2 | - | Motion module to use |

## Performance Tips

**For GTX 1070 Ti 8GB:**
- Use 512x512 resolution max
- Use 16 frames max (2 seconds at 8fps)
- Enable --lowvram flag
- Close other GPU-intensive apps
- Use Euler or Euler_a sampler (faster)

**Generation Time:**
- 16 frames @ 512x512: ~2-3 minutes
- 24 frames @ 512x512: ~4-5 minutes

## Troubleshooting

### Out of Memory Error
```
RuntimeError: CUDA out of memory
```
**Solutions:**
1. Reduce resolution to 512x512 or 384x384
2. Reduce num_frames to 8-12
3. Use --lowvram flag
4. Close other applications

### Motion Module Not Found
```
Error: mm_sd_v15_v2.safetensors not found
```
**Solution:**
1. Download motion module to `stable-diffusion/models/animatediff/`
2. Restart ComfyUI

### Custom Nodes Not Loading
```
Error: AnimateDiffLoaderWithContext not found
```
**Solution:**
1. Install ComfyUI-AnimateDiff-Evolved custom node
2. Restart ComfyUI

## File Locations

```
stable-diffusion/
├── models/
│   ├── checkpoints/        # SD models (.safetensors)
│   ├── animatediff/        # Motion modules
│   │   └── mm_sd_v15_v2.safetensors
│   └── svd/                # SVD models (optional)
│       └── svd_xt.safetensors
└── ...

output/
├── images/                 # Generated images
├── video/                  # Generated videos (.mp4)
└── audio/                  # Generated audio
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/integrations/comfyui/generate` | POST | Generate image |
| `/api/integrations/comfyui/generate-video` | POST | Generate video |
| `/api/outputs/` | GET | List all outputs |
| `/api/outputs/video` | GET | List video outputs |

## Next Steps

1. ✅ Run `setup-video-models.bat` to download motion module
2. ✅ Install custom nodes (AnimateDiff-Evolved, VideoHelperSuite)
3. ✅ Restart ComfyUI with --lowvram flag
4. ✅ Test video generation via API or Media Library
5. ✅ Browse generated videos in Media Library
