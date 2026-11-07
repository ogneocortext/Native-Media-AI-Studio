"""
Unified Event Bus for Native Media AI Studio.

Provides a centralized event system with:
- Type-safe event definitions
- Async pub/sub with automatic replay buffer
- Integration with SSE and WebSocket managers
- Event history for new connections
- Structured logging
"""

import asyncio
import collections
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, Generic, TypeVar

from ..core.logging_config import structured_logger

logger = logging.getLogger(__name__)

T = TypeVar("T")

# =============================================================================
# Event Definitions
# =============================================================================


class EventPriority(StrEnum):
    """Event priority for delivery ordering and client filtering"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class EventCategory(StrEnum):
    """High-level event categories for filtering"""
    SYSTEM = "system"
    JOB = "job"
    HEALTH = "health"
    RESOURCE = "resource"
    QUEUE = "queue"
    ADAPTER = "adapter"
    PROGRESS = "progress"
    NOTIFICATION = "notification"


@dataclass
class Event(Generic[T]):
    """Standardized event envelope"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    category: EventCategory = EventCategory.SYSTEM
    type: str = ""
    data: T = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    priority: EventPriority = EventPriority.MEDIUM
    source: str = ""
    correlation_id: str = ""
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # Convert enum values to strings
        if hasattr(self.category, 'value'):
            d['category'] = self.category.value
        if hasattr(self.priority, 'value'):
            d['priority'] = self.priority.value
        if hasattr(self.data, 'model_dump'):  # Pydantic model
            d['data'] = self.data.model_dump(mode="json")
        return d

    def to_sse(self) -> dict[str, Any]:
        """Format for SSE delivery"""
        return {
            "id": self.id,
            "event": self.type,
            "data": json.dumps(self.to_dict()),
        }


# =============================================================================
# Concrete Event Types (for type hints and documentation)
# =============================================================================

@dataclass
class JobEventData:
    """Job status change event"""
    job_id: str
    job_type: str
    status: str
    progress: float = 0.0
    message: str = ""
    error: str | None = None
    output_path: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


@dataclass
class HealthEventData:
    """System health change event"""
    status: str  # healthy|degraded|unhealthy
    overall: str  # healthy|degraded
    backend: str  # online|offline
    adapters: dict[str, Any]


@dataclass
class ResourceEventData:
    """Resource threshold warning/critical"""
    resource_type: str  # memory|vram|disk
    level: str  # warning|critical
    message: str
    current_value: float
    threshold: float
    unit: str
    details: dict[str, Any] | None = None


@dataclass
class QueueEventData:
    """Queue statistics update"""
    queued: int
    running: int
    completed: int
    failed: int
    total: int


@dataclass
class AdapterEventData:
    """Adapter status change"""
    name: str
    status: str  # connected|disconnected|connecting|error
    adapter_type: str
    url: str | None = None
    error: str | None = None


@dataclass
class ProgressEventData:
    """Granular progress update for long-running operations"""
    job_id: str
    stage: str
    progress: float  # 0.0-1.0
    message: str
    details: dict[str, Any] | None = None


@dataclass
class NotificationEventData:
    """User-facing notification"""
    title: str
    message: str
    level: str = "info"  # info|success|warning|error
    action: dict[str, Any] | None = None  # {label, url}
    persistent: bool = False


# =============================================================================
# Event Bus Implementation
# =============================================================================

