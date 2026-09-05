"""
Tests for the adapter registry thread-safety fix:
- _ensure_init uses double-check locking
- Concurrent calls do not create duplicate adapters
"""
from __future__ import annotations

import sys
from pathlib import Path
import threading

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.adapters.registry import AdapterRegistry


def test_ensure_init_is_thread_safe():
    """_ensure_init must use a lock to prevent race conditions."""
    registry = AdapterRegistry()
    registry._initialized = False
    registry._adapters = {}

    errors: list[Exception] = []

    def init_and_check():
        try:
            registry._ensure_init()
        except Exception as e:
            errors.append(e)

    # Run many threads concurrently
    threads = [threading.Thread(target=init_and_check) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Thread-safe init raised errors: {errors}"
    assert registry._initialized is True, "Registry should be initialized after concurrent calls"
    # No duplicate adapter creation
    assert len(registry._adapters) == len(set(registry._adapters.keys())), (
        "Duplicate adapter keys detected — race condition in _ensure_init"
    )


def test_ensure_init_skips_when_already_done():
    """_ensure_init should be a no-op once initialized (double-check pattern)."""
    registry = AdapterRegistry()
    registry._initialized = True
    registry._adapters = {"comfyui": "stub"}

    # Call the real _ensure_init — it should return immediately
    registry._ensure_init()

    # Adapters should be untouched
    assert registry._adapters == {"comfyui": "stub"}


@pytest.mark.asyncio
async def test_set_mock_mode_resets_state():
    """set_mock_mode must reset adapters so they reinitialize on next access."""
    registry = AdapterRegistry()
    registry._initialized = True
    registry._adapters = {"comfyui": "stub"}

    registry.set_mock_mode(True)

    assert registry._initialized is False, "set_mock_mode should reset _initialized"
    assert registry._adapters == {}, "set_mock_mode should clear adapters"
