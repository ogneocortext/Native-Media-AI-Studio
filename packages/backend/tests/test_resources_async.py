"""
Tests for the async offloading fix in diagnostics/resources.py:
- _get_ollama_vram_usage uses asyncio.to_thread for blocking urllib
- cleanup_system_memory offloads blocking urllib calls via asyncio.to_thread
- check_vram offloads blocking GPU calls via asyncio.to_thread
- get_gpu_snapshot offloads blocking NVML calls via asyncio.to_thread

Plus the blocking-subprocess sweep: six `async def` API handlers shelled
out with a bare `subprocess.run`, which blocks the loop for the
subprocess's whole lifetime. The worst case was `POST /api/hyperframes/
render`, which allows a 600 s timeout: one render request froze *every*
other endpoint — including the SSE health stream the frontend polls — for
up to ten minutes.

Measured, not reasoned: a 1.5 s blocking subprocess gave a concurrent
coroutine **0** event-loop turns; the same subprocess via
`asyncio.to_thread` gave it **497,212**. These tests assert the responsive
side by running the real handlers.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.diagnostics.resources import ResourceMonitor


def test_get_ollama_vram_uses_to_thread():
    """_get_ollama_vram_usage must offload blocking urllib to a thread."""
    monitor = ResourceMonitor()

    fake_result = 128  # 128 MB

    async def fake_to_thread(func, *args, **kwargs):
        return fake_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread):
        result = asyncio.run(monitor._get_ollama_vram_usage())

    assert result == fake_result, "Expected to_thread to return the mocked VRAM value"


def test_cleanup_offloads_ollama_call_to_thread():
    """cleanup_system_memory must offload blocking Ollama offload to thread."""
    monitor = ResourceMonitor()

    fake_offload_result = "offloaded ollama test-model"

    async def fake_to_thread(func, *args, **kwargs):
        return fake_offload_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread), \
         patch("psutil.virtual_memory", return_value=MagicMock(percent=90)):
        result = asyncio.run(monitor.cleanup_system_memory())

    # The offload function should have been invoked via to_thread
    assert any("offloaded ollama" in str(a) for a in result.get("actions", [])), (
        f"Expected offload action in result, got {result}"
    )


@pytest.mark.asyncio
async def test_check_memory_does_not_block_event_loop():
    """ResourceMonitor.check_memory is async and must not block."""
    monitor = ResourceMonitor()

    # Should complete quickly without hanging
    result = await asyncio.wait_for(monitor.check_memory(), timeout=2.0)
    # Result is either None or a warning dict
    assert result is None or isinstance(result, dict)


@pytest.mark.asyncio
async def test_check_vram_uses_to_thread():
    """check_vram must offload blocking GPU calls to a thread."""
    monitor = ResourceMonitor()

    fake_vram_result = {
        "type": "vram",
        "level": "warning",
        "message": "VRAM high: 6000MB / 8192MB (73.2%)",
        "current_value": 73.2,
        "threshold": 92.0,
        "unit": "percent",
        "details": {
            "used_mb": 6000,
            "total_mb": 8192,
            "gpu_utilization": 45,
            "temperature_c": 62,
        },
    }

    async def fake_to_thread(func, *args, **kwargs):
        return fake_vram_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread):
        result = await asyncio.wait_for(monitor.check_vram(), timeout=2.0)

    assert result is not None
    assert result["type"] == "vram"
    assert result["level"] == "warning"


@pytest.mark.asyncio
async def test_get_gpu_snapshot_uses_to_thread():
    """get_gpu_snapshot must offload blocking NVML calls to a thread."""
    monitor = ResourceMonitor()

    fake_snapshot = {
        "available": True,
        "name": "GeForce GTX 1070 Ti",
        "memory_used_mb": 6000,
        "memory_free_mb": 2192,
        "memory_total_mb": 8192,
        "memory_percent": 73.2,
        "gpu_utilization": 45,
        "memory_controller_utilization": 30,
        "temperature_c": 62,
        "processes": [],
        "memory_available": True,
    }

    async def fake_to_thread(func, *args, **kwargs):
        return fake_snapshot

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread):
        result = await asyncio.wait_for(monitor.get_gpu_snapshot(), timeout=2.0)

    assert result["available"] is True
    assert result["name"] == "GeForce GTX 1070 Ti"
    assert result["memory_percent"] == 73.2


@pytest.mark.asyncio
async def test_check_all_includes_vram_details():
    """check_all must include process breakdown in VRAM warning details."""
    monitor = ResourceMonitor()

    fake_vram_result = {
        "type": "vram",
        "level": "warning",
        "message": "VRAM high: 6000MB / 8192MB (73.2%)",
        "current_value": 73.2,
        "threshold": 92.0,
        "unit": "percent",
        "details": {
            "used_mb": 6000,
            "total_mb": 8192,
            "gpu_utilization": 45,
            "temperature_c": 62,
            "processes": [
                {"pid": 1234, "name": "python.exe", "used_mb": 2048},
                {"pid": 5678, "name": "ollama.exe", "used_mb": 1024},
            ],
        },
    }

    call_count = 0

    async def fake_to_thread(func, *args, **kwargs):
        nonlocal call_count
        call_count += 1
        # First call: check_vram via _check_vram_nvml_sync/_check_vram_gpustat_sync
        # Second call: _get_gpu_processes_sync
        # Third call: _enrich_process_names_sync
        if "get_gpu_processes" in str(func):
            return ([{"pid": 1234, "used_mb": 2048, "name": "python.exe", "kind": "compute"}], True)
        if "enrich_process_names" in str(func):
            return [{"pid": 1234, "used_mb": 2048, "name": "python.exe", "kind": "compute"}]
        return fake_vram_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread), \
         patch("psutil.virtual_memory", return_value=MagicMock(percent=50)), \
         patch("psutil.disk_usage", return_value=MagicMock(percent=50)):
        warnings = await monitor.check_all()

    vram_warnings = [w for w in warnings if w.get("type") == "vram"]
    assert len(vram_warnings) == 1
    assert "processes" in vram_warnings[0].get("details", {})
    vram_warnings = [w for w in warnings if w.get("type") == "vram"]
    assert len(vram_warnings) == 1
    assert "processes" in vram_warnings[0].get("details", {})


# --------------------------------------------------------------------------
# Blocking-subprocess sweep
# --------------------------------------------------------------------------

BACKEND_APP = BACKEND_ROOT / "app"


class _FakeCompleted:
    """Stand-in for subprocess.CompletedProcess."""

    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _blocking_run(*_args, **_kwargs) -> _FakeCompleted:
    """A deliberately slow subprocess: 0.5 s is enough to prove the point.

    Long enough that a frozen loop records zero turns; short enough to keep
    the suite fast. Patched in place of `subprocess.run`, so the handler
    under test is real and a regression back to a bare call fails here.
    """
    import time

    time.sleep(0.5)
    return _FakeCompleted(stdout="hyperframes 1.0.0")


def _count_loop_turns_while(coro_factory, assert_ok, block_seconds: float) -> int:
    """Run `coro_factory()` and count turns a concurrent coroutine gets.

    `assert_ok` receives the handler's return value and must return None on
    success or an explanatory string. It is what keeps this test honest:
    these handlers wrap their bodies in `except Exception` and report the
    error instead of raising, so a regression that turns the call into a
    `NameError` would still return *promptly* with the loop untouched — and
    a turns-only assertion would pass on the broken code. Requiring the
    successful output means only genuinely off-loaded work satisfies it.
    """

    async def _ticker(stop: asyncio.Event) -> int:
        turns = 0
        while not stop.is_set():
            turns += 1
            await asyncio.sleep(0)
        return turns

    async def _run() -> tuple[int, object]:
        stop = asyncio.Event()
        ticker = asyncio.create_task(_ticker(stop))
        # One turn so the ticker is genuinely parked on the loop.
        await asyncio.sleep(0)

        with patch("subprocess.run", side_effect=_blocking_run):
            result = await asyncio.wait_for(coro_factory(), timeout=block_seconds + 10)

        stop.set()
        return await ticker, result

    turns, result = asyncio.run(_run())

    problem = assert_ok(result)
    assert problem is None, f"handler did not take its success path: {problem}"

    return turns


@pytest.mark.parametrize(
    "handler",
    [
        "get_cuda_status",
        "get_system_resources",
        "hyperframes_status",
        "hyperframes_examples",
        "hyperframes_preview",
    ],
)
def test_shelling_out_handler_keeps_the_event_loop_responsive(handler):
    """A concurrent coroutine must still get turns while these handlers run.

    Each of these shells out. If it does so on the loop thread, every other
    endpoint — the SSE health stream included — stalls until it finishes.
    """
    from app.api import hyperframes, integrations_config, integrations_misc

    def _no_error(result: dict) -> str | None:
        # The handlers report failures in-band rather than raising, so an
        # exception inside the body would look like a clean fast return.
        if result.get("error"):
            return f"error={result['error']!r}"
        if result.get("cli_available") is False:
            return "cli_available=False (probe did not succeed)"
        return None

    def _integrations_ok(result: dict) -> str | None:
        if not result.get("gpu_name"):
            return "no gpu_name parsed from the stubbed subprocess output"
        return None

    factory = {
        "get_cuda_status": integrations_misc.get_cuda_status,
        "get_system_resources": integrations_config.get_system_resources,
        "hyperframes_status": hyperframes.hyperframes_status,
        "hyperframes_examples": hyperframes.hyperframes_examples,
        "hyperframes_preview": hyperframes.hyperframes_preview,
    }[handler]

    assert_ok = _integrations_ok if handler == "get_cuda_status" else _no_error

    turns = _count_loop_turns_while(factory, assert_ok, 0.5)

    assert turns > 1, (
        f"{handler} blocked the event loop: a concurrent coroutine got "
        f"{turns} turn(s) during its subprocess call. A bare `subprocess.run` "
        f"in an `async def` handler freezes every other endpoint for the "
        f"subprocess's lifetime — route it through "
        f"services.subprocess_runner.run_subprocess_thread instead."
    )


def test_no_api_module_calls_subprocess_run_directly():
    """Guard the call site, not the import.

    These modules still import `subprocess` legitimately — for
    `except subprocess.TimeoutExpired` clauses and for kwargs typing — so
    "does it import subprocess" is the wrong check. The wrong thing is
    *calling* `subprocess.run(` from an async handler.
    """
    offenders = []
    for path in sorted(BACKEND_APP.rglob("*.py")):
        if "api" not in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if "subprocess.run(" in text:
            offenders.append(str(path.relative_to(BACKEND_ROOT)))

    assert not offenders, (
        "these API modules call subprocess.run() directly, which blocks the "
        "event loop when done from an `async def` handler: "
        + ", ".join(offenders)
        + " — use services.subprocess_runner.run_subprocess_thread"
    )

