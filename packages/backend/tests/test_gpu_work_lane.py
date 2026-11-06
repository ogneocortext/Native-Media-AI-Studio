"""Tests for the shared GPU work lane (D71).

The lane is the single mutual-exclusion domain for VRAM-heavy work: queue
jobs hold it for their whole handler run, and user-facing endpoints
(separation, 3D gen, music gen, transcription, vision) hold it around their
service calls. On the 8 GB card, two of these overlapping is an OOM.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.vram_manager import VRAMManager  # noqa: E402


@pytest.mark.asyncio
async def test_work_lane_mutual_exclusion():
    """Two concurrent holders must never overlap."""
    manager = VRAMManager()
    order: list[str] = []

    async def hold(label: str, delay: float) -> None:
        async with manager.work_lane(label):
            order.append(f"{label}:enter")
            await asyncio.sleep(delay)
            order.append(f"{label}:exit")

    await asyncio.gather(hold("a", 0.05), hold("b", 0.01), hold("c", 0.02))

    # Strict alternation: each enter is immediately followed by its own exit.
    for i in range(0, len(order), 2):
        assert order[i].split(":")[0] == order[i + 1].split(":")[0]
    assert len(order) == 6


@pytest.mark.asyncio
async def test_work_lane_status_tracks_holder_and_waiters():
    manager = VRAMManager()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def holder() -> None:
        async with manager.work_lane("endpoint:/api/3d/generate"):
            entered.set()
            await release.wait()

    async def waiter() -> None:
        await entered.wait()
        async with manager.work_lane("endpoint:/api/audio/transcribe"):
            pass

    h = asyncio.create_task(holder())
    w = asyncio.create_task(waiter())
    await entered.wait()
    await asyncio.sleep(0)  # let the waiter reach the lock

    status = manager.work_lane_status
    assert status["held"] is True
    assert status["holder"] == "endpoint:/api/3d/generate"
    assert status["waiters"] >= 1

    release.set()
    await asyncio.gather(h, w)
    assert manager.work_lane_status == {"held": False, "holder": None, "waiters": 0}


@pytest.mark.asyncio
async def test_work_lane_releases_on_exception():
    manager = VRAMManager()
    with pytest.raises(RuntimeError):
        async with manager.work_lane("job:test"):
            raise RuntimeError("boom")
    assert manager.work_lane_status["held"] is False
    assert manager.work_lane_status["holder"] is None


def test_get_status_includes_work_lane():
    status = VRAMManager().get_status()
    assert status["work_lane"] == {"held": False, "holder": None, "waiters": 0}
