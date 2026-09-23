"""Download ComfyUI models with resume support (merged 2026-09-23).

Two engines, two named sets (merged from tmp_download_models.py, which only
fetched the Wan 2.2 set via huggingface_hub):

    qwen-upscalers  Qwen 2.5-VL text encoder + ClearReality/UltraSharp
                    upscalers, via urllib with Range-resume and
                    expected-size verification.
    wan22           Wan 2.2 TI2V-5B GGUF + VAE + UMT5-XXL FP8 encoder,
                    via huggingface_hub (needs `pip install huggingface_hub`).
    all             Both sets (default).

Run detached; progress is appended to comfyui_download_models.log next to
this script. Idempotent: skips files that already exist at the expected size.

Run from anywhere:
    python tools/scripts/comfyui_download_models.py [--set qwen-upscalers|wan22|all]
"""

import argparse
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Portable default: ComfyUI is the sibling checkout of the repo root.
# Override with COMFYUI_DIR when the layout differs.
COMFY = Path(os.environ.get("COMFYUI_DIR", ROOT.parent / "ComfyUI"))
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comfyui_download_models.log")

# (url, dest-relative-to-models, expected_bytes)
URLLIB_DOWNLOADS = [
    (
        "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
        os.path.join("text_encoders", "qwen_2.5_vl_7b_fp8_scaled.safetensors"),
        9384670680,
    ),
    (
        "https://huggingface.co/Kim2091/ClearRealityV1/resolve/main/4x-ClearRealityV1.safetensors",
        os.path.join("upscale_models", "4x-ClearRealityV1.safetensors"),
        4492232,
    ),
    (
        "https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth",
        os.path.join("upscale_models", "4x-UltraSharp.pth"),
        66961958,
    ),
]

# (repo_id, filename, dest-relative-to-models, dest_name)
# Targets verified 2026-09-20 against HF API + localmodel.run/wan2.video.
# WanVideoWrapper WanVideoModelLoader reads diffusion_models, not unet.
# MUST be umt5 (not t5-xxl): the wrapper node rejects standard T5 and falls
# back to downloading google/t5-xxl from HF at render time.
HF_HUB_DOWNLOADS = [
    ("QuantStack/Wan2.2-TI2V-5B-GGUF",
     "Wan2.2-TI2V-5B-Q4_K_M.gguf",
     "diffusion_models", "Wan2.2-TI2V-5B-Q4_K_M.gguf"),
    ("QuantStack/Wan2.2-TI2V-5B-GGUF",
     "VAE/Wan2.2_VAE.safetensors",
     "vae", "wan2.2_vae.safetensors"),
    ("wangkanai/wan22-fp8-encoders",
     "text_encoders/umt5-xxl-fp8.safetensors",
     "text_encoders", "umt5-xxl-fp8.safetensors"),
]


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def download_url(url: str, dest: str, expected: int, max_attempts: int = 30) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    for attempt in range(1, max_attempts + 1):
        if os.path.exists(dest) and os.path.getsize(dest) == expected:
            log(f"[skip] complete: {os.path.basename(dest)}")
            return
        have = os.path.getsize(tmp) if os.path.exists(tmp) else 0
        if have >= expected:
            break
        headers = {"Range": f"bytes={have}-"} if have else {}
        req = urllib.request.Request(url, headers=headers)
        log(f"[start] {os.path.basename(dest)} attempt {attempt} (resume at {have / 1e9:.2f} GB)")
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "ab") as f:
                last_log = time.time()
                while True:
                    chunk = r.read(1 << 22)
                    if not chunk:
                        break
                    f.write(chunk)
                    have += len(chunk)
                    if time.time() - last_log > 30:
                        log(f"  {os.path.basename(dest)}: {have / 1e9:.2f}/{expected / 1e9:.2f} GB")
                        last_log = time.time()
        except Exception as e:  # noqa: BLE001 - transient network errors are retried
            log(f"[retry] {os.path.basename(dest)}: {e}")
            time.sleep(5)
    have = os.path.getsize(tmp) if os.path.exists(tmp) else 0
    if have != expected:
        log(f"[FAIL] size mismatch {have} != {expected}: {dest} (kept .part for resume)")
        return
    os.replace(tmp, dest)
    log(f"[ok] {dest}")


def download_hf(repo_id: str, filename: str, dest_dir: Path, dest_name: str | None = None) -> Path:
    from huggingface_hub import hf_hub_download  # noqa: E402 - optional dependency

    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / (dest_name or filename)
    print(f"[download] {repo_id}/{filename} -> {target}")
    if target.exists():
        print("  -> already exists, skipping")
        return target
    try:
        path = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            local_dir=str(dest_dir),
            local_dir_use_symlinks=False,
        )
        print(f"  -> saved to {path}")
        return Path(path)
    except Exception as e:
        print(f"  -> FAILED: {e}")
        raise


def run_urllib_set(models_dir: Path) -> None:
    for url, rel, expected in URLLIB_DOWNLOADS:
        try:
            download_url(url, str(models_dir / rel), expected)
        except Exception as e:  # noqa: BLE001 - keep going with the rest
            log(f"[ERROR] {os.path.basename(rel)}: {e}")


def run_hf_set(models_dir: Path) -> None:
    try:
        import huggingface_hub  # noqa: F401 - fail fast with a clear message
    except ImportError:
        print("huggingface_hub not installed. Run: pip install huggingface_hub")
        sys.exit(1)
    done = []
    for repo_id, filename, subdir, dest_name in HF_HUB_DOWNLOADS:
        done.append(download_hf(repo_id, filename, models_dir / subdir, dest_name))
    print("\n[done] downloaded files:")
    for p in done:
        print(f"  - {p}  ({p.stat().st_size / (1024 * 1024):.1f} MB)")


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Download ComfyUI model sets")
    parser.add_argument("--set", dest="set", default="all",
                        choices=("qwen-upscalers", "wan22", "all"),
                        help="model set to fetch (default: all)")
    args = parser.parse_args(argv)
    models_dir = COMFY / "models"
    log(f"ComfyUI models dir: {models_dir}")
    if args.set in ("qwen-upscalers", "all"):
        run_urllib_set(models_dir)
    if args.set in ("wan22", "all"):
        run_hf_set(models_dir)
    log("DONE")


if __name__ == "__main__":
    main()
