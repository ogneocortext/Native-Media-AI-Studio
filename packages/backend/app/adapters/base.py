"""
Base adapter interface for external AI services.
"""
import logging
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class AdapterStatus(str, Enum):
    """Adapter connection status"""
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"


class BaseAdapter(ABC):
    """
    Base class for service adapters.

    This abstract base class defines the interface that all external
    service adapters must implement. It provides automatic fallback
    to mock generation when the real service is unavailable.
    """

    def __init__(self, base_url: str, name: str, mock_mode: bool = False):
        """
        Initialize the adapter.

        Args:
            base_url: Base URL for the external service
            name: Human-readable name for this adapter
            mock_mode: If True, skip service checks and use mock directly
        """
        self.base_url = base_url.rstrip('/') if not mock_mode else "mock://internal"
        self.name = name
        self._status = AdapterStatus.DISCONNECTED
        self._mock_mode = mock_mode

    @abstractmethod
    async def health_check(self) -> bool:
        """
        Check if the service is available.

        Returns:
            True if the service is reachable and healthy
        """
        pass

    @abstractmethod
    async def generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate content with given parameters.

        Args:
            params: Dictionary of generation parameters

        Returns:
            Dictionary containing at minimum:
            - image: base64 encoded image (for image adapters)
            - seed: generation seed used
            - info: additional info about the generation
        """
        pass

    @abstractmethod
    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Mock generation for testing without external service.

        This method should return realistic mock data that matches
        the format of the real generate() method output.

        Args:
            params: Dictionary of generation parameters

        Returns:
            Mock response matching the real generate() output format
        """
        pass

    async def generate_with_fallback(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate content — now fails fast when service unavailable unless mock_mode=True.

        Previous behavior silently returned a 1x1 mock PNG when ComfyUI was down,
        masking failures. Per user request to replace mocks with functioning features,
        we now surface the real error so the UI can show it.
        """
        if self._mock_mode:
            logger.info(f"{self.name}: Running in mock mode (explicit)")
            return await self._mock_generate(params)

        # Require real service to be healthy
        healthy = await self.health_check()
        if not healthy:
            self.set_status(AdapterStatus.DISCONNECTED)
            raise RuntimeError(
                f"{self.name} unavailable at {self.base_url}. "
                f"Start the service or set MOCK_GENERATION=true for placeholder output."
            )

        try:
            result = await self.generate(params)
            self.set_status(AdapterStatus.CONNECTED)
            return result
        except Exception as e:
            self.set_status(AdapterStatus.ERROR)
            logger.error("%s: Real service failed: %s", self.name, e)
            raise

    def get_status(self) -> AdapterStatus:
        """Get current adapter status"""
        return self._status

    def set_status(self, status: AdapterStatus):
        """Set adapter status"""
        self._status = status

    def is_mock_mode(self) -> bool:
        """Check if running in mock mode"""
        return self._mock_mode
