---
tags:
  - ai
  - ai-agents
  - platform-atomic-chat
aliases:
  - Nemotron 3.5 Bolt E4B
  - Nemotron Bolt E4B 4GB
  - Local Agent Model Reference
cssclasses:
  - technical-guide
date: 2026-11-01
type: entity
---

# Nemotron 3.5 Bolt E4B 4GB — Local Agent Model Reference

Reference for working with **NVIDIA Nemotron 3.5 Bolt E4B 4GB**
(`nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M` on Atomic Chat, port 1337;
`nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB` upstream): 8B total / 4B
effective parameters, Gemma-4-E4B architecture, Q4_K_M quantization
(~4 GB VRAM), released 2026-10-23. This is the text-only conversational
agent model in the Nemotron 3.5 Bolt family — distinct from the
multimodal Bolt 74B-A9B 24GB (too large for 8 GB) and the 120B Super VL
(documented separately at [[nemotron-3-5-super-vl-prompting-2026]]).

Local standing: reached via Atomic Chat's OpenAI-compatible endpoint
(`http://127.0.0.1:1337/v1/chat/completions`), model id
`nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M`. It is Atomic Chat's only loaded
model, so it is the default local route for chat-class work when Ollama's
`qwen3.5:4b` is not preferred.

## What it is good for (NVIDIA-reported strengths)

Nemotron 3.5 Bolt E4B is post-trained from Gemma-4-E4B-it using
reinforcement learning only (RLVR + RLHF via NeMo-RL and NeMo-Gym;
no supervised fine-tuning). Training ran in both reasoning and
non-reasoning modes with verbosity control. NVIDIA's published figures
(Q4_K_M, measured on llama.cpp CUDA at batch size 1):

| Capability | Nemotron 3.5 Bolt E4B | Nemotron 3 Nano 4B | Qwen 3.5 4B | Gemma 4 E4B |
|---|---|---|---|---|
| AgentIF — complex agentic instructions | 25.8 | 20.1 | 20.4 | 21.9 |
| IFBench — precise output constraints | 63.8 | 60.1 | 58.9 | 42.8 |
| IHEval — instruction hierarchy / priority | 84.8 | 51.3 | 60.6 | 67.0 |
| InverseIFEval — counterintuitive instructions | 46.8 | 35.2 | 31.0 | 42.0 |
| StructEval-T — valid structured outputs | 80.4 | 63.5 | 76.0 | 79.3 |
| Tool use with changing state | 68.8 | 57.9 | 69.5 | 65.4 |
| When2Call-MT — call / clarify / abstain | 63.4 | 27.7 | 37.8 | 62.9 |
| RelyToolBench — tool grounding & hallucination | 63.2 | 41.2 | 43.3 | 61.6 |

Top score on 15 of 21 benchmarks against Gemma 4 E4B, Qwen3.5-4B, and
Nemotron 3 Nano 4B. ~40% higher average quality than the prior Nemotron
3 Nano 4B, and outputs up to ~80% fewer tokens vs peers (brevity
control trained in).

**The four things this model is built around:**

1. **Multi-turn tool use** — call application APIs across a
   conversation, with guidance for asynchronous tool calls. Strongest
   fit for agent orchestration where a cloud model routes work to local
   tools.
2. **Conversational mode** — a toggle for concise, speech-ready
   responses in natural back-and-forth interactions. Good for local
   voice assistants and interactive characters.
3. **Instruction following & input grounding** — follows precise output
   constraints and resists hallucinating tool calls (68.8% on tool use
   with changing state; 63.4% on when to call vs. clarify vs. abstain).
4. **Configurable reasoning** — reasoning and non-reasoning modes with a
   runtime thinking budget to cap latency under tight constraints.

**Deployment characteristics:**
- ~4 GB VRAM (Q4_K_M: 3.1–4.3 GB on RTX) — leaves headroom for speech
  and vision models alongside it on the 8 GB GTX 1070 Ti.
- 64K context window for history, tool definitions, and application
  state.
- DFlash speculative decoding available upstream (272.6 tokens/s on
  RTX 5070, 1.21× Gemma 4 E4B with MTP); local Atomic Chat serving
  does not expose this knob.
- 35 languages supported (base pre-trained on 140+ languages).

## Our measured performance on this machine

Two benchmarks were run locally on 2026-11-01 (see
`tools/model-reliability/run_threejs_benchmark.py` and
`tools/model-reliability/ab_measure.py`; outcomes logged to
`tools/model-reliability/observed.jsonl`):

**Chat A/B (turntable product description prompt):**

| Engine | Model | First token | Total | Result |
|---|---|---|---|---|
| Atomic Chat | Nemotron Bolt-E4B | 8,013 ms | 14,204 ms | Worked, 433 chars, no error |
| Ollama | qwen3.5:4b | 9,046 ms | 14,000 ms | Worked, empty content |
| Ollama | qwen3.5:4b (cold) | N/A | ~65,000 ms | Failed (cold start) |

