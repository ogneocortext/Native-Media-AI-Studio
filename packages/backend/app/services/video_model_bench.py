"""Video model benchmark for LTX 2.3 / Mochi on 8GB VRAM hardware.

Run from ``packages/backend``:

    python -m app.services.video_model_bench --dry-run --all
    python -m app.services.video_model_bench --model ltx_2_3 --resolution 512x512 --frames 24
    python -m app.services.video_model_bench --model ltxv_2b --precision fp8 --format safetensors

Results are written to ``docs/knowledge-library/benchmarks/video-model-8gb-2026.json``
(one record per model/resolution/frames/precision/format key — re-runs update in place).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
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
        "model": "ltxv_2b",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "fp8",
        "expected_vram_mb": 8000,
        "format": "safetensors",
    },
    {
        "model": "ltxv_2b",
        "resolution": "832x480",
        "width": 832,
        "height": 480,
        "frames": 24,
        "fps": 12,
        "precision": "fp8",
        "expected_vram_mb": 10000,
        "format": "safetensors",
    },
    {
        "model": "ltx_2_3",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "fp8",
        "expected_vram_mb": 8000,
        "format": "safetensors",
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
        "format": "safetensors",
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
        "format": "safetensors",
    },
    {
        "model": "ltx_2_3",
        "resolution": "512x512",
        "width": 512,
        "height": 512,
        "frames": 24,
        "fps": 12,
        "precision": "Q4_K_S",
        "expected_vram_mb": 10000,
        "format": "gguf",
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
        "format": "safetensors",
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
        "format": "safetensors",
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
        "format": "safetensors",
    },
]

# ---------------------------------------------------------------------------
# Workflow templates (minimal, protocol-compatible)
# ---------------------------------------------------------------------------

def _ltxv_2b_workflow(model_file: str, width: int, height: int, frames: int, fps: int, seed: int) -> dict[str, Any]:
    return {
        "prompt": {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": model_file, "weight_dtype": "default"},
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
                "inputs": {"width": width, "height": height, "length": frames, "batch_size": 1},
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
                    "frame_rate": fps,
                    "loop_count": 0,
                    "filename_prefix": "NativeMediaAI_LTX2B",
                    "format": "image/gif",
                    "pingpong": False,
                    "save_output": True,
                },
            },
        }
    }


def _ltx_workflow(model_file: str, width: int, height: int, frames: int, fps: int, seed: int, model_format: str = "safetensors") -> dict[str, Any]:
    if model_format == "gguf":
        unet_node = {
            "1": {
                "class_type": "UnetLoaderGGUF",
                "inputs": {"unet_name": model_file},
            }
        }
        clip1 = "gemma_3_12B_it_fp4_mixed.safetensors"
        clip2 = "ltx-2.3_text_projection_bf16.safetensors"
    else:
        unet_node = {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": model_file, "weight_dtype": "default"},
            }
        }
        clip1 = "gemma_3_12B_it_fp4_mixed.safetensors"
        clip2 = "ltx-2.3_text_projection_bf16.safetensors"

    workflow = {
        "prompt": {
            **unet_node,
            "2": {
                "class_type": "DualCLIPLoader",
                "inputs": {
                    "clip_name1": clip1,
                    "clip_name2": clip2,
                    "type": "ltxv",
                },
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
                "class_type": "LTXVConditioning",
                "inputs": {
                    "positive": ["3", 0],
                    "negative": ["4", 0],
                    "frame_rate": fps,
                },
            },
            "6": {
                "class_type": "EmptyLTXVLatentVideo",
                "inputs": {"width": width, "height": height, "length": frames, "batch_size": 1},
            },
            "7": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": 20,
                    "cfg": 7.0,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["5", 0],
                    "negative": ["5", 1],
                    "latent_image": ["6", 0],
                },
            },
            "8": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": "LTX23_video_vae_bf16.safetensors"},
            },
            "9": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["7", 0], "vae": ["8", 0]},
            },
            "10": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["9", 0],
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
    return workflow


def _mochi_workflow(model_file: str, width: int, height: int, frames: int, fps: int, seed: int) -> dict[str, Any]:
    return {
        "prompt": {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": model_file, "weight_dtype": "default"},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "positive prompt here", "clip": ["3", 0]},
            },
            "3": {
                "class_type": "CLIPLoader",
                "inputs": {"clip_name": "umt5_xxl_fp16.safetensors", "type": "mochi"},
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "negative prompt here", "clip": ["3", 0]},
            },
            "5": {
                "class_type": "EmptyMochiLatentVideo",
                "inputs": {"width": width, "height": height, "length": frames, "batch_size": 1},
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

class VramSampler:
    """Background VRAM sampler that records the peak while generation runs.

    Sampling only before/after a run measures idle memory; this thread polls
    NVML concurrently with the ComfyUI submission so ``peak_vram_mb`` reflects
    the generation itself.
    """

    def __init__(self, poll_interval_s: float = 0.5) -> None:
        self._poll_interval_s = poll_interval_s
        self._stop = threading.Event()
        self._peak = -1
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="vram-sampler", daemon=True)
        self._thread.start()

    def stop(self) -> int:
        """Stop sampling and return the peak MB observed (-1 if unavailable)."""
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        return self._peak

    def _run(self) -> None:
        try:
            import pynvml  # type: ignore

            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            try:
                while not self._stop.is_set():
                    info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                    used_mb = info.used // (1024 * 1024)
                    if used_mb > self._peak:
                        self._peak = used_mb
                    self._stop.wait(self._poll_interval_s)
            finally:
                pynvml.nvmlShutdown()
        except Exception as exc:
            logger.debug("vram sampler stopped early: %s", exc)


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

def _run_async(coro):
    import asyncio

    try:
        return asyncio.run(coro)
    except RuntimeError as exc:
        msg = str(exc).lower()
        if "no current event loop" in msg or "cannot be called from" in msg or "already running" in msg:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(coro)
            finally:
                loop.close()
        raise


async def _submit_and_wait(workflow: dict[str, Any], base_url: str, timeout: int = 900) -> dict[str, Any]:
    """Submit a workflow and wait for completion. Returns history entry."""
    import asyncio

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
                    status = entry.get("status", {}).get("status_str", "unknown")
                    last_status = status
                    if status in ("success", "error", "failed"):
                        return {
                            "prompt_id": prompt_id,
                            "status": status,
                            "execution_time": entry.get("status", {}).get("execution_time"),
                            "outputs": entry.get("outputs", {}),
                        }
            await asyncio.sleep(poll_interval)

        return {"error": f"Timed out after {timeout}s", "prompt_id": prompt_id, "last_status": last_status}
    finally:
        await session.close()


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------

def load_existing_results(path: Path = BENCHMARK_OUTPUT) -> list[dict[str, Any]]:
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
            logger.warning("Benchmark file %s is not a list — starting fresh", path)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Could not read existing results from %s: %s", path, exc)
    return []


def save_results(results: list[dict[str, Any]], path: Path = BENCHMARK_OUTPUT) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(results, indent=2), encoding="utf-8")


def _run_key(record: dict[str, Any]) -> str:
    """Stable identity for a benchmark configuration (one record per key).

    ``format`` defaults to ``safetensors`` because legacy records and custom
    CLI-built entries may omit it while ``run_benchmark_entry`` always writes it.
    """
    core = "|".join(
        str(record.get(field, ""))
        for field in ("model", "resolution", "frames", "precision")
    )
    return f"{core}|{record.get('format') or 'safetensors'}"


def upsert_result(results: list[dict[str, Any]], record: dict[str, Any]) -> list[dict[str, Any]]:
    """Replace any existing record for the same configuration, else append.

    Prevents the results file from growing duplicate rows every time the
    benchmark (or ``--dry-run``) is re-run.
    """
    key = _run_key(record)
    for index, existing in enumerate(results):
        if _run_key(existing) == key:
            results[index] = record
            return results
    results.append(record)
    return results


def run_benchmark_entry(entry: dict[str, Any], base_url: str, dry_run: bool = False) -> dict[str, Any]:
    model = entry["model"]
    width = entry["width"]
    height = entry["height"]
    frames = entry["frames"]
    fps = entry["fps"]
    precision = entry["precision"]
    model_format = entry.get("format", "safetensors")

    if model == "ltxv_2b":
        model_file = f"ltxv-2b-0.9.8-distilled-{precision}.safetensors"
        workflow = _ltxv_2b_workflow(model_file, width, height, frames, fps, seed=0)
    elif model == "ltx_2_3":
        if model_format == "gguf":
            model_file = f"ltx-2.3-22b-dev-{precision}.gguf"
        else:
            model_file = f"ltx-video-2.3-{precision}.safetensors"
        workflow = _ltx_workflow(model_file, width, height, frames, fps, seed=0, model_format=model_format)
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
        "format": model_format,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if dry_run:
        result["status"] = "dry-run-ok"
        result["workflow_preview"] = {
            "model_file": model_file,
            "nodes": len(workflow.get("prompt", {})),
        }
        return result

    # VRAM baseline before submit (idle reading, kept for comparison)
    vram_pre = measure_peak_vram_mb(2.0)
    result["vram_pre_mb"] = vram_pre

    # Submit while sampling VRAM concurrently so the peak reflects the
    # generation itself rather than idle memory before/after the run.
    sampler = VramSampler()
    sampler.start()
    start = time.time()
    try:
        run_result = _run_async(_submit_and_wait(workflow, base_url))
    except Exception as exc:  # noqa: BLE001 — one failed entry must not abort the matrix
        run_result = {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        vram_peak = sampler.stop()

    generation_time_s = time.time() - start
    result["generation_time_s"] = round(generation_time_s, 2)
    result["peak_vram_mb"] = max(vram_pre, vram_peak)

    if "error" in run_result:
        result["status"] = "error"
        result["error"] = run_result["error"]
        return result

    result["prompt_id"] = run_result.get("prompt_id")
    result["status"] = run_result.get("status", "unknown")
    result["execution_time"] = run_result.get("execution_time")

    # Quality rating placeholder (manual)
    result["quality_rating"] = None
    result["notes"] = ""

    # Output path from history if available
    outputs = run_result.get("outputs", {})
    for node_out in outputs.values():
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
    ap.add_argument("--model", choices=["ltxv_2b", "ltx_2_3", "mochi_1", "mochi_2"], help="Model to test")
    ap.add_argument("--resolution", type=parse_resolution, help="WxH, e.g. 512x512")
    ap.add_argument("--frames", type=int, default=24, help="Frame count (default 24)")
    ap.add_argument("--all", action="store_true", help="Run full matrix")
    ap.add_argument("--precision", help="Precision filter (e.g. fp8, fp16, Q4_K_S)")
    ap.add_argument("--format", help="Format filter (e.g. safetensors, gguf)")
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
            and (args.precision is None or e.get("precision") == args.precision)
            and (args.format is None or e.get("format") == args.format)
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

    output_path = Path(args.output)
    results = load_existing_results(output_path)
    succeeded = {_run_key(record) for record in results if record.get("status") == "success"}

    for entry in entries:
        entry_key = _run_key(entry)
        if not args.dry_run and entry_key in succeeded:
            logger.info("Skipping %s — already succeeded", entry_key)
            continue

        logger.info("Benchmarking %s @ %s/%dfps %s", entry["model"], entry["resolution"], entry["fps"], entry["precision"])
        rec = run_benchmark_entry(entry, args.comfyui_url, dry_run=args.dry_run)
        upsert_result(results, rec)
        save_results(results, output_path)
        logger.info("Saved result to %s", output_path)

    # Summary
    ok = sum(1 for r in results if r.get("status") == "success" or r.get("status") == "dry-run-ok")
    err = sum(1 for r in results if r.get("status") == "error")
    logger.info("Done. %d ok, %d errors, %d total", ok, err, len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
