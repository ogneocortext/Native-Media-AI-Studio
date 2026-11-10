---
name: sub-agent-orchestration
description: >-
  Protocol for running work through multiple sub-agents: pattern
  selection, task decomposition into claimable cards, the evidence
  contract every finding must satisfy, synthesis rules that never drop
  findings silently, and the repo-sweep protocol. This is a PROTOCOL
  document for whatever agent host reads it (Kilo, Devin, Claude Code).
  The bundled orchestrator.py is a simulation scaffold, not an engine:
  it executes nothing and its output is never evidence.
---

# Sub-Agent Orchestration (v2)

Sub-agents are infrastructure, not interrupts. They activate when a task
decomposes cleanly, share state through structured artifacts (never
chat), and every claim they return carries evidence a reviewer can
re-run. An orchestration result that cannot be checked is not a result.

## Ground rules (non-negotiable)

1. **Evidence or it did not happen.** Every finding uses the Finding
   schema below. A finding without file:line and a named evidence kind
   is recorded as UNVERIFIED and is never reported as a defect, a pass,
   or a completed check.
2. **No fabricated telemetry.** Nothing in this workflow writes to
   `tools/model-reliability/observed.jsonl` except a session report
   about real work the reporting agent itself performed. Simulated,
   mocked, or placeholder runs log nothing.
3. **Unimplemented means failed, loudly.** If a pattern, agent, or tool
   is unavailable, the run reports that and stops. Returning success
   with zero work performed is the worst outcome this protocol exists
   to prevent.
4. **Confidence is earned, not assigned.** No default or hardcoded
   confidence values. A worker states what it ran; the synthesis weighs
   evidence kind, not self-assessment (measured > reproduced > read).
5. **Timeboxes are wall-clock.** The orchestrator checks elapsed time
   at every synthesis point and stops the wave at the box. A worker
   that exceeds its box is reported as timed out, not silently awaited.

## The Finding schema

```yaml
finding:
  id: "<area>-<nnn>"            # stable within the run
  file: "path/to/file.py"
  line: 123                      # or range 120-135
  kind: defect | debt | risk | observation
  severity: critical | major | minor
  claim: "One sentence, falsifiable."
  evidence:
    kind: gate-output | reproduction | measurement | code-read
    detail: "Command run and its output, or the measured values.
             code-read alone caps severity at minor and marks the
             finding UNVERIFIED until measured."
  acceptance: "The check that would close this finding."
```

