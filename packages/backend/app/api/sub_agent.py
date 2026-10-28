"""
Sub-agent API endpoints for Native Media AI Studio.

Exposes the local Qwen sub-agent (tools/qwen_subagent/) via REST + SSE so the
frontend can submit tasks and stream the agent's ReAct loop output in real time.

Endpoints:
  POST   /api/sub-agent/run        - Start a sub-agent task, returns { task_id }
  GET    /api/sub-agent/stream/{task_id}  - SSE stream of agent iterations
  GET    /api/sub-agent/status/{task_id}  - Get task status
  GET    /api/sub-agent/tasks      - List all tasks
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

# Add repo root to path so we can import the qwen_subagent package
_repo_root = Path(__file__).resolve().parents[4]  # app/api/ -> repo root
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from tools.qwen_subagent.config import DEFAULT_MODEL  # noqa: E402
from tools.qwen_subagent.subagent import run_task  # noqa: E402

from ..sse.handler import sse_manager  # noqa: E402

router = APIRouter(prefix="/api/sub-agent", tags=["sub-agent"])

# In-memory task store: task_id -> { status, result, error, created_at }
# In production this would be backed by a database or Redis.
_tasks: dict[str, dict[str, Any]] = {}
_tasks_lock = asyncio.Lock()


class SubAgentTaskError(Exception):
    """Raised when a sub-agent task fails."""


def _make_sse_event(message_type: str, data: dict[str, Any]) -> dict[str, Any]:
    """Format an SSE event."""
    return {
        "id": str(uuid.uuid4().hex[:8]),
        "event": message_type,
        "data": json.dumps(data),
    }


async def _run_sub_agent_task(task_id: str, task: str, model: str | None) -> None:
    """Background coroutine: run the sub-agent and stream output via SSE."""
    async with _tasks_lock:
        _tasks[task_id] = {
            "status": "running",
            "result": None,
            "error": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "iterations": [],
        }

    iteration_outputs: list[str] = []

    def on_output(text: str) -> None:
        """Callback called by the sub-agent for each iteration/tool result."""
        iteration_outputs.append(text)
        # Fire-and-forget: push to SSE queue (non-blocking)
        asyncio.create_task(
            sse_manager.send_message(
                _make_sse_event(
                    "agent_output",
                    {
                        "task_id": task_id,
                        "text": text,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
            )
        )

    try:
        # Run the sub-agent in a thread to avoid blocking the event loop
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: run_task(task, model=model, stream=False),
        )

        async with _tasks_lock:
            _tasks[task_id]["status"] = "completed"
            _tasks[task_id]["result"] = result
            _tasks[task_id]["iterations"] = iteration_outputs

        # Send completion event
        await sse_manager.send_message(
            _make_sse_event(
                "agent_done",
                {
                    "task_id": task_id,
                    "result": result,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        )

    except Exception as exc:  # noqa: BLE001
        error_msg = str(exc)
        async with _tasks_lock:
            _tasks[task_id]["status"] = "failed"
            _tasks[task_id]["error"] = error_msg
        await sse_manager.send_message(
            _make_sse_event(
                "agent_error",
                {
                    "task_id": task_id,
                    "error": error_msg,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        )


@router.post("/run")
async def run_sub_agent(task: dict[str, Any]) -> dict[str, Any]:
    """Start a sub-agent task.

    Body: { "task": "string describing what to do", "model?: "qwen3.5:4b" }
    Returns: { "task_id": "..." }
    """
    task_text = task.get("task", "")
    if not task_text or not isinstance(task_text, str):
        raise HTTPException(status_code=400, detail="Missing 'task' field")

    model = task.get("model") or DEFAULT_MODEL
    task_id = uuid.uuid4().hex[:12]

    # Fire the agent in the background
    asyncio.create_task(_run_sub_agent_task(task_id, task_text, model))

    return {"task_id": task_id, "status": "running"}


@router.get("/stream/{task_id}")
async def stream_sub_agent(task_id: str) -> EventSourceResponse:
    """SSE stream for a sub-agent task.

    Connect with EventSource to receive real-time agent output.
    """
    async def event_generator():
        # Send any existing task state first
        async with _tasks_lock:
            task_state = _tasks.get(task_id)
        if task_state is None:
            yield _make_sse_event("error", {"message": f"Task {task_id} not found"})
            return

        # If already completed/failed, send final state and close
        if task_state["status"] in ("completed", "failed"):
            if task_state["status"] == "completed":
                yield _make_sse_event(
                    "agent_done",
                    {"task_id": task_id, "result": task_state["result"]},
                )
            else:
                yield _make_sse_event(
                    "agent_error",
                    {"task_id": task_id, "error": task_state["error"]},
                )
            return

        # Connect to SSE manager for live updates
        queue = await sse_manager.connect()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield event
                except asyncio.TimeoutError:
                    # Send a keep-alive comment
                    yield ":keep-alive\n\n"
        finally:
            await sse_manager.disconnect(queue)

    return EventSourceResponse(event_generator())


@router.get("/status/{task_id}")
async def get_task_status(task_id: str) -> dict[str, Any]:
    """Get the status of a sub-agent task."""
    async with _tasks_lock:
        task_state = _tasks.get(task_id)
    if task_state is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return {
        "task_id": task_id,
        "status": task_state["status"],
        "result": task_state["result"],
        "error": task_state["error"],
        "created_at": task_state["created_at"],
    }


@router.get("/tasks")
async def list_tasks() -> dict[str, Any]:
    """List all sub-agent tasks."""
    async with _tasks_lock:
        tasks = [
            {
                "task_id": tid,
                "status": t["status"],
                "created_at": t["created_at"],
                "has_result": t["result"] is not None,
                "has_error": t["error"] is not None,
            }
            for tid, t in _tasks.items()
        ]
    return {"tasks": sorted(tasks, key=lambda x: x["created_at"], reverse=True)}