Nemotron answered on the first try with no cold-start failures — a
contrast with qwen3.5:4b, which failed twice per engine before
succeeding once.

**Three.js scene generation benchmark (same contract as
[[ollama-benchmarks]]):**

| Rank | Model | Engine | Score | Latency | Chars | Lines |
|---|---|---|---|---|---|---|
| 1 | qwen3.5:4b | Ollama | 91 | 28.0s | 2,701 | 43 |
| 2 | llama3.2:3b | Ollama | 91 | 68.8s | 2,931 | 82 |
| 3 | **Nemotron Bolt-E4B** | Atomic Chat | **77** | **43.1s** | **1,361** | **43** |
| 4 | gemma4:e2b-it-qat | Ollama | 73 | 18.8s | 2,768 | 81 |

All models pass 12/13 validation rules; Nemotron ties at 77 (12/13) and
is the **most concise** output at 1,361 chars / 43 lines. Its latency
(43.1s) sits between qwen3.5:4b (fastest) and llama3.2:3b (slowest).

## When to route cloud models to it

Nemotron Bolt E4B is the local answer when a cloud model's output needs
to be executed or verified on-device:

- **Agent orchestration:** a cloud planner writes tool calls; Nemotron
  executes them locally with multi-turn tool use and input grounding.
- **Structured output validation:** 80.4% on StructEval-T makes it a
  good local checker for JSON/tool-call schemas produced by larger
  cloud models before they reach production.
- **Conversational refinement:** the conversational mode toggle suits
  speech-ready, concise replies for voice/character interfaces.
- **Low-VRAM sidecar:** at ~4 GB it co-resides with speech/vision
  models on the 8 GB card — useful when a cloud model delegates
  sub-tasks that must stay local.

## Reaching it from the cloud agent (Orion)

On 2026-11-01 the cloud-side route was built and verified end to end:

- Both machines sit on the owner's personal Tailscale tailnet — the
  rig as device `customrig`, the cloud agent's VM as device `muse`
  (client-only: it calls out, hosts nothing, accepts no connections).
- The path uses Atomic Chat's **Local network** bind (LAN/tailnet
  scope). Atomic's **Remote access** option — a public Cloudflare
  tunnel URL — was evaluated and deliberately not used; there is no
  port forwarding.
- API-key auth is enforced server-wide: an unauthenticated request
  through the tailnet returned 401 before any key was shared. The key
  is held by the cloud agent transiently (never written to this repo
  or any file) and is revocable at any time by regenerating it in
  Atomic Chat. The key matters beyond the tailnet: the home LAN is
  shared with other people.
- The path exists only while the rig is awake with Tailscale
  connected, Atomic Chat open with Local network started, and a model
  loaded — availability is owner-controlled by construction.
- Verified 2026-11-01: `GET /v1/models` over the tailnet returned
  exactly the model id above, and a test completion succeeded
  (~23 tok/s generation measured on the GTX 1070 Ti in a first small
  test).

## Calling it from an agent (API behavior)

Measured 2026-11-01 by the cloud agent through the tailnet route
above (9 probes; outcomes in `tools/model-reliability/observed.jsonl`).
These are the behaviors a programmatic caller actually meets — they
are not visible from the Atomic Chat UI:

- **Reasoning is on by default and rides in a separate field.** The
  response message carries `reasoning_content` (plan + worked steps)
  alongside `content` (final answer only). A one-token answer ("10")
  cost 177 completion tokens — roughly 176 of them hidden reasoning.
- **Tight token budgets return empty replies.** With `max_tokens` of
  60 and of 320, reasoning consumed the entire budget and `content`
  came back empty. Budget ~200+ tokens of headroom for reasoning on
  small tasks, or switch reasoning off deliberately (next bullet).
- **The reasoning toggle works over the API:**
  `chat_template_kwargs: {"enable_thinking": false}`. On the same
  prompt: 177 tokens / 5.6s with thinking on vs 19 tokens / 0.8s with
  it off — but the thinking-off answer was *wrong* (13.33 vs the
  correct 10; it divided by the drain rate alone). Rule: thinking ON
  for anything numeric or multi-step; OFF only for format/extraction
  work whose output gets mechanically validated anyway.
- **Prompt caching is active server-side** — usage reported cached
  prompt tokens on repeat-shaped requests, so the repo's
  stable-prefix convention pays off here too.
- **Instruction behavior, probed live:** stayed JSON-only against an
  embedded "SYSTEM OVERRIDE" instruction inside a document
  (hierarchy holds); asked for clarification on an ambiguous tool
  call (which report, which Sam, email address) instead of inventing
  values; produced an exactly schema-valid JSON object (keys, id
  format, enum, range); followed a counterintuitive reverse-sort +
  capitalization rule in substance (no spaces after its commas).
