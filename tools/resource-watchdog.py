"""System RAM watchdog and orphan-process reaper for the dev rig.

Motivation: episodic "orphaned python eating all RAM" events and commit-charge
spikes (pagefile peak hit 11.7 GB on a 32 GB box) that make the machine thrash.
Physical RAM is only half the story — Windows kills interactivity when the
*commit charge* approaches the commit limit, so this tool tracks both.

Modes:
    status   One-shot report: memory, top consumers, orphan candidates.
    watch    Poll every --interval seconds, append JSONL to
             output/logs/resource-watchdog.jsonl, warn on thresholds, and
             optionally reap orphans (--reap).
    reap     One-shot orphan scan. Dry-run unless --apply is passed.

Orphan definition: a process in ORPHAN_NAMES whose parent PID no longer
exists, older than --min-age minutes, and whose command line does not match
ALLOWLIST_PATTERNS (long-running services legitimately have dead parents —
Electron apps, pnpm, and MCP hosts all spawn-then-exit).

Usage:
    python tools/resource-watchdog.py status
    python tools/resource-watchdog.py reap            # dry run
    python tools/resource-watchdog.py reap --apply    # kill candidates
    python tools/resource-watchdog.py watch --interval 30 --reap
"""

from __future__ import annotations

import argparse
import ctypes
import json
import logging
import re
import sys
import time
from datetime import UTC, datetime
from operator import itemgetter
from pathlib import Path
from typing import ClassVar

import psutil

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / "output" / "logs"
JSONL_LOG = LOG_DIR / "resource-watchdog.jsonl"
TEXT_LOG = LOG_DIR / "resource-watchdog.log"

ORPHAN_NAMES = {
    "python.exe",
    "pythonw.exe",
    "node.exe",
    "ffmpeg.exe",
    "ffprobe.exe",
}

# Command-line fragments that mark a process as a legitimate long-running
# service even though its launcher has exited. Match is case-insensitive
# substring on the full command line.
ALLOWLIST_PATTERNS = [
    r"app\.main:app",  # backend uvicorn
    r"ollama",  # ollama serve / app
    r"pnpm",  # package-manager wrappers
    r"vite",  # frontend dev server
    r"tools[/\\]mcp[/\\]",  # MCP stdio servers
    r"anaconda_desktop_bridge",  # Kilo bridge python
    r"blender",  # Blender / blender-mcp
    r"comfyui",  # ComfyUI python main.py
    r"go-(dashboard|gateway|media|ports|studio|worker)",  # Go sidecars
    r"server-manager|windows_server_manager",
    r"resource-watchdog",  # self
    r"run-gates|run_checks|pytest",  # gate/test runners are transient anyway
]
ALLOWLIST_RE = re.compile("|".join(ALLOWLIST_PATTERNS), re.IGNORECASE)

WARN_COMMIT_PCT = 80.0
CRIT_COMMIT_PCT = 90.0
WARN_FREE_PHYS_GB = 2.0
CRIT_FREE_PHYS_GB = 1.0


class MEMORYSTATUSEX(ctypes.Structure):
    _fields_: ClassVar = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def memory_stats() -> dict:
    """GlobalMemoryStatusEx gives true commit charge; psutil is the fallback."""
    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):  # type: ignore[attr-defined]
        total_phys = stat.ullTotalPhys
        avail_phys = stat.ullAvailPhys
        total_commit = stat.ullTotalPageFile
        avail_commit = stat.ullAvailPageFile
        commit_used = total_commit - avail_commit
        return {
            "phys_total_gb": round(total_phys / 2**30, 2),
            "phys_avail_gb": round(avail_phys / 2**30, 2),
            "phys_used_pct": round(100 * (1 - avail_phys / total_phys), 1),
            "commit_total_gb": round(total_commit / 2**30, 2),
            "commit_used_gb": round(commit_used / 2**30, 2),
            "commit_pct": round(100 * commit_used / total_commit, 1),
        }
    vm = psutil.virtual_memory()
    sm = psutil.swap_memory()
    commit_total = vm.total + sm.total
    commit_used = (vm.total - vm.available) + sm.used
    return {
        "phys_total_gb": round(vm.total / 2**30, 2),
        "phys_avail_gb": round(vm.available / 2**30, 2),
        "phys_used_pct": vm.percent,
        "commit_total_gb": round(commit_total / 2**30, 2),
        "commit_used_gb": round(commit_used / 2**30, 2),
        "commit_pct": round(100 * commit_used / commit_total, 1) if commit_total else 0.0,
    }


