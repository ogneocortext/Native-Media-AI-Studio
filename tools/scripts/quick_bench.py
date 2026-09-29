"""Quick benchmark: submit a hardcoded LTXV-2B workflow to ComfyUI, wait, record result.

This is the fast manual harness for a single run. The canonical, configurable
harness is the backend module (it owns the test matrix, VRAM sampling and OCR):

    cd packages/backend
    python -m app.services.video_model_bench --all

Both write docs/knowledge-library/benchmarks/video-model-8gb-2026.json and both
upsert by model|resolution|frames|precision|format, so re-running replaces the
matching record instead of appending a duplicate.

Usage:
    python tools/scripts/quick_bench.py [--timeout 1800] [--output PATH]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# tools/scripts/quick_bench.py -> repo root is two levels up from scripts/
REPO_ROOT = Path(__file__).resolve().parents[2]
PORTS_PATH = REPO_ROOT / "config" / "ports.json"
DEFAULT_RESULTS_PATH = (
    REPO_ROOT / "docs" / "knowledge-library" / "benchmarks" / "video-model-8gb-2026.json"
)
DEFAULT_COMFY_URL = "http://127.0.0.1:8188"


def comfy_base_url() -> str:
    """ComfyUI base URL from config/ports.json, falling back to the default port."""
    try:
        ports = json.loads(PORTS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return DEFAULT_COMFY_URL
    return str(ports.get("comfyui_url") or DEFAULT_COMFY_URL)


RUN_IDENTITY = {
    "model": "ltxv_2b",
    "resolution": "512x512",
    "frames": 24,
    "fps": 12,
    "precision": "fp8",
    "format": "safetensors",
}

WORKFLOW = {
    "prompt": {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "ltxv-2b-0.9.8-distilled-fp8.safetensors",
                "weight_dtype": "default",
            },
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": "umt5_xxl_fp16.safetensors", "type": "ltxv"},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "positive prompt here", "clip": ["2", 0]},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "negative prompt here", "clip": ["2", 0]},
        },
        "5": {
            "class_type": "EmptyLTXVLatentVideo",
            "inputs": {"width": 512, "height": 512, "length": 24, "batch_size": 1},
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 0,
                "steps": 20,
                "cfg": 7.0,
                "sampler_name": "euler_ancestral",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["3", 0],
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
            "inputs": {"vae_name": "LTX23_video_vae_bf16.safetensors"},
        },
        "9": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["7", 0],
                "frame_rate": 12,
                "loop_count": 0,
                "filename_prefix": "NativeMediaAI_LTX2B",
                "format": "image/gif",
                "pingpong": False,
                "save_output": True,
            },
        },
    }
}


def run_key(record: dict[str, Any]) -> tuple[Any, ...]:
    """Identity of a benchmark run, used to replace rather than duplicate rows."""
    return tuple(record.get(field) for field in RUN_IDENTITY)


def extract_error(entry: dict[str, Any]) -> str:
    """Pull the exception text out of a ComfyUI history status block.

    ComfyUI reports failures as status.messages entries shaped
    ("execution_error", {...}); there is no status.exception field.
    """
    status = entry.get("status") or {}
    for message in status.get("messages") or []:
        if isinstance(message, list) and len(message) >= 2 and message[0] == "execution_error":
            details = message[1] or {}
            return (
                f"node {details.get('node_id')} "
                f"{details.get('exception_type', '')}: {details.get('exception_message', '')}"
            )[:500]
    return str(status.get("status_str", "unknown"))[:500]


def record_path(results_path: Path, result: dict[str, Any]) -> None:
    """Insert or replace the record matching this run's identity."""
    results: list[Any] = []
    if results_path.exists():
        try:
            loaded = json.loads(results_path.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise SystemExit(f"{results_path} is not valid JSON: {exc}") from exc
        if isinstance(loaded, dict):
            results = list(loaded.get("results") or [])
        elif isinstance(loaded, list):
            results = loaded
        else:
            raise SystemExit(f"{results_path} must contain a list or an object with a results array")

    key = run_key(result)
    for index, existing in enumerate(results):
        if isinstance(existing, dict) and run_key(existing) == key:
            results[index] = result
            break
    else:
        results.append(result)

    results_path.parent.mkdir(parents=True, exist_ok=True)
    results_path.write_text(json.dumps(results, indent=2), encoding="utf-8")


async def run(base_url: str, results_path: Path, timeout_s: int) -> int:
    """Submit the workflow, poll until it settles, and record the outcome."""
    import aiohttp

    submit_timeout = aiohttp.ClientTimeout(total=30)
    poll_timeout = aiohttp.ClientTimeout(total=10)

    entry: dict[str, Any] = {}
    status = "unknown"

    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(
                f"{base_url}/prompt", json=WORKFLOW, timeout=submit_timeout
            ) as resp:
                body = await resp.text()
                if resp.status != 200:
                    print(f"Rejected ({resp.status}): {body[:2000]}")
                    return 2
                prompt_id = (await resp.json())["prompt_id"]
        except (aiohttp.ClientError, TimeoutError) as exc:
            print(f"Cannot reach ComfyUI at {base_url}: {exc}")
            return 2

        print(f"Submitted: {prompt_id}")

        start = time.time()
        while True:
            elapsed = time.time() - start
            if elapsed > timeout_s:
                status = "timeout"
                break
            try:
                url = f"{base_url}/history/{prompt_id}"
                async with session.get(url, timeout=poll_timeout) as resp:
                    history = await resp.json()
            except (aiohttp.ClientError, TimeoutError) as exc:
                print(f"  poll failed, retrying: {exc}")
                await asyncio.sleep(5)
                continue

            # ComfyUI only writes the history entry once the prompt finishes, so
            # an absent entry means "still running" rather than an error.
            entry = history.get(prompt_id) or {}
            status = str((entry.get("status") or {}).get("status_str", "running"))
            print(f"[{elapsed:6.1f}s] Status: {status}")
            if status != "running":
                break
            await asyncio.sleep(5)

        if status == "timeout":
            # A timed-out prompt keeps executing inside ComfyUI and would hold
            # the GPU (and block the next queued prompt), so cancel it.
            try:
                async with session.post(f"{base_url}/interrupt", timeout=submit_timeout) as resp:
                    print(f"  interrupted running prompt ({resp.status})")
            except (aiohttp.ClientError, TimeoutError) as exc:
                print(f"  interrupt failed, the prompt may still be running: {exc}")

        elapsed = time.time() - start

    result: dict[str, Any] = {
        **RUN_IDENTITY,
        "timestamp": datetime.now(UTC).isoformat(),
        "generation_time_s": round(elapsed, 2),
        "status": status,
    }

    if status == "success":
        for node_out in (entry.get("outputs") or {}).values():
            images = node_out.get("images") if isinstance(node_out, dict) else None
            if images:
                result["output_path"] = images[0].get("filename", "")
                break
    elif status != "timeout":
        result["error"] = extract_error(entry)

    record_path(results_path, result)
    print(f"Saved result to {results_path}: {result}")
    return 0 if status == "success" else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Submit one LTXV-2B workflow to ComfyUI and record the result."
    )
    parser.add_argument(
        "--comfy-url",
        default=comfy_base_url(),
        help="ComfyUI base URL (default: comfyui_url from config/ports.json)",
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_RESULTS_PATH, help="benchmark JSON file to update"
    )
    parser.add_argument(
        "--timeout", type=int, default=1800, help="max seconds to wait for the prompt (default: 1800)"
    )
    args = parser.parse_args()
    return asyncio.run(run(args.comfy_url, args.output, args.timeout))


if __name__ == "__main__":
    raise SystemExit(main())

