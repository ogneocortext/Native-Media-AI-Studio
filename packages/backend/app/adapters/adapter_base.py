"""
Shared adapter base mixin.

Provides common functionality for both HTTP-based service adapters
(``app.adapters.base.BaseAdapter``) and subprocess-based MCP bridge
adapters (``app.adapters.bridge_base.BaseBridgeAdapter``), eliminating
duplicated code between the two hierarchies.

Includes:
- Status tracking (``set_status``, ``get_status``)
- Mock mode flag (``is_mock_mode``)
- Activity tracking (``record_activity``, ``idle_seconds``, ``is_idle``)
- Shared aiohttp session management (``_get_session``, ``close``)
- Error-handling decorator (``_handle_adapter_error``)

Dependency direction: this module imports only stdlib + aiohttp + the
shared core.http module. Nothing in this module imports from
app.api or app.services.
"""

from __future__ import annotations

import functools
import logging
import time
from abc import ABC
from collections.abc import Callable
from enum import StrEnum
from typing import TYPE_CHECKING, Any, TypeVar

if TYPE_CHECKING:
    import aiohttp

from ..core.http import close_shared_session, get_shared_session

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


class AdapterStatus(StrEnum):
    """Adapter connection status."""

    AVAILABLE = "available"
    BUSY = "busy"
    CRITICAL = "critical"
    OFFLINE = "offline"
    ERROR = "error"


class AdapterBase(ABC):  # noqa: B024 - Mixin base class, abstract methods defined in subclasses
    """Shared base mixin for all adapter types.

    Provides common state management and helper methods used by both
    :class:`app.services.adapters.base.BaseAdapter` (HTTP-based API
    adapters) and :class:`app.services.adapters.bridge_base.BaseBridgeAdapter`
    (subprocess-based MCP bridge adapters).

    Subclasses should call ``super().__init__()`` in their ``__init__``
    and may override any method as needed.
    """

    def __init__(self, name: str, *, mock_mode: bool = False):
        """Initialize the adapter base.

        Args:
            name: Human-readable name for this adapter.
            mock_mode: If True, skip service checks and use mock directly.
        """
        self._status: AdapterStatus = AdapterStatus.OFFLINE
        self._mock_mode: bool = mock_mode
        # Shared-session key for this adapter's service, keyed by adapter name
        # so all adapters of one service share one pooled connection (see
        # core/http.py). Adapters no longer own a private ClientSession.
        self._session_key: str = name.lower().replace(" ", "-")
        # Tracks the last time this adapter was used (generate or health_check).
        # Used by the idle monitor to auto-unload services after 15 minutes.
        self._last_activity: float | None = None

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
        """Get the shared aiohttp session for this adapter's service.

        Backed by ``core/http.get_shared_session`` so all adapters of one
        service share a single pooled connection instead of each owning a
        private (and easily leaked) ``ClientSession``.
        """
        return await get_shared_session(self._session_key)

    async def close(self) -> None:
        """Release the shared session for this adapter's service key."""
        await close_shared_session(self._session_key)

    # ------------------------------------------------------------------
    # Error handling decorator
    # ------------------------------------------------------------------

    @staticmethod
    def _handle_adapter_error(
        status_on_error: AdapterStatus = AdapterStatus.ERROR,
    ) -> Callable[[F], F]:
        """Decorator for adapter methods that standardizes error handling.

        Wraps an async adapter method so that:

        * Every exception is logged with the adapter name.
        * The adapter status is updated to ``status_on_error``.
        * The exception is re-raised so the caller can decide how to respond.

        Usage::

            @_handle_adapter_error()
            async def some_method(self, ...):
                ...
        """

        def decorator(func: F) -> F:
            @functools.wraps(func)
            async def wrapper(self: AdapterBase, *args: Any, **kwargs: Any) -> Any:
                try:
                    return await func(self, *args, **kwargs)
                except Exception as exc:
                    self.set_status(status_on_error)
                    logger.error("%s: %s failed: %s", self.name, func.__name__, exc)
                    raise

            return wrapper

        return decorator


# Module-level alias for convenience
_handle_adapter_error = AdapterBase._handle_adapter_error
