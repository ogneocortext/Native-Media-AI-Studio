---
tags:
  - technical
  - database
  - gpu
  - telemetry
  - Database Operations 2026
aliases:
  - GPU Telemetry Ops
  - studio.db Maintenance
cssclasses:
  - technical-guide
date: 2026-11-06
type: concept
---

# Database Operations — studio.db, GPU Telemetry & Maintenance (2026-11-06)

> Operational reference for the SQLite layer: where the DB lives, how
> `gpu_telemetry` grows and is retained, the admin API, and the
> VACUUM/mmap caveat that decides whether a shrink actually works.
> Verified against `app/core/connection.py`, `app/core/gpu.py`,
> `app/diagnostics/resources.py`, `app/api/database_admin.py`.

## Location & connection policy

- Path: `NMA_DB_PATH` env var wins; default `<PROJECT_ROOT>/storage/studio.db`.
- WAL mode with `wal_autocheckpoint=1000`, `synchronous=NORMAL`,
  `busy_timeout=5000`, `temp_store=MEMORY`, `cache_size=-20000` (~20 MB),
  `journal_size_limit=64 MB`.
- **`mmap_size=268435456` (256 MB)** — memory-mapped reads. This is the
  detail that matters for maintenance (see VACUUM below).
- Pooled connections recycle after `CONNECTION_MAX_AGE_SECONDS = 300`.

## `gpu_telemetry` — the growth table

Written every 30 s by `resource_monitoring_loop`
(`app/diagnostics/resources.py`) via `log_gpu_telemetry(snapshot)`.
Columns: `ts_ms`, `ts_iso`, `gpu_name`, `memory_total/used/free`,
`memory_percent`, `gpu_util`, `mem_controller_util`, `temperature_c`,
`processes_json`.

**Payload compaction (T-PLT-11, 2026-11-06):** measured on the live DB,
99.6% of stored process entries had `used_mb=None` (Windows
permission-denied stubs) at ~3.7 KB/row of pure noise — ~40 MB of a
68 MB database. `_compact_processes()` now keeps only entries with a
measured `used_mb`, sorts largest-first, caps at 12. Live history was
rewritten and the file VACUUMed: **68.2 MB → 21.1 MB**.

Readers:

- `GET /api/health/gpu/history?since_ms&limit&include_processes` —
  `include_processes` is opt-in; the frontend never passes it
  (`services/api/gpu-3d.ts` charts the scalar columns only).
- `GET /api/health/gpu/stats` — aggregates + linear-trend slope per metric.
- There is also a destructive clear path in `health.py`
  (`DELETE FROM gpu_telemetry`) for the admin UI.

## Retention — two different defaults, know which you're calling

| Path | Keep window | Interval |
|---|---|---|
| Background loop (`resources.py`) | **7 days** (`GPU_TELEMETRY_KEEP_DAYS`) | every **15 min** (`GPU_PRUNE_INTERVAL_SECONDS`), driven by `next_prune_time()`/`prunes_due()` on the monotonic clock |
| Admin API `POST /api/database/maintenance/prune-telemetry` | **14 days** (`_PRUNE_ACTIONS` default; `keep_days` in body overrides) | on demand |

The loop's guard used to be `int(event_loop.time()) % 1000 < 10` — a
modulo on the monotonic clock that fired ~1.7% of cycles; the table grew
to 125k rows / ~417 MB before the elapsed-time rewrite. The helpers exist
so that bug class can't return — don't reintroduce counter/modulo guards.

`cleanup_old_gpu_telemetry(keep_days, vacuum=True)` deletes rows older
than the cutoff and VACUUMs when `deleted >= 500` — **after committing**,
because SQLite refuses `VACUUM` inside a transaction (that bug was real
and is now covered by tests).

## The VACUUM/mmap caveat (the one that wastes time)

`VACUUM` rewrites the DB file, but **Windows will not truncate a file
that has active memory mappings**. The backend's pooled connections hold
`mmap_size` mappings, so a VACUUM issued through the admin API (or the
retention helper) frees pages *inside* SQLite (freelist → reused) but
**the `.db` file on disk does not shrink** while the backend runs.

To actually reclaim disk:

```powershell
pwsh -NoProfile -File scripts\manage-servers.ps1 stop backend
# then vacuum via sqlite3 or the admin endpoint on a fresh process
pwsh -NoProfile -File scripts\manage-servers.ps1 start backend
```

This was verified live during T-PLT-11 (68.2 → 21.1 MB only after the
backend was stopped).

## Admin API — `app/api/database_admin.py`

| Endpoint | Purpose |
|---|---|
| `GET /api/database/overview` | sizes, table inventory, last-activity |
| `GET /api/database/tables/{name}` | per-table detail (+ `?sizes` for dbstat bytes) |
| `GET /api/database/schema` | schema dump |
| `POST /api/database/integrity-check` | `PRAGMA integrity_check` |
| `POST /api/database/maintenance/{action}` | `vacuum`, `wal-checkpoint`, `analyze`, `prune-logs` (30 d), `prune-telemetry` (14 d), `prune-resources` (7 d) — returns `before_bytes`/`after_bytes`/`freed_bytes`/`duration_ms` |

Maintenance runs under `_MAINTENANCE_LOCK`; prune helpers open their own
pooled connection (called *without* holding one, to avoid writer-lock
contention). `safe_vacuum()` in `connection.py` wraps the vacuum with the
transaction-safe ordering.

## Incident log

- **2026-11-06 (T-PLT-11):** live DB held six leaked synthetic test
  tables (`cp`, `keep`, `leak`, `filler`, `dangling`, `test_persist`)
  from pre-isolation test runs — dropped after content verification.
  Combined with telemetry compaction + VACUUM: 68.2 MB → 21.1 MB.
- Tests covering this area: process compaction, permission-denied
  stub dropping, 12-entry cap, retention delete, VACUUM-after-commit,
  prune scheduling (`tests/` retention file, 9 tests).

## Rules of thumb

- Never `VACUUM` inside a transaction — commit first.
- File-size shrink requires no live `mmap` mappings → stop the backend.
- `include_processes=true` is for debugging only; history readers get
  compacted payloads regardless.
- Retention windows differ by caller (7 d loop / 14 d admin) — deliberate,
  but don't "fix" one to match the other without deciding which is right.
