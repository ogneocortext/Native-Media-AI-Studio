#!/usr/bin/env python3
"""agent-board — multi-agent coordination for this repo.

Shared claim/lease board so concurrent agents (Devin, Kilo, Windsurf,
Claude Code, manual sessions) stop editing the same files. Patterned on
the 2026 coordination-tool consensus (swarlo / befall / succubus /
coordinaut): atomic claims, TTL leases, heartbeats, fail-open.

State lives in storage/agent-board/board.db — gitignored runtime state,
never committed. Task *plans* stay in docs/plans/tasks/ (git); claims are
ephemeral and stay here.

Design rules (do not break):
  - FAIL-OPEN: every failure prints an advisory and exits 0. Coordination
    must never block productive work.
  - Claims are ADVISORY, not locks — nothing physically prevents an edit.
    The value is visibility + the pre-commit `check` command.
  - Leases expire on their own (default 45 min, --ttl override,
    heartbeat renews) so a crashed session never blocks a file forever.

Commands:
  python tools/orchestration/board.py claim --agent ID --paths "glob" ["glob2" ...] --task T-XXX [--ttl 45m] [--note "..."]
  python tools/orchestration/board.py release --agent ID [--paths ...]
  python tools/orchestration/board.py heartbeat --agent ID
  python tools/orchestration/board.py status [--json]
  python tools/orchestration/board.py conflicts --paths "glob" [...]
  python tools/orchestration/board.py check --paths "glob" [...]   # pre-commit advisory
  python tools/orchestration/board.py handoff --agent ID --task T-XXX --note "..."
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sqlite3
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "storage" / "agent-board" / "board.db"
DEFAULT_TTL_S = 45 * 60
LIVE_AFTER_S = 10 * 60  # heartbeat older than this = agent considered gone

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
    agent_id       TEXT PRIMARY KEY,
    tool           TEXT,
    host           TEXT,
    pid            INTEGER,
    started_at     REAL NOT NULL,
    last_heartbeat REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   TEXT NOT NULL,
    path_glob  TEXT NOT NULL,
    task_id    TEXT,
    note       TEXT,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    released_at REAL
);
CREATE INDEX IF NOT EXISTS idx_claims_agent ON claims(agent_id);
CREATE INDEX IF NOT EXISTS idx_claims_expiry ON claims(expires_at);
"""


def _now() -> float:
    return time.time()


def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(SCHEMA)
    return conn


def _agent_id(arg: str | None) -> str:
    """Resolve agent identity: flag > $AGENT_ID > tool-pid fallback."""
    if arg:
        return arg
    env = os.environ.get("AGENT_ID")
    if env:
        return env
    tool = os.environ.get("AGENT_TOOL", "agent")
    return f"{tool}-{os.getpid()}"


def _norm_glob(g: str) -> str:
    """Normalize a claim path for conflict comparison.

    'packages/frontend/src/**' -> 'packages/frontend/src/'
    'foo/bar.tsx'             -> 'foo/bar.tsx'
    Conflict rule: two claims conflict if one's normalized prefix is a
    prefix of the other's (directory containment) or they are equal.
    Trailing '*'/ '**' are stripped — we compare at directory granularity,
    which is deliberately conservative (may over-warn on sibling files,
    never under-warn on real overlaps).
    """
    g = g.replace("\\", "/").strip().lstrip("./")
    while g.endswith(("/**", "/*", "*")):
        g = g[:-1] if g.endswith("*") else g[:-2]
        g = g.rstrip("/")
    return g.lower()


def _conflicts(a: str, b: str) -> bool:
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


def _sweep(conn: sqlite3.Connection) -> None:
    "Lazily release expired claims and drop stale agents."
    conn.execute("UPDATE claims SET released_at=? WHERE released_at IS NULL AND expires_at<?", (_now(), _now()))
    conn.execute("DELETE FROM agents WHERE last_heartbeat<?", (_now() - 24 * 3600,))


def _active_claims(conn: sqlite3.Connection):
    _sweep(conn)
    return conn.execute(
        "SELECT * FROM claims WHERE released_at IS NULL AND expires_at>=? ORDER BY agent_id, path_glob",
        (_now(),),
    ).fetchall()


def _upsert_agent(conn: sqlite3.Connection, agent_id: str, tool: str | None) -> None:
    conn.execute(
        """INSERT INTO agents(agent_id, tool, host, pid, started_at, last_heartbeat)
           VALUES(?,?,?,?,?,?)
           ON CONFLICT(agent_id) DO UPDATE SET
             last_heartbeat=excluded.last_heartbeat,
             tool=COALESCE(excluded.tool, agents.tool)""",
        (agent_id, tool, socket.gethostname(), os.getpid(), _now(), _now()),
    )


