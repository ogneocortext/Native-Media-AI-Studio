"""
Log Analytics API routes.

Provides trend-analysis endpoints backed by the SQLite log_events store.
"""

import time

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..core.database import (
    cleanup_old_log_events,
    get_log_analytics_last_cleanup,
    get_log_analytics_sources,
    get_log_patterns,
    get_log_trends,
    ingest_log_file,
)
from ..core.logging_config import LOG_DIR

router = APIRouter(prefix="/api/logs/analytics", tags=["Log Analytics"])

# ---------------------------------------------------------------------------
# Lightweight in-memory cache for /summary (TTL-based, process-local).
# /summary is the heaviest endpoint because it runs multiple GROUP BY queries
# against a potentially large log_events table.  A 30s TTL cuts redundant
# work when the frontend polls repeatedly during active investigation.
# ---------------------------------------------------------------------------
_summary_cache: dict[str, tuple[float, dict]] = {}
_SUMMARY_TTL_SECONDS = 30


def _cached_summary() -> dict:
    now = time.time()
    hit = _summary_cache.get("data")
    if hit and (now - hit[0]) < _SUMMARY_TTL_SECONDS:
        return hit[1]
    data = _build_summary()
    _summary_cache["data"] = (now, data)
    return data


def _build_summary() -> dict:
    trends = get_log_trends(limit=1)
    last_ts = trends[0]["ts_iso"] if trends else None
    patterns = get_log_patterns(limit=5)
    total = sum(p["count"] for p in patterns.get("levels", []))
    return {
        "total_events": total,
        "last_event_at": last_ts,
        "last_cleanup_at": get_log_analytics_last_cleanup(),
        "levels": patterns.get("levels", []),
        "top_loggers": patterns.get("loggers", [])[:5],
        "top_messages": patterns.get("messages", [])[:5],
        "sources": get_log_analytics_sources(limit=20),
    }


class IngestResponse(BaseModel):
    inserted: int
    source: str
    path: str


@router.post("/ingest")
async def ingest_logs(
    source: str = Query("app", description="Log source label"),
    log_name: str = Query("app", description="Log file key: app, error, queue, comfyui"),
    limit: int = Query(20000, ge=100, le=100000),
) -> IngestResponse:
    """Parse a log file and store structured events for trend analysis."""
    mapping = {
        "app": LOG_DIR / "app.log",
        "error": LOG_DIR / "error.log",
        "queue": LOG_DIR / "queue.log",
        "comfyui": LOG_DIR / "comfyui.log",
    }
    path = mapping.get(log_name, mapping["app"])
    # Default source to log_name so ingested files are labeled accurately.
    effective_source = source if source != "app" else log_name
    inserted = ingest_log_file(path, source=effective_source, limit=limit)
    return IngestResponse(inserted=inserted, source=effective_source, path=str(path))


# reload trigger


@router.get("/trends")
async def get_trends(
    since_ms: int | None = Query(None, description="Only events after this Unix ms timestamp"),
    limit: int = Query(5000, ge=100, le=50000),
) -> dict:
    """Time-series log events for trend charts."""
    points = get_log_trends(since_ms=since_ms, limit=limit)
    return {"count": len(points), "points": points}


@router.get("/patterns")
async def get_patterns(limit: int = Query(20, ge=1, le=100)) -> dict:
    """Aggregated patterns: levels, top loggers, top messages."""
    return get_log_patterns(limit=limit)


@router.get("/summary")
async def get_summary() -> dict:
    """Roll-up summary of ingested log analytics data (cached for 30s)."""
    return _cached_summary()


@router.post("/cleanup")
async def cleanup_log_analytics(keep_days: int = Query(30, ge=1, le=365)) -> dict:
    """Remove old log analytics rows."""
    deleted = cleanup_old_log_events(keep_days=keep_days)
    return {"deleted": deleted, "keep_days": keep_days}
