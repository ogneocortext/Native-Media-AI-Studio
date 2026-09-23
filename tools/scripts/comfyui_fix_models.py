"""ComfyUI model-folder fix-up (audit follow-up, 2026-09-22).

Actions (idempotent, safe to re-run):
1. Delete HF error-page placeholder files masquerading as .safetensors
   (checkpoints/triposr.safetensors, checkpoints/stable-fast-3d.safetensors).
2. Replace the duplicated Hunyuan3D DiT checkpoint copy with a hardlink
   to the diffusion_models copy (verified byte-identical first).
3. Move models/animatediff/mm_sd15_v3.safetensors -> models/animatediff_models/
   so AnimateDiff-Evolved (and the backend auto-picker) can see it.
4. Replace legacy stable-diffusion/ duplicates with hardlinks to the
   ComfyUI copies (verified byte-identical first).
"""

import hashlib
import os
import sys

COMFY = r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI"
LEGACY = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\stable-diffusion"

JUNK = [
    os.path.join(COMFY, "models", "checkpoints", "triposr.safetensors"),
    os.path.join(COMFY, "models", "checkpoints", "stable-fast-3d.safetensors"),
]

# (canonical source, duplicate to replace with hardlink)
HARDLINK_PAIRS = [
    (
        os.path.join(COMFY, "models", "diffusion_models", "hunyuan3d-2mini",
                     "hunyuan3d-dit-v2-mini", "model.fp16.safetensors"),
        os.path.join(COMFY, "models", "checkpoints", "hunyuan3d-dit-v2-mini.safetensors"),
    ),
    (
        os.path.join(COMFY, "models", "checkpoints", "v1-5-pruned-emaonly.safetensors"),
        os.path.join(LEGACY, "models", "checkpoints", "v1-5-pruned-emaonly.safetensors"),
    ),
    (
        os.path.join(COMFY, "models", "animatediff_models", "mm_sd15_v3.safetensors"),
        os.path.join(LEGACY, "models", "animatediff", "mm_sd15_v3.safetensors"),
    ),
]

MOVE = (
    os.path.join(COMFY, "models", "animatediff", "mm_sd15_v3.safetensors"),
    os.path.join(COMFY, "models", "animatediff_models", "mm_sd15_v3.safetensors"),
)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def delete_junk() -> None:
    for p in JUNK:
        if not os.path.exists(p):
            print(f"[skip] junk already gone: {p}")
            continue
        size = os.path.getsize(p)
        if size > 4096:
            print(f"[ABORT] {p} is {size} bytes — not a placeholder, leaving alone")
            continue
        head = open(p, "rb").read(120)
        print(f"[del] {p} ({size} bytes): {head!r}")
        os.remove(p)


def hardlink_pair(src: str, dst: str) -> None:
    if not os.path.exists(src):
        print(f"[skip] source missing: {src}")
        return
    if not os.path.exists(dst):
        print(f"[skip] duplicate missing: {dst}")
        return
    if os.path.samefile(src, dst):
        print(f"[ok] already hardlinked: {dst}")
        return
    s1, s2 = os.path.getsize(src), os.path.getsize(dst)
    if s1 != s2:
        print(f"[ABORT] size mismatch {s1} vs {s2}: {dst}")
        return
    print(f"[hash] verifying {dst} ({s1 / 1e9:.2f} GB) ...")
    if sha256(src) != sha256(dst):
        print(f"[ABORT] content differs, leaving alone: {dst}")
        return
    os.remove(dst)
    os.link(src, dst)
    print(f"[ok] hardlinked {dst} -> {src} (saved {s1 / 1e9:.2f} GB)")


def move_motion_module() -> None:
    src, dst = MOVE
    if not os.path.exists(src):
        print(f"[skip] move source gone (already moved?): {src}")
        return
    if os.path.exists(dst):
        print(f"[skip] move target already exists: {dst}")
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.replace(src, dst)
    print(f"[ok] moved {src} -> {dst}")


def main() -> None:
    delete_junk()
    # Move first so the legacy mm_sd15_v3 hardlink targets the new location.
    move_motion_module()
    for src, dst in HARDLINK_PAIRS:
        hardlink_pair(src, dst)
    print("DONE")


if __name__ == "__main__":
    sys.exit(main())
