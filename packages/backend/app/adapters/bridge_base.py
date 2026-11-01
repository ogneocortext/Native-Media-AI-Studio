"""
Bridge base class for third-party tool adapters.

Extends the adapter pattern from ``base.py`` to support subprocess-based
MCP bridges (Unity, Blender, etc.) that run as separate Node.js processes
communicating via stdio or HTTP.

The bridge adapter pattern isolates third-party vendor code from the core
application. When a vendor updates their MCP protocol or CLI interface,
only the corresponding adapter needs to change -- the services and API
layers remain untouched.

Dependency direction: api -> services -> adapters (this module only).
Nothing in this module imports from app.api or app.services.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any, TypeVar

import aiohttp

from .base import AdapterStatus

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


def _handle_bridge_error(status_on_error: AdapterStatus = AdapterStatus.ERROR) -> Callable[[F], F]:
    """Decorator for bridge methods that standardizes error handling.

    Mirrors ``base._handle_adapter_error`` but for bridge adapters that manage
    subprocess lifecycle. Any exception updates the adapter status and is
    re-raised so the caller can decide how to respond.
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        async def wrapper(self: BaseBridgeAdapter, *args: Any, **kwargs: Any) -> Any:
            try:
                return await func(self, *args, **kwargs)
            except Exception as exc:
                self.set_status(status_on_error)
                logger.error("%s: %s failed: %s", self.name, func.__name__, exc)
                raise
        return wrapper  # type: ignore[return-value]
    return decorator


