"""Tests for the database administration API (``/api/database/*``).

Covers the three shipped concerns: inventory (overview / table detail / schema),
health (integrity check) and maintenance (vacuum / checkpoint / prune).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api.database_admin import _as_text  # noqa: E402
from app.core import database as db  # noqa: E402


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Point every test in this module at a throwaway database."""
    db_path = tmp_path / "test_studio.db"
    monkeypatch.setattr(db, "DB_PATH", db_path)
    db.init_db()
    return db_path


def _insert_log_event(ts_ms: int, message: str = "event") -> None:
    """Insert a log_events row so retention/prune can be exercised for real."""
    with db.get_db() as conn:
        conn.execute(
            "INSERT INTO log_events (ts_iso, ts_ms, level, logger, message, source) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("1970-01-01T00:00:00", ts_ms, "INFO", "test", message, "test"),
        )


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_overview_reports_schema_and_inventory(client):
    """The overview is the page's landing data: version, size, table list."""
    res = await client.get("/api/database/overview")
    assert res.status_code == 200
    body = res.json()

    assert body["exists"] is True
    assert body["schema_version"] == db.SCHEMA_VERSION
    assert body["target_schema_version"] == db.SCHEMA_VERSION
    assert body["journal_mode"] == "wal"
    assert body["page_size"] > 0
    assert body["page_count"] > 0
    assert body["reclaimable_bytes"] == body["freelist_count"] * body["page_size"]
    assert body["path"].endswith("test_studio.db")

    names = {t["name"] for t in body["tables"]}
    assert {"jobs", "log_events", "audio_files"} <= names
    assert body["table_count"] >= 1
    assert body["index_count"] >= 1
    assert set(body["last_activity"]) == {"log_events", "native_opens", "gpu_telemetry"}


@pytest.mark.asyncio
async def test_overview_row_counts_are_exact(client):
    """A counted table must report the real number of rows, not an estimate."""
    _insert_log_event(1_700_000_000_000, message="counted")
    res = await client.get("/api/database/overview")
    tables = {t["name"]: t for t in res.json()["tables"]}
    assert tables["log_events"]["rows"] == 1
    assert tables["log_events"]["type"] == "table"


@pytest.mark.asyncio
async def test_overview_survives_an_integer_timestamp_column(client):
    """Regression: gpu_telemetry holds an INTEGER ts_ms beside its TEXT ts_iso.

    Reading the integer column returned an int where the response model declared
    ``str | None``, so the whole overview 500'd on a real database (the empty
    test table hid it). The endpoint must stay up and render the text column.
    """
    with db.get_db() as conn:
        conn.execute(
            "INSERT INTO gpu_telemetry (ts_ms, ts_iso) VALUES (?, ?)",
            (1_792_362_430_926, "2026-10-10T14:24:19"),
        )

    res = await client.get("/api/database/overview")
    assert res.status_code == 200
    assert res.json()["last_activity"]["gpu_telemetry"] == "2026-10-10T14:24:19"


def test_as_text_renders_numeric_timestamps_as_iso():
    """A numeric timestamp is rendered as ISO instead of leaking an int."""
    assert _as_text(None) is None
    assert _as_text("2026-10-10T00:00:00") == "2026-10-10T00:00:00"
    # 13 digits are milliseconds, 10 digits are seconds; both are the same instant.
    assert _as_text(1_792_362_430_926).startswith("2026-10-18T22:27:10")
    assert _as_text(1_792_362_430).startswith("2026-10-18T22:27:10")
    # An unrepresentable value is stringified rather than raising.
    assert _as_text(10**30) == str(10**30)


@pytest.mark.asyncio
async def test_table_detail_returns_columns_and_indexes(client):
    res = await client.get("/api/database/tables/log_events")
    assert res.status_code == 200
    body = res.json()

    assert body["type"] == "table"
    columns = {c["name"]: c for c in body["columns"]}
    assert "ts_ms" in columns
    assert columns["ts_ms"]["notnull"] is True
    assert {i["name"] for i in body["indexes"]} >= {"idx_log_events_ts_ms"}
    # dbstat is opt-in, so the default response carries no size.
    assert body["indexes_bytes"] is None


@pytest.mark.asyncio
async def test_table_detail_sizes_flag_is_tolerant(client):
    """``sizes=true`` returns bytes when dbstat exists and None when it does not."""
    res = await client.get("/api/database/tables/log_events?sizes=true")
    assert res.status_code == 200
    value = res.json()["indexes_bytes"]
    assert value is None or value >= 0


@pytest.mark.asyncio
async def test_table_detail_unknown_table_is_404(client):
    res = await client.get("/api/database/tables/not_a_table")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_table_detail_rejects_invalid_identifier(client):
    res = await client.get("/api/database/tables/1bad-name")
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_schema_reports_ordered_migration_ladder(client):
    res = await client.get("/api/database/schema")
    assert res.status_code == 200
    body = res.json()

    versions = [m["version"] for m in body["migrations"]]
    assert versions == sorted(versions)
    assert versions  # at least one migration exists
    assert max(versions) == db.SCHEMA_VERSION
    assert all(m["applied"] for m in body["migrations"])
    assert body["up_to_date"] is True


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_integrity_check_defaults_to_quick_check(client):
    res = await client.post("/api/database/integrity-check")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["mode"] == "quick_check"
    assert body["messages"] == ["ok"]


@pytest.mark.asyncio
async def test_integrity_check_full_mode(client):
    res = await client.post("/api/database/integrity-check", json={"full": True})
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "integrity_check"
    assert body["ok"] is True


# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.slow
async def test_maintenance_vacuum_succeeds(client):
    # Insert data so VACUUM has pages to reclaim.
    _insert_log_event(0, message="vacuum target")
    _insert_log_event(1, message="another row")
    res = await client.post("/api/database/maintenance/vacuum")
    assert res.status_code == 200
    body = res.json()
    assert body["action"] == "vacuum"
    assert body["ok"] is True
    assert isinstance(body["freed_bytes"], int)
    assert body["duration_ms"] >= 0


@pytest.mark.asyncio
@pytest.mark.slow
async def test_maintenance_wal_checkpoint_reports_result(client):
    res = await client.post("/api/database/maintenance/wal-checkpoint")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    # PRAGMA wal_checkpoint returns (busy, log_pages, checkpointed_pages).
    assert len(body["detail"]["result"]) == 3


@pytest.mark.asyncio
@pytest.mark.slow
async def test_maintenance_prune_logs_deletes_old_rows(client):
    """Prune must actually delete rows older than the retention window."""
    _insert_log_event(0, message="ancient")
    res = await client.post("/api/database/maintenance/prune-logs", json={"keep_days": 1})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["detail"]["keep_days"] == 1
    assert body["detail"]["rows_deleted"] >= 1

    with db.get_db() as conn:
        remaining = conn.execute("SELECT COUNT(*) FROM log_events WHERE ts_ms = 0").fetchone()[0]
    assert remaining == 0


@pytest.mark.asyncio
@pytest.mark.slow
async def test_maintenance_prune_without_body_uses_defaults(client):
    res = await client.post("/api/database/maintenance/prune-telemetry")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["detail"]["keep_days"] == 14


@pytest.mark.asyncio
async def test_maintenance_unknown_action_is_400(client):
    res = await client.post("/api/database/maintenance/do-something-else")
    assert res.status_code == 400
    assert res.json()["error"]["message"].startswith("Unknown action")
