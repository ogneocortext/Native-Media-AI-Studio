"""Background auto-ingestion of log files into the analytics store.

The Log Analytics dashboard (Admin > Log Analytics) reads from the SQLite
``log_events`` table. That table is otherwise only populated by the manual
"Ingest Logs" button, so without this loop the dashboard's metrics -- Total
Events, level counts, patterns, error roll-ups, timeline -- sit at zero forever
while the real logs grow. To an operator that reads as "the metrics are frozen /
misconfigured", even though the live request panel (a separate, always-on
buffer) is updating fine.

This coroutine closes that gap by periodically ingesting NEW events from the
configured log files. It reuses the exact same incremental ``ingest_log_file``
the manual button uses (it only inserts rows newer than the last timestamp per
source, so it is idempotent and safe to run on a timer). Config -- enabled flag,
interval, source list, per-pass limit -- lives in ``config/logging.json``
(``analytics`` block), not hardcoded here.

Blocking file+DB work runs via ``asyncio.to_thread`` so the event loop is never
stalled by reading a large log file.
"""

from __future__ import annotations

import asyncio
import logging

from . import logging_settings

logger = logging.getLogger(__name__)


async def log_analytics_ingest_loop() -> None:
    """Supervised background task: keep the log analytics store fresh."""
    # Imported lazily so importing this module never triggers DB/app wiring.
    from .database import ingest_log_file
    from .logging_config import get_log_files

    while True:
        cfg = logging_settings.analytics()
        try:
            interval = max(5.0, float(cfg.get("interval_seconds", 15)))
        except (TypeError, ValueError):
            interval = 15.0

        if cfg.get("auto_ingest", True):
            files = get_log_files()
            try:
                limit = int(cfg.get("limit", 20000))
            except (TypeError, ValueError):
                limit = 20000
            for name in cfg.get("sources", ["app"]):
                path = files.get(name)
                if not path:
                    continue
                try:
                    inserted = await asyncio.to_thread(
                        ingest_log_file, str(path), name, limit
                    )
                    if inserted:
                        logger.info(
                            "Log analytics auto-ingest: %d new events from %s",
                            inserted,
                            name,
                        )
                except Exception as exc:  # noqa: BLE001 - never kill the loop
                    logger.warning(
                        "Log analytics auto-ingest failed for %s: %s", name, exc
                    )

        await asyncio.sleep(interval)
