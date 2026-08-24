"""
Modern HTTP Client - Future-proof replacement for requests
Uses httpx for both sync and async HTTP operations
Compatible with urllib3 2.x and charset-normalizer 3.x
"""

from typing import Any, Optional
import httpx
from contextlib import asynccontextmanager

# Default timeout for all requests
DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# Shared async client (to be used across the application)
_async_client: Optional[httpx.AsyncClient] = None


def get_sync_client(**kwargs) -> httpx.Client:
    """
    Get a synchronous HTTP client with sensible defaults.
    
    Usage:
        client = get_sync_client()
        response = client.get("https://api.example.com/data")
    """
    defaults = {
        "timeout": DEFAULT_TIMEOUT,
        "follow_redirects": True,
        "limits": httpx.Limits(max_connections=10, max_keepalive_connections=5),
    }
    defaults.update(kwargs)
    return httpx.Client(**defaults)


async def get_async_client(**kwargs) -> httpx.AsyncClient:
    """
    Get or create a shared async HTTP client.
    
    Usage:
        client = await get_async_client()
        response = await client.get("https://api.example.com/data")
    """
    global _async_client
    if _async_client is None or _async_client.is_closed:
        defaults = {
            "timeout": DEFAULT_TIMEOUT,
            "follow_redirects": True,
            "limits": httpx.Limits(max_connections=20, max_keepalive_connections=10),
        }
        defaults.update(kwargs)
        _async_client = httpx.AsyncClient(**defaults)
    return _async_client


@asynccontextmanager
async def async_http_client(**kwargs):
    """
    Async context manager for HTTP requests.
    
    Usage:
        async with async_http_client() as client:
            response = await client.get("https://api.example.com/data")
    """
    client = httpx.AsyncClient(
        timeout=kwargs.get("timeout", DEFAULT_TIMEOUT),
        follow_redirects=kwargs.get("follow_redirects", True),
        limits=kwargs.get("limits", httpx.Limits(max_connections=10, max_keepalive_connections=5)),
    )
    try:
        yield client
    finally:
        await client.aclose()


async def close_async_client():
    """Close the shared async client. Call this on application shutdown."""
    global _async_client
    if _async_client and not _async_client.is_closed:
        await _async_client.aclose()
        _async_client = None


class HTTPClientMixin:
    """
    Mixin class for adapters that need HTTP functionality.
    Provides both sync and async HTTP methods.
    """
    
    def __init__(self):
        self._sync_client: Optional[httpx.Client] = None
    
    @property
    def sync_client(self) -> httpx.Client:
        """Lazy initialization of sync client"""
        if self._sync_client is None or self._sync_client.is_closed:
            self._sync_client = get_sync_client()
        return self._sync_client
    
    async def http_get(self, url: str, **kwargs) -> httpx.Response:
        """Async GET request"""
        client = await get_async_client()
        return await client.get(url, **kwargs)
    
    async def http_post(self, url: str, **kwargs) -> httpx.Response:
        """Async POST request"""
        client = await get_async_client()
        return await client.post(url, **kwargs)
    
    def sync_get(self, url: str, **kwargs) -> httpx.Response:
        """Synchronous GET request (for non-async contexts)"""
        return self.sync_client.get(url, **kwargs)
    
    def sync_post(self, url: str, **kwargs) -> httpx.Response:
        """Synchronous POST request (for non-async contexts)"""
        return self.sync_client.post(url, **kwargs)
    
    def close(self):
        """Close the sync client"""
        if self._sync_client and not self._sync_client.is_closed:
            self._sync_client.close()


# Backwards compatibility helpers
# These make it easier to migrate from requests

class ResponseCompat:
    """Wrapper to provide requests-like response interface"""
    
    def __init__(self, response: httpx.Response):
        self._response = response
        self.status_code = response.status_code
        self.headers = response.headers
        self.url = str(response.url)
        self.text = response.text
        self.content = response.content
        self.json = response.json
    
    def __getattr__(self, name):
        # Forward any other attributes to the wrapped response
        return getattr(self._response, name)


def requests_get(url: str, **kwargs) -> ResponseCompat:
    """
    Drop-in replacement for requests.get()
    
    Usage:
        response = requests_get("https://api.example.com/data")
        if response.status_code == 200:
            data = response.json()
    """
    with get_sync_client() as client:
        response = client.get(url, **kwargs)
        return ResponseCompat(response)


def requests_post(url: str, **kwargs) -> ResponseCompat:
    """
    Drop-in replacement for requests.post()
    
    Usage:
        response = requests_post("https://api.example.com/submit", json={"key": "value"})
    """
    with get_sync_client() as client:
        response = client.post(url, **kwargs)
        return ResponseCompat(response)
