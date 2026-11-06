#!/usr/bin/env python3
"""
Fast local model inventory checker.
Scans ComfyUI models directory and compares against known model requirements.
Run: python tools/check-model-inventory.py
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

# ComfyUI root (external install)
COMFYUI_ROOT = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI")

# Known model requirements from trends doc + local knowledge
REQUIRED_MODELS = {
    # Video Generation (8GB VRAM)
    "wan22_ti2v_5b_gguf": {
        "name": "Wan 2.2 TI2V-5B GGUF Q4_K_M",
        "type": "video",
        "priority": "P0",
        "paths": [
            "models/diffusion_models/Wan2.2-TI2V-5B-Q4_K_M.gguf",
        ],
        "deps": [
            "models/vae/wan2.2_vae.safetensors",
            "models/text_encoders/umt5-xxl-fp8.safetensors",
        ],
        "nodes": ["ComfyUI-GGUF", "ComfyUI-WanVideoWrapper"],
        "vram_gb": "6-8",
    },
    "animatediff_v2": {
        "name": "AnimateDiff v2 Motion Module",
        "type": "video",
        "priority": "P0",
        "paths": ["models/animatediff_models/mm_sd_v15_v2.ckpt"],
        "deps": ["models/checkpoints/v1-5-pruned-emaonly.safetensors"],
        "nodes": ["ComfyUI-AnimateDiff-Evolved"],
        "vram_gb": "8 (--lowvram)",
    },
    "animatediff_v3": {
        "name": "AnimateDiff v3 Motion Module",
        "type": "video",
        "priority": "P0",
        "paths": ["models/animatediff_models/mm_sd15_v3.safetensors"],
        "deps": ["models/checkpoints/v1-5-pruned-emaonly.safetensors"],
        "nodes": ["ComfyUI-AnimateDiff-Evolved"],
        "vram_gb": "8 (--lowvram)",
    },
    "animatediff_loras": {
        "name": "AnimateDiff Motion LoRAs (8x)",
        "type": "video",
        "priority": "P1",
        "paths": ["custom_nodes/ComfyUI-AnimateDiff-Evolved/motion_lora/"],
        "nodes": ["ComfyUI-AnimateDiff-Evolved"],
        "vram_gb": "minimal",
    },
    "ltx_2b_distilled": {
        "name": "LTX-2B Distilled (fp8)",
        "type": "video",
        "priority": "P1",
        "paths": ["models/diffusion_models/ltxv-2b-0.9.8-distilled-fp8.safetensors"],
        "deps": [
            "models/vae/LTX23_video_vae_bf16.safetensors",
            "models/text_encoders/t5-xxl-fp8.safetensors",
        ],
        "nodes": ["ComfyUI-LTX-Video"],
        "vram_gb": "6-8",
    },
    "wan21_1_3b": {
        "name": "Wan 2.1 T2V 1.3B fp16",
        "type": "video",
        "priority": "P2",
        "paths": ["models/diffusion_models/wan2.1_t2v_1.3b_fp16.safetensors"],
        "deps": ["models/vae/wan_2.1_vae.safetensors"],
        "nodes": ["ComfyUI-WanVideoWrapper"],
        "vram_gb": "~6",
    },
    "kandinsky5_lite": {
        "name": "Kandinsky 5 Lite i2v",
        "type": "video",
        "priority": "P2",
        "paths": ["models/checkpoints/kandinsky5lite_i2v_5s.safetensors"],
        "nodes": ["kandinsky"],
        "vram_gb": "~6",
    },
    # 3D Generation
    "hunyuan3d_2mini": {
        "name": "Hunyuan3D-2mini (Kijai Wrapper)",
        "type": "3d",
        "priority": "P0",
        "paths": [
            "models/diffusion_models/hunyuan3d-2mini/hunyuan3d-dit-v2-mini/model.fp16.safetensors",
            "models/diffusion_models/hunyuan3d-2mini/hunyuan3d-dit-v2-mini-fast/model.fp16.safetensors",
            "models/diffusion_models/hunyuan3d-2mini/hunyuan3d-dit-v2-mini-turbo/model.fp16.safetensors",
            "models/diffusion_models/hunyuan3d-2mini/hunyuan3d-vae-v2-mini/model.fp16.safetensors",
            "models/diffusion_models/hunyuan3d-2mini/hunyuan3d-vae-v2-mini-turbo/model.fp16.safetensors",
        ],
        "nodes": ["ComfyUI-Hunyuan3DWrapper"],
        "vram_gb": "~5 (geometry only)",
    },
    # Text Encoders
    "gemma4_e2b": {
        "name": "Gemma 4 E2B (ComfyUI native)",
        "type": "text_encoder",
        "priority": "P1",
        "paths": ["models/text_encoders/gemma-4-E2B-it/"],
        "nodes": ["TextGenerate (built-in)"],
        "vram_gb": "~2.9",
    },
    "umt5_xxl_fp8": {
        "name": "UMT5-XXL FP8 (Wan 2.2)",
        "type": "text_encoder",
        "priority": "P0",
        "paths": ["models/text_encoders/umt5-xxl-fp8.safetensors"],
        "nodes": ["CLIPLoader (wan)"],
        "vram_gb": "CPU offload",
    },
    # VAE
    "wan22_vae": {
        "name": "Wan 2.2 VAE",
        "type": "vae",
        "priority": "P0",
        "paths": ["models/vae/wan2.2_vae.safetensors"],
        "vram_gb": "~1.3",
    },
    "wan21_vae": {
        "name": "Wan 2.1 VAE",
        "type": "vae",
        "priority": "P1",
        "paths": ["models/vae/wan_2.1_vae.safetensors"],
        "vram_gb": "~1.3",
    },
}

REQUIRED_NODES = [
    "ComfyUI-AnimateDiff-Evolved",
    "ComfyUI-VideoHelperSuite",
    "ComfyUI-GGUF",
    "ComfyUI-WanVideoWrapper",
    "ComfyUI-LTX-Video",
    "ComfyUI-Hunyuan3DWrapper",
    "comfyui-feynobg",
    "kandinsky",
]

def check_path_exists(path: Path) -> Tuple[bool, int]:
    """Check if path exists and return (exists, size_mb)"""
    if path.is_file():
        return True, path.stat().st_size // (1024 * 1024)
    elif path.is_dir():
        # Directory - check if it has content
        files = list(path.rglob("*"))
        total_size = sum(f.stat().st_size for f in files if f.is_file())
        return len(files) > 0, total_size // (1024 * 1024)
    return False, 0

def scan_comfyui() -> Dict:
    """Scan ComfyUI directory for models and nodes"""
    results = {
        "models": {},
        "nodes": {},
        "summary": {"installed": 0, "missing": 0, "partial": 0},
    }

    if not COMFYUI_ROOT.exists():
        results["error"] = f"ComfyUI not found at {COMFYUI_ROOT}"
        return results

    # Check models
    for key, spec in REQUIRED_MODELS.items():
        model_result = {
            "name": spec["name"],
            "type": spec["type"],
            "priority": spec["priority"],
            "vram_gb": spec["vram_gb"],
            "main_files": [],
            "deps": [],
            "status": "missing",
        }

        # Check main files
        all_main_exist = True
        for rel_path in spec["paths"]:
            full_path = COMFYUI_ROOT / rel_path
            exists, size = check_path_exists(full_path)
            model_result["main_files"].append({
                "path": rel_path,
                "exists": exists,
                "size_mb": size,
            })
            if not exists:
                all_main_exist = False

        # Check deps
        all_deps_exist = True
        for rel_path in spec.get("deps", []):
            full_path = COMFYUI_ROOT / rel_path
            exists, size = check_path_exists(full_path)
            model_result["deps"].append({
                "path": rel_path,
                "exists": exists,
                "size_mb": size,
            })
            if not exists:
                all_deps_exist = False

        # Determine status
        if all_main_exist and all_deps_exist:
            model_result["status"] = "installed"
            results["summary"]["installed"] += 1
        elif all_main_exist and not all_deps_exist:
            model_result["status"] = "partial"
            results["summary"]["partial"] += 1
        else:
            model_result["status"] = "missing"
            results["summary"]["missing"] += 1

        results["models"][key] = model_result

    # Check custom nodes
    nodes_dir = COMFYUI_ROOT / "custom_nodes"
    for node in REQUIRED_NODES:
        node_path = nodes_dir / node
        exists = node_path.is_dir()
        results["nodes"][node] = {
            "exists": exists,
            "path": str(node_path.relative_to(COMFYUI_ROOT)) if exists else None,
        }

    return results

def print_report(results: Dict):
    """Print formatted report"""
    if "error" in results:
        print(f"[ERROR] {results['error']}")
        return

    print("=" * 80)
    print("COMFYUI MODEL INVENTORY REPORT")
    print(f"Root: {COMFYUI_ROOT}")
    print("=" * 80)

    # Summary
    s = results["summary"]
    print(f"\n[SUMMARY] {s['installed']} installed, {s['partial']} partial, {s['missing']} missing")
    print("-" * 80)

    # Models by type
    for model_type in ["video", "3d", "text_encoder", "vae"]:
        type_models = {k: v for k, v in results["models"].items() if v["type"] == model_type}
        if not type_models:
            continue

        print(f"\n[{model_type.upper()}]")
        print("-" * 80)

        for key, model in type_models.items():
            status_icon = {"installed": "[OK]", "partial": "[PARTIAL]", "missing": "[MISSING]"}[model["status"]]
            print(f"\n{status_icon} {model['name']} ({model['priority']}) - VRAM: {model['vram_gb']}")

            for f in model["main_files"]:
                icon = "[FOUND]" if f["exists"] else "[MISSING]"
                size = f" ({f['size_mb']} MB)" if f["exists"] else ""
                print(f"  {icon} {f['path']}{size}")

            for f in model["deps"]:
                icon = "[FOUND]" if f["exists"] else "[MISSING]"
                size = f" ({f['size_mb']} MB)" if f["exists"] else ""
                print(f"  {icon} [dep] {f['path']}{size}")

    # Nodes
    print(f"\n[CUSTOM NODES]")
    print("-" * 80)
    for node, info in results["nodes"].items():
        icon = "[OK]" if info["exists"] else "[MISSING]"
        print(f"  {icon} {node}")

    # Missing critical items
    missing_critical = [
        (k, v) for k, v in results["models"].items()
        if v["status"] == "missing" and v["priority"] in ["P0", "P1"]
    ]
    if missing_critical:
        print(f"\n[CRITICAL MISSING (P0/P1)]:")
        for k, v in missing_critical:
            print(f"   - {v['name']} ({v['priority']})")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Check ComfyUI model inventory")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument("--comfyui-root", type=str, help="Override ComfyUI root path")
    args = parser.parse_args()

    global COMFYUI_ROOT
    if args.comfyui_root:
        COMFYUI_ROOT = Path(args.comfyui_root)

    results = scan_comfyui()

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_report(results)

if __name__ == "__main__":
    main()