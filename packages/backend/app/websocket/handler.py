"""
WebSocket handler for real-time job updates.
"""
import asyncio
import json
from datetime import datetime
from typing import Any

from fastapi import WebSocket

from ..models.job import Job


class ConnectionManager:
    """Manages WebSocket connections for real-time updates"""

    def __init__(self):
        self._active_connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        """Accept and track a new connection"""
        await websocket.accept()
        async with self._lock:
            self._active_connections.add(websocket)

    async def disconnect(self, websocket: WebSocket):
        """Remove a connection"""
        async with self._lock:
            self._active_connections.discard(websocket)

    async def send_message(self, message: dict[str, Any]):
        """Send a message to all connected clients"""
        if not self._active_connections:
            return

        message_json = json.dumps(message)

        # Copy to avoid modification during iteration
        connections = list(self._active_connections)

        # Disconnect any dead connections
        dead_connections = []

        for ws in connections:
            try:
                await ws.send_text(message_json)
            except Exception:
                dead_connections.append(ws)

        # Clean up dead connections
        async with self._lock:
            for ws in dead_connections:
                self._active_connections.discard(ws)

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
        """Broadcast health status to all connected clients.
        
        Args:
            status: The aggregate health status dict containing:
                - status: "healthy|degraded|unhealthy"
                - backend: "online|offline"
                - adapters: {...}
                - overall: "healthy|degraded"
        """
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

# Global connection manager
connection_manager = ConnectionManager()
