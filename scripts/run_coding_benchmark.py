#!/usr/bin/env python3
"""Coding model benchmark runner.

Standalone CLI to benchmark Ollama coding models against the standardized
coding tasks defined in packages/backend/app/services/coding_benchmark.py.

Usage:
    python scripts/run_coding_benchmark.py [--model qwen2.5:7b] [--all]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "packages" / "backend"))

from app.adapters.ollama import OllamaAdapter  # noqa: E402
from app.services.coding_benchmark import run_benchmark  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description="Run coding model benchmarks")
    parser.add_argument("--model", type=str, default=None, help="Specific model to benchmark")
    parser.add_argument("--all", action="store_true", help="Benchmark all available models")
    parser.add_argument("--max-models", type=int, default=12, help="Max models when using --all")
    parser.add_argument("--quick", action="store_true", help="Quick benchmark: code generation + tool use only")
    parser.add_argument("--num-ctx", type=int, default=None, help="Ollama context window size (default: 8192 full / 4096 quick)")
    args = parser.parse_args()

    adapter = OllamaAdapter()
    try:
        if not await adapter.health_check():
            print("Ollama is not available", file=sys.stderr)
            return 1

        models = None
        if args.model:
            models = [args.model]
        elif args.all:
            models = None  # resolved in run_benchmark
        else:
            # Default: benchmark the project's standard coding models
            models = [
                "qwen2.5:7b",
                "qwen3.5:9b",
                "qwen3.5:4b",
                "gemma4:e2b-it-qat",
                "llama3.2:3b",
                "deepseek-r1:7b",
            ]

        print(f"Running coding benchmark on: {models or 'all available'}")
        result = await run_benchmark(models=models, adapter=adapter, max_models=args.max_models, quick=args.quick, num_ctx=args.num_ctx)

        results = result.get("results", {})
        print("\n" + "=" * 70)
        print("Coding Benchmark Results")
        print("=" * 70)
        for model_name, data in sorted(results.items(), key=lambda x: x[1].get("total_score", 0), reverse=True):
            score = data.get("total_score", 0)
            latency = data.get("total_latency_ms", 0)
            success = data.get("success", False)
            status = "OK" if success else "FAIL"
            print(f"  {status} {model_name:30s} score={score:3d}  latency={latency:6d}ms")
            for task in data.get("tasks", []):
                tscore = task.get("validation", {}).get("score", 0)
                tlat = task.get("latency_ms", 0)
                tstatus = "OK" if task.get("success") else "FAIL"
                print(f"      {tstatus} {task['task']:30s} score={tscore:3d}  {tlat:6d}ms")
        print("=" * 70)

        out_path = PROJECT_ROOT / "output" / "coding-benchmarks.json"
        print(f"Results saved to: {out_path}")
        return 0
    finally:
        try:
            await adapter.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
