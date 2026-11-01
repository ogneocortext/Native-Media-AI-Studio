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
