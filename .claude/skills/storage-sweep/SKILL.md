---
name: storage-sweep
description: Recurring storage/ and repo-debris hygiene sweep. Use when storage/ accumulates DB backups, orphaned media dirs, or scratch files; when asked to clean up, organize, or audit disk usage; or as a periodic maintenance pass. Classifies files as delete/consolidate/move/keep, groups DB backups under storage/backups/, and removes agent scratch scripts left at repo root.
---

# Storage Sweep

`storage/` is gitignored runtime state — nothing in it is tracked, and nothing
outside `storage/` should ever reference its subdirectories except the known
live paths below. That makes it safe to reorganize aggressively, but **verify
before deleting**: the app is running while you sweep.

## Live paths — never delete or move these

| Path | Owner |
|---|---|
| `storage/studio.db` (+ `-wal`/`-shm`) | SQLite DB, `app/core/connection.py` (`DB_PATH`) |
| `storage/ports.json` | `app/core/port_manager.py` |
| `storage/queue/` | `app/queue/manager.py` (`jobs.json`) |
| `storage/visualizer_presets/` | visualizer preset store |
| `storage/audio/` | audio library docs/README |
| `storage/Demo Tracks/` | demo audio content |

Anything else in `storage/` is a candidate for deletion — but confirm with
`rg` first (see step 2).

## Sweep procedure

Run from repo root in pwsh. Work in this order — cheap checks first.

### 1. Inventory

```powershell
Get-ChildItem storage -Recurse -File |
  Sort-Object Length -Descending |
  Select-Object @{n='MB';e={[math]::Round($_.Length/1MB,2)}}, LastWriteTime, FullName
```

Group by directory: `Get-ChildItem storage -Directory | % { ... Measure-Object Length -Sum ... }`.
Flag anything >50 MB and anything older than 30 days.

### 2. Reference check before deleting

For each candidate dir/file, grep the codebase — backend services, tools,
frontend fetch paths, docs that describe live behavior:

```powershell
rg -ln "<dirname-or-filename>" packages tools config scripts docs --glob '!docs/scratch/**'
```

Hits in `docs/` only = documentation mention, not a live dependency. Hits in
`packages/` or `tools/` = read the call site before deciding.

### 3. Classify and act

- **DB backups** (`*.pre-migrate-*.db`, `*.bak-*`, `*.db-journal/-wal/-shm`
  orphans): keep the **newest one** `pre-migrate` snapshot, move it to
  `storage/backups/` (already gitignored). Delete all older snapshots and
  every orphaned `-journal`/`-wal`/`-shm` sidecar — they are migration safety
  nets, not data. Delete `studio.db.bak-*` older than the newest pre-migrate.
- **Stale duplicate DBs** (e.g. `studio-data-studio.db` — different name,
  older `LastWriteTime` than `studio.db`, zero code references): delete.
- **Orphaned media dirs** (months-old `images/`, `video/`, `3d/` dumps with
  no code references): delete files older than 30 days; if the dir empties,
  remove the dir. Keep files newer than 30 days — they may be in-flight work.
- **0-byte files** anywhere under `storage/`: delete (failed writes).
- **`take_the_crown.blend` and other root-level strays**: move to
  `packages/frontend/public/models/blends/` if it's a source asset, else flag
  to the user — do not silently delete ambiguous assets.

### 4. Repo-root scratch sweep

Agents leave one-off scripts at repo root. List candidates:

```powershell
Get-ChildItem -File | ? { $_.Name -match '^(check_|test_|fix_|scratch|tmp|verify|capture-)' }
```

- **Untracked + older than ~7 days + zero references** (`rg -l <name>` hits
  only itself): delete.
- **Untracked but recent (<7 days) or referenced by another agent's
  uncommitted work**: leave it, list it in your report. Do not delete files
  that may belong to an in-flight session — `git status` cannot tell you who
  owns an untracked file.
- Legit scratch destinations per AGENTS.md: `docs/scratch/` or
  `packages/frontend/tests/browser/out/` — never repo root.

### 5. Report

Always report: bytes freed, files deleted (grouped), files moved, files kept
with reason, and anything ambiguous you left for the user.

## What "merged" means for DBs

There is exactly **one** live database: `storage/studio.db`. Any other
`*.db` in `storage/` is either a backup (→ `storage/backups/`, newest only) or
stale (→ delete after the reference check). Never merge SQLite files by
copying rows — if two DBs both look live, stop and ask the user which one the
app should use.

## Prevention (the actual fix for recurring debris)

The sweep is remediation; the disease is agents writing scratch files to repo
root or `storage/` subdirs instead of their proper homes. When you create
throwaway scripts during a task:

- Python/Node one-offs → `docs/scratch/` (gitignored from authority, but
  tracked-able) or delete them when the task ends.
- Render/QA captures → `packages/frontend/tests/browser/out/` or `output/qa/`.
- Blender intermediates → `public/models/blends/` (source) or `output/` (renders).
- DB inspection snippets → run inline (`python -c`) or in `docs/scratch/`,
  never as `check_*.py` at repo root.

Delete your own scratch files **before** committing — `git status` should show
only intended changes.
