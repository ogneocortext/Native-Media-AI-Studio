# Agent Board — Multi-Agent Coordination Protocol

**Status:** Active 2026-11-08
**Tool:** `python tools/orchestration/board.py`
**State:** `storage/agent-board/board.db` (gitignored, per-machine, ephemeral)

## Why this exists

Multiple agent tools work this repo concurrently (Devin, Kilo, Windsurf,
Claude Code, manual sessions). The task files in `docs/plans/tasks/` are
the **plan** layer — they say what should happen. The board is the
**coordination** layer — it says who is touching what *right now*, so two
agents don't edit the same file in parallel. This exact failure already
happened: a fix landed on `ChiptunePage.tsx` and was overwritten minutes
later by the owning agent's next write.

Design follows the 2026 coordination-tool consensus (swarlo, befall-mcp,
succubus, coordinaut — all converged on the same primitives):

- **Atomic claims** on path globs, taken *before* editing
- **TTL leases** (default 45 min) with **heartbeats** — a crashed session
  never blocks a file permanently
- **Fail-open** — every command exits 0 with an advisory on any failure;
  coordination never blocks productive work
- **Advisory, not enforced** — nothing physically locks a file; the value
  is visibility plus the pre-commit `check` command

## The protocol

```
1. status      — who is here, what is claimed
2. claim       — path globs + task id, BEFORE editing
3. heartbeat   — every ~20 min during long work (also renews claims)
4. work        — edit, verify, commit per gates-commit-push
5. release     — when done, or `handoff` to pass context forward
```

### Commands

```powershell
# Identity: pass --agent <stable-id> or set $env:AGENT_ID once per session.
# Fallback is <tool>-<pid> — fine for one-shots, bad for long sessions
# (a restarted session gets a new id and old claims linger until TTL).

python tools/orchestration/board.py status                    # agents + claims
python tools/orchestration/board.py status --json             # machine-readable
python tools/orchestration/board.py claim --agent devin-1 --tool devin `
    --paths "packages/frontend/src/features/vst/**" --task T-VIZ-55 --note "chiptune sweep"
python tools/orchestration/board.py conflicts --paths "packages/frontend/src/features/vst/pages/**"
python tools/orchestration/board.py check                      # staged files vs foreign claims (pre-commit)
python tools/orchestration/board.py heartbeat --agent devin-1
python tools/orchestration/board.py release --agent devin-1    # all claims
python tools/orchestration/board.py handoff --agent devin-1 --task T-VIZ-55 --note "what the next agent needs"
```

### Rules

1. **Claim before edit.** Path globs at directory granularity
   (`packages/backend/app/services/gen3d/**`). Over-claim slightly — a
   false-positive advisory costs seconds; a collision costs a rewrite.
2. **Heartbeat during long work.** Claims TTL at 45 min; a heartbeat
   renews them. Run it at natural checkpoints (after each commit).
3. **`check` before commit** when other agents are live — it diffs your
   staged files against foreign claims. Advisory only; if it warns,
   verify you actually own the overlap before proceeding.
4. **Release on finish.** `release` frees claims; `handoff` releases +
   emits the note for the task file's Last-session field.
5. **Task files stay in git; claims don't.** `docs/plans/tasks/` is the
   durable plan; `board.db` is ephemeral runtime state. Never commit
   `storage/`.
6. **Subagents count too.** When dispatching `run_subagent` work that
   writes files, give the subagent a disjoint path set — or claim the
   union yourself and tell it the boundaries in the prompt. Read-only
   `subagent_explore` needs no claim.

## What this does NOT do

- No distributed mutex — a claim is a flag, not a lock. Two agents can
  still claim the same path; the second gets a loud advisory at claim
  time and at `check` time.
- No cross-machine sync — `board.db` is local to this machine. Agents on
  other machines won't see each other's claims (task files remain the
  cross-machine handoff).
- No enforcement hook — `check` is opt-in. A pre-commit hook could be
  added later behind the repo's hooks installer; kept advisory for now
  so it can never block a legitimate commit.

## Failure modes it prevents

| Incident class | Prevention |
|---|---|
| Two agents rewrite the same file mid-flight | claim-before-edit + `check` advisory |
| Dead session holds files forever | 45-min TTL + heartbeat renewal |
| "Where did that work go?" | `handoff` note → task file Last-session |
| Agent doesn't know others exist | `status` at session pre-flight |
| Coordination tooling itself breaks the session | fail-open: every error exits 0 |
