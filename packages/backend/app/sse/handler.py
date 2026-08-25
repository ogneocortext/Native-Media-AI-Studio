"""
SSE (Server-Sent Events) handler for real-time updates.

Replaces WebSocket with a simpler, more reliable HTTP-based protocol.
SSE provides one-way server-to-client push with automatic reconnection
and event resumption built into the browser's EventSource API.
"""
import asyncio
import json
from datetime import datetime
from typing import Any

from sse_starlette.sse import EventSourceResponse

from ..models.job import Job


class SSEManager:
    """Manages SSE connections for real-time updates"""

    def __init__(self):
        self._active_connections: list[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        self._event_id = 0

    async def connect(self) -> asyncio.Queue:
        """Create a new SSE connection queue"""
        queue = asyncio.Queue()
        async with self._lock:
            self._active_connections.append(queue)
        return queue

    async def disconnect(self, queue: asyncio.Queue):
        """Remove an SSE connection"""
        async with self._lock:
            if queue in self._active_connections:
                self._active_connections.remove(queue)

    async def send_message(self, message: dict[str, Any]):
        """Send a message to all connected clients"""
        if not self._active_connections:
            return

        async with self._lock:
            self._event_id += 1
            event_data = {
                "id": str(self._event_id),
                "data": json.dumps(message),
            }

            for queue in self._active_connections:
                try:
                    await queue.put(event_data)
                except Exception:
                    pass

    async def send_job_update(self, job: Job):
        """Send job update to all clients"""
        await self.send_message({
            "type": "job_update",
            "data": job.model_dump(mode='json'),
            "timestamp": datetime.now().isoformat()
        })

    async def send_health_update(self, health: dict[str, Any]):
        """Send health update to all clients"""
        await self.send_message({
            "type": "health_update",
            "data": health,
            "timestamp": datetime.now().isoformat()
        })

    async def broadcast_health_status(self, status: dict[str, Any]):
        """Broadcast health status to all connected clients"""
        await self.send_message({
            "type": "system.health_changed",
            "data": status,
            "timestamp": datetime.now().isoformat()
        })

    async def send_queue_update(self, stats: dict[str, Any]):
        """Send queue stats update to all clients"""
        await self.send_message({
            "type": "queue_update",
            "data": stats,
            "timestamp": datetime.now().isoformat()
        })

    async def broadcast(self, type: str, data: dict[str, Any]):
        """Broadcast a message to all clients"""
        await self.send_message({
            "type": type,
            "data": data,
            "timestamp": datetime.now().isoformat()
        })

    def connection_count(self) -> int:
        """Get number of active connections"""
        return len(self._active_connections)


# Global SSE manager
sse_manager = SSEManager()