def top_processes(limit: int = 10) -> list[dict]:
    rows = []
    for p in psutil.process_iter(["pid", "name", "memory_info", "create_time", "cmdline"]):
        try:
            info = p.info
            rows.append(
                {
                    "pid": info["pid"],
                    "name": info["name"],
                    "ram_mb": round(info["memory_info"].rss / 2**20, 1)
                    if info["memory_info"]
                    else 0,
                    "age_min": round((time.time() - info["create_time"]) / 60, 1)
                    if info["create_time"]
                    else None,
                    "cmd": " ".join(info["cmdline"] or [])[:160],
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    rows.sort(key=itemgetter("ram_mb"), reverse=True)
    return rows[:limit]


def find_orphans(min_age_min: float) -> list[dict]:
    """Return orphan candidates: dead parent + monitored name + allowlist miss."""
    live_pids = {p.pid for p in psutil.process_iter(["pid"])}
    now = time.time()
    orphans = []
    for p in psutil.process_iter(["pid", "name", "create_time", "cmdline", "ppid"]):
        try:
            info = p.info
            name = (info["name"] or "").lower()
            if name not in ORPHAN_NAMES:
                continue
            ppid = info["ppid"]
            if ppid in live_pids:
                continue
            age_min = (now - info["create_time"]) / 60 if info["create_time"] else 0
            if age_min < min_age_min:
                continue
            cmd = " ".join(info["cmdline"] or [])
            if ALLOWLIST_RE.search(cmd):
                continue
            orphans.append(
                {
                    "pid": info["pid"],
                    "name": info["name"],
                    "ram_mb": round(p.memory_info().rss / 2**20, 1),
                    "age_min": round(age_min, 1),
                    "ppid": ppid,
                    "cmd": cmd[:200],
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    orphans.sort(key=itemgetter("ram_mb"), reverse=True)
    return orphans


def kill_pid(pid: int) -> bool:
    try:
        p = psutil.Process(pid)
        p.kill()
        p.wait(timeout=5)
        return True
    except psutil.NoSuchProcess:
        return True
    except (psutil.AccessDenied, psutil.TimeoutExpired, psutil.Error) as e:
        logging.warning("kill pid=%s failed: %s", pid, e)
        return False


def setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(TEXT_LOG, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def jsonl(record: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    record["ts"] = datetime.now(UTC).isoformat(timespec="seconds")
    with JSONL_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def level_for(stats: dict) -> str:
    if stats["commit_pct"] >= CRIT_COMMIT_PCT or stats["phys_avail_gb"] < CRIT_FREE_PHYS_GB:
        return "CRITICAL"
    if stats["commit_pct"] >= WARN_COMMIT_PCT or stats["phys_avail_gb"] < WARN_FREE_PHYS_GB:
        return "WARN"
    return "OK"


def cmd_status(args: argparse.Namespace) -> int:
    stats = memory_stats()
    orphans = find_orphans(args.min_age)
    level = level_for(stats)
    report = {
        "level": level,
        "memory": stats,
        "top_processes": top_processes(args.top),
        "orphan_candidates": orphans,
    }
    print(json.dumps(report, indent=2))
    return 2 if level == "CRITICAL" else (1 if level == "WARN" else 0)


def cmd_reap(args: argparse.Namespace) -> int:
    orphans = find_orphans(args.min_age)
    if not orphans:
        print("No orphan candidates found.")
        return 0
    print(f"{len(orphans)} orphan candidate(s):")
    for o in orphans:
        print(
            f"  pid={o['pid']} {o['name']} {o['ram_mb']}MB age={o['age_min']}m cmd={o['cmd'][:100]}"
        )
    if not args.apply:
        print("Dry run — pass --apply to kill.")
        return 0
    killed = [o for o in orphans if kill_pid(o["pid"])]
    jsonl(
        {
            "event": "reap",
            "killed": [o["pid"] for o in killed],
            "skipped": [o["pid"] for o in orphans if o not in killed],
        }
    )
    print(f"Killed {len(killed)}/{len(orphans)} process(es).")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    setup_logging()
    logging.info(
        "resource-watchdog starting interval=%ss reap=%s min_age=%.0fm",
        args.interval,
        args.reap,
        args.min_age,
    )
    last_level = "OK"
    try:
        while True:
            stats = memory_stats()
            level = level_for(stats)
            record = {"event": "sample", "level": level, **stats}
            if args.reap:
                orphans = find_orphans(args.min_age)
                if orphans:
                    killed_pids = [o["pid"] for o in orphans if kill_pid(o["pid"])]
                    record["orphans_found"] = len(orphans)
                    record["orphans_killed"] = killed_pids
                    if killed_pids:
                        logging.warning(
                            "reaped %d orphan(s): pids=%s", len(killed_pids), killed_pids
                        )
            jsonl(record)
            if level != last_level:
                logging.warning(
                    "memory level %s -> %s (commit=%.1f%% phys_avail=%.1fGB)",
                    last_level,
                    level,
                    stats["commit_pct"],
                    stats["phys_avail_gb"],
                )
                last_level = level
            time.sleep(args.interval)
    except KeyboardInterrupt:
        logging.info("resource-watchdog stopped")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_status = sub.add_parser("status", help="one-shot memory + orphan report")
    p_status.add_argument("--min-age", type=float, default=30.0, help="min orphan age in minutes")
    p_status.add_argument("--top", type=int, default=10, help="top-N processes to show")
    p_status.set_defaults(func=cmd_status)

    p_reap = sub.add_parser("reap", help="scan and optionally kill orphan processes")
    p_reap.add_argument("--min-age", type=float, default=30.0, help="min orphan age in minutes")
    p_reap.add_argument("--apply", action="store_true", help="actually kill (default: dry run)")
    p_reap.set_defaults(func=cmd_reap)

    p_watch = sub.add_parser("watch", help="continuous monitor loop")
    p_watch.add_argument("--interval", type=float, default=30.0, help="poll interval seconds")
    p_watch.add_argument("--min-age", type=float, default=30.0, help="min orphan age in minutes")
    p_watch.add_argument("--reap", action="store_true", help="kill orphans each cycle")
    p_watch.set_defaults(func=cmd_watch)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
