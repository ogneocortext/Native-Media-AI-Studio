"""Download LTX 2B distilled FP8 model with resume support."""
from __future__ import annotations

import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

MODEL_ID = "Lightricks/LTX-Video"
FILENAME = "ltxv-2b-0.9.8-distilled-fp8.safetensors"
DEST_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI\models\diffusion_models")
DEST_DIR.mkdir(parents=True, exist_ok=True)

print(f"Downloading {FILENAME} to {DEST_DIR} ...")
path = hf_hub_download(
    repo_id=MODEL_ID,
    filename=FILENAME,
    local_dir=str(DEST_DIR),
    local_dir_use_symlinks=False,
    resume_download=True,
)
size = Path(path).stat().st_size
print(f"Downloaded to: {path}")
print(f"Size: {size / 1e9:.2f} GB")
