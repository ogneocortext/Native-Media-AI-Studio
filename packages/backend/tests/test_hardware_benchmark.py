"""Tests for hardware profiles, benchmark execution, persistence, and API routes."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest
from app.api import hardware as hardware_api
from app.core import database as database_module
from app.core.hardware_profile import detect_hardware_profile, save_hardware_profile
from app.services.hardware_benchmark import (
    BenchmarkEngine,
    BenchmarkRequest,
    BenchmarkStatus,
    HardwareBenchmarkRunner,
)


class FakeOllamaAdapter:
    def __init__(self, *, delay: float = 0.0, fail: bool = False) -> None:
        self.delay = delay
        self.fail = fail
        self.calls: list[dict] = []

    async def list_models(self) -> list[dict[str, str]]:
        return [{"name": "test-model"}]

    async def chat(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("adapter failure")
        return {
            "message": {"content": "benchmark response"},
            "eval_count": 4,
            "prompt_eval_count": 12,
            "total_duration": 20_000_000,
        }


class FakeResourceMonitor:
    def __init__(self) -> None:
        self.calls = 0

    def get_gpu_snapshot(self) -> dict[str, object]:
        self.calls += 1
        return {"available": True, "free_mb": 4096}


class FakeComfyUIAdapter:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def generate(self, params: dict[str, object]) -> dict[str, object]:
        self.calls.append(params)
        return {"image": "AAAA", "seed": 7, "prompt_id": "prompt-1"}


def _profile_path(tmp_path: Path) -> Path:
    source = Path(__file__).resolve().parents[3] / "config" / "hardware-profile.json"
    target = tmp_path / "hardware-profile.json"
    shutil.copy2(source, target)
    return target


def test_profile_applies_manual_overrides_and_limits(tmp_path: Path) -> None:
    profile = detect_hardware_profile(_profile_path(tmp_path))

    assert profile.profile_name == "nma-gtx-1070ti-workstation"
    assert profile.cpu.name == "AMD Ryzen 5 5500"
    assert profile.memory.total_mb == 32768
    assert profile.gpus[0].memory_total_mb == 8192
    assert profile.limits.max_concurrent_benchmarks == 1
    assert profile.limits.comfyui_width == 768

    saved = save_hardware_profile(profile, _profile_path(tmp_path))
    cached = saved.with_suffix(".cached.json")
    assert cached.exists()
    assert json.loads(cached.read_text(encoding="utf-8"))["cpu"]["name"] == "AMD Ryzen 5 5500"


@pytest.mark.asyncio
async def test_ollama_runner_executes_bounded_iterations(tmp_path: Path) -> None:
    adapter = FakeOllamaAdapter()
    monitor = FakeResourceMonitor()
    persisted: list[dict] = []

    async def persist(result: object) -> None:
        persisted.append(result.model_dump(mode="json"))  # type: ignore[attr-defined]

    runner = HardwareBenchmarkRunner(
        _profile_path(tmp_path),
        ollama_adapter=adapter,
        resource_monitor=monitor,
        persist_result=persist,
    )
    result = await runner.run(
        BenchmarkRequest(
            engine=BenchmarkEngine.OLLAMA,
            iterations=2,
            persist=True,
        )
    )

    assert result.status is BenchmarkStatus.COMPLETED
    assert result.success is True
    assert result.successful_iterations == 2
    assert result.model == "test-model"
    assert result.metrics["output_tokens"] == 8
    assert len(adapter.calls) == 2
    assert all(call["num_ctx"] == 4096 for call in adapter.calls)
    assert monitor.calls == 2
    assert len(persisted) == 1
    assert persisted[0]["run_id"] == result.run_id


@pytest.mark.asyncio
async def test_comfyui_runner_records_metadata_without_image_payload(tmp_path: Path) -> None:
    adapter = FakeComfyUIAdapter()
    runner = HardwareBenchmarkRunner(
        _profile_path(tmp_path),
        comfyui_adapter=adapter,
        resource_monitor=FakeResourceMonitor(),
        persist_result=None,
    )

    result = await runner.run(
        BenchmarkRequest(
            engine=BenchmarkEngine.COMFYUI,
            model="test-checkpoint",
            iterations=2,
            persist=False,
        )
    )

    assert result.status is BenchmarkStatus.COMPLETED
    assert result.successful_iterations == 2
    assert result.result == {"seed": 7, "prompt_id": "prompt-1"}
    assert result.metrics["output_bytes"] == 8
    assert len(adapter.calls) == 2
    assert all(call["width"] == 768 and call["height"] == 768 for call in adapter.calls)


@pytest.mark.asyncio
async def test_runner_reports_timeout_without_leaking_adapter_error(tmp_path: Path) -> None:
    adapter = FakeOllamaAdapter(delay=2.0)
    runner = HardwareBenchmarkRunner(
        _profile_path(tmp_path),
        ollama_adapter=adapter,
        resource_monitor=FakeResourceMonitor(),
        persist_result=None,
    )

    result = await runner.run(
        BenchmarkRequest(
            engine=BenchmarkEngine.OLLAMA,
            timeout_seconds=1,
            persist=False,
        )
    )

    assert result.status is BenchmarkStatus.TIMED_OUT
    assert result.success is False
    assert "timed out" in (result.error or "")


def test_benchmark_repository_round_trip(temp_db: Path) -> None:
    record = {
        "run_id": "test-run",
        "engine": "ollama",
        "model": "test-model",
        "status": "completed",
        "started_at": "2026-01-01T00:00:00+00:00",
        "completed_at": "2026-01-01T00:00:01+00:00",
        "duration_ms": 1000.0,
        "iterations": 1,
        "successful_iterations": 1,
        "success": True,
        "request": {"engine": "ollama"},
        "metrics": {"avg_latency_ms": 1000.0},
        "result": {"text": "ok"},
        "profile": {"profile_name": "test"},
    }

    stored = database_module.insert_benchmark_result(record)
    assert stored["run_id"] == "test-run"
    assert database_module.get_benchmark_result("test-run")["result"] == {"text": "ok"}
    assert database_module.list_benchmark_results(engine="ollama")[0]["model"] == "test-model"


@pytest.mark.asyncio
async def test_hardware_api_profile_and_benchmark(client, monkeypatch, tmp_path: Path) -> None:
    adapter = FakeOllamaAdapter()
    fake_runner = HardwareBenchmarkRunner(
        _profile_path(tmp_path),
        ollama_adapter=adapter,
        resource_monitor=FakeResourceMonitor(),
        persist_result=None,
    )
    monkeypatch.setattr(hardware_api, "_runner", fake_runner)

    profile_response = await client.get("/api/hardware/profile")
    assert profile_response.status_code == 200
    assert profile_response.json()["profile_name"] == "nma-gtx-1070ti-workstation"

    benchmark_response = await client.post(
        "/api/hardware/benchmark",
        json={"engine": "ollama", "iterations": 1, "persist": False},
    )
    assert benchmark_response.status_code == 200
    assert benchmark_response.json()["status"] == "completed"
    assert benchmark_response.json()["model"] == "test-model"


def test_hardware_profile_config_is_valid_json() -> None:
    config_path = Path(__file__).resolve().parents[3] / "config" / "hardware-profile.json"
    data = json.loads(config_path.read_text(encoding="utf-8"))
    assert data["version"] == 1
    assert data["limits"]["max_concurrent_benchmarks"] == 1
