# Review: `sub_agent_orchestration` skill — readiness for a Devin-run repo sweep

**Reviewer:** Maya (planner lane, static review) · **Date:** 2026-11-09
**Subject:** `.kilo/skills/sub_agent_orchestration/` — SKILL.md (510 lines),
orchestrator.py (1,046 lines), README.md, QUICK_REFERENCE.md,
`.kilo/orchestration.yaml` (414 lines)
**Question asked:** Can Devin use this skill to run a full-repo tech-debt
sweep, and what should be improved first?

## Verdict

**Not as-is.** The skill is a well-written *protocol document* wrapped around
a **non-functional runtime**. SKILL.md read as instructions is decent raw
material but lacks the repo's core discipline (evidence before claims). The
Python runtime does not execute anything — it simulates execution and, in one
place, would fabricate trust-roster evidence. Separately, the skill is
invisible to Devin today: it lives only in `.kilo/skills`, unmirrored, and its
agent vocabulary is Kilo-native.

Usable after surgery (spec below). The sweep should run off a repaired
SKILL.md as session instructions; orchestrator.py should play no part in it.

## Critical findings

1. **Mock execution dressed as real.** `orchestrator.py:892` —
   `_execute_agent` is self-described as a "placeholder for actual agent
   invocation" returning a mock result (`tokens_used: 5000`, one fabricated
   finding). `spawn_agent` wraps it in a COMPLETED artifact with a summary.
   Anyone running `orchestrate()` gets a realistic-looking, entirely invented
   result set.
2. **Fabricated trust evidence.** `_log_outcome` (`:834`) appends those mock
   outcomes to `tools/model-reliability/observed.jsonl` as `worked: true`,
   and auto-logging defaults to ON. One demo run of `__main__` would write
   fake success rows into the evidence base the whole trust roster stands on.
3. **Vacuous success.** `run_orchestration` implements 3 of the 6 advertised
   patterns. CONCURRENT, AGENT_TEAMS, and SHARED_STATE fall through with
   `artifacts = []`, and `success = all(...)` over an empty list is `True` —
   a run can report success having done literally nothing.
4. **No evidence standard.** Findings are free-form `{topic, detail}`.
   TaskCard has an `acceptance_criteria` field that nothing ever checks.
   Artifact `confidence` is hardcoded `0.8` at spawn (`:795`). This is the
   saying-vs-doing failure mode (Cobus data: 67.9% of claimed reviews never
   finished) implemented as a data model, and it contradicts AGENTS.md's
   "Proving a Defect Before Claiming One" doctrine directly: a sweep run on
   this protocol would emit unmeasured defect claims at 6x speed.

## Major findings

5. **Lossy synthesis.** `synthesize` deduplicates findings **by topic,
   first one wins** — two different real defects under one topic, the second
   is silently discarded. SKILL.md promises a union merge; the code does the
   opposite. For an audit tool this is the worst merge strategy available.
6. **Inert conflict detection.** `detect_conflicts` compares a
   `recommendation` key that the findings schema does not carry, so
   contradictions are almost never detected.
7. **Unenforced guards.** `timebox_seconds` is stored per card but never
   enforced (no timeout wraps `spawn_agent` — SKILL.md's own pseudocode has
   one, the code doesn't); `session_token_budget` is never checked in the
   execution loop. README advertises circuit breakers and rate limits that
   do not exist in the code.
8. **Duplicated definitions.** `_load_config` is defined twice (`:215` and
   `:475`; in Python the second silently wins). Every agent profile in
   `_load_agent_profiles` is defined twice in a row. `TASK_TIER_REQUIREMENTS`
   repeats the `visual_verification` key. In a quality tool, this is the
   tech debt it exists to catch.
9. **Stale routing table.** Profiles include **opencode** — uninstalled
   2026-10-26 under a standing never-reinstall rule — and front-line
   **cline**, which is fallback-only on this rig. The code's default model
   map (general→ling, frontend→cline) disagrees with SKILL.md's own model
   table (general→gpt-6, frontend→gpt-6). Three sources of truth, three
   answers.
10. **Discovery is broken for the intended user.** AGENTS.md: canonical
    skills live in `.claude/skills/`, mirrored to `.kilo/`, `.devin/`,
    `.agents/`. This skill exists **only** in `.kilo/skills` — absent from
    all three other homes — so Devin cannot discover it as a skill, and its
    agent types (explore, backend-architect, bolt-local, …) are Kilo's
    roster, not Devin's session model.

## Strengths worth keeping

- The pattern taxonomy and anti-patterns table in SKILL.md are genuinely
  good protocol material (bounded depth, artifact-not-chat handoffs,
  timeboxes as a concept).
- The design *respects* the trust system: per-task-type tier requirements,
  roster-aware model selection intent, outcome logging intent.
- Resource-guard *values* are sane for this rig: 3 concurrent, 500K session
  budget, 8-minute default timebox, max 8 agents per task.
- `orchestration.yaml` is real, structured, and the rightful single source
  for profiles — the code just doesn't fully use it.

## Improvement spec (executor-ready, in order)

1. **Quarantine the runtime.** Remove or hard-gate the `observed.jsonl`
   writer in `_log_outcome` (never writable from simulated execution); label
   orchestrator.py as SIMULATION in its docstring and the README; make
   unimplemented patterns raise instead of returning success.
2. **Add the evidence contract to SKILL.md.** Every finding must carry
   file:line, an evidence kind (gate output / reproduction / measurement),
   and a severity class. Findings without evidence are labelled
   "unverified — needs measurement" in synthesis and can never be reported
   as defects. A card cannot complete until its acceptance criteria are
   checked and the check is named.
3. **Fix synthesis.** Union-merge findings; dedup on (file, line, kind),
   never topic-first-wins. Conflicts = same file:line with differing
   verdicts, surfaced unresolved rather than averaged away.
4. **One roster source.** Delete the duplicated `_load_config` and profile
   blocks; load profiles from `orchestration.yaml`; remove opencode; demote
   cline to fallback-only; sync the model table across SKILL.md, code
   defaults, and the yaml.
5. **Mirror properly + Devin dialect.** Canonical copy in `.claude/skills/`,
   mirrors in `.devin/` and `.agents/` per AGENTS.md. Add a mapping from
   Kilo agent types to Devin session roles (explore → read-only scout
   session, general → standard session, etc.) so Devin can execute the
   protocol with its own machinery.
6. **Sweep protocol section.** Shard by the repo's task-file focus areas
   (not by file glob); Wave 1 audit-only, Wave 2 fixes only reviewed items;
   findings land as task-file items in the relevant area file, not as a
   prose report; seed the known-defect list (e.g. the
   `ascii_pytest_plugin.py` syntax error from `25f13433`, pre-existing
   docs-gate failures, T-PLT-46 loader half) so the sweep doesn't spend
   itself rediscovering them; per-wave budget and stop conditions stated
   up front.

## Bottom line for the sweep

Hand Devin the **repaired protocol** (items 2, 5, 6 are the minimum viable
set), as session instructions, in waves. Do not hand him the skill as it
stands, and do not let anything run `orchestrator.py` against the real
`observed.jsonl`.
