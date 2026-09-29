"""Tests for the queue's error-classification and error-reporting system.

Covers the taxonomy in :mod:`app.queue.processor` (word-boundary status codes,
ComfyUI saturation, handler timeouts, workflow rejections, exception types), the
structured ComfyUI rejection error, the dead-letter reporting fixes (the queue's
``failed`` count, ``is_terminal``/``can_retry``) and the stale-error regression
where the DLQ recorded the *previous* attempt's message.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest
import pytest_asyncio

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core import database as database_module  # noqa: E402
from app.core.comfyui_client import (  # noqa: E402
    WorkflowRejectedError,
    fetch_history,
    parse_workflow_rejection,
    submit_prompt,
)
from app.models.job import Job, JobStatus, JobType  # noqa: E402
from app.queue.db_manager import JobDatabaseManager  # noqa: E402
from app.queue.manager import QueueManager  # noqa: E402
from app.queue.processor import (  # noqa: E402
    DETERMINISTIC,
    HANDLER_TIMEOUT,
    TRANSIENT_NETWORK,
    UNKNOWN,
    UPSTREAM_BUSY,
    WORKFLOW_REJECTED,
    HandlerTimeoutError,
    JobProcessor,
    _is_retryable_error,
    classify_job_error,
)


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Point the database at a throwaway file for every test."""
    db_path = tmp_path / "test_studio.db"
    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()
    return db_path


@pytest_asyncio.fixture
async def queue() -> QueueManager:
    manager = QueueManager()
    manager._jobs.clear()
    manager._subscribers.clear()
    manager._new_job_event.clear()
    return manager


def _make_job(**overrides) -> Job:
    job = Job(job_type=JobType.IMAGE_GENERATION, status=JobStatus.QUEUED)
    for key, value in overrides.items():
        setattr(job, key, value)
    JobDatabaseManager.create_job(job)
    return job


# ---------------------------------------------------------------------------
# Taxonomy: status codes must not match inside other numbers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "category", "retryable", "status"),
    [
        ("HTTP 502 Bad Gateway", TRANSIENT_NETWORK, True, 502),
        ("503 Service Unavailable", TRANSIENT_NETWORK, True, 503),
        ("HTTP 429 Too Many Requests", TRANSIENT_NETWORK, True, 429),
        ("HTTP 504 Gateway Timeout", TRANSIENT_NETWORK, True, 504),
        ("status 502 from upstream", TRANSIENT_NETWORK, True, 502),
        # A bare three-digit number is not a status: it needs HTTP context.
        ("upstream replied 503", UNKNOWN, False, None),
        ("render failed after 1502ms", UNKNOWN, False, None),
        ("clip_502.mp4 not found", UNKNOWN, False, None),
        ("step 503 of 800", UNKNOWN, False, None),
        # 500 is a code bug: retrying the identical request cannot help.
        ("HTTP 500 Internal Server Error", DETERMINISTIC, False, 500),
        ("HTTP 404 Not Found", DETERMINISTIC, False, 404),
        # ComfyUI refusing a saturated queue is the most common transient here.
        ("ComfyUI queue is full, try again later", UPSTREAM_BUSY, True, None),
        ("server is busy", UPSTREAM_BUSY, True, None),
        ("connection refused", TRANSIENT_NETWORK, True, None),
        ("something entirely novel happened", UNKNOWN, False, None),
    ],
)
def test_classify_by_message(message, category, retryable, status):
    verdict = classify_job_error(RuntimeError(message))
    assert verdict.category == category
    assert verdict.retryable is retryable
    assert verdict.status == status


@pytest.mark.parametrize(
    ("exc", "category", "retryable"),
    [
        (asyncio.TimeoutError("read timed out"), TRANSIENT_NETWORK, True),
        (ConnectionResetError("peer reset"), TRANSIENT_NETWORK, True),
        (ConnectionRefusedError("no listener"), TRANSIENT_NETWORK, True),
        (ValueError("shape [1, 128, 1, 64, 64] is invalid"), DETERMINISTIC, False),
        (KeyError("width"), DETERMINISTIC, False),
        (FileNotFoundError("ltxv-2b-0.9.8-distilled-fp8.safetensors"), DETERMINISTIC, False),
        (PermissionError("denied"), DETERMINISTIC, False),
        (HandlerTimeoutError("Job abc exceeded handler timeout of 3600s"), HANDLER_TIMEOUT, False),
        (
            WorkflowRejectedError(400, "value not in list", node_id="7", node_type="UNETLoader"),
            WORKFLOW_REJECTED,
            False,
        ),
    ],
)
def test_classify_by_exception_type(exc, category, retryable):
    verdict = classify_job_error(exc)
    assert verdict.category == category
    assert verdict.retryable is retryable


