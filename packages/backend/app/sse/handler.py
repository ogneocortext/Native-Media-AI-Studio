"""
SSE (Server-Sent Events) handler for real-time updates.

Replaces WebSocket with a simpler, more reliable HTTP-based protocol.
SSE provides one-way server-to-client push with automatic reconnection
and event resumption built into the browser's EventSource API.

Standard wire format
--------------------
Every outbound SSE message is serialized as::

    id: <monotonic-integer>
    event: message
    data: <json({type, data, timestamp})>

Frontend listeners receive the parsed ``data`` object (a dict with at
least ``type`` and ``data`` keys, plus ``timestamp``).
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Any

import httpx

from ..core.config import config
from ..models.job import Job

logger = logging.getLogger(__name__)

_go_dashboard_client: httpx.AsyncClient | None = None


def _get_go_dashboard_client() -> httpx.AsyncClient | None:
    global _go_dashboard_client
    if _go_dashboard_client is None:
        url = getattr(config, 'go_dashboard_url', '')
        if url:
            _go_dashboard_client = httpx.AsyncClient(
                base_url=url,
                timeout=httpx.Timeout(2.0, connect=1.0),
            )
    return _go_dashboard_client


async def _broadcast_to_go_dashboard(message: dict[str, Any]) -> None:
    """Fire-and-forget POST to go-dashboard /publish."""
    client = _get_go_dashboard_client()
    if client is None:
        return
    try:
        await client.post("/publish", json=message)
    except Exception:
        pass  # go-dashboard is optional infra


class SSEManager:
    """Manages SSE connections for real-time updates"""

    def __init__(self):
        self._active_connections: list[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        self._event_id = 0
        self._max_connections = 50
        self._queue_put_timeout = 5.0  # Drop slow clients after 5s

    @staticmethod
    def _format_message(message_type: str, data: dict[str, Any]) -> dict[str, Any]:
        """Wrap a payload in the standard SSE envelope."""
        return {
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        }

    async def connect(self) -> asyncio.Queue:
        """Create a new SSE connection queue"""
        queue = asyncio.Queue()
        async with self._lock:
            if len(self._active_connections) >= self._max_connections:
                # Put a sentinel so the client gets a clean close message
                await queue.put({
                    "id": "0",
                    "data": json.dumps({
                        "type": "error",
                        "message": "Server at capacity, try again later",
                    }),
                })
                logger.warning("SSE connection rejected: at capacity (%d)", self._max_connections)
                return queue
            self._active_connections.append(queue)
        logger.debug("SSE client connected. Active connections: %d", len(self._active_connections))
        return queue

    async def disconnect(self, queue: asyncio.Queue):
        """Remove an SSE connection"""
        async with self._lock:
            if queue in self._active_connections:
                self._active_connections.remove(queue)
        logger.debug("SSE client disconnected. Active connections: %d", len(self._active_connections))

    async def send_message(self, message: dict[str, Any]):
        """Send a message to all connected clients, dropping slow consumers."""
        if not self._active_connections:
            return

        async with self._lock:
            self._event_id += 1
            event_data = {
                "id": str(self._event_id),
                "data": json.dumps(message),
            }

            dead_connections = []
            for queue in self._active_connections:
                try:
                    await asyncio.wait_for(
                        queue.put(event_data),
                        timeout=self._queue_put_timeout,
                    )
                except asyncio.TimeoutError:
                    logger.warning("SSE client dropped: queue full (slow consumer)")
                    dead_connections.append(queue)
                except Exception as e:
                    logger.warning("Failed to send SSE message to client: %s", e)
                    dead_connections.append(queue)

            # Clean up dead/slow connections
            for queue in dead_connections:
                if queue in self._active_connections:
                    self._active_connections.remove(queue)

        # Fan out to go-dashboard without blocking the main path
        asyncio.create_task(_broadcast_to_go_dashboard(message))

    async def send_job_update(self, job: Job):
        """Send job update to all clients"""
        logger.debug("Broadcasting job update: %s", job.id)
        await self.send_message(self._format_message(
            "job_update",
            {"job": job.model_dump(mode='json')},
        ))

    async def send_health_update(self, health: dict[str, Any]):
        """Send health update to all clients"""
        await self.send_message(self._format_message(
            "health_update",
            health,
        ))

    async def broadcast_health_status(self, status: dict[str, Any]):
        """Broadcast health status to all connected clients"""
        logger.debug("Broadcasting health status: %s", status.get("overall", "unknown"))
        await self.send_message(self._format_message(
            "system.health_changed",
            status,
        ))

    async def send_queue_update(self, stats: dict[str, Any]):
        """Send queue stats update to all clients"""
        await self.send_message(self._format_message(
            "queue_update",
            stats,
        ))

    async def broadcast(self, type: str, data: dict[str, Any]):
        """Broadcast a message to all clients"""
        logger.debug("Broadcasting SSE message: type=%s", type)
        await self.send_message(self._format_message(type, data))

    def connection_count(self) -> int:
        """Get number of active connections"""
        return len(self._active_connections)


# Global SSE manager
sse_manager = SSEManager()
