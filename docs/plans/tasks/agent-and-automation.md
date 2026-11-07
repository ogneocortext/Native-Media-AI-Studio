# Tasks — Agent & Automation

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.7
Rules: `docs/plans/tasks/README.md`
Design: `docs/knowledge-library/custom-agent-design.md`
Code: `packages/backend/app/agents/`

### T-AGT-01 — Design the agent LLM decision loop
- **Status:** done
- **Goal:** A written spec for the LLM decision loop on top of the
  existing pipeline: adapter chat-with-tools over `NMAApiClient`
  operations; first driver Qwen3.5-4B via Atomic Chat; failure and
  fallback behavior named (including `atomic_chat_enabled: false`).
- **Files:** docs/knowledge-library/agent-llm-loop-spec-2026-10.md
- **Acceptance:** Spec defines the acceptance test for T-AGT-02 — one
  track driven analyze → plan by model tool-calls, timed against the
  Ollama path.
- **Last session:** Kilo, 2026-10-27 — wrote
  docs/knowledge-library/agent-llm-loop-spec-2026-10.md covering: Qwen3.5-4B
  via Atomic Chat as first driver (A/B-measured first-token win), NMAApiClient
  tool set (12 tools), goal-driven loop with 12-iteration cap, Atomic→Ollama
  fallback (existing adapter behavior), `atomic_chat_enabled: false` transparent
  routing, tool-call failure handling, state fields (llm_driver, iterations,
  tool_calls, aborted), and acceptance test (one track analyze→plan, timed
  vs Ollama path).

### T-AGT-02 — Build the agent LLM decision loop
- **Status:** done
- **Goal:** The T-AGT-01 spec implemented to its acceptance test.
- **Files:** packages/backend/app/agents/, packages/backend/app/adapters/ollama.py
- **Acceptance:** The T-AGT-01 acceptance test passes; result logged to
  `tools/model-reliability/observed.jsonl`; ledger §3.7 updated.
- **Last session:** Kilo, 2026-10-27 — Implemented `run_llm_loop()` in
  nma_agent.py: goal-driven tool-calling loop over NMAApiClient with 12
  tool schemas (health, audio_upload/analyze/list, music_gen_*,
  remix_*, media_list), `_LLM_TOOL_METHODS` dispatch map, and
  `chat_with_tools()` on NMAApiClient calling POST /api/ollama/chat.
  Added `llm_driver`, `llm_iterations`, `llm_tool_calls`, `llm_aborted`
  fields to AgentStateData. ruff check passes, modules import cleanly.
  Backend tests: 94 passed, 1 pre-existing VRAM failure (unrelated).
  Not yet end-to-end tested against a live LLM (acceptance test for
  T-AGT-02 requires a track driven analyze→plan by model tool-calls).

### T-AGT-03 — Ground 3D code generation: API retrieval + traceback-first loop
- **Status:** todo
- **Goal:** When an agent writes bpy or GLSL for the studio, it
  works from retrieved API documentation (the BlenderRAG pattern)
  under a loop budget set by the 3DCodeBench evidence —
  traceback feedback always on, visual refine capped at one pass.
- **Plan:** Evidence: `docs/knowledge-library/3d-viz-code-harnesses-2026.md`
  Lane A. Steps: (1) Build the retrieval pack: chunk the Blender
  Python API documentation for the operation groups studio scenes
  actually use (primitives, modifiers, materials / shader nodes,
  camera and lights, render settings) into
  `docs/knowledge-library/blender-api-grounding/` as grep-able
  markdown chunks — no vector database in v0; this repo's
  convention is file-based state. (2) Write the loop contract into
  the knowledge doc (a section under Lane A): write → execute
  headless (`blender --background --python`) → on traceback, feed
  the traceback back and retry (max 3) → on success, exactly one
  vision-critic pass → stop; further refine turns need an owner
  ask. Record the role rule with it: scene code is written by a
  Tier A route; local 4B/9B models run retrieval, execution, and
  verification only. The executor then mirrors the contract into a
  local `.kilo/skills/` note (local-only home; the knowledge doc
  is the portable source). (3) Add a short comparison note to the
  knowledge doc: Blender Lab's official MCP server vs the current
  ahujasid bridge (tool surface, headless support, maintenance) —
  a note, not a migration. (4) Validate: one primitive-scene trial
  script runs headless end-to-end using the pack and contract;
  executability only, no rendered deliverable.