def test_workflow_rejection_detected_from_message_alone():
    verdict = classify_job_error(RuntimeError("ComfyUI rejected workflow (400): bad input"))
    assert verdict.category == WORKFLOW_REJECTED
    assert verdict.retryable is False


def test_describe_prefixes_the_category_code():
    verdict = classify_job_error(RuntimeError("connection refused"))
    assert verdict.describe("connection refused") == "transient_network: connection refused"


def test_legacy_text_helper_still_agrees():
    assert _is_retryable_error("connection refused") is True
    assert _is_retryable_error("render failed after 1502ms") is False
    assert _is_retryable_error("ComfyUI queue is full, try again later") is True


# ---------------------------------------------------------------------------
# Structured ComfyUI rejection
# ---------------------------------------------------------------------------

_COMFY_REJECTION_BODY = json.dumps(
    {
        "error": {
            "type": "prompt_outputs_failed_validation",
            "message": "Prompt outputs failed validation",
            "details": {
                "node_id": "7",
                "node_type": "UNETLoader",
                "errors": [{"type": "value_not_in_list", "message": "Value not in list"}],
            },
        }
    }
)


def test_parse_rejection_extracts_the_offending_node():
    err = parse_workflow_rejection(400, _COMFY_REJECTION_BODY)
    assert isinstance(err, WorkflowRejectedError)
    assert err.status == 400
    assert err.node_id == "7"
    assert err.node_type == "UNETLoader"
    assert "UNETLoader" in str(err)
    assert "node 7" in str(err)


def test_parse_rejection_falls_back_for_non_json_bodies():
    err = parse_workflow_rejection(502, "<html>Bad Gateway</html>")
    assert err.status == 502
    assert err.node_id is None
    assert "Bad Gateway" in str(err)


