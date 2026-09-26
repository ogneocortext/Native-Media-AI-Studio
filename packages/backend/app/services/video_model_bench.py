"""Video model benchmark for LTX 2.3 / Mochi on 8GB VRAM hardware.

Usage:
    python -m packages.backend.services.video_model_bench --dry-run
    python -m packages.backend.services.video_model_bench --model ltx_2_3 --resolution 512x512 --frames 24
    python -m packages.backend.services.video_model_bench --all

Results are written to ``docs/knowledge-library/benchmarks/video-model-8gb-2026.json``.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
WORKFLOW_DIR = PROJECT_ROOT / "tools" / "mcp" / "comfyui-workflows"
BENCHMARK_OUTPUT = PROJECT_ROOT / "docs" / "knowledge-library" / "benchmarks" / "video-model-8gb-2026.json"

# ---------------------------------------------------------------------------
# Test matrix from video-model-test-protocol-2026.md
# ---------------------------------------------------------------------------

TEST_MATRIX = [
    {
        "model": "ltx_2_3",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "fp8",
        "expected_vram_mb": 8000,
    },
    {
        "model": "ltx_2_3",
        "resolution": "832x480",
        "width": 832,
        "height": 480,
        "frames": 24,
        "fps": 12,
        "precision": "fp8",
        "expected_vram_mb": 10000,
    },
    {
        "model": "ltx_2_3",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "fp16",
        "expected_vram_mb": 16000,
    },
    {
        "model": "mochi_1",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "fp8",
        "expected_vram_mb": 12000,
    },
    {
        "model": "mochi_2",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "fp8",
        "expected_vram_mb": 12000,
    },
    {
        "model": "mochi_1",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "fp16",
        "expected_vram_mb": 16000,
    },
]

# ---------------------------------------------------------------------------
# Workflow templates (minimal, protocol-compatible)
# ---------------------------------------------------------------------------

def _ltx_workflow(model_file: str, width: int, height: int, frames: int, fps: int, seed: int) -> dict[str, Any]:
    return {
        "prompt": {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": model_file, "model_file": "diffusion_models"},
            },
            "2": {
                "class_type": "DualCLIPLoader",
                "inputs": {
                    "text": "positive prompt here",
                    "text2": "negative prompt here",
                    "clip_name1": "clip-l",
                    "clip_name2": "umt5_xxl_fp16.safetensors",
                    "type": "ltxv",
                },
            },
            "3": {
                "class_type": "LTXVConditioning",
                "inputs": {
                    "clip": ["2", 0],
                    "latent": ["5", 0],
                    "frame_count": frames,
                    "fps": fps,
                },
            },
            "4": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": 20,
                    "cfg": 7.0,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["3", 0],
                    "negative": ["3", 1],
                    "latent_image": ["5", 0],
                },
            },
            "5": {
                "class_type": "EmptyLatentVideo",
                "inputs": {"width": width, "height": height, "frame_count": frames, "batch_size": 1},
            },
            "6": {
                "class_type": "LTXVDecode",
                "inputs": {"samples": ["4", 0], "vae": ["7", 0]},
            },
            "7": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": "ltxvae.safetensors"},
            },
            "8": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["6", 0],
                    "frame_rate": fps,
                    "loop_count": 0,
                    "filename_prefix": "NativeMediaAI_LTX",
                    "format": "image/gif",
                    "pingpong": False,
                    "save_output": True,
                },
            },
        }
    }


def _mochi_workflow(model_file: str, width: int, height: int, frames: int, fps: int, seed: int) -> dict[str, Any]:
    return {
        "prompt": {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": model_file, "model_file": "diffusion_models"},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "positive prompt here", "clip": ["3", 0]},
            },
            "3": {
                "class_type": "CLIPLoader",
                "inputs": {"clip_name": "umt5_xxl_fp16.safetensors"},
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "negative prompt here", "clip": ["3", 0]},
            },
            "5": {
                "class_type": "EmptyLatentVideo",
                "inputs": {"width": width, "height": height, "frame_count": frames, "batch_size": 1},
            },
            "6": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": 20,
                    "cfg": 7.0,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["4", 0],
                    "latent_image": ["5", 0],
                },
            },
            "7": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["6", 0], "vae": ["8", 0]},
            },
            "8": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": "mochi-vae.safetensors"},
            },
            "9": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["7", 0],
                    "frame_rate": fps,
                    "loop_count": 0,
                    "filename_prefix": "NativeMediaAI_Mochi",
                    "format": "image/gif",
                    "pingpong": False,
                    "save_output": True,
                },
            },
        }
    }


# ---------------------------------------------------------------------------
# VRAM measurement
# ---------------------------------------------------------------------------

def measure_peak_vram_mb(duration_s: float, poll_interval_s: float = 1.0) -> int:
    """Poll nvidia-smi and return peak VRAM usage in MB."""
    try:
        import pynvml  # type: ignore

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        peak = 0
        end = time.time() + duration_s
        while time.time() < end:
            info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            used_mb = info.used // (1024 * 1024)
            if used_mb > peak:
                peak = used_mb
            time.sleep(poll_interval_s)
        pynvml.nvmlShutdown()
        return peak
    except Exception as exc:
        logger.debug("nvidia-smi measurement failed: %s", exc)
        return -1


# ---------------------------------------------------------------------------
# ComfyUI interaction
# ---------------------------------------------------------------------------

async def _submit_and_wait(workflow: dict[str, Any], base_url: str, timeout: int = 900) -> dict[str, Any]:
    """Submit a workflow and wait for completion. Returns history entry."""
    import aiohttp

    session = aiohttp.ClientSession()
    try:
        async with session.post(
            f"{base_url.rstrip('/')}/prompt",
            json=workflow,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                return {"error": f"ComfyUI rejected workflow ({resp.status}): {body[:300]}"}
            data = await resp.json()
            prompt_id = data.get("prompt_id")
            if not prompt_id:
                return {"error": "ComfyUI returned no prompt_id"}

        # Poll history for completion
        poll_interval = 5
        deadline = time.time() + timeout
        last_status = "pending"
        while time.time() < deadline:
            async with session.get(
                f"{base_url.rstrip('/')}/history/{prompt_id}",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as hist_resp:
                if hist_resp.status == 200:
                    history = await hist_resp.json()
                    entry = history.get(prompt_id, {})
                    status = entry.get("status", {}).get("status", "unknown")
                    last_status = status
                    if status in ("success", "error", "failed"):
                        return {
                            "prompt_id": prompt_id,
                            "status": status,
                            "execution_time": entry.get("status", {}).get("execution_time"),
                            "outputs": entry.get("outputs", {}),
                        }
            await asyncio_sleep(poll_interval)

        return {"error": f"Timed out after {timeout}s", "prompt_id": prompt_id, "last_status": last_status}
    finally:
        await session.close()


def asyncio_sleep(seconds: float) -> coroutine:  # type: ignore[return]
    import asyncio
    return asyncio.sleep(seconds)


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------

def load_existing_results() -> list[dict[str, Any]]:
    if BENCHMARK_OUTPUT.exists():
        try:
            return json.loads(BENCHMARK_OUTPUT.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def save_results(results: list[dict[str, Any]]) -> None:
    BENCHMARK_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    BENCHMARK_OUTPUT.write_text(json.dumps(results, indent=2), encoding="utf-8")


def run_benchmark_entry(entry: dict[str, Any], base_url: str, dry_run: bool = False) -> dict[str, Any]:
    model = entry["model"]
    width = entry["width"]
    height = entry["height"]
    frames = entry["frames"]
    fps = entry["fps"]
    precision = entry["precision"]

    if model == "ltx_2_3":
        model_file = f"ltx-video-2.3-{precision}.safetensors"
        workflow = _ltx_workflow(model_file, width, height, frames, fps, seed=0)
    elif model in ("mochi_1", "mochi_2"):
        model_file = f"mochi-{model.split('_')[1]}-{precision}.safetensors"
        workflow = _mochi_workflow(model_file, width, height, frames, fps, seed=0)
    else:
        return {**entry, "status": "skipped", "error": f"Unknown model {model}"}

    result: dict[str, Any] = {
        "model": model,
        "resolution": entry["resolution"],
        "frames": frames,
        "fps": fps,
        "precision": precision,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if dry_run:
        result["status"] = "dry-run-ok"
        result["workflow_preview"] = {
            "model_file": model_file,
            "nodes": len(workflow.get("prompt", {})),
        }
        return result

    # VRAM pre-check
    vram_pre = measure_peak_vram_mb(2.0)
    result["vram_pre_mb"] = vram_pre

    # Submit
    start = time.time()
    try:
        loop = __import__("asyncio").get_event_loop()
        if not loop.is_running():
            run_result = loop.run_until_complete(_submit_and_wait(workflow, base_url))
        else:
            # Already in async context (e.g. jupyter) — use nest_asyncio or skip
            run_result = {"error": "async event loop already running; run from sync script"}
    except RuntimeError as exc:
        run_result = {"error": str(exc)}

    generation_time_s = time.time() - start
    result["generation_time_s"] = round(generation_time_s, 2)

    if "error" in run_result:
        result["status"] = "error"
        result["error"] = run_result["error"]
        return result

    result["prompt_id"] = run_result.get("prompt_id")
    result["status"] = run_result.get("status", "unknown")
    result["execution_time"] = run_result.get("execution_time")

    # VRAM post-check
    vram_post = measure_peak_vram_mb(5.0)
    result["peak_vram_mb"] = max(vram_pre, vram_post)

    # Quality rating placeholder (manual)
    result["quality_rating"] = None
    result["notes"] = ""

    # Output path from history if available
    outputs = run_result.get("outputs", {})
    for node_id, node_out in outputs.items():
        if isinstance(node_out, dict) and "images" in node_out:
            images = node_out["images"]
            if images:
                result["output_path"] = images[0].get("filename", "")
                break

    return result


def parse_resolution(res_str: str) -> tuple[int, int]:
    parts = res_str.lower().split("x")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("Resolution must be WxH, e.g. 512x512")
    w, h = int(parts[0]), int(parts[1])
    if w <= 0 or h <= 0:
        raise argparse.ArgumentTypeError("Width and height must be positive")
    return w, h


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Video model 8GB benchmark")
    ap.add_argument("--dry-run", action="store_true", help="Validate workflows without submitting")
    ap.add_argument("--model", choices=["ltx_2_3", "mochi_1", "mochi_2"], help="Model to test")
    ap.add_argument("--resolution", type=parse_resolution, help="WxH, e.g. 512x512")
    ap.add_argument("--frames", type=int, default=24, help="Frame count (default 24)")
    ap.add_argument("--all", action="store_true", help="Run full matrix")
    ap.add_argument("--comfyui-url", default="http://127.0.0.1:8188", help="ComfyUI base URL")
    ap.add_argument("--output", default=str(BENCHMARK_OUTPUT), help="Results JSON path")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if not args.all and not args.model:
        ap.print_help()
        return 1

    # Build run list
    if args.all:
        entries = TEST_MATRIX
    else:
        entries = [
            e for e in TEST_MATRIX
            if e["model"] == args.model
            and (args.resolution is None or (e["width"], e["height"]) == args.resolution)
        ]
        if not entries:
            # Build a custom entry from CLI args when not in matrix
            if args.model and args.resolution:
                entries = [
                    {
                        "model": args.model,
                        "resolution": f"{args.resolution[0]}x{args.resolution[1]}",
                        "width": args.resolution[0],
                        "height": args.resolution[1],
                        "frames": args.frames,
                        "fps": 12,
                        "precision": "fp8",
                        "expected_vram_mb": 12000,
                    }
                ]

    results = load_existing_results()
    run_ids = {r.get("model") + "|" + r.get("resolution", "") + "|" + str(r.get("frames", "")) for r in results}

    for entry in entries:
        run_key = entry["model"] + "|" + entry["resolution"] + "|" + str(entry["frames"])
        if not args.dry_run and run_key in run_ids:
            logger.info("Skipping %s — already in results", run_key)
            continue

        logger.info("Benchmarking %s @ %s/%dfps %s", entry["model"], entry["resolution"], entry["fps"], entry["precision"])
        rec = run_benchmark_entry(entry, args.comfyui_url, dry_run=args.dry_run)
        results.append(rec)
        save_results(results)
        logger.info("Saved result to %s", args.output)

    # Summary
    ok = sum(1 for r in results if r.get("status") == "success" or r.get("status") == "dry-run-ok")
    err = sum(1 for r in results if r.get("status") == "error")
    logger.info("Done. %d ok, %d errors, %d total", ok, err, len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
