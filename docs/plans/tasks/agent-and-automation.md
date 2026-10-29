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
