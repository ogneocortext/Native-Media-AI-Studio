#!/usr/bin/env python3
"""Daily maintenance runner - the repo's scheduled-task payload.

Everything here is deliberately non-GPU: file scans, HTTP-light probes,
JSONL aggregation, and small cleanups. GPU work (analysis, embeddings,
renders) stays on-demand.

Each step runs isolated with a timeout; a failing step is recorded in the
digest but does not stop the rest. The digest lands in
``tools/self-metrics/daily/<date>.txt`` so a human or agent can review what
the machine did without digging through logs.

Steps:
  1. report-self-metrics   - fresh trends snapshot (test + gate history)
  2. fetch_advertised      - refresh advertised-free model catalogs
                             (its own docstring says "run weekly")
  3. check-dangling-commits- are deleted refs hiding unpublished work?
  4. docs drift            - docs-triage + report-path-orphans (report-only)
  5. model inventory       - check-model-inventory drift
  6. backup rotation       - prune studio.db.bak-* older than 30 days,
                             always keeping the 3 newest
  7. history prune         - keep newest 20 test-insights .history runs
  8. dedup probe           - if the backend is up, POST a report-only
                             /api/audio/dedup-scan (no --apply)

Usage:
    python tools/maintenance_daily.py               # run all steps
    python tools/maintenance_daily.py --with-audit  # + pnpm audit (slow, net)
    python tools/maintenance_daily.py --dry-run     # show plan, change nothing

Install the Windows scheduled task with:
    pwsh -File scripts/install-maintenance-task.ps1
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAILY_DIR = ROOT / "tools" / "self-metrics" / "daily"
HISTORY_DIR = ROOT / "tools" / "test-insights-out" / ".history"
STORAGE = ROOT / "storage"
BACKEND_DIR = ROOT / "packages" / "backend"
FRONTEND_DIR = ROOT / "packages" / "frontend"

BACKUP_KEEP_NEWEST = 3
BACKUP_MAX_AGE_DAYS = 30
HISTORY_KEEP = 20
STEP_TIMEOUT = 120


def _run_step(name: str, argv: list[str], cwd: Path,
              timeout: int = STEP_TIMEOUT) -> tuple[int, str]:
    """Run one maintenance step; return (exit_code, output tail)."""
    start = time.time()
    try:
        proc = subprocess.run(
            argv, cwd=str(cwd), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        code = proc.returncode
    except subprocess.TimeoutExpired:
        out = f"TIMED OUT after {timeout}s"
        code = 124
    except OSError as e:
        out = f"could not run: {e}"
        code = 1
    tail = "\n".join(out.strip().splitlines()[-15:])
    return code, f"[{name}] {time.time() - start:.1f}s exit={code}\n{tail}"


def _rotate_backups(*, dry_run: bool) -> str:
    """Delete studio.db.bak-* files older than 30d, keeping 3 newest."""
    backups = sorted(
        (p for p in STORAGE.glob("studio.db.bak-*")
         if not p.name.endswith(("-shm", "-wal")) and p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not backups:
        return "[rotate-backups] no backups found"
    cutoff = time.time() - BACKUP_MAX_AGE_DAYS * 86400
    removed, kept = [], 0
    for i, p in enumerate(backups):
        age_days = (time.time() - p.stat().st_mtime) / 86400
        if i < BACKUP_KEEP_NEWEST or p.stat().st_mtime >= cutoff:
            kept += 1
            continue
        removed.append((p.name, age_days))
        if not dry_run:
            try:
                p.unlink()
            except OSError as e:
                return f"[rotate-backups] could not delete {p.name}: {e}"
    msg = (f"[rotate-backups] kept={kept} removed={len(removed)}"
           + (" (dry-run)" if dry_run else ""))
    for name, age in removed:
        msg += f"\n  - {name} ({age:.0f}d old)"
    return msg


def _prune_history(*, dry_run: bool) -> str:
    """Keep the newest HISTORY_KEEP timestamped runs."""
    if not HISTORY_DIR.exists():
        return "[prune-history] no history dir"
    runs = sorted((p for p in HISTORY_DIR.iterdir() if p.is_dir()),
                  reverse=True)
    removed = runs[HISTORY_KEEP:]
    if not removed:
        return f"[prune-history] {len(runs)} runs, nothing to prune" + \
               (" (dry-run)" if dry_run else "")
    for p in removed:
        if not dry_run:
            import shutil
            shutil.rmtree(p, ignore_errors=True)
    names = ", ".join(p.name for p in removed[:5])
    more = f" +{len(removed) - 5} more" if len(removed) > 5 else ""
    return (f"[prune-history] kept {HISTORY_KEEP}, removed {len(removed)}"
            f"{'' if dry_run else ''}: {names}{more}")


def _dedup_probe() -> str:
    """Report-only duplicate scan via the backend, if it is running."""
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:8000/api/audio/dedup-scan",
            data=json.dumps({"apply": False}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        groups = data.get("duplicate_groups", data.get("groups", "?"))
        return f"[dedup-probe] backend up - duplicate groups: {groups}"
    except Exception as e:
        return f"[dedup-probe] backend unreachable ({type(e).__name__}) - skipped"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--with-audit", action="store_true",
                        help="also run pnpm audit (network, slower)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the plan and skip destructive steps")
    args = parser.parse_args()

    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y-%m-%d")
    digest_path = DAILY_DIR / f"{stamp}.txt"

    py = sys.executable
    steps: list[tuple[str, list[str], Path]] = [
        ("metrics", [py, "tools/report-self-metrics.py"], ROOT),
        ("advertised", [py, "tools/model-reliability/fetch_advertised.py"],
         ROOT),
        ("dangling", [py, "tools/check-dangling-commits.py"], ROOT),
        ("docs-drift", [py, "tools/docs-triage.py"], ROOT),
        ("orphans", [py, "tools/report-path-orphans.py"], ROOT),
        ("models", [py, "tools/check-model-inventory.py"], ROOT),
    ]
    if args.with_audit:
        steps.append(("audit",
                      ["pnpm", "audit", "--prod"], FRONTEND_DIR))

    sections = [f"MAINTENANCE DIGEST - {stamp} "
                f"({datetime.now(UTC).isoformat(timespec='seconds')})",
                "=" * 60, ""]
    failures = 0

    for name, argv, cwd in steps:
        code, block = _run_step(name, argv, cwd)
        sections.extend((block, ""))
        if code != 0:
            failures += 1

    for label, fn in (("rotate-backups",
                       lambda: _rotate_backups(dry_run=args.dry_run)),
                      ("prune-history",
                       lambda: _prune_history(dry_run=args.dry_run)),
                      ("dedup-probe", _dedup_probe)):
        try:
            sections.append(fn())
        except Exception as e:  # housekeeping must never kill the run
            sections.append(f"[{label}] internal error: {e}")
        sections.append("")

    digest = "\n".join(sections)
    mode = " (dry-run)" if args.dry_run else ""
    print(digest)
    print(f"---\n{failures} step(s) failed{mode}; digest -> {digest_path}")
    if not args.dry_run:
        try:
            with digest_path.open("a", encoding="utf-8") as fh:
                fh.write(digest + "\n")
        except OSError:
            pass
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
