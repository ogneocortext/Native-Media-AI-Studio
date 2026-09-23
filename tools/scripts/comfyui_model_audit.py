"""ComfyUI model visibility audit + verification (merged 2026-09-23).

What the live ComfyUI on :8188 actually exposes per loader node, plus an
expectation check that the models this studio needs are visible.

Modes:
    dump    Print combo options for every known loader node
            (default; subsumes the old verify_comfyui_lists.py, whose two
            nodes are covered by the dump).
    verify  Check expected models are present per node and list the
            registered Hy3D / Kandinsky / 3D node families
            (merged from verify_comfyui_objectinfo.py). Exits 1 on any miss.

Run from the repo root:
    python tools/scripts/comfyui_model_audit.py [dump|verify]
"""

import argparse
import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8188"


def obj(name: str):
    try:
        with urllib.request.urlopen(f"{BASE}/object_info/{name}", timeout=5) as r:
            return json.loads(r.read())
    except Exception as e:  # noqa: BLE001 - probe must survive a down server
        return f"ERR: {e}"


def combos(data):
    if not isinstance(data, dict):
        return data
    out = {}
    for _cls, info in data.items():
        req = info.get("input", {}).get("required", {})
        for k, v in req.items():
            if isinstance(v, list) and v and isinstance(v[0], list):
                out[k] = v[0]
            elif isinstance(v, list) and len(v) > 1 and v[0] == "COMBO":
                out[k] = v[1].get("options")
    return out


NODES = [
    "CheckpointLoaderSimple",
    "VAELoader",
    "CLIPLoader",
    "UNETLoader",
    "DualCLIPLoader",
    "TripleCLIPLoader",
    "LoraLoader",
    "ControlNetLoader",
    "UpscaleModelLoader",
    "LoadWanVideoT5TextEncoder",
    "WanVideoModelLoader",
    "WanVideoVAELoader",
    "Hy3DModelLoader",
    "Hy3DVAEEncoderLoader",
    "ImageOnlyCheckpointLoader",
    "DownloadAndLoadHy3DDelightModel",
    "DownloadAndLoadHy3DPaintModel",
    "TripoSRModelLoader",
    "SF3DModelLoader",
    "AnimateDiffLoaderWithContext",
    "ADE_AnimateDiffLoaderGen1",
    "ADE_AnimateDiffLoaderSimple",
    "ADE_LoadAnimateDiffModel",
    "ADE_AnimateDiffLoRALoader",
]

# (node, input_name, expected model substrings) for verify mode.
VERIFY_CHECKS = [
    ("CheckpointLoaderSimple", "ckpt_name",
     ["hunyuan3d-dit-v2-mini.safetensors", "kandinsky5lite_i2v_5s.safetensors",
      "v1-5-pruned-emaonly.safetensors", "triposr", "stable-fast"]),
    ("UpscaleModelLoader", "model_name",
     ["4x-ClearRealityV1.safetensors", "4x-UltraSharp.pth"]),
    ("CLIPLoader", "clip_name",
     ["qwen_2.5_vl_7b_fp8_scaled.safetensors"]),
    ("ADE_AnimateDiffLoaderGen1", "model_name", ["mm_sd15_v3"]),
    ("UNETLoader", "unet_name", []),
]

# Node-family substrings listed (not asserted) in verify mode.
VERIFY_FAMILIES = {
    "Hy3D nodes registered": ("hy3d", "hunyuan3d"),
    "Kandinsky nodes": ("kandinsky",),
    "TripoSR / StableFast nodes": ("triposr", "stablefast", "stable_fast", "sf3d"),
}


def cmd_dump() -> int:
    for node in NODES:
        print("=" * 20, node)
        print(json.dumps(combos(obj(node)), indent=1, default=str)[:2500])
    return 0


def _get(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as r:
        return json.load(r)


def _choices(info, node, input_name):
    node_info = info.get(node)
    if node_info is None:
        return None
    try:
        return node_info["input"]["required"][input_name][0]
    except Exception:
        return None


def cmd_verify() -> int:
    try:
        info = _get("/object_info")
    except Exception as e:  # noqa: BLE001 - report, don't traceback
        print(f"FAIL: cannot reach {BASE}/object_info: {e}")
        return 1
    failures = 0
    for node, inp, expected in VERIFY_CHECKS:
        opts = _choices(info, node, inp)
        if opts is None:
            print(f"[MISSING NODE] {node}")
            failures += 1
            continue
        print(f"[{node}.{inp}] {len(opts)} options")
        for e in expected:
            hit = [o for o in opts if e.lower() in str(o).lower()]
            print(f"    {'OK ' if hit else 'NO '} {e}: {hit if hit else '(not found)'}")
            if not hit:
                failures += 1
    for label, patterns in VERIFY_FAMILIES.items():
        hits = sorted({k for k in info if any(p in k.lower() for p in patterns)})
        print(f"\n[{label}] {len(hits)}")
        for k in hits[:25]:
            print("   ", k)
    print(f"\nVERIFY: {'PASS' if not failures else f'{failures} MISS(ES)'}")
    return 0 if not failures else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Audit / verify ComfyUI model visibility")
    parser.add_argument("mode", nargs="?", default="dump", choices=("dump", "verify"),
                        help="dump: print all loader combos (default); verify: check expected models")
    args = parser.parse_args(argv)
    return cmd_verify() if args.mode == "verify" else cmd_dump()


if __name__ == "__main__":
    sys.exit(main())
