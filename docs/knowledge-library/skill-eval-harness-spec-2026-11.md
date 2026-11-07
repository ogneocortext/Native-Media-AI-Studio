---
tags:
  - ai
  - agent
  - skills
  - documentation
aliases:
  - Skill Eval Harness Spec
cssclasses:
  - agent-guide
date: 2026-11-19
type: concept
---

# Skill Eval Harness — Spec

> Status: spec (no code yet)
> Date: 2026-11-19
> Task: T-AGT-06 (`docs/plans/tasks/agent-and-automation.md`)
> Research basis: Anthropic Agent Skills docs (progressive disclosure,
> description-as-trigger), skill-creator eval methodology (trigger queries,
> 3× runs, 0.5 threshold, train/held-out split), agentskills.io
> description-optimization guide.

## Problem

A skill's `description` is the only text the agent sees before deciding to
load it. A bad description means the skill never fires (false negative) or
fires on unrelated work (false positive). Today we have ~20 project skills
across `.claude/skills` (tracked) and `.kilo/skills` (local canonical), and
no way to measure whether any of them triggers correctly. Descriptions were
written ad hoc; five shipped with none at all.

This spec defines a harness that answers two questions per skill:

1. **Trigger precision** — does the skill activate on prompts that should
   trigger it, and stay quiet on near-misses?
2. **Description quality (static)** — is the frontmatter present, within
   budget, and non-overlapping with sibling skills?

Output quality evals (did the skill produce good work?) are explicitly out
of scope — that's per-skill `evals/evals.json` territory and a much larger
investment.

## Layout

```
tools/skill-evals/
├── SPEC.md                  # this file
├── skill_evals.py           # runner (stdlib only, like tools/check-deps.py)
├── queries.json             # trigger-query bank, one entry per skill
└── results/                 # gitignored run output
```

`.claude/skills/<name>/` stays the tracked canonical copy;
`.kilo` / `.devin` / `.agents` remain byte-identical local mirrors (verified
by hash — the runner asserts this, see below).

## Query bank format (`queries.json`)

```json
{
  "version": 1,
  "skills": {
    "line-by-line-review": {
      "queries": [
        { "q": "review this file line by line before I commit", "expect": true },
        { "q": "audit the diff for edge cases", "expect": true },
        { "q": "check whether we missed anything in the parser", "expect": true },
        { "q": "line-by-line pass over the vision scripts twice", "expect": true },
        { "q": "skim the README for typos", "expect": false },
        { "q": "write a summary of what this PR does", "expect": false },
        { "q": "run the unit tests for the audio module", "expect": false },
        { "q": "explain how the stem_remixer tempo detection works", "expect": false }
      ]
    }
  }
}
```

Rules for authoring queries (from skill-creator methodology):

- **8–10 `expect: true`** per skill, phrased the way a real user talks —
  formal, casual, and implicit (never naming the skill or its tools).
- **8–10 `expect: false`** — *near-misses*, not obvious non-sequiturs.
  "Write a Fibonacci function" proves nothing; "summarize this PR" for a
  review skill does. Negatives must share vocabulary with the skill.
