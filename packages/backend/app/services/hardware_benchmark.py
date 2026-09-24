"""Hardware-aware benchmark runner for Ollama and ComfyUI.

The runner is deliberately adapter-based so it can be used by FastAPI, the
command line, or tests without requiring a live service for unit tests.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..core.hardware_profile import DEFAULT_PROFILE_PATH, HardwareProfile, load_hardware_profile

logger = logging.getLogger(__name__)


class BenchmarkEngine(str, Enum):
    OLLAMA = "ollama"
    COMFYUI = "comfyui"


class BenchmarkStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"


class BenchmarkRequest(BaseModel):
    """A bounded benchmark request."""

    model_config = ConfigDict(extra="forbid")

    engine: BenchmarkEngine
    model: str | None = None
    prompt: str = "Explain the difference between a benchmark and a smoke test in three sentences."
    iterations: int = Field(default=1, ge=1, le=20)
    timeout_seconds: int | None = Field(default=None, ge=1, le=3600)
    options: dict[str, Any] = Field(default_factory=dict)
    persist: bool = True


class BenchmarkResult(BaseModel):
    """Serializable result returned by :class:`HardwareBenchmarkRunner`."""

    run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    engine: BenchmarkEngine
    model: str | None
    status: BenchmarkStatus
    started_at: datetime
    completed_at: datetime | None = None
    duration_ms: float | None = None
    iterations: int
    successful_iterations: int = 0
    request: dict[str, Any] = Field(default_factory=dict)
    success: bool = False
    metrics: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    profile: dict[str, Any] = Field(default_factory=dict)


class HardwareBenchmarkRunner:
    """Run repeatable, hardware-aware local AI benchmarks.

    Args:
        profile_path: Hardware profile/config path. ``None`` uses the project
            default. Supplying a path is useful for tests and alternate hosts.
        ollama_adapter: Optional adapter override.
        comfyui_adapter: Optional adapter override.
        resource_monitor: Optional resource monitor override.
        persist_result: Optional persistence callback. The default lazy-imports
            the SQLite repository function when a result is completed.
    """

    def __init__(
        self,
        profile_path: str | Path | None = None,
        *,
        ollama_adapter: Any | None = None,
        comfyui_adapter: Any | None = None,
        resource_monitor: Any | None = None,
        persist_result: Any | None = None,
    ) -> None:
        self.profile_path = Path(profile_path) if profile_path else DEFAULT_PROFILE_PATH
        self.profile: HardwareProfile = load_hardware_profile(self.profile_path)
        self.ollama_adapter = ollama_adapter
        self.comfyui_adapter = comfyui_adapter
        self.resource_monitor = resource_monitor
        self.persist_result = persist_result
        self._semaphore = asyncio.Semaphore(
            max(1, self.profile.limits.max_concurrent_benchmarks)
        )

    async def run(self, request: BenchmarkRequest) -> BenchmarkResult:
        """Run a request while enforcing the configured concurrency limit."""

        async with self._semaphore:
            return await self._run_locked(request)

    async def _run_locked(self, request: BenchmarkRequest) -> BenchmarkResult:
        started_at = datetime.now(timezone.utc)
        started = time.perf_counter()
        model = request.model
        samples: list[dict[str, Any]] = []
        gpu_before = self._gpu_snapshot()
        result_payload: dict[str, Any] = {}
        error: str | None = None
        status = BenchmarkStatus.RUNNING
        successful_iterations = 0

        result: BenchmarkResult | None = None
        timeout_seconds = self._timeout_seconds(request)
        try:
            if request.engine is BenchmarkEngine.OLLAMA:
                adapter = self.ollama_adapter or self._get_adapter("ollama")
                if model is None:
                    model = await self._select_ollama_model(adapter)
                for _ in range(request.iterations):
                    sample = await self._run_ollama_iteration(
                        adapter,
                        model,
                        request.prompt,
                        request.options,
                        timeout_seconds,
                    )
                    samples.append(sample)
                    successful_iterations += 1
                    result_payload = sample.get("result", {})
            else:
                adapter = self.comfyui_adapter or self._get_adapter("comfyui")
                for _ in range(request.iterations):
                    sample = await self._run_comfyui_iteration(
                        adapter,
                        model,
                        request.prompt,
                        request.options,
                        timeout_seconds,
                    )
                    samples.append(sample)
                    successful_iterations += 1
                    result_payload = sample.get("result", {})
            status = (
                BenchmarkStatus.COMPLETED
                if successful_iterations == request.iterations
                else BenchmarkStatus.FAILED
            )
        except asyncio.TimeoutError:
            status = BenchmarkStatus.TIMED_OUT
            error = f"benchmark timed out after {self._timeout_seconds(request)} seconds"
        except Exception as exc:  # Adapter failures should become API results.
            status = BenchmarkStatus.FAILED
            error = f"{type(exc).__name__}: {exc}"
            logger.exception("Hardware benchmark failed for engine=%s", request.engine.value)
        finally:
            completed_at = datetime.now(timezone.utc)
            duration_ms = (time.perf_counter() - started) * 1000.0
            gpu_after = self._gpu_snapshot()
            metrics = self._aggregate_metrics(samples, gpu_before, gpu_after)
            result = BenchmarkResult(
                engine=request.engine,
                model=model,
                status=status,
                started_at=started_at,
                completed_at=completed_at,
                duration_ms=duration_ms,
                iterations=request.iterations,
                successful_iterations=successful_iterations,
                request=request.model_dump(mode="json"),
                success=status is BenchmarkStatus.COMPLETED,
                metrics=metrics,
                result=result_payload,
                error=error,
                profile=self.profile.model_dump(mode="json"),
            )
            if request.persist:
                await self._persist(result)
        assert result is not None
        return result

    def _timeout_seconds(self, request: BenchmarkRequest) -> int:
        return request.timeout_seconds or self.profile.limits.benchmark_timeout_seconds

    def _get_adapter(self, engine: str) -> Any:
        try:
            from ..adapters.registry import get_adapter

            return get_adapter(engine)
        except Exception as exc:
            raise RuntimeError(f"Unable to load {engine} adapter: {exc}") from exc

    async def _select_ollama_model(self, adapter: Any) -> str:
        models = await adapter.list_models()
        names = [
            item.get("name") if isinstance(item, dict) else str(item)
            for item in models
        ]
        names = [name for name in names if name]
        if not names:
            raise RuntimeError("Ollama has no available models")
        return names[0]

    async def _run_ollama_iteration(
        self,
        adapter: Any,
        model: str,
        prompt: str,
        options: dict[str, Any],
        timeout_seconds: int,
    ) -> dict[str, Any]:
        iteration_started = time.perf_counter()
        chat_options = {
            key: value
            for key, value in options.items()
            if key not in {"messages", "model", "stream"}
        }
        chat_options.setdefault("num_ctx", self.profile.limits.ollama_context_tokens)
        chat_options.setdefault(
            "num_predict", self.profile.limits.ollama_max_output_tokens
        )
        response = await asyncio.wait_for(
            adapter.chat(
                messages=[
                    {"role": "system", "content": "You are a concise benchmark assistant."},
                    {"role": "user", "content": prompt},
                ],
                model=model,
                stream=False,
                think=False,
                **chat_options,
            ),
            timeout=timeout_seconds,
        )
        latency_ms = (time.perf_counter() - iteration_started) * 1000.0
        text = self._ollama_response_text(response)
        return {
            "engine": BenchmarkEngine.OLLAMA.value,
            "model": model,
            "latency_ms": latency_ms,
            "output_tokens": self._ollama_output_tokens(response),
            "prompt_tokens": self._ollama_prompt_tokens(response),
            "result": {"text": text, "raw": self._json_safe(response)},
            "metrics": self._ollama_metrics(response),
        }

    async def _run_comfyui_iteration(
        self,
        adapter: Any,
        model: str | None,
        prompt: str,
        options: dict[str, Any],
        timeout_seconds: int,
    ) -> dict[str, Any]:
        iteration_started = time.perf_counter()
        params_options = dict(options)
        params = {
            "prompt": prompt,
            "negative_prompt": params_options.pop(
                "negative_prompt", "blurry, low quality, distorted"
            ),
            "width": params_options.pop("width", self.profile.limits.comfyui_width),
            "height": params_options.pop("height", self.profile.limits.comfyui_height),
            "steps": params_options.pop("steps", self.profile.limits.comfyui_steps),
            "cfg_scale": params_options.pop("cfg_scale", self.profile.limits.comfyui_cfg),
            "seed": params_options.pop("seed", -1),
        }
        params.update(params_options)
        if model:
            params.setdefault("model", model)
        response = await asyncio.wait_for(
            adapter.generate(params),
            timeout=timeout_seconds,
        )
        latency_ms = (time.perf_counter() - iteration_started) * 1000.0
        image_data = response.get("image") if isinstance(response, dict) else None
        result_payload = dict(response) if isinstance(response, dict) else {}
        result_payload.pop("image", None)
        return {
            "engine": BenchmarkEngine.COMFYUI.value,
            "model": model,
            "latency_ms": latency_ms,
            "output_bytes": len(image_data) if isinstance(image_data, str) else None,
            "result": self._json_safe(result_payload),
            "metrics": {"output_bytes": len(image_data) if isinstance(image_data, str) else None},
        }

    @staticmethod
    def _ollama_response_text(response: Any) -> str:
        if not isinstance(response, dict):
            return str(response)
        message = response.get("message") or {}
        if isinstance(message, dict) and message.get("content"):
            return str(message["content"])
        if response.get("response"):
            return str(response["response"])
        return ""

    @staticmethod
    def _ollama_output_tokens(response: Any) -> int | None:
        if not isinstance(response, dict):
            return None
        for key in ("eval_count", "completion_tokens", "output_tokens"):
            value = response.get(key)
            if isinstance(value, (int, float)):
                return int(value)
        return None

    @staticmethod
    def _ollama_prompt_tokens(response: Any) -> int | None:
        if not isinstance(response, dict):
            return None
        for key in ("prompt_eval_count", "prompt_tokens", "input_tokens"):
            value = response.get(key)
            if isinstance(value, (int, float)):
                return int(value)
        return None

    @staticmethod
    def _ollama_metrics(response: Any) -> dict[str, Any]:
        if not isinstance(response, dict):
            return {}
        metrics: dict[str, Any] = {}
        for key, output_key in (
            ("total_duration", "total_duration_ns"),
            ("eval_duration", "eval_duration_ns"),
            ("prompt_eval_duration", "prompt_eval_duration_ns"),
            ("load_duration", "load_duration_ns"),
        ):
            value = response.get(key)
            if isinstance(value, (int, float)):
                metrics[output_key] = int(value)
        return metrics

    def _aggregate_metrics(
        self,
        samples: list[dict[str, Any]],
        gpu_before: dict[str, Any],
        gpu_after: dict[str, Any],
    ) -> dict[str, Any]:
        latencies = [float(sample["latency_ms"]) for sample in samples]
        output_tokens = sum(int(sample.get("output_tokens") or 0) for sample in samples)
        prompt_tokens = sum(int(sample.get("prompt_tokens") or 0) for sample in samples)
        output_bytes = sum(int(sample.get("output_bytes") or 0) for sample in samples)
        metrics: dict[str, Any] = {
            "samples": samples,
            "avg_latency_ms": sum(latencies) / len(latencies) if latencies else None,
            "min_latency_ms": min(latencies) if latencies else None,
            "max_latency_ms": max(latencies) if latencies else None,
            "output_tokens": output_tokens or None,
            "prompt_tokens": prompt_tokens or None,
            "output_bytes": output_bytes or None,
            "tokens_per_second": (
                output_tokens / (sum(float(s.get("latency_ms", 0)) for s in samples) / 1000.0)
                if output_tokens and samples
                else None
            ),
            "gpu_before": gpu_before,
            "gpu_after": gpu_after,
        }
        return self._json_safe(metrics)

    def _gpu_snapshot(self) -> dict[str, Any]:
        monitor = self.resource_monitor
        if monitor is None:
            try:
                from ..diagnostics.resources import resource_monitor as _monitor

                monitor = _monitor
            except Exception:
                return {"available": False, "error": "resource monitor unavailable"}
        try:
            snapshot = monitor.get_gpu_snapshot()
            return self._json_safe(snapshot or {"available": False})
        except Exception as exc:
            return {"available": False, "error": f"{type(exc).__name__}: {exc}"}

    async def _persist(self, result: BenchmarkResult) -> None:
        if self.persist_result is not None:
            callback_result = self.persist_result(result)
            if asyncio.iscoroutine(callback_result):
                await callback_result
            return

        try:
            from ..core.database import insert_benchmark_result

            persisted = insert_benchmark_result(result.model_dump(mode="json"))
            if asyncio.iscoroutine(persisted):
                await persisted
        except (ImportError, AttributeError) as exc:
            logger.debug("Benchmark persistence is not available yet: %s", exc)
        except Exception:
            logger.exception("Failed to persist benchmark result %s", result.run_id)

    @staticmethod
    def _json_safe(value: Any) -> Any:
        return json.loads(json.dumps(value, default=str, ensure_ascii=False))


async def _cli_main() -> None:
    parser = argparse.ArgumentParser(description="Run a local Ollama or ComfyUI benchmark")
    parser.add_argument("--engine", required=True, choices=[item.value for item in BenchmarkEngine])
    parser.add_argument("--model")
    parser.add_argument("--prompt", default="Explain the difference between a benchmark and a smoke test in three sentences.")
    parser.add_argument("--iterations", type=int, default=1)
    parser.add_argument("--timeout-seconds", type=int)
    parser.add_argument("--profile", default=str(DEFAULT_PROFILE_PATH))
    parser.add_argument("--no-persist", action="store_true")
    parser.add_argument("--json", action="store_true", help="Print only the JSON result")
    args = parser.parse_args()

    request = BenchmarkRequest(
        engine=BenchmarkEngine(args.engine),
        model=args.model,
        prompt=args.prompt,
        iterations=args.iterations,
        timeout_seconds=args.timeout_seconds,
        persist=not args.no_persist,
    )
    runner = HardwareBenchmarkRunner(args.profile)
    result = await runner.run(request)
    payload = result.model_dump(mode="json")
    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(
            f"{result.engine.value} benchmark {result.run_id}: "
            f"{result.status.value} ({result.duration_ms:.1f} ms)"
        )
        if result.error:
            print(result.error)
        if result.metrics:
            print(json.dumps(result.metrics, indent=2, ensure_ascii=False))


def main() -> None:
    asyncio.run(_cli_main())


if __name__ == "__main__":
    main()