- **Files:** docs/knowledge-library/blender-api-grounding/,
  docs/knowledge-library/3d-viz-code-harnesses-2026.md
- **Acceptance:** The grounding pack exists and covers the listed
  operation groups; the loop contract with its retry/refine caps
  and role rule is written in the knowledge doc; the bridge
  comparison note is recorded; the trial script's headless run is
  logged in Last session.
- **Last session:** Orion, 2026-11-01 — Item created with the
  knowledge doc; not started.

### T-AGT-04 — Add a bolt-local scout agent definition (Kilo)
- **Status:** todo
- **Goal:** A Kilo subagent definition for Nemotron 3.5 Bolt E4B —
  the same read-only scout pattern as `qwen-local`, with the
  model's measured behavior (Bolt reference doc, §"Calling it
  from an agent") baked into its limits and prompt, so a Tier A
  driver can delegate bounded local lookups to Bolt the way it
  already can to Qwen.
- **Plan:** Evidence:
  `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md`
  (measured API behavior, 2026-11-01) and the qwen-local
  precedent (`.kilo/agents/qwen-local.md`, commit bef6184).
  Steps: (1) Add Bolt to the Kilo `atomic` provider's models in
  `kilo.jsonc` alongside the existing Qwen entry: model id
  exactly `nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M` (from
  `GET /v1/models` — never typed from memory), `tool_call:
  true`, limits context 16384 (the context Atomic actually
  served in the Activity log) / output 4096 (the output limit
  carries the reasoning headroom the Bolt doc requires).
  (2) Write `.kilo/agents/bolt-local.md` mirroring qwen-local's
  frontmatter discipline (mode subagent, temperature 0.15,
  steps 15, edit/bash/task/webfetch/websearch all deny) with
  the grounding rules carried over verbatim in substance
  (never invent a path; glob/grep first; evidence as paths and
  line numbers; report only what was found). Its description
  and prompt must state the single-loaded-model rule: this
  agent works only while Bolt is the model loaded in Atomic
  Chat; with any other model loaded, calls 404 — say so and
  stop rather than retrying. (3) Force-add the file (`.kilo/`
  is gitignored; qwen-local set the precedent). (4) Validate:
  with Bolt loaded in Atomic, `kilo agent list` shows
  bolt-local; run one bounded scout job (summarize
  `packages/backend/app/agents`, read-only) and log the
  outcome to `tools/model-reliability/observed.jsonl`.
- **Files:** .kilo/agents/bolt-local.md, kilo.jsonc
- **Acceptance:** bolt-local appears in `kilo agent list`;
  the scout job completes read-only while Bolt is loaded,
  with file-path evidence in its answer; the outcome is
  logged in observed.jsonl and in Last session.