- **Exact counting is still a 4B limit:** asked for three 6-word
  bullets it produced 5/5/4 words, while satisfying the harder
  constraints (no repeated word anywhere; required terminal word).
  Validate counts, lengths, and arithmetic mechanically — do not
  trust the model to count.

## Failure modes and countermeasures

- **Reasoning starves small token budgets.** Default reasoning can
  consume an entire `max_tokens` budget and return empty content
  (observed at 60 and 320 tokens). Size budgets for the reasoning,
  or disable it explicitly — see §"Calling it from an agent".
- **Thinking-off is fast but sloppy.** `enable_thinking: false`
  cut one probe from 177 tokens / 5.6s to 19 tokens / 0.8s and
  flipped its arithmetic answer from correct to wrong. Never use
  it for numeric or multi-step work.
- **Not a reasoning powerhouse.** It is an instruction-following /
  tool-use model, not a deep-reasoning one. For planning and diagnosis
  that needs extended thinking, prefer a larger cloud model (Super VL
  via Kilo, or qwen3.5:9b via Ollama) and use Nemotron for execution.
- **English-only post-training.** NVIDIA post-trained in English only;
  multilingual capability (35 languages) is retained from the Gemma base
  but unmeasured here. Route non-English work to a multilingual model.
- **Single-loaded on Atomic Chat.** It is Atomic Chat's only model, so
  there is no local fallback if it is unloaded or fails. Ollama's
  `qwen3.5:4b` is the chat-class fallback; verify port 11434 before
  depending on it. As of 2026-11-01 Ollama binds 127.0.0.1 only, so
  the fallback is reachable from the rig itself but not over the
  tailnet (the owner is holding on exposing it; if that ever
  changes, bind the tailnet address rather than 0.0.0.0 — Ollama
  has no auth and the home LAN is shared).
- **Cold-start latency.** First-token times (~8s) reflect model load on
  this hardware. Keep it resident (set `keep_alive`) for interactive
  agent loops rather than loading/unloading per turn.

## Prompting patterns that match its training

- **Issue-brief shape:** problem statement, repo context, named files,
  acceptance criteria, report shape — the same structure that works for
  Nemotron 3.5 Super VL (see
  [[nemotron-3-5-super-vl-prompting-2026]] §"Structure that matches its
  training").
- **Deliverable-first ordering:** state the output artifact before the
  steps; give a call budget ("after ~N tool calls without a file write,
  report what you have or blocked").
- **Exact paths:** name file paths explicitly instead of "find the file
  that…" — each specified search saves the model from wandering.
- **Evidence required:** require raw command output, diffs, test
  summaries — never a summary claim alone. Add *report only what you
  measured*.
- **Conversational mode:** for short, speech-ready replies, add an
  instruction to be concise (the conversational mode toggle is upstream;
  locally, steer via prompt instruction).

## Related documents

- [[ollama-utilization-2026]] — installed model inventory, task → model
  routing, VRAM-aware scheduling for the 8GB workstation
- [[ollama-benchmarks]] — Three.js scene generation benchmark method
  and historical model scores
- [[nemotron-3-5-super-vl-prompting-2026]] — the 120B sibling; prompt
  patterns transfer to Bolt E4B
- [[integration-ollama]] — local LLM inference, tool calling, agent loop
  patterns
- [[ollama-prompting-2026]] — code-gen contracts, VRAM latency policy
- [[programmatic-tool-calling-2026]] — batch execution conventions
- [[tools/model-reliability/roster.md]] — trust tiers for all models
- [[tools/model-reliability/observed.jsonl]] — observed session
  outcomes, including this model's 2026-11-01 benchmark entries

## Sources

- [NVIDIA Nemotron 3.5 Bolt E4B 4GB page](https://research.nvidia.com/labs/nemotron/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB/) — release notes, benchmark table, training methodology.
- [Nemotron 3.5 Bolt E4B 4GB technical report (PDF)](https://research.nvidia.com/labs/nemotron/files/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB-Technical-Report.pdf) — abstract, multilingual evals, throughput (DFlash 272.6 tokens/s on RTX 5070).
- [NVIDIA blog: Nemotron 3.5 family expansion](https://blogs.nvidia.com/blog/nemotron-3-5-super-vl) — Bolt E4B positioned as the conversational-agent edge model (released 2026-10-23).
- [Hugging Face: Nemotron-3.5-Bolt-E4B-BF16](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16) — full-precision release, benchmark table vs Gemma 4 E4B / Qwen3.5 4B / Nemotron 3 Nano 4B.
- Local: `tools/model-reliability/observed.jsonl` (2026-11-01 chat
  A/B and Three.js benchmark entries),
  `tools/model-reliability/run_threejs_benchmark.py` (benchmark runner),
  `tools/model-reliability/ab_measure.py` (Ollama vs Atomic Chat A/B
  tool).
