# Tasks — Agent & Automation

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.7
Rules: `docs/plans/tasks/README.md`
Design: `docs/knowledge-library/custom-agent-design.md`
Code: `packages/backend/app/agents/`

### T-AGT-01 — Spec the agent LLM loop
- **Status:** todo
- **Goal:** A written spec for the LLM decision loop on top of the
  existing pipeline: adapter chat-with-tools over `NMAApiClient`
  operations; first driver Qwen3.5-4B via Atomic Chat; failure and
  fallback behavior named (including `atomic_chat_enabled: false`).
- **Files:** docs/knowledge-library/custom-agent-design.md (extend) or a
  new design article
- **Acceptance:** Spec defines the acceptance test for T-AGT-02 — one
  track driven analyze → plan by model tool-calls, timed against the
  Ollama path.
- **Last session:** Orion's static review 2026-10-25: current agent is a
  deterministic pipeline with no model call anywhere; the adapter
  already forwards tools to Atomic.

### T-AGT-02 — Implement the LLM loop skeleton
- **Status:** todo
- **Goal:** The T-AGT-01 spec implemented to its acceptance test.
- **Files:** packages/backend/app/agents/, packages/backend/app/adapters/ollama.py
- **Acceptance:** The T-AGT-01 acceptance test passes; result logged to
  `tools/model-reliability/observed.jsonl`; ledger §3.7 updated.
- **Last session:** —