def cmd_claim(args: argparse.Namespace) -> int:
    agent_id = _agent_id(args.agent)
    ttl = _parse_ttl(args.ttl)
    globs = [_norm_glob(g) for g in args.paths]
    conn = _db()
    try:
        _upsert_agent(conn, agent_id, args.tool)
        existing = _active_claims(conn)
        # Conflicts: active claims by OTHER agents overlapping any new glob.
        conflicts = [
            c for c in existing
            if c["agent_id"] != agent_id
            and any(_conflicts(n, _norm_glob(c["path_glob"])) for n in globs)
        ]
        if conflicts and not args.force:
            print("ADVISORY: overlapping claims held by other agents:")
            for c in conflicts:
                print(f"  {c['path_glob']:<60} agent={c['agent_id']} task={c['task_id'] or '-'} expires_in={int(c['expires_at'] - _now()) // 60}m")
            print("Claiming anyway (--force not needed to proceed; this is advisory).")
        now = _now()
        for n in globs:
            conn.execute(
                "INSERT INTO claims(agent_id,path_glob,task_id,note,created_at,expires_at) VALUES(?,?,?,?,?,?)",
                (agent_id, n, args.task, args.note, now, now + ttl),
            )
        conn.commit()
        print(f"claimed {len(globs)} path(s) as {agent_id} (ttl {int(ttl) // 60}m, task={args.task or '-'})")
        return 0
    finally:
        conn.close()


def cmd_release(args: argparse.Namespace) -> int:
    agent_id = _agent_id(args.agent)
    conn = _db()
    try:
        _upsert_agent(conn, agent_id, args.tool)
        if args.paths:
            n_globs = [_norm_glob(g) for g in args.paths]
            cur = conn.execute(
                f"UPDATE claims SET released_at=? WHERE agent_id=? AND released_at IS NULL AND path_glob IN ({','.join('?' * len(n_globs))})",
                [_now(), agent_id, *n_globs],
            )
        else:
            cur = conn.execute("UPDATE claims SET released_at=? WHERE agent_id=? AND released_at IS NULL", (_now(), agent_id))
        conn.commit()
        print(f"released {cur.rowcount} claim(s) for {agent_id}")
        return 0
    finally:
        conn.close()


def cmd_heartbeat(args: argparse.Namespace) -> int:
    agent_id = _agent_id(args.agent)
    conn = _db()
    try:
        _upsert_agent(conn, agent_id, args.tool)
        # Renew this agent's live claims too.
        conn.execute(
            "UPDATE claims SET expires_at=? WHERE agent_id=? AND released_at IS NULL",
            (_now() + DEFAULT_TTL_S, agent_id),
        )
        conn.commit()
        n = conn.execute("SELECT COUNT(*) c FROM claims WHERE agent_id=? AND released_at IS NULL", (agent_id,)).fetchone()["c"]
        print(f"heartbeat ok: {agent_id} ({n} live claim(s))")
        return 0
    finally:
        conn.close()


def cmd_status(args: argparse.Namespace) -> int:
    conn = _db()
    try:
        _sweep(conn)
        now = _now()
        agents = conn.execute(
            "SELECT * FROM agents WHERE last_heartbeat>=? ORDER BY last_heartbeat DESC", (now - 24 * 3600,)
        ).fetchall()
        claims = _active_claims(conn)
        if args.json:
            out = {
                "agents": [
                    {
                        "agent_id": a["agent_id"], "tool": a["tool"], "host": a["host"],
                        "pid": a["pid"], "live": a["last_heartbeat"] >= now - LIVE_AFTER_S,
                        "last_heartbeat_ago_s": int(now - a["last_heartbeat"]),
                    } for a in agents
                ],
                "claims": [
                    {
                        "agent_id": c["agent_id"], "path": c["path_glob"], "task": c["task_id"],
                        "expires_in_s": int(c["expires_at"] - now), "note": c["note"],
                    } for c in claims
                ],
            }
            print(json.dumps(out, indent=2))
            return 0
        if not agents and not claims:
            print("board empty — no agents, no claims")
            return 0
        print("AGENTS:")
        for a in agents:
            live = "LIVE " if a["last_heartbeat"] >= now - LIVE_AFTER_S else "stale"
            print(f"  [{live}] {a['agent_id']:<28} tool={a['tool'] or '-':<10} host={a['host']} pid={a['pid']} hb_ago={int(now - a['last_heartbeat'])}s")
        print("CLAIMS:")
        by_agent: dict[str, list] = {}
        for c in claims:
            by_agent.setdefault(c["agent_id"], []).append(c)
        for agent_id, cs in sorted(by_agent.items()):
            print(f"  {agent_id}:")
            for c in cs:
                print(f"    {c['path_glob']:<58} task={c['task_id'] or '-':<12} expires_in={int(c['expires_at'] - now) // 60}m {c['note'] or ''}")
        return 0
    finally:
        conn.close()


