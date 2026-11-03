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
import collections
import json
import logging
import time
from datetime import datetime
from typing import Any

import httpx

from ..core.config import config
from ..core.logging_config import structured_logger
from ..models.job import Job, JobStatus

logger = logging.getLogger(__name__)

_go_dashboard_client: httpx.AsyncClient | None = None


def _get_go_dashboard_client() -> httpx.AsyncClient | None:
    global _go_dashboard_client
    if _go_dashboard_client is None:
        url = getattr(config, "go_dashboard_url", "")
        if url:
            _go_dashboard_client = httpx.AsyncClient(
                base_url=url,
                timeout=httpx.Timeout(2.0, connect=1.0),
            )
    return _go_dashboard_client


#: Fire-and-forget tasks for go-dashboard broadcasts. Tracked so they can't
#: be silently cancelled on loop close and so exceptions are surfaced.
_go_dashboard_tasks: set[asyncio.Task] = set()


async def _broadcast_to_go_dashboard(message: dict[str, Any]) -> None:
    """POST to go-dashboard /publish (optional infra, failures are logged but not fatal)."""
    client = _get_go_dashboard_client()
    if client is None:
        return
    try:
        await client.post("/publish", json=message)
    except Exception:
        logger.debug("go-dashboard broadcast failed (optional infra)", exc_info=True)