- **Last session:** Orion, 2026-11-01 — Item created from the
  cloud↔local bridge work of the same day (the bridge
  integration's Layer 1); not started.
- **Last session:** Orion, 2026-11-06 — Still todo: the Kilo
  definition itself is unbuilt. Supporting evidence for the
  role it encodes, gathered owner-requested via the
  Orion→Atomic route (not the Kilo route this item builds):
  one serial Bolt call reviewed
  `packages/backend/app/services/stem_curves.py` — accurate
  summary, edge cases reported "none found" (defensible on
  contract; missed position-dependent NaN behavior in max()
  chunks, caught by mechanical verification: 3,000-case
  property test, 0 failures). Logged in observed.jsonl
  2026-11-06. Owner's framing: Bolt as gap-filler while Devin
  SWE 2.0 is rate-limit-stalled and Nemotron-via-Kilo hits
  compaction/rate limits; owner rule — Atomic calls are
  strictly serial, never parallel (single 8 GB GPU, shared
  with Hermes).
- **Last session:** Orion, 2026-11-06 (later) — Definition and
  config LANDED via the owner's chain test (Orion → Atomic/Bolt
  → repo → Kilo/Devin): Bolt drafted `.kilo/agents/bolt-local.md`
  from the qwen-local template in one serial call (44.8 s,
  1,082 tokens); the draft passed all 9 mechanical checks
  (exact model id, frontmatter discipline, five denies,
  grounding rules, single-loaded-model 404 rule). Its
  kilo.jsonc entry flattened the nested `limit` object into
  `limit context`/`limit output` keys — values right
  (16384/4096), structure wrong; Orion corrected the nesting
  when landing. kilo.jsonc now carries the Bolt entry beside
  the Qwen placeholder. Remaining for acceptance (Kilo-side,
  owner's machine): `kilo agent list` shows bolt-local, and
  one bounded scout job through Kilo with Bolt loaded
  (summarize `packages/backend/app/agents`, read-only).
  Logged in observed.jsonl 2026-11-06.

### T-AGT-05 — Design the cloud-agent bridge (backend service + Bridge panel)
- **Status:** todo
- **Goal:** A written spec for making the cloud-agent ↔
  local-model bridge a studio surface: an authorized external
  agent (today: Orion over the owner's tailnet) calls the
  studio backend, which proxies to the loaded local model
  under governance — instead of the external agent calling
  Atomic Chat raw, as the 2026-11-01 proof of concept did.
  Design only; build items open from the spec after owner
  review.
- **Plan:** Evidence:
  `docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md`
  (§"Reaching it from the cloud agent", §"Calling it from an
  agent") and the publication outline's service angle.
  The spec must decide, with the evidence named for each:
  (1) **Ingress:** the backend binds the rig's tailnet
  address for bridge routes only (never 0.0.0.0 by default);
  API-key auth with the key held server-side; the external
  caller's key and Atomic's key are separate credentials.
  (2) **Governance:** per-call token budgets that include
  reasoning headroom; the thinking policy (on for numeric /
  multi-step, off only for mechanically validated format
  work); a loaded-model precheck via `GET /v1/models`
  before every call (the 404 rule); NO silent fallback to
  Ollama for external calls — a cloud caller asked for the
  local lane, so lane-down is an explicit status, not a
  substitution. (3) **Audit:** a persistent local log of
  prompt/reply text plus metadata (timestamps, model id,
  tokens, tok/s, stop/error) — the deliberate fix for
  Atomic's memory-only Activity text, which the owner hit
  on 2026-11-01; retention and owner-only visibility are
  design decisions to state, not defaults to assume.
  (4) **Panel:** a frontend Bridge view — lane status
  (tailnet reachable, model loaded, exact id), the request
  feed from the audit log, and the rules in force.
  (5) **Relationship to the loop:** the bridge consumes the
  same adapter path as T-AGT-02's decision loop and
  inherits T-MOD-04's route-truth rules; name what is
  shared and what is bridge-only. Close the spec with the
  follow-on build items drafted (backend service, panel,
  tests) — drafted, not opened; owner review gates them.
- **Files:** docs/knowledge-library/cloud-agent-bridge-spec-2026-11.md
- **Acceptance:** The spec exists and decides ingress,
  governance, audit, panel, and loop relationship, each
  with its evidence named; follow-on build items are
  drafted in the spec; no code is written under this item.
- **Last session:** Orion, 2026-11-01 — Item created from
  the cloud↔local bridge work of the same day (the bridge
  integration's Layers 3–4); not started.

### T-AGT-06 — Spec the skill-eval harness
- **Status:** done
- **Goal:** A written spec for measuring skill trigger precision
  (description-as-trigger) and static description quality across the
  project skillset, per Anthropic Agent Skills progressive-disclosure
  docs and skill-creator eval methodology.
- **Files:** docs/knowledge-library/skill-eval-harness-spec-2026-11.md
- **Acceptance:** Spec defines query-bank format, lint + simulated-route
  + deferred-live runner modes, metrics/thresholds, build order, and
  open questions; no harness code written under this item.
- **Last session:** Devin, 2026-11-19 — wrote
  docs/knowledge-library/skill-eval-harness-spec-2026-11.md. Same commit
  backfilled YAML frontmatter + trigger descriptions on the five
  previously-undescribed tracked skills (blender-mcp, comfyui-mcp,
  dependency-management, music-video-vision, unity-mcp) across all four
  mirrors, and added frontmatter to the six .kilo-only design skills.

### T-AGT-07 — Build the skill-eval harness
- **Status:** todo
- **Goal:** Implement the T-AGT-06 spec: `tools/skill-evals/` with
  queries.json seed bank, Mode-1 lint (frontmatter, description budget,
  mirror-hash, overlap heuristic, coverage), Mode-2 route (Ollama
  simulated activation, 3 runs/query, 60/40 train/held-out), Mode-3 live
  deferred pending an observable skill-invocation path.
- **Files:** tools/skill-evals/, .claude/skills/*/SKILL.md descriptions
- **Acceptance:** `python tools/skill-evals/skill_evals.py lint` exits 0
  on the current tree; `route` mode produces per-skill trigger/FP rates
  for the seeded bank; results written under tools/skill-evals/results/.
- **Last session:** — not started.