class _StubResponse:
    def __init__(self, status: int, body: str) -> None:
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body

    async def json(self):
        return json.loads(self._body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> bool:
        return False


class _StubSession:
    def __init__(self, response: _StubResponse) -> None:
        self._response = response
        self.calls: list[tuple[str, str]] = []

    def _request(self, method: str, url: str):
        self.calls.append((method, url))
        return self._response

    def post(self, url, **_kwargs):
        return self._request("POST", url)

    def get(self, url, **_kwargs):
        return self._request("GET", url)


@pytest.mark.asyncio
async def test_submit_prompt_raises_the_structured_rejection():
    session = _StubSession(_StubResponse(400, _COMFY_REJECTION_BODY))
    with pytest.raises(WorkflowRejectedError) as excinfo:
        await submit_prompt("http://127.0.0.1:8188", {"1": {}}, session=session)
    assert excinfo.value.node_id == "7"
    assert excinfo.value.node_type == "UNETLoader"
    # Still a RuntimeError, so existing `except RuntimeError` callers keep working.
    assert isinstance(excinfo.value, RuntimeError)


@pytest.mark.asyncio
async def test_fetch_history_warns_instead_of_silently_reporting_empty(caplog):
    session = _StubSession(_StubResponse(502, "Bad Gateway"))
    with caplog.at_level("WARNING"):
        result = await fetch_history("http://127.0.0.1:8188", "abc", session=session)
    assert result == {}
    assert any("502" in record.getMessage() for record in caplog.records)



# ---------------------------------------------------------------------------
# Dead-letter reporting
# ---------------------------------------------------------------------------


def test_dead_job_reports_terminal_and_retryable():
    job = Job(job_type=JobType.IMAGE_GENERATION, status=JobStatus.DEAD, error="deterministic: nope")
    assert job.is_terminal is True
    assert job.has_error is True
    # POST /api/jobs/{id}/retry accepts DEAD, so the field must agree.
    assert job.can_retry is True


def test_dead_job_at_retry_cap_is_not_retryable():
    job = Job(
        job_type=JobType.IMAGE_GENERATION,
        status=JobStatus.DEAD,
        error="x",
        retry_count=3,
        max_retries=3,
    )
    assert job.can_retry is False


@pytest.mark.asyncio
async def test_queue_stats_count_dead_jobs_as_failures(queue: QueueManager):
    dead = _make_job(status=JobStatus.DEAD, error="boom")
    done = _make_job(status=JobStatus.COMPLETED)
    queue._jobs[dead.id] = dead
    queue._jobs[done.id] = done

    stats = await queue.get_stats()

    # FAILED is never assigned by the processor, so counting only FAILED pinned
    # the queue page's failure count at zero.
    assert stats.failed == 1
    assert stats.dead == 1
    assert stats.completed == 1


@pytest.mark.asyncio
async def test_clear_failed_also_clears_the_dead_letter_queue(queue: QueueManager):
    dead = _make_job(status=JobStatus.DEAD, error="boom")
    done = _make_job(status=JobStatus.COMPLETED)
    queue._jobs[dead.id] = dead
    queue._jobs[done.id] = done

    removed = await queue.clear_failed()

    assert removed == 1
    assert dead.id not in queue._jobs
    assert done.id in queue._jobs
    stored = await JobDatabaseManager.get_job_async(dead.id)
    assert stored is None


@pytest.mark.asyncio
async def test_deterministic_failure_is_not_retried(queue: QueueManager, monkeypatch):
    """A code bug must not burn three more attempts."""
    monkeypatch.setattr("app.queue.processor.queue_manager", queue)
    job = _make_job()
    queue._jobs[job.id] = job
    attempts = 0

    async def bad_request(_job: Job):
        nonlocal attempts
        attempts += 1
        raise ValueError("width must be a multiple of 16")

    processor = JobProcessor()
    processor.register_handler(JobType.IMAGE_GENERATION, bad_request)
    await processor._process_job(job)

    assert attempts == 1
    assert job.status == JobStatus.DEAD
    assert job.retry_count == 0
    assert (job.error or "").startswith("deterministic: ")


@pytest.mark.asyncio
async def test_dead_letter_records_the_final_error_not_a_stale_one(
    queue: QueueManager, monkeypatch
):
    """Regression: the DLQ used to store the previous attempt's message.

    ``_move_to_dead_letter`` was called with ``current.error or error_msg``, and
    ``current.error`` still held the message written by the RETRYING transition
    of the *previous* attempt — so the reported cause lagged one failure behind.
    """
    monkeypatch.setattr("app.queue.processor.queue_manager", queue)
    job = _make_job()
    queue._jobs[job.id] = job
    attempts = 0

    async def flaky(_job: Job):
        nonlocal attempts
        attempts += 1
        raise RuntimeError(f"connection refused on attempt {attempts}")

    processor = JobProcessor()
    processor.register_handler(JobType.IMAGE_GENERATION, flaky)

    async def no_backoff(_retry_count: int) -> None:
        return None

    processor._backoff_sleep = no_backoff  # type: ignore[method-assign]

    for _ in range(job.max_retries + 2):
        await processor._process_job(job)
        if job.status == JobStatus.DEAD:
            break

    assert job.status == JobStatus.DEAD
    assert f"connection refused on attempt {attempts}" in (job.error or "")
    assert (job.error or "").startswith("transient_network: ")


# ---------------------------------------------------------------------------
# The adapter's own submit path (image/video generation)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adapter_submit_surfaces_the_rejected_node(monkeypatch):
    """``ComfyUIAdapter._submit_prompt`` used to raise a bare ``Exception``.

    That lost the node id (truncated inside a 500-char body dump) and made the
    queue classifier guess, so a deterministic prompt bug could look retryable.
    """
    from app.adapters.comfyui import ComfyUIAdapter

    adapter = ComfyUIAdapter(base_url="http://127.0.0.1:9", mock_mode=False)

    async def fake_session():
        return _StubSession(_StubResponse(400, _COMFY_REJECTION_BODY))

    monkeypatch.setattr(adapter, "_get_session", fake_session)

    with pytest.raises(WorkflowRejectedError) as excinfo:
        await adapter._submit_prompt({"prompt": {"1": {"class_type": "UNETLoader"}}})

    assert excinfo.value.node_id == "7"
    assert excinfo.value.node_type == "UNETLoader"
    # The queue must treat it as deterministic, never retryable.
    verdict = classify_job_error(excinfo.value)
    assert verdict.category == WORKFLOW_REJECTED
    assert verdict.retryable is False