def cmd_conflicts(args: argparse.Namespace) -> int:
    wanted = [_norm_glob(g) for g in args.paths]
    conn = _db()
    try:
        hits = [
            c for c in _active_claims(conn)
            if any(_conflicts(w, _norm_glob(c["path_glob"])) for w in wanted)
        ]
        if not hits:
            print("no conflicts — paths are unclaimed")
            return 0
        print("CONFLICTS:")
        for c in hits:
            print(f"  {c['path_glob']:<58} agent={c['agent_id']} task={c['task_id'] or '-'} expires_in={int(c['expires_at'] - _now()) // 60}m")
        return 1  # nonzero is fine here — it's a query, not a failure
    finally:
        conn.close()


def cmd_check(args: argparse.Namespace) -> int:
    """Pre-commit advisory: do staged/changed paths overlap other agents' claims?"""
    paths = args.paths
    if not paths:
        # Default: staged files from git.
        import subprocess
        try:
            out = subprocess.run(
                ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
                cwd=REPO_ROOT, capture_output=True, timeout=15,
            )
            paths = [line for line in out.stdout.decode("utf-8", "replace").splitlines() if line.strip()]
        except Exception:
            paths = []
    if not paths:
        print("check: no paths to verify")
        return 0
    agent_id = _agent_id(args.agent)
    wanted = [_norm_glob(g) for g in paths]
    conn = _db()
    try:
        hits = [
            c for c in _active_claims(conn)
            if c["agent_id"] != agent_id
            and any(_conflicts(w, _norm_glob(c["path_glob"])) for w in wanted)
        ]
        if hits:
            print("ADVISORY: staged paths overlap claims by other agents:")
            for c in hits:
                print(f"  {c['path_glob']:<58} agent={c['agent_id']} task={c['task_id'] or '-'}")
            print("Proceed only if you own the overlap or the claim is stale.")
        else:
            print("check: clean — no foreign claims on these paths")
        return 0  # advisory only — never blocks
    finally:
        conn.close()


def cmd_handoff(args: argparse.Namespace) -> int:
    """Release claims + print the handoff note the next agent needs."""
    agent_id = _agent_id(args.agent)
    conn = _db()
    try:
        _upsert_agent(conn, agent_id, args.tool)
        cur = conn.execute(
            "UPDATE claims SET released_at=? WHERE agent_id=? AND released_at IS NULL", (_now(), agent_id)
        )
        conn.commit()
        print(f"released {cur.rowcount} claim(s) for {agent_id}")
        print(f"HANDOFF -> task {args.task}:")
        print(f"  {args.note}")
        print("Next agent: update the task file's Last-session field, then resume.")
        return 0
    finally:
        conn.close()


def _parse_ttl(s: str | None) -> int:
    if not s:
        return DEFAULT_TTL_S
    s = s.strip().lower()
    mult = {"s": 1, "m": 60, "h": 3600}.get(s[-1], 60)
    try:
        return int(float(s[:-1] if s[-1] in "smh" else s) * mult)
    except ValueError:
        return DEFAULT_TTL_S


def main() -> int:
    p = argparse.ArgumentParser(prog="board.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--agent", help="agent id (default: $AGENT_ID or <tool>-<pid>)")
        sp.add_argument("--tool", help="agent tool name (devin/kilo/windsurf/claude/...)")

    sp = sub.add_parser("claim", help="claim path globs before editing")
    common(sp)
    sp.add_argument("--paths", nargs="+", required=True)
    sp.add_argument("--task", help="task id from docs/plans/tasks (e.g. T-VIZ-55)")
    sp.add_argument("--ttl", default="45m")
    sp.add_argument("--note")
    sp.add_argument("--force", action="store_true", help="claim even with conflicts (advisory anyway)")
    sp.set_defaults(fn=cmd_claim)

    sp = sub.add_parser("release", help="release claims")
    common(sp)
    sp.add_argument("--paths", nargs="*")
    sp.set_defaults(fn=cmd_release)

    sp = sub.add_parser("heartbeat", help="renew agent + claims")
    common(sp)
    sp.set_defaults(fn=cmd_heartbeat)

    sp = sub.add_parser("status", help="show agents + active claims")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(fn=cmd_status)

    sp = sub.add_parser("conflicts", help="check paths against active claims")
    sp.add_argument("--paths", nargs="+", required=True)
    sp.set_defaults(fn=cmd_conflicts)

    sp = sub.add_parser("check", help="pre-commit advisory on staged paths")
    common(sp)
    sp.add_argument("--paths", nargs="*")
    sp.set_defaults(fn=cmd_check)

    sp = sub.add_parser("handoff", help="release + emit handoff note")
    common(sp)
    sp.add_argument("--task", required=True)
    sp.add_argument("--note", required=True)
    sp.set_defaults(fn=cmd_handoff)

    args = p.parse_args()
    try:
        return args.fn(args)
    except Exception as e:  # FAIL-OPEN: coordination never blocks work
        print(f"board.py advisory: {e} — continuing without coordination", file=sys.stderr)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
