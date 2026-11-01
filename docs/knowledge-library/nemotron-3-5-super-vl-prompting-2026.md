---
tags:
  - ai
  - ai-agents
aliases:
  - Super VL Prompting
  - Nemotron Prompting Reference
cssclasses:
  - technical-guide
date: 2026-11-01
type: concept
---

# Prompting Nemotron 3.5 Super VL (Kilo Route)

Reference for working with **NVIDIA Nemotron 3.5 Super VL**
(`nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B`, released
2026-10-15): 120B total / 12B active, Mamba-2 + MoE + attention
hybrid with a C-RADIO vision encoder, 1M-token context, open
weights (OpenMDW-1.1). Here it is reached through the Kilo
gateway's free rotation — free in Kilo, OpenCode, and Cline for a
limited, unspecified period — so these notes are captured while
the route lasts. When it leaves the rotation: OpenRouter carries
free and paid endpoints; the weights themselves are far beyond
local hardware (the 24 GB Bolt 74B sibling does not fit 8 GB
either, and Bolt E4B is a different, text-only model).

Local standing: Tier A in `tools/model-reliability/roster.md`
(owner sessions 2026-10-24/25 — refactor repair, shell /
environment diagnosis). Vendor benchmark figures below are
NVIDIA-reported and unreproduced unless noted.

## The knobs (from NVIDIA's model card)

- **Reasoning levels: off, on (medium), on** — set through the
  chat template (`enable_thinking`); Kilo exposes this as
  `reasoning_effort`, plus a `reasoning_budget` hard cap on
  thinking tokens. Match the level to the work: medium or off for
  mechanical execution (faster, less drift), on for planning,
  diagnosis, and repair. Owner experience: max-thinking output
  still feels uneven — more thinking is not monotonically better
  for this model, so cap the budget on long runs rather than
  letting thinking eat the session.
- **Sampling:** card-recommended temperature 1.0 / top_p 0.95 for
  text, but **temperature 0.6 / top_p 0.95 for vision**. If a
  route applies one setting to both, vision answers at text
  temperature will look more random than the model is.
- **Tool calling** uses the qwen3_coder parser family; the API
  supports `tool_choice` auto / required / named and structured
  outputs via JSON schema. Kilo handles the wire format — prompt
  side, steer by instruction ("use X; do not use Y").
- **Documents** are an input pattern, not native PDF parsing:
  supply pages as images **with accompanying text** (the card's
  stated format).

## Failure modes and countermeasures

From the one independent agentic evaluation located (LeanZero:
0.3781, 31st of 41 — the model lost its context mid-run, made
290 tool calls without writing, and reported "everything works
with zero errors" over an empty canvas) and a community
data-analysis test (30/43, but it missed **all** data-quality and
hidden-pattern questions). The owner's own sessions reconcile
with these: the model is strong inside a well-formed harness on
diagnostic-shaped work and weak when a run is open-ended. Prompt
to the failure modes:

1. **Loses the thread on long runs.** One task item per session;
   self-contained packets that carry their own context;
   re-state the goal and hard constraints at each phase
   boundary; stable prefix (never reshuffle AGENTS.md / task
   files mid-session — also the T-PLT-08 convention).
2. **Exploration loops that never produce.** Order steps
   deliverable-first; state a call budget ("after ~15 tool calls
   without a file write, write what you have or report
   blocked"); give exact file paths instead of "find the file
   that…" — every search you specify is a dozen calls it does
   not wander through.
3. **False completion claims.** Require evidence in the report:
   raw command output, diffs, test summaries — never a summary
   claim alone. Name the acceptance artifact in the prompt
   ("done when: `python tools/run-gates.py` prints all PASS").
   Include the clause *report only what you measured*. The
   card's own AA-Omniscience hallucination rate is 30% — low
   for its class, not zero; independent verification stays a
   separate lane.
4. **Does not audit unprompted.** It found the owner's
   environment-variable conflicts when the task *was* diagnosis;
   it did not check data quality when the task was analysis.
   Carry the audit list in the prompt: name what to verify and
   what anomalies to flag, every time.

## Structure that matches its training

The model's mid-training included software-engineering data at
scale — repositories, issue–PR pairs, commit diffs, build and CI
logs, agent trajectories. Frame work the way that data is
shaped: an **issue brief** (problem statement, repo context,
named files, acceptance criteria, report shape) reads native to
it in a way a loose chat ask does not. The T-PLT-08 session
packet in `docs/plans/tasks/platform-and-workflow.md` is the
worked example: expected repo state up front with
stop-and-report on mismatch, numbered steps with done-criteria,
a verify step that compares against hand counts, gates before
the status flip, and a fixed report-back shape. General harness
patterns: [[programmatic-tool-calling-2026]].

## Vision prompting

- One frame per ask (NVIDIA's reference serving config limits
  media per prompt; dense multi-image asks degrade quietly).
- **Inspect before judging:** instruct it to describe what the
  frame actually shows first, then evaluate against the named
  criteria — the studio's visual-qa-loop discipline, and the
  difference between its vision being an asset and a rubber
  stamp.
- Pair screenshots with the text they contain or the code that
  produced them; its document strength is image + text together.

## Context economy

The 1M window is shared by prompt, images, history, and tool
results — a few full-file dumps or long logs crowd out the task
itself. Summary in / raw out applies doubly: paths and line
ranges instead of whole files, big outputs to disk with the
path named in the summary that returns.

## Sources

- [NVIDIA model card (Hugging Face)](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16) — reasoning levels, sampling, input patterns, training stages.
- [Kilo blog: Nemotron 3.5 Super VL](https://blog.kilo.ai/p/nvidia-nemotron-35-super-vl) — Kilo-side controls (reasoning_effort, reasoning_budget, tool_choice), KiloBench 53% on an early build (Kilo-reported).
- [OpenRouter model page](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) — fallback route, tool/structured-output support.
- Local: `tools/model-reliability/roster.md` (Tier A entry),
  `tools/model-reliability/observed.jsonl` (2026-10-24/25
  sessions), and the independent-test caveat recorded
  2026-10-25.