- Each skill's positives should include at least one query where it
  *competes* with a sibling skill and should win (e.g. "make the page look
  better" → `visual-qa-loop`, not `line-by-line-review`).
- Queries are cheap to write badly and expensive to debug later — review
  them like test fixtures.

## Runner modes

### Mode 1 — `lint` (static, deterministic, no LLM)

Always available; runs in CI. Checks:

- Every `SKILL.md` in scope has YAML frontmatter with non-empty `name` and
  `description`.
- `description` length within budget (~100–600 chars; flag >600).
- Mirror consistency: `.claude` vs `.kilo`/`.devin`/`.agents` copies are
  byte-identical (MD5), for skills present in more than one tree.
- Description overlap: pairwise token-Jaccard between descriptions;
  flag pairs >0.6 for human review (heuristic, not a verdict).
- Query bank coverage: every tracked skill has an entry; every entry has
  ≥6 positives and ≥6 negatives (warn below the 8/8 target).

Exit non-zero on hard failures (missing frontmatter, mirror drift, missing
query-bank entry); warnings don't fail.

### Mode 2 — `route` (simulated activation, LLM-judged)

The honest version of "would the skill trigger": present the agent with
**only the name+description list** (exactly what progressive disclosure
level 1 gives it) plus one query, and ask which skills — if any — it would
load. This measures *description discriminability*, which is the thing we
actually control. It does NOT measure real agent behavior; the spec is
explicit about that limitation.

Implementation:

- Backend: local Ollama chat model (default `qwen3.5`-class instruct,
  configurable via `--model`), `temperature: 0`, constrained output —
  JSON array of skill names or `[]`.
- Prompt template (fixed, versioned in the runner): the full
  name+description catalog, the query, instruction to reply with only the
  matching skill names.
- Each query runs **3 times**; a `expect: true` query passes if trigger
  rate > 0.5 and includes the target skill in the majority of responses;
  `expect: false` passes if the target skill appears in ≤ 1 of 3 runs.
- Split: 60% of queries train / 40% held-out, seeded by query index, so
  description edits can't overfit the whole bank.
- `--skill <name>` runs one skill's queries; default runs all.
- Reports per-skill trigger rate, false-positive rate, and the queries
  that flipped — that's the description-edit feedback loop.

### Mode 3 — `live` (real activation, deferred)

True end-to-end: spawn the agent CLI headless with each query in a clean
session, observe which skills it loads, score against `expect`.

**Blocker to resolve before building:** no confirmed headless/observable
skill-invocation interface for Devin CLI or Kilo in this environment.
Candidates to investigate: session transcript/log parsing, CLI verbose
flags, MCP-style hooks. Until one is confirmed, Mode 3 stays unimplemented
and `route` mode is the accepted proxy. Do not fake it.

## Metrics and thresholds

| Metric | Definition | Pass |
|---|---|---|
| trigger_rate(q) | fraction of 3 runs where skill selected for should-trigger q | > 0.5 |
| fp_rate(q) | fraction of 3 runs where skill selected for near-miss q | ≤ 0.33 |
| skill_score | fraction of that skill's queries passing | report; investigate < 0.8 |
| description_overlap | max pairwise Jaccard across catalog | warn > 0.6 |

A skill scoring < 0.8 gets a description-rewrite suggestion generated by
the same LLM (few-shot: current description + failing queries → proposed
rewrite), which a human then applies and re-measures. Same loop as
skill-creator's `run_loop.py`, minus the held-out retraining complexity —
our banks are small enough that 3-run stochasticity is the dominant noise.

## Non-goals

- Output-quality evals (`evals/evals.json` per skill) — separate effort.
- Auto-editing SKILL.md files — the harness proposes, humans dispose.
- Cross-client coverage (Claude Code, Cursor) — the catalog snapshot is
  whatever the runner is pointed at; mirrors are asserted identical so one
  catalog serves all four trees.
- Plugin skills (`.agents/skills/remotion-*`, `~/.agents/skills/hyperframes-*`)
  — third-party, not ours to lint. The runner takes an explicit roots list.

## Build order

1. `queries.json` seed for the 5 previously-undescribed skills + the
   highest-traffic ones (`visual-qa-loop`, `line-by-line-review`,
   `gates-commit-push`, `ollama-model-ops`, `media-output-contract`,
   `vendor-drift`) — ~8 skills × ~16 queries.
2. Mode 1 `lint` — pure stdlib, lands first, immediately useful in CI.
3. Mode 2 `route` — needs the Ollama chat call; reuse patterns from
   `tools/vision/vision-common.mjs` (model resolution, warm-up) ported to
   Python or kept in Node — decide at build time; Python preferred for
   consistency with `tools/check-deps.py`.
4. Mode 3 `live` — only after a real activation-observation path exists.

## Open questions

- Which Ollama chat model is the right "router judge" on 8 GB VRAM —
  needs an A/B against description-discrimination sanity cases.
- Whether Kilo exposes skill-load events in its session logs (would
  unblock Mode 3 cheaply).
- Whether query banks should live in `queries.json` (one file, easy to
  review) or per-skill `evals/` dirs (co-located, matches Anthropic
  convention). Leaning `queries.json` for v1; revisit if banks outgrow it.