class SSEManager:
    """Manages SSE connections for real-time updates"""

    def __init__(self):
        self._active_connections: list[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        self._event_id = 0
        self._max_connections = 50
        self._queue_put_timeout = 5.0  # Drop slow clients after 5s
        # Bounded by both count and age: a reconnecting client may be away
        # longer than the retry interval (DNS/TCP/TLS/cold start), so retain
        # enough history to cover a realistic gap without unbounded growth.
        self._replay_buffer: collections.deque = collections.deque(maxlen=1000)
        self._replay_max_age_ms = 300_000  # 5 minutes

    @staticmethod
    def _format_message(
        message_type: str,
        data: dict[str, Any],
        priority: str = "medium",
        retry_ms: int | None = None,
    ) -> dict[str, Any]:
        """Wrap a payload in the standard SSE envelope.

        ``retry_ms``, when set, instructs the client to reconnect after the
        given milliseconds (used on capacity rejection and as a sane default).
        """
        envelope: dict[str, Any] = {
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
            "priority": priority,
        }
        if retry_ms is not None:
            envelope["retry_ms"] = retry_ms
        return envelope

    async def connect(self) -> asyncio.Queue | None:
        """Create a new SSE connection queue.

        Returns ``None`` (instead of refusing the HTTP request) when at
        capacity. A non-200 response makes ``EventSource`` fail permanently,
        so the caller should return a 200 ``text/event-stream`` with a
        ``retry:`` directive and let the browser back off and reconnect.
        """
        queue = asyncio.Queue()
        async with self._lock:
            if len(self._active_connections) >= self._max_connections:
                structured_logger.warning(
                    "sse.connection_rejected",
                    reason="at_capacity",
                    active_connections=len(self._active_connections),
                    max_connections=self._max_connections,
                )
                return None
            self._active_connections.append(queue)
        structured_logger.info(
            "sse.connection_established",
            active_connections=len(self._active_connections),
        )
        return queue

    async def disconnect(self, queue: asyncio.Queue):
        """Remove an SSE connection"""
        async with self._lock:
            if queue in self._active_connections:
                self._active_connections.remove(queue)
        structured_logger.info(
            "sse.connection_disconnected",
            active_connections=len(self._active_connections),
        )

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

            # Store in replay buffer for late-reconnecting clients
            self._replay_buffer.append((self._event_id, message, time.monotonic() * 1000))
            self._evict_replay_buffer()

            dead_connections = []
            for queue in self._active_connections:
                try:
                    await asyncio.wait_for(
                        queue.put(event_data),
                        timeout=self._queue_put_timeout,
                    )
                except TimeoutError:
                    logger.warning("SSE client dropped: queue full (slow consumer)")
                    dead_connections.append(queue)
                except Exception as e:
                    logger.warning("Failed to send SSE message to client: %s", e)
                    dead_connections.append(queue)

            # Clean up dead/slow connections
            for queue in dead_connections:
                if queue in self._active_connections:
                    self._active_connections.remove(queue)

        # Fan out to go-dashboard without blocking the main path.
        task = asyncio.create_task(_broadcast_to_go_dashboard(message))
        _go_dashboard_tasks.add(task)
        task.add_done_callback(_go_dashboard_tasks.discard)

    def _evict_replay_buffer(self) -> None:
        """Drop replay events older than ``_replay_max_age_ms`` (age bound)."""
        if not self._replay_buffer:
            return
        cutoff = time.monotonic() * 1000 - self._replay_max_age_ms
        while self._replay_buffer and self._replay_buffer[0][2] < cutoff:
            self._replay_buffer.popleft()

    async def get_replay_events(self, last_event_id: int) -> list[dict[str, Any]]:
        """Return events newer than last_event_id for client replay.

        Holds the lock so a concurrent connect/disconnect cannot mutate the
        buffer mid-iteration, and drops entries that have aged out.
        """
        async with self._lock:
            self._evict_replay_buffer()
            return [
                {"id": str(eid), "data": json.dumps(msg)}
                for eid, msg, _ts in self._replay_buffer
                if eid > last_event_id
            ]

    async def send_health_update(self, health: dict[str, Any]):
        """Send health update to all clients"""
        await self.send_message(
            self._format_message(
                "health_update",
                health,
                priority="medium",
            )
        )

    async def broadcast_health_status(self, status: dict[str, Any]):
        """Broadcast health status to all connected clients"""
        structured_logger.info(
            "sse.health_broadcast",
            overall=status.get("overall", "unknown"),
        )
        await self.send_message(
            self._format_message(
                "system.health_changed",
                status,
                priority="medium",
            )
        )

    async def send_queue_update(self, stats: dict[str, Any]):
        """Send queue stats update to all clients"""
        await self.send_message(
            self._format_message(
                "queue_update",
                stats,
                priority="low",
            )
        )

    async def send_job_update(self, job: Job):
        """Send job update to all clients"""
        structured_logger.info(
            "sse.job_update",
            job_id=job.id,
            job_type=job.job_type.value if hasattr(job.job_type, "value") else str(job.job_type),
            status=job.status.value if hasattr(job.status, "value") else str(job.status),
        )
        priority = (
            "urgent"
            if job.status in (JobStatus.FAILED, JobStatus.DEAD)
            else "high"
            if job.status in (JobStatus.COMPLETED, JobStatus.CANCELLED)
            else "medium"
            if job.status == JobStatus.RUNNING
            else "low"
        )
        await self.send_message(
            self._format_message(
                "job_update",
                {"job": job.model_dump(mode="json")},
                priority=priority,
            )
        )

    async def broadcast(self, type: str, data: dict[str, Any], priority: str = "medium"):
        """Broadcast a message to all clients"""
        structured_logger.debug("sse.broadcast", type=type)
        await self.send_message(self._format_message(type, data, priority=priority))

    async def connection_count(self) -> int:
        """Get number of active connections (lock-safe for concurrent
        connect/disconnect)."""
        async with self._lock:
            return len(self._active_connections)


async def shutdown() -> None:
    """Close the go-dashboard HTTP client on app shutdown.

    Awaits any in-flight go-dashboard broadcast tasks so they aren't
    abandoned mid-flight when the loop stops.
    """
    if _go_dashboard_tasks:
        await asyncio.gather(*_go_dashboard_tasks, return_exceptions=True)
        _go_dashboard_tasks.clear()
    global _go_dashboard_client
    if _go_dashboard_client is not None:
        try:
            await _go_dashboard_client.aclose()
        except Exception:
            logger.debug("go-dashboard client close failed", exc_info=True)
        _go_dashboard_client = None


# Global SSE manager
sse_manager = SSEManager()
