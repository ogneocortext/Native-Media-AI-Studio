---
tags:
  - technical
  - ai-agents
  - tooling
aliases:
  - Programmatic Tool Calling
  - PTC
  - Droid 1.0 Patterns
cssclasses:
  - technical-guide
date: 2026-11-01
type: concept
---

# Programmatic Tool Calling — Patterns Taken from Factory Droid 1.0

Factory shipped **Droid 1.0** on 2026-10-29, the largest update to its
agent harness (the prompts, tools, result handling, and loop around a
model). Owner decision, 2026-11-01: **do not adopt the product; take
the patterns** into this project's own harness conventions. This doc
records what was evaluated so the evaluation is not redone.

## What Factory actually changed

- **Programmatic tool calling (PTC) is the default.** Instead of the
  model firing one tool call, waiting for the result to land in
  context, and repeating, the model writes a JavaScript program (a
  "Script" tool) that runs in a sandbox with no direct file, network,
  or system access of its own. One model request can execute hundreds
  of tool calls, independent calls concurrently. Only the program's
  printed output returns to context; full tool results stay logged
  outside the window, searchable later.
- **Worked example (vendor-reported):** moving and verifying 151
  Linear issues took 312 tool calls — about 36 model requests and
  3.1M input tokens with direct calling, versus 2 requests and 61K
  tokens as a Script.
- **Smaller, cache-stable prefix.** First-request prompt shrank from
  20,887 to 13,055 tokens (−37%); up-front tool definitions dropped
  from 11 to 2; newly loaded tools are *appended* so the prompt cache
  stays intact (Factory reports ~98% of a typical production request
  read from cache).
- **Provenance:** PTC is not a Factory invention. CodeAct (Wang et
  al., 2024) showed code-as-action beating JSON/text tool calls
  across 17 models; Cloudflare and Anthropic shipped production
  versions in late 2025 and Codex brought it to coding agents in
  2026. Factory's move is making it the default.
- **Benchmarks:** Factory's Terminal-Bench 4 lead over Codex, Claude
  Code, Cursor, OpenCode, and Devin is from **Factory's own runs**
  (Oct 23–28, 2026; three trials per task) with no third-party
  reproduction as of this writing. Per this project's standing rule,
  vendor benchmark scores carry no weight; the mechanism above is the
  verifiable part.

## The three patterns this project takes

1. **Script the batch.** When a task needs many similar mechanical
   operations (bulk file sweeps, batch edits, repeated API calls,
   verification passes), the executor writes ONE Python script and
   runs it, instead of dozens of individual tool calls. This extends
   two existing rules rather than replacing them: AGENTS.md already
   says "Prefer Python over PowerShell for anything an agent runs"
   and "Write new helper scripts in Python under `tools/`"; the new
   step is making the scripted pass the *default shape* for batch
   work, with one-off scripts kept outside the repo (per the
   `tmp_*` rule) and keepers committed under `tools/`.
2. **Summary in, raw out.** A script's default output is a compact
   summary sized for a model's context; full logs and raw results go
   to a file on disk (`output/` or `docs/scratch/` per repo rules),
   named in the summary. The planner/executor split already runs on
   this shape (a written Plan replaces turn-by-turn negotiation);
   this makes it the contract for tool output too.
3. **Stable prefix, append-only guidance.** The files every session
   reads first (AGENTS.md, the area task file, the roster) are the
   prompt prefix. Amend them in place or append; do not reshuffle
   stable sections as a side effect of task work. Structural
   reorganizations are their own deliberate commits (precedent:
   2026-11-01 README reconciliation), never drive-bys.

## What this project does not take

- **The product.** Droid has no free plan and no published free
  trial; Pro at $20/month is the floor, and BYOK usage still sits
  inside a paid individual plan (free only up to an unpublished
  allowance). That fails the project's tool rule: a tool earns its
  place only if the owner can use it long enough to form an opinion
  on routes he actually has.
- **The local-model route into Droid.** Factory's BYOK docs
  recommend 30B+ models for agentic coding; this machine's working
  range is 4B–9B on 8 GB VRAM. The route is plan-gated and
  size-gated at once.
- **The benchmark claims**, per the provenance note above.

## Application

Executor-ready work item: **T-PLT-08** in
`docs/plans/tasks/platform-and-workflow.md` (convention text in the
task-file rules + a pilot script, `tools/task-ledger-summary.py`).

## References

- [Droid 1.0: Building a Frontier Harness](https://factory.com/news/frontier-harness) — Factory's own release post (mechanism, worked example, prompt/cache figures).
- Marktechpost, 2026-11-01 issue — the brief that surfaced the release.
