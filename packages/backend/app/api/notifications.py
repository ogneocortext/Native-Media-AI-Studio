"""
Notification and event history API routes.
"""

import logging
from typing import Any

from fastapi import APIRouter, Query

from ..sse.handler import sse_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Notifications"])


@router.get("/api/notifications", response_model=list[dict])
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
) -> list[dict[str, Any]]:
    """Return recent SSE events for the notification center.

    The payload is sourced from the SSE replay buffer, so it reflects the
    same events that late-reconnecting EventSource clients receive. Each
    item contains ``id``, ``type``, ``data``, ``timestamp``, and ``priority``.
    """
    raw = list(sse_manager._replay_buffer)  # type: ignore[attr-defined]
    items: list[dict[str, Any]] = []
    for eid, msg in reversed(raw[-limit:]):
        data = msg.get("data") if isinstance(msg, dict) else None
        if isinstance(data, str):
            try:
                data = __import__("json").loads(data)
            except Exception:
                pass
        items.append(
            {
                "id": str(eid),
                "type": msg.get("type") if isinstance(msg, dict) else None,
                "data": data,
                "timestamp": msg.get("timestamp") if isinstance(msg, dict) else None,
                "priority": msg.get("priority") if isinstance(msg, dict) else "medium",
            }
        )
    return items


@router.get("/api/events/since", response_model=list[dict])
async def events_since(
    last_id: int = Query(..., gt=0, description="Last seen SSE event ID"),
) -> list[dict[str, Any]]:
    """Return SSE events newer than ``last_id``.

    This endpoint supports offline-replay / catch-up flows. The response
    shape matches the SSE wire format so clients can enqueue the items
    directly into their local event queue.
    """
    events = await sse_manager.get_replay_events(last_id)
    result: list[dict[str, Any]] = []
    for ev in events:
        data = ev.get("data")
        if isinstance(data, str):
            try:
                data = __import__("json").loads(data)
            except Exception:
                pass
        result.append(
            {
                "id": ev.get("id"),
                "data": data,
            }
        )
    return result