class EventBus:
    """
    Central event bus with:
    - Async pub/sub
    - Replay buffer for late joiners
    - Subscriber filtering by category/type
    - Automatic dead connection cleanup
    - Integration with SSE/WebSocket managers
    """

    def __init__(
        self,
        max_replay: int = 2000,
        replay_max_age_ms: int = 300_000,  # 5 minutes
        max_subscribers: int = 100,
    ):
        self._subscribers: dict[str, list[Callable[[Event], Awaitable[None]]]] = collections.defaultdict(list)
        self._wildcard_subscribers: list[Callable[[Event], Awaitable[None]]] = []
        self._replay_buffer: collections.deque = collections.deque(maxlen=max_replay)
        self._replay_max_age_ms = replay_max_age_ms
        self._max_subscribers = max_subscribers
        self._lock = asyncio.Lock()
        self._event_counter = 0

        # Integration hooks for SSE/WebSocket managers
        self._sse_manager = None
        self._ws_manager = None

    def set_managers(self, sse_manager=None, ws_manager=None):
        """Register delivery managers"""
        self._sse_manager = sse_manager
        self._ws_manager = ws_manager

    # -------------------------------------------------------------------------
    # Subscription Management
    # -------------------------------------------------------------------------

    async def subscribe(
        self,
        callback: Callable[[Event], Awaitable[None]],
        event_type: str = "*",
        category: EventCategory | None = None,
    ) -> str:
        """Subscribe to events.

        Args:
            callback: Async function receiving Event
            event_type: Specific event type or "*" for all
            category: Optional category filter

        Returns:
            Subscription ID for unsubscribing
        """
        async with self._lock:
            if len(self._subscribers[event_type]) >= self._max_subscribers:
                raise RuntimeError(f"Max subscribers reached for {event_type}")

            sub_id = str(uuid.uuid4())
            self._subscribers[event_type].append(callback)

            if category:
                cat_key = f"category:{category.value}"
                self._subscribers[cat_key].append(callback)

            if event_type == "*":
                self._wildcard_subscribers.append(callback)

            structured_logger.info(
                "event.subscribed",
                subscription_id=sub_id,
                event_type=event_type,
                category=category.value if category else None,
            )
            return sub_id

    async def unsubscribe(self, callback: Callable[[Event], Awaitable[None]]) -> bool:
        """Unsubscribe a callback from all event types."""
        async with self._lock:
            removed = False
            for _event_type, callbacks in self._subscribers.items():
                if callback in callbacks:
                    callbacks.remove(callback)
                    removed = True
            if callback in self._wildcard_subscribers:
                self._wildcard_subscribers.remove(callback)
                removed = True

            if removed:
                structured_logger.info("event.unsubscribed", callback=callback.__name__)
            return removed

    # -------------------------------------------------------------------------
    # Publishing
    # -------------------------------------------------------------------------

    async def publish(self, event: Event) -> int:
        """Publish an event to all subscribers.

        Returns:
            Number of subscribers notified
        """
        # Add to replay buffer
        await self._add_to_replay(event)

        # Determine target subscribers
        targets = []
        targets.extend(self._subscribers.get(event.type, []))
        targets.extend(self._subscribers.get(f"category:{event.category.value}", []))
        targets.extend(self._wildcard_subscribers)

        if not targets:
            return 0

        # Deduplicate
        unique_targets = list(dict.fromkeys(targets))

        # Deliver
        delivered = 0
        for callback in unique_targets:
            try:
                await callback(event)
                delivered += 1
            except Exception as e:
                logger.warning(f"Event delivery failed to {callback.__name__}: {e}")

        # Forward to delivery managers
        if self._sse_manager:
            try:
                await self._sse_manager.send_message(event.to_dict())
            except Exception as e:
                logger.warning(f"SSE delivery failed: {e}")

        if self._ws_manager:
            try:
                await self._ws_manager.broadcast(event.type, event.data)
            except Exception as e:
                logger.warning(f"WS delivery failed: {e}")

        structured_logger.debug(
            "event.published",
            event_id=event.id,
            event_type=event.type,
            category=event.category.value,
            subscribers=delivered,
        )

        return delivered

    async def publish_simple(
        self,
        event_type: str,
        data: Any,
        category: EventCategory = EventCategory.SYSTEM,
        priority: EventPriority = EventPriority.MEDIUM,
        source: str = "",
        tags: list[str] | None = None,
    ) -> int:
        """Convenience method for simple event publishing."""
        event = Event(
            type=event_type,
            data=data,
            category=category,
            priority=priority,
            source=source,
            tags=tags or [],
        )
        return await self.publish(event)

    # -------------------------------------------------------------------------
    # Replay Buffer
    # -------------------------------------------------------------------------

    async def _add_to_replay(self, event: Event):
        """Add event to replay buffer with timestamp for aging."""
        async with self._lock:
            self._event_counter += 1
            self._replay_buffer.append({
                "counter": self._event_counter,
                "event": event.to_dict(),
                "timestamp": time.monotonic() * 1000,
            })
            self._evict_replay_buffer()

    def _evict_replay_buffer(self):
        """Remove events older than max age."""
        if not self._replay_buffer:
            return
        cutoff = time.monotonic() * 1000 - self._replay_max_age_ms
        while self._replay_buffer and self._replay_buffer[0]["timestamp"] < cutoff:
            self._replay_buffer.popleft()

    async def get_replay_events(
        self,
        since_counter: int = 0,
        event_type: str | None = None,
        category: EventCategory | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Get replay events for a new connection.

        Args:
            since_counter: Return events with counter > this
            event_type: Filter by type
            category: Filter by category
            limit: Max events to return

        Returns:
            List of event dicts with counter for pagination
        """
        async with self._lock:
            self._evict_replay_buffer()
            events = []
            for entry in reversed(self._replay_buffer):
                if entry["counter"] <= since_counter:
                    break
                if event_type and entry["event"].get("type") != event_type:
                    continue
                if category and entry["event"].get("category") != category.value:
                    continue
                events.append(entry)
                if len(events) >= limit:
                    break
            return list(reversed(events))

    async def get_replay_since_time(
        self,
        since_timestamp: float,
        event_type: str | None = None,
        category: EventCategory | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Get replay events since a given timestamp (ms)."""
        async with self._lock:
            self._evict_replay_buffer()
            events = []
            for entry in reversed(self._replay_buffer):
                if entry["timestamp"] <= since_timestamp:
                    break
                if event_type and entry["event"].get("type") != event_type:
                    continue
                if category and entry["event"].get("category") != category.value:
                    continue
                events.append(entry)
                if len(events) >= limit:
                    break
            return list(reversed(events))

    # -------------------------------------------------------------------------
    # Convenience Methods for Common Events
    # -------------------------------------------------------------------------

    async def emit_job_update(self, job_data: JobEventData, **kwargs) -> int:
        return await self.publish_simple(
            "job_update",
            asdict(job_data),
            category=EventCategory.JOB,
            priority=EventPriority.HIGH if job_data.status in ("failed", "dead", "completed") else EventPriority.MEDIUM,
            source="queue_manager",
            tags=["job", job_data.job_type, job_data.status],
        )

    async def emit_health_change(self, health_data: HealthEventData, **kwargs) -> int:
        return await self.publish_simple(
            "system.health_changed",
            asdict(health_data),
            category=EventCategory.HEALTH,
            priority=EventPriority.HIGH,
            source="health_monitor",
            tags=["health"],
        )

    async def emit_resource_warning(self, resource_data: ResourceEventData, **kwargs) -> int:
        priority = EventPriority.URGENT if resource_data.level == "critical" else EventPriority.HIGH
        return await self.publish_simple(
            "system.resource_warning",
            asdict(resource_data),
            category=EventCategory.RESOURCE,
            priority=priority,
            source="resource_monitor",
            tags=["resource", resource_data.resource_type, resource_data.level],
        )

    async def emit_queue_stats(self, queue_data: QueueEventData, **kwargs) -> int:
        return await self.publish_simple(
            "queue_update",
            asdict(queue_data),
            category=EventCategory.QUEUE,
            priority=EventPriority.LOW,
            source="queue_manager",
            tags=["queue"],
        )

    async def emit_adapter_change(self, adapter_data: AdapterEventData, **kwargs) -> int:
        return await self.publish_simple(
            "adapter_status_changed",
            asdict(adapter_data),
            category=EventCategory.ADAPTER,
            priority=EventPriority.HIGH,
            source="adapter_registry",
            tags=["adapter", adapter_data.name, adapter_data.status],
        )

    async def emit_progress(self, progress_data: ProgressEventData, **kwargs) -> int:
        return await self.publish_simple(
            "job_progress",
            asdict(progress_data),
            category=EventCategory.PROGRESS,
            priority=EventPriority.HIGH,
            source="processor",
            tags=["progress", progress_data.job_id, progress_data.stage],
        )

    async def emit_notification(self, notification: NotificationEventData, **kwargs) -> int:
        return await self.publish_simple(
            "notification",
            asdict(notification),
            category=EventCategory.NOTIFICATION,
            priority=EventPriority.HIGH if notification.level == "error" else EventPriority.MEDIUM,
            source="app",
            tags=["notification", notification.level],
        )

    # Back-compat with old SSEManager API
    async def send_health_update(self, health: dict[str, Any]):
        await self.publish_simple(
            "health_update",
            health,
            category=EventCategory.HEALTH,
            priority=EventPriority.MEDIUM,
        )

    async def broadcast_health_status(self, status: dict[str, Any]):
        await self.publish_simple(
            "system.health_changed",
            status,
            category=EventCategory.HEALTH,
            priority=EventPriority.MEDIUM,
        )

    async def send_queue_update(self, stats: dict[str, Any]):
        await self.publish_simple(
            "queue_update",
            stats,
            category=EventCategory.QUEUE,
            priority=EventPriority.LOW,
        )

    async def send_job_update(self, job: Any):
        from ..models.job import Job, JobStatus
        if isinstance(job, Job):
            priority = (
                EventPriority.URGENT if job.status in (JobStatus.FAILED, JobStatus.DEAD)
                else EventPriority.HIGH if job.status in (JobStatus.COMPLETED, JobStatus.CANCELLED)
                else EventPriority.MEDIUM if job.status == JobStatus.RUNNING
                else EventPriority.LOW
            )
            await self.publish_simple(
                "job_update",
                {"job": job.model_dump(mode="json")},
                category=EventCategory.JOB,
                priority=priority,
            )

    async def broadcast(self, type: str, data: dict[str, Any], priority: EventPriority = EventPriority.MEDIUM):
        await self.publish_simple(type, data, category=EventCategory.SYSTEM, priority=priority)


# =============================================================================
# Global Event Bus Instance
# =============================================================================

event_bus = EventBus()


# =============================================================================
# Helper Functions for Easy Publishing
# =============================================================================

async def emit_job_started(job_id: str, job_type: str, **kwargs):
    await event_bus.emit_job_update(JobEventData(
        job_id=job_id,
        job_type=job_type,
        status="running",
        progress=0.0,
        message="Job started",
        started_at=datetime.now().isoformat(),
    ))


async def emit_job_progress(job_id: str, stage: str, progress: float, message: str, **details):
    await event_bus.emit_progress(ProgressEventData(
        job_id=job_id,
        stage=stage,
        progress=progress,
        message=message,
        details=details or None,
    ))


async def emit_job_completed(job_id: str, job_type: str, output_path: str | None = None, **kwargs):
    await event_bus.emit_job_update(JobEventData(
        job_id=job_id,
        job_type=job_type,
        status="completed",
        progress=1.0,
        message="Job completed successfully",
        output_path=output_path,
        completed_at=datetime.now().isoformat(),
    ))


async def emit_job_failed(job_id: str, job_type: str, error: str, **kwargs):
    await event_bus.emit_job_update(JobEventData(
        job_id=job_id,
        job_type=job_type,
        status="failed",
        progress=0.0,
        message="Job failed",
        error=error,
        completed_at=datetime.now().isoformat(),
    ))


async def emit_notification(
    title: str,
    message: str,
    level: str = "info",
    action: dict | None = None,
    *,
    persistent: bool = False,
):
    await event_bus.emit_notification(NotificationEventData(
        title=title,
        message=message,
        level=level,
        action=action,
        persistent=persistent,
    ))


async def notify_user(title: str, message: str, level: str = "info", action_url: str | None = None):
    """Convenience: emit a user notification with optional action."""
    await emit_notification(
        title=title,
        message=message,
        level=level,
        action={"label": "View", "url": action_url} if action_url else None,
    )
