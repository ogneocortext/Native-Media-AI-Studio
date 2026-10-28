"""
Idle monitor for AI service adapters.

Runs as a background asyncio task that checks all registered adapters
periodically and unloads any that have been idle for longer than the
configured threshold (default 15 minutes). This keeps VRAM and system
memory free on home-server hardware when services aren't actively used.

The monitor:
1. Wakes up every 60 seconds
2. Iterates all adapters from AdapterRegistry
3. For each CONNECTED adapter idle longer than IDLE_TIMEOUT_SECONDS,
   calls stop_service() to unload it
4. Logs all actions

Services that support stop_service():
- MusicGenAdapter (ACE-Step subprocess)
- Any future adapter implementing stop_service()
"""

from __future__ import annotations

import asyncio
import logging

from ..adapters.base import BaseAdapter
from ..adapters.registry import adapter_registry

logger = logging.getLogger(__name__)

# Default idle timeout: 15 minutes in seconds
IDLE_TIMEOUT_SECONDS = 15 * 60
# Check interval: every 60 seconds
CHECK_INTERVAL_SECONDS = 60


class IdleMonitor:
    """Background task that auto-unloads idle service adapters."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        """Start the idle monitor background task."""
        if self._running:
            logger.warning("Idle monitor already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info(
            "Idle monitor started (timeout=%ds, check=%ds)",
            IDLE_TIMEOUT_SECONDS,
            CHECK_INTERVAL_SECONDS,
        )

    async def stop(self) -> None:
        """Stop the idle monitor background task."""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Idle monitor stopped")

    async def _monitor_loop(self) -> None:
        """Main monitor loop: check all adapters every CHECK_INTERVAL_SECONDS."""
        while self._running:
            try:
                await self._check_idle_adapters()
            except Exception as e:
                logger.error("Idle monitor check failed: %s", e)
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def _check_idle_adapters(self) -> None:
        """Check all adapters and unload any that are idle too long."""
        adapters = adapter_registry.get_all_adapters()
        for name, adapter in adapters.items():
            if not isinstance(adapter, BaseAdapter):
                continue

            # Skip mock-mode adapters (they don't hold real resources)
            if adapter.is_mock_mode():
                continue

            # Only unload CONNECTED adapters
            if adapter.get_status().value != "connected":
                continue

            idle = adapter.idle_seconds()
            if idle is None:
                # Never active - nothing to unload
                continue

            if idle > IDLE_TIMEOUT_SECONDS:
                logger.info(
                    "Idle timeout: %s has been idle for %.0fs, unloading",
                    name, idle,
                )
                await self._unload_adapter(adapter)

    async def _unload_adapter(self, adapter: BaseAdapter) -> None:
        """Unload a single adapter by calling its stop_service if available."""
        stop_method = getattr(adapter, "stop_service", None)
        if stop_method is None:
            logger.warning(
                "Adapter %s has no stop_service method, cannot auto-unload",
                adapter.name,
            )
            return

        try:
            await stop_method()
            logger.info("Successfully unloaded idle adapter: %s", adapter.name)
        except Exception as e:
            logger.error("Failed to unload idle adapter %s: %s", adapter.name, e)


# Global idle monitor instance
idle_monitor = IdleMonitor()
