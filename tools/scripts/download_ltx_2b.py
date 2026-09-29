"""Download the LTX-Video 2B distilled FP8 checkpoint into ComfyUI's model dir.

huggingface_hub 1.x removed `local_dir_use_symlinks` and `resume_download` from
hf_hub_download() (it takes no **kwargs), so neither is passed here; resuming is
handled automatically. The destination defaults to the ComfyUI checkout next to
this repo and can be overridden with COMFYUI_ROOT or --dest.

Usage:
    python tools/scripts/download_ltx_2b.py [--dest PATH] [--filename NAME]
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from huggingface_hub import hf_hub_download

MODEL_ID = "Lightricks/LTX-Video"
DEFAULT_FILENAME = "ltxv-2b-0.9.8-distilled-fp8.safetensors"

# tools/scripts/download_ltx_2b.py -> repo root, whose sibling holds the ComfyUI checkout.
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_COMFYUI_ROOT = REPO_ROOT.parent / "ComfyUI"


def default_dest() -> Path:
    """Diffusion-model directory of the ComfyUI install."""
    root = Path(os.environ.get("COMFYUI_ROOT", DEFAULT_COMFYUI_ROOT))
    return root / "models" / "diffusion_models"


def main() -> int:
    parser = argparse.ArgumentParser(description=f"Download {DEFAULT_FILENAME} for ComfyUI.")
    parser.add_argument("--dest", type=Path, default=default_dest(), help="target directory (default: ComfyUI diffusion_models)")
    parser.add_argument("--filename", default=DEFAULT_FILENAME, help="checkpoint filename within the repo")
    parser.add_argument("--repo", default=MODEL_ID, help="Hugging Face repo id")
    args = parser.parse_args()

    dest: Path = args.dest
    dest.mkdir(parents=True, exist_ok=True)

    print(f"Downloading {args.filename} from {args.repo} to {dest} ...")
    path = Path(
        hf_hub_download(
            repo_id=args.repo,
            filename=args.filename,
            local_dir=str(dest),
        )
    )
    size = path.stat().st_size
    print(f"Downloaded to: {path}")
    print(f"Size: {size / 1e9:.2f} GB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
