---
tags:
  - ai
  - ai-agents
aliases:
  - Local Model Operating Brief
  - The Operating Brief Method
cssclasses:
  - technical-guide
date: 2026-11-06
type: concept
---

# The Local-Model Operating Brief — Making a Small Model Work Like an Agent

**The problem this solves.** A small local model (the 4B–9B class this
studio runs) has weak instincts about what a *session* should look like.
Given a bare question, it pattern-matches the immediate ask and returns
a plausible-shaped answer — fluent, mostly right, with invented details
mixed in and no forward motion. The failure is silent: nothing looks
broken, the output just quietly reverts to filler. This studio has
re-derived the cure three times — the studio agent loop's invented
folders (diagnosed 2026-10-28), Bolt E4B's measured behavior rules
(2026-11-01), and the Atomic Chat repo-analyst brief (2026-11-06).
This document is the method, written down once, so nobody has to
re-derive it a fourth time.

**The claim.** Behavior = weights × brief × sampling. The weights are
fixed at download time; the other two factors are free and immediate.
Adequate on all three, a 4B does bounded agent work reliably.
Neglecting any one of them reads as "the model is weak" when the
model was never the binding constraint.

## The method — six parts, all load-bearing

An operating brief is a system prompt with six parts. Each part maps
to an observed failure when absent:

1. **A named role.** One sentence: who the model is in this session
   and what surface it serves ("repo analyst for Native Media AI
   Studio"). Without it, the model defaults to generic-assistant
   behavior — summaries, hedging, option menus.
2. **A grounding contract.** Only mention a file, path, or line
   number a tool returned *in this session*; never invent a
   plausible path; look before answering (read the governing docs
   first); label inference as inference. Without it: invented
   folders and confident false specifics — the single most common
   small-model failure in this studio's records.
3. **An output contract.** A fixed shape for work answers (here:
   Findings with evidence → Why it matters → Next action). Without
   it, answers arrive in whatever shape the prompt's wording hints
   at, and quality varies turn to turn.
4. **A stopping rule.** Exactly one specific next action, never a
   menu, never "let me know what you'd like." Without it, sessions
   end in summaries and the work does not advance — a scan or a
   suggestion list is not a result.
5. **Sampling discipline.** For tool-using factual work:
   temperature 0.15–0.3 (0.15 for unattended subagent scouts, 0.3
   for interactive analysis), top-p ~0.9, **frequency and presence
   penalties at 0**, repeat penalty light (~1.05). Repo work *is*
   repeated tokens — paths, identifiers, tool syntax, fixed output
   headers — and frequency/presence penalties punish exactly that.
   Use one anti-loop mechanism (the repeat penalty), never three
   stacked.
6. **Verification behind the output.** The brief makes output
   *checkable* (paths, line numbers, quoted evidence), and something
   actually checks it: a mechanical test, a schema validation, a
   read-back against the repo. The model's self-report — including
   whether it has tools, ran a command, or found nothing — is its
   least reliable output class. A "none found" from a small model is
   a claim to verify, not a conclusion.

## Injection surfaces — one brief, four wrappers

The brief is wrapper-agnostic; every surface in this studio exposes
the same injection point, differing in visibility, not capability:

- **Raw API** — a `system` message in the chat payload (Ollama
  `/api/chat` and OpenAI-compatible servers alike, including Atomic
  Chat's `:1337/v1`).
- **Ollama Modelfile** — a baked-in `SYSTEM` instruction makes the
  brief a property of a custom model, present on every call.
- **Atomic Chat** — a custom assistant's system prompt plus its Run
  settings panel (temperature/penalties as UI controls). The most
  discoverable surface; the one used for the analyst brief below.
- **Kilo agent definitions** — `.kilo/agents/*.md`: frontmatter
  carries mode, model, temperature, step cap, and permission denies;
  the body is the brief. This is how `qwen-local` works and how
  `bolt-local` (landed 2026-11-06, T-AGT-04) was built — Bolt
  drafted its own definition from the sibling template, to spec.

## Evidence — same weights, same tools, brief as the only delta

2026-11-06, Bolt E4B in Atomic Chat with a filesystem MCP rooted at
this repo and Exa search connected:

- **Before the brief** (default assistant prompt, chat sampling:
  temperature 0.7, penalties 0.7/0.7/1.12): asked to summarize the
  repo's `tools/` directory, it returned 16 named entries of which
  2 — `bin/` and `config/` — do not exist. Fluent, plausible,
  wrong in the specific.
- **After the brief** (the six parts above, repo root pinned in the
  prompt, sampling per part 5): two consecutive answers verified
  claim-by-claim against the repo with zero fabrications — the
  AGENTS.md PowerShell-7 rule and command-sheet requirement, and
  T-PLT-34's status; then the TripoSR integration (T-PLT-33),
  including the node-class chain confirmed in
  `packages/backend/app/services/gen3d/gen3d_service.py:224`.
  Asked "are you familiar with TripoSR?" — a question that invites
  a generic answer — it went to the repo and answered about *this*
  integration, source named.
- **The drafting unit, same day** (Orion → Atomic API → repo):
  Bolt drafted `bolt-local.md` to a written spec; the file passed
  9/9 mechanical checks as drafted. Its companion JSON snippet had
  every value right and one structural error (a flattened `limit`
  object) — caught by the schema check at landing, which is part 6
  of the method doing its job, not an exception to it.

Full session records: `tools/model-reliability/observed.jsonl`
(2026-11-06 entries).

## The fill-in skeleton

Copy, replace the bracketed parts, keep it short — a brief a 4B can
hold is a brief that gets followed:

```text
You are [role] for [project]. You run locally ([model]) and work
through tools: [tool surfaces].

GROUNDING — never break these:
- [Absolute root/path facts the model cannot discover on its own.]
- Only mention a file, folder, or line number if a tool returned it
  in this session. Never invent a plausible path. If a tool finds
  nothing, say so.
- Before any substantive answer, read [governing docs] first.
- Mark the difference: "read in <path>" vs "inferred".

HOW TO WORK:
- One tool call at a time. Verify each result before the next call.
- [Domain tools and when to use each.]

OUTPUT — every work answer ends with:
1. Findings: the evidence, with paths and line numbers.
2. Why it matters: one or two concrete sentences.
3. Next action: exactly ONE specific action, with a one-line reason.
   Never a menu, never "let me know what you'd like."

LIMITS YOU STATE PLAINLY:
- [What this surface cannot do; honesty rules for errors.]
- Counts and totals from you are estimates until verified.
- Keep answers tight. No praise, no preamble.
```

## Related documents

- [[nemotron-3-5-bolt-e4b-2026]] — the model reference this method
  was proven on; its behavior rules are part 2 and part 5 in
  model-specific form
- [[ollama-prompting-2026]] — code-gen contracts and prompting for
  the Ollama route
- [[nemotron-3-5-super-vl-prompting-2026]] — the same discipline
  applied to the large sibling via Kilo
- [[custom-agent-design]] — agent architecture the briefs plug into
- `tools/model-reliability/roster.md` — trust tiers: which models
  may hold which lane, brief or no brief
- [[stable-diffusion-local-models-2026]]:see-also — Repo-local SD 1.5 + AnimateDiff (4.75 GB)
- [[tools-checkpoints-models-2026]]:see-also — ACE-Step, Qwen3, shared VAE (13.8 GB)
- [[runtime-models-2026]]:see-also — Text encoder, VAE approx, voice TTS (0.09 GB)
- [[comfyui-workflows]]:see-also — Main ComfyUI inventory (131.9 GB)
- [[hardware-verified-models]]:see-also — VRAM tier list for 8 GB GPU