`code-read` evidence is a hypothesis grade. Per AGENTS.md ("Proving a
Defect Before Claiming One"), a defect claim needs gate-output,
reproduction, or measurement behind it.

## Decomposition and the task board

- Decompose by **repo focus area** (the `docs/plans/tasks/` files) for
  audit work, or by **disjoint path set** for implementation work.
  Workers are stateless: give each a path set that does not overlap
  another worker's, or claim the union on the agent board first
  (`tools/orchestration/board.py`, protocol in
  `docs/plans/orchestration.md`).
- Each card states: title, path set, acceptance criteria (a check that
  can pass or fail), timebox, tier requirement (from
  `tools/model-reliability/roster.md`).
- A card is complete only when its acceptance check has been RUN and
  the result recorded. "Reviewed" is not an acceptance check.

## Patterns

| Pattern | When | Notes |
|---|---|---|
| Orchestrator-Worker | Clear decomposition, bounded subtasks | Default. Max 3 concurrent, max 8 workers per task. |
| Sequential Pipeline | Ordered dependencies | Each stage validates before the next starts. |
| Generator-Verifier | Quality-critical output | Max 3 rounds; verifier judges against written criteria, not taste. |
| Concurrent research | Independent questions, same input | Findings merge by the synthesis rules below. |

Agent Teams and Shared State / Swarm are **not used** in this repo:
coordination cost exceeds value at this scale. Do not select them.

## Synthesis rules

1. **Union merge.** All findings from all workers enter the synthesis.
2. **Dedup on (file, line, kind)** - never on topic. Two findings about
   the same area are two findings.
3. **Conflicts are surfaced, not averaged.** Same file:line with
   different verdicts = one CONFLICT entry, listed for the reviewer
   with both evidence trails attached.
4. **Unverified findings are listed separately** and labelled. They are
   leads for a measurement pass, not results.
5. The synthesis reports counts honestly: workers run, workers timed
   out, findings by evidence kind, conflicts open.

## Resource guards

- Max 3 concurrent workers; max 8 per task; max delegation depth 2.
- Session budget and per-wave budget are set by the session owner
  before the run starts and stated in the run's first artifact.
- Circuit breaker: 3 consecutive worker failures pauses the wave for
  orchestrator review. Failures are reported, never retried silently
  more than once.

## Roster hygiene

- Agent and model assignments live in ONE place:
  `.kilo/orchestration.yaml`. This document and any code defaults must
  not restate them; if they disagree, the yaml wins and the disagreement
  is a finding.
- Retired agents are removed from routing in the same change that
  retires them. (As of 2026-11-09: opencode is uninstalled and must not
  appear in any routing table; Cline is fallback-only.)
- Tier requirements per task type follow `roster.md`; route-specific
  trust applies (same model, different route, different tier).

## Host dialect: Kilo

- Workers = Kilo subagents (`run_subagent`); explore-type workers are
  read-only and need no board claim; write workers get disjoint path
  sets per the board protocol in `autonomous-session`.
- Model selection follows the orchestration.yaml agent types (ling,
  kilo, bolt-local, qwen-local, devin).

## Host dialect: Devin

- Workers = Devin child sessions (or in-session subagents where
  available). Read-only scout work = a session instructed to produce
  findings only, with writes disabled by instruction and verified at
  synthesis (a scout that returns a diff has failed its card).
- Kilo agent types map to Devin session briefs: explore -> scout
  session (read-only), general -> standard session, architect roles ->
  a session briefed with the relevant task file and decision log
  section. There is no bolt-local on this host; route scout work to
  the standard session and keep its scope small.
- Devin commits follow the repo trailer table (`Co-authored-by:
  Devin`) and the task-file same-commit rule, same as every host.

## The repo-sweep protocol (audit waves)

For whole-repo tech-debt sweeps, run in waves. Never one unbounded pass.

1. **Shard by focus area.** One worker per `docs/plans/tasks/` area
   file. The worker reads its area file first; items already tracked
   are context, not new findings.
2. **Wave 1 is audit-only.** Workers produce Finding-schema records.
   No fixes, no edits outside the run's artifact directory.
3. **Seed the knowns.** The wave brief lists already-known defects
   (from the task files and the owner) so workers do not spend the
   wave rediscovering them; a worker that re-reports a seeded item
   without new evidence is marked duplicate.
4. **Review gate.** A reviewer (planner lane) static-reviews the wave's
   findings, drops or downgrades the unverified ones, and approves a
   fix list. No wave-2 work starts on unreviewed findings.
5. **Wave 2 fixes approved items only**, one commit per item, task
   file flipped in the same commit, gates run per
   `gates-commit-push`.
6. **Budgets and stops.** Each wave states its budget (sessions and
   wall-clock) up front. The wave stops at budget even if areas
   remain; remaining areas are listed as NOT SWEPT in the report.
   Partial coverage reported honestly beats full coverage claimed
   falsely.

## Anti-patterns

| Anti-pattern | Why | Instead |
|---|---|---|
| Spawning agents for trivial tasks | Overhead exceeds value | Complexity threshold: decompose only above 3 distinct domains or 5 files |
| Unbounded recursion | Infinite delegation | Depth cap 2, worker cap 8 |
| Full context in handoffs | Context bloat | Artifact references only |
| No timebox | Workers run forever | Wall-clock box per card, checked at synthesis |
| Chat-based coordination | Lossy, untraceable | Structured artifacts + the board |
| Topic-level dedup | Silently drops findings | Dedup on (file, line, kind) |
| Self-assessed confidence | Unfalsifiable | Weigh evidence kind |
