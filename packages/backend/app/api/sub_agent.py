"""
Sub-agent API endpoints for Native Media AI Studio.

Exposes the local Qwen sub-agent (tools/qwen_subagent/) via REST + SSE so the
frontend can submit tasks and stream the agent's ReAct loop output in real time.

Endpoints:
  POST   /api/sub-agent/run        - Start a sub-agent task, returns { task_id }
  POST   /api/sub-agent/cancel/{task_id}  - Cancel a running task
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

# In-memory task store: task_id -> { status, result, error, created_at, model, cancelled }
# In production this would be backed by a database or Redis.
_tasks: dict[str, dict[str, Any]] = {}
_tasks_lock = asyncio.Lock()

# Path to model reliability log
_OBSERVED_LOG = _repo_root / "tools" / "model-reliability" / "observed.jsonl"


def _log_session_outcome(model: str, worked: bool, note: str) -> None:
    """Append a session outcome to the model reliability log.

    Per AGENTS.md D21: append one line per session to observed.jsonl.
    This is the only handoff state that a new agent cannot rebuild for itself.
    """
    try:
        entry = {
            "date": datetime.now(timezone.utc).isoformat()[:10],
            "model": model,
            "route": "subagent",
            "worked": worked,
            "note": note,
        }
        # Use utf-8-sig to handle BOM if present (see score.py for rationale)
        with open(_OBSERVED_LOG, "a", encoding="utf-8-sig") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        # Logging failures should not break the sub-agent endpoint
        pass


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
            "model": model or DEFAULT_MODEL,
            "cancelled": False,
        }

    iteration_outputs: list[str] = []
    # Capture the running event loop so the on_output callback (invoked from a
    # thread executor) can schedule SSE messages on the main loop.
    main_loop = asyncio.get_running_loop()

    def on_output(text: str) -> None:
        """Callback called by the sub-agent for each iteration/tool result."""
        iteration_outputs.append(text)
        # Schedule the SSE message on the main event loop from the worker thread.
        asyncio.run_coroutine_threadsafe(
            sse_manager.send_message(
                _make_sse_event(
                    "agent_output",
                    {
                        "task_id": task_id,
                        "text": text,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
            ),
            main_loop,
        )

    try:
        # Check if cancelled before starting
        async with _tasks_lock:
            if _tasks[task_id].get("cancelled", False):
                _tasks[task_id]["status"] = "cancelled"
                return

        # Run the sub-agent in a thread to avoid blocking the event loop.
        # Pass on_output so each iteration/tool result is streamed via SSE.
        result, metrics = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: run_task(task, model=model, stream=False, on_output=on_output),
        )

        # Check if cancelled after completion
        async with _tasks_lock:
            if _tasks[task_id].get("cancelled", False):
                _tasks[task_id]["status"] = "cancelled"
                return

        async with _tasks_lock:
            _tasks[task_id]["status"] = "completed"
            _tasks[task_id]["result"] = result
            _tasks[task_id]["iterations"] = iteration_outputs
            _tasks[task_id]["metrics"] = metrics

        # Log successful session to model reliability tracker with metrics
        metrics_note = (
            f"Task completed successfully via sub-agent (task_id: {task_id}). Metrics: {metrics}"
        )
        _log_session_outcome(
            model or DEFAULT_MODEL,
            worked=True,
            note=metrics_note,
        )

        # Send completion event with metrics
        await sse_manager.send_message(
            _make_sse_event(
                "agent_done",
                {
                    "task_id": task_id,
                    "result": result,
                    "metrics": metrics,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        )

    except Exception as exc:  # noqa: BLE001
        error_msg = str(exc)
        import traceback

        error_detail = traceback.format_exc()
        async with _tasks_lock:
            _tasks[task_id]["status"] = "failed"
            _tasks[task_id]["error"] = error_msg
            _tasks[task_id]["error_detail"] = error_detail

        # Log failed session to model reliability tracker
        _log_session_outcome(
            model or DEFAULT_MODEL,
            worked=False,
            note=f"Task failed: {error_msg[:200]} (task_id: {task_id})",
        )

        await sse_manager.send_message(
            _make_sse_event(
                "agent_error",
                {
                    "task_id": task_id,
                    "error": error_msg,
                    "error_detail": error_detail,
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

    return {"task_id": task_id, "status": "running", "model": model}


@router.post("/cancel/{task_id}")
async def cancel_sub_agent(task_id: str) -> dict[str, Any]:
    """Cancel a running sub-agent task.

    Returns: { "task_id": "...", "status": "cancelled" }
    """
    async with _tasks_lock:
        task_state = _tasks.get(task_id)
    if task_state is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    if task_state["status"] not in ("running",):
        raise HTTPException(
            status_code=400,
            detail=f"Task {task_id} is {task_state['status']} and cannot be cancelled",
        )

    async with _tasks_lock:
        _tasks[task_id]["cancelled"] = True
        _tasks[task_id]["status"] = "cancelled"

    # Send cancellation event
    await sse_manager.send_message(
        _make_sse_event(
            "agent_cancelled",
            {
                "task_id": task_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
    )

    return {"task_id": task_id, "status": "cancelled"}


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
