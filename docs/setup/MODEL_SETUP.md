# Model Setup Guide for Native Media AI Studio

## Overview

This guide explains how to set up real image generation using ComfyUI and Stable Diffusion models.

## Current Status

- **Mock Generation**: ✅ Working (creates placeholder images)
- **ComfyUI Integration**: ✅ Configured but needs:
  1. PyTorch installation
  2. ComfyUI dependencies
  3. Model files

## Quick Setup

### 1. Install ComfyUI Dependencies

Run the setup script:
```powershell
cd scripts
.\setup-comfyui.bat
```

This will install:
- PyTorch with CUDA 11.8 support (for GTX 1070 Ti)
- All ComfyUI dependencies

### 2. Download Models

Models should be placed in:
```
stable-diffusion/models/checkpoints/
```

**Recommended models for testing:**

1. **SD 1.5 (Base Model)** - 4GB
   - Download: https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors
   
2. **SDXL (Higher Quality)** - 6.9GB
   - Download: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors

3. **Anything V5 (Anime/Art Style)** - 4.2GB
   - Download: https://huggingface.co/ckpt/anything-v5.0/resolve/main/AnythingV5Ink_v5PrtRE.safetensors

### 3. Start ComfyUI

Run the startup script:
```powershell
cd scripts
.\start-comfyui.bat
```

ComfyUI will start on http://127.0.0.1:8188

### 4. Verify Backend Connection

Check if backend can see ComfyUI:
```powershell
Invoke-RestMethod -Uri http://localhost:8000/api/integrations/config/mock-mode
Invoke-RestMethod -Uri http://localhost:8000/api/integrations/models/status
```

## Directory Structure

```
Native Media AI Studio/
├── stable-diffusion/           # Your model storage
│   └── models/
│       ├── checkpoints/       # SD models (.safetensors, .ckpt)
│       ├── vae/              # VAE models
│       ├── loras/            # LoRA models
│       ├── controlnet/       # ControlNet models
│       └── embeddings/       # Textual inversion
│
└── third_party/ComfyUI/       # ComfyUI installation
    └── models/               # Built-in model directory (also scanned)
```

## Configuration

### Environment Variables

- `MOCK_GENERATION=true` - Force mock mode (no real generation)
- `DISABLED_SD_WEBUI=true` - Disable SD WebUI
- `DISABLED_COMFYUI=true` - Disable ComfyUI

### API Endpoints

- `GET /api/integrations/models/status` - Check available models
- `GET /api/integrations/config/mock-mode` - Check mock mode status
- `POST /api/integrations/config/mock-mode?enabled=false` - Disable mock mode

## Troubleshooting

### ComfyUI Won't Start

1. Check PyTorch installation:
   ```powershell
   python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"
   ```

2. Check CUDA is available:
   ```powershell
   nvidia-smi
   ```

### Models Not Found

1. Verify model file extensions (.safetensors or .ckpt)
2. Check paths in `third_party/ComfyUI/extra_model_paths.yaml`
3. Run model status check: `GET /api/integrations/models/status`

### Generation Fails

1. Check ComfyUI is running: http://127.0.0.1:8188
2. Check backend logs for errors
3. Enable mock mode temporarily: `MOCK_GENERATION=true`

## Performance Tips

- **GTX 1070 Ti (8GB)**: Use SD 1.5 models at 512x512 for best performance
- **VRAM Management**: Enable `--lowvram` or `--normalvram` flags if needed
- **Model Format**: Use `.safetensors` instead of `.ckpt` for faster loading

## Alternative: SD WebUI

If you prefer AUTOMATIC1111's SD WebUI:

1. Install from: https://github.com/AUTOMATIC1111/stable-diffusion-webui
2. Start with `--api` flag
3. Backend will auto-detect at http://127.0.0.1:7860