class BaseBridgeAdapter(ABC):
    """
    Abstract base class for third-party tool bridge adapters.

    Bridge adapters wrap external tools (Unity Editor, Blender, ComfyUI via
    MCP, etc.) that run as separate processes. Each adapter:

    * Manages the subprocess lifecycle (start/stop/restart)
    * Health-checks the external service
    * Executes commands via the tool's MCP/CLI interface
    * Provides status tracking and mock mode
    * Isolates vendor-specific API changes to this single module

    Dependency direction: this module imports only stdlib + aiohttp + the
    shared base adapter types. It never imports from app.api or app.services,
    keeping the dependency graph acyclic.
    """

    def __init__(
        self,
        bridge_command: list[str],
        name: str,
        base_url: str | None = None,
        *,
        mock_mode: bool = False,
        startup_timeout: float = 30.0,
        health_timeout: float = 5.0,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ):
        """
        Initialize the bridge adapter.

        Args:
            bridge_command: Command and args to launch the bridge subprocess
                (e.g. ``["node", "/path/to/unity-mcp-bridge.mjs"]``).
            name: Human-readable name for this adapter.
            base_url: Base URL for the bridge's HTTP endpoint (if HTTP-based).
            mock_mode: If True, skip subprocess lifecycle and use mock responses.
            startup_timeout: Seconds to wait for the bridge to become ready.
            health_timeout: Seconds to wait for health check responses.
            cwd: Working directory for the subprocess.
            env: Additional environment variables for the subprocess.
        """
        self.bridge_command = bridge_command
        self.name = name
        self.base_url = base_url.rstrip('/') if base_url else None
        self._status = AdapterStatus.DISCONNECTED
        self._mock_mode = mock_mode
        self._startup_timeout = startup_timeout
        self._health_timeout = health_timeout
        self._cwd = cwd
        self._env = env or {}
        self._process: asyncio.subprocess.Process | None = None
        self._session: aiohttp.ClientSession | None = None
        self._last_activity: float | None = None

    # ------------------------------------------------------------------
    # Subprocess lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the bridge subprocess and wait for it to become ready.

        Raises:
            RuntimeError: If the bridge fails to start within the timeout.
        """
        if self._mock_mode:
            self._status = AdapterStatus.CONNECTED
            logger.info("%s: Mock mode enabled, skipping subprocess start", self.name)
            return

        if self._process is not None and self._process.returncode is None:
            logger.warning("%s: Bridge process already running", self.name)
            return

        try:
            self._process = await asyncio.create_subprocess_exec(
                *self.bridge_command,
                cwd=self._cwd,
                env={**os.environ, **self._env},
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            logger.error("%s: Bridge command not found: %s", self.name, self.bridge_command[0])
            raise RuntimeError(
                f"{self.name}: Bridge executable not found: {self.bridge_command[0]}"
            ) from exc
        except Exception as exc:
            logger.error("%s: Failed to start bridge process: %s", self.name, exc)
            raise RuntimeError(f"{self.name}: Failed to start bridge: {exc}") from exc

        # Wait for the bridge to become healthy
        deadline = time.monotonic() + self._startup_timeout
        while time.monotonic() < deadline:
            if await self.health_check():
                self._status = AdapterStatus.CONNECTED
                self.record_activity()
                logger.info("%s: Bridge started successfully", self.name)
                return
            # Check if the process died
            if self._process.returncode is not None:
                stderr = await self._process.stderr.read()
                raise RuntimeError(
                    f"{self.name}: Bridge process exited with code "
                    f"{self._process.returncode}: {stderr.decode(errors='replace')[:200]}"
                )
            await asyncio.sleep(0.5)

        raise RuntimeError(
            f"{self.name}: Bridge did not become ready within {self._startup_timeout}s"
        )

    async def stop(self) -> None:
        """Stop the bridge subprocess gracefully."""
        if self._mock_mode:
            self._status = AdapterStatus.DISCONNECTED
            return

        if self._process is None:
            return

        try:
            if self._process.returncode is None:
                self._process.terminate()
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=5.0)
                except TimeoutError:
                    self._process.kill()
                    await self._process.wait()
        except Exception as exc:
            logger.warning("%s: Error stopping bridge: %s", self.name, exc)
        finally:
            self._process = None
            self._status = AdapterStatus.DISCONNECTED

    async def restart(self) -> None:
        """Restart the bridge subprocess."""
        await self.stop()
        await self.start()

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the bridge and underlying tool are reachable.

        Returns:
            True if the bridge and external tool are healthy.
        """

    # ------------------------------------------------------------------
    # Command execution
    # ------------------------------------------------------------------

    @abstractmethod
    async def execute(
        self,
        command: str,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Execute a command on the third-party tool.

        Args:
            command: The command name (tool-specific).
            params: Command parameters.
            timeout: Optional timeout override in seconds.

        Returns:
            Command result dictionary.

        Raises:
            RuntimeError: If the bridge is not available.
            asyncio.TimeoutError: If the command times out.
        """

    @abstractmethod
    def _mock_execute(
        self,
        command: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Mock command execution for testing without the external tool.

        Args:
            command: The command name.
            params: Command parameters.

        Returns:
            Mock result dictionary matching the real output format.
        """

    async def execute_with_fallback(
        self,
        command: str,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Execute a command with health check and error handling.

        Unlike ``execute``, this method checks bridge health first and raises
        a clear error if the bridge is unavailable (unless in mock mode).
        """
        if self._mock_mode:
            logger.info("%s: Running in mock mode (explicit)", self.name)
            return self._mock_execute(command, params)

        healthy = await self.health_check()
        if not healthy:
            self.set_status(AdapterStatus.DISCONNECTED)
            raise RuntimeError(
                f"{self.name} unavailable at {self.base_url or self.bridge_command[0]}. "
                "Start the third-party tool or set MOCK_GENERATION=true."
            )

        try:
            result = await self.execute(command, params, timeout=timeout)
            self.record_activity()
            self.set_status(AdapterStatus.CONNECTED)
            return result
        except Exception as exc:
            self.set_status(AdapterStatus.ERROR)
            logger.error("%s: Command %s failed: %s", self.name, command, exc)
            raise

    # ------------------------------------------------------------------
    # Status and lifecycle
    # ------------------------------------------------------------------

    def get_status(self) -> AdapterStatus:
        """Get current adapter status."""
        return self._status

    def set_status(self, status: AdapterStatus) -> None:
        """Set adapter status."""
        self._status = status

    def is_mock_mode(self) -> bool:
        """Check if running in mock mode."""
        return self._mock_mode

    def record_activity(self) -> None:
        """Record that this adapter was just used."""
        self._last_activity = time.monotonic()

    def idle_seconds(self) -> float | None:
        """Return seconds since last activity, or None if never active."""
        if self._last_activity is None:
            return None
        return time.monotonic() - self._last_activity

    def is_idle(self, threshold_seconds: float) -> bool:
        """Return True if this adapter has been idle longer than threshold."""
        idle = self.idle_seconds()
        if idle is None:
            return False
        return idle > threshold_seconds

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create a shared aiohttp session for HTTP-based bridges."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(limit=5, ttl_dns_cache=300),
                timeout=aiohttp.ClientTimeout(total=30),
            )
        return self._session

    async def close(self) -> None:
        """Close the bridge subprocess and any HTTP sessions."""
        await self.stop()
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None
