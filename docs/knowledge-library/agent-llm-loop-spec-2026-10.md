---
tags:
  - ai
  - agent
  - documentation
aliases:
  - Agent LLM Loop Spec
cssclasses:
  - agent-guide
date: 2026-10-27
type: concept
---

# Agent LLM Loop Spec — Native Media AI Studio

**Status:** Proposed  
**Area:** Agent & Automation (T-AGT-01)  
**Source:** `docs/knowledge-library/custom-agent-design.md`  
**Next Actions:** `docs/plans/next-actions-2026-10.md` §6 (ACE-Step agent drive)  
**Last Updated:** 2026-10-27

## Purpose

Add an **LLM-driven decision loop** on top of the existing deterministic NMA agent pipeline. The LLM decides *which* pipeline operations to call and in what order, using tool-calling over `NMAApiClient`. The current agent (`packages/backend/app/agents/nma_agent.py`) is a deterministic pipeline with no model calls — this spec adds the model-driven layer.

## Driver

**First driver:** Qwen3.5-4B via Atomic Chat (`atomic_chat_url: http://127.0.0.1:1337`, `atomic_chat_enabled: true` per T-MOD-02).

Atomic Chat was selected because A/B measurement (T-MOD-01) showed it wins cold first-token latency (5,815ms vs 12,081ms for Ollama) — the critical metric for synchronous 4B callers per focus map §3.6.

## Tool Set

The LLM has access to `NMAApiClient` operations as tools. Each tool maps to one backend endpoint:

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `health` | `GET /api/health` | Check backend and adapter health |
| `audio_upload` | `POST /api/audio/upload` | Upload audio file |
| `audio_analyze` | `POST /api/audio/analysis` | Analyze audio (BPM, beats, sections, energy) |
| `audio_list` | `GET /api/outputs` | List all outputs |
| `music_gen_status` | `GET /api/music-gen/status` | Check ACE-Step service status |
| `music_gen_start` | `POST /api/music-gen/start` | Start ACE-Step generation service |
| `music_gen_generate` | `POST /api/music-gen/generate` | Generate music from style + lyrics |
| `music_gen_audio` | `GET /api/audio/file/{name}` | Get playable audio URL |
| `remix_list` | `GET /api/audio/remix/` | List existing remixes |
| `remix_preview` | `POST /api/audio/remix/preview` | Preview a mashup recipe |
| `remix_build` | `POST /api/audio/remix/build` | Build a remix from stems |
| `remix_enhance` | `POST /api/audio/remix/{name}/enhance` | Master a remix |
| `media_list` | `GET /api/outputs` | List media files |

## Decision Loop

```
loop:
  1. LLM receives current state + available tools
  2. LLM decides next action (or none, if done)
  3. LLM issues tool call(s)
  4. System executes tool via NMAApiClient
  5. Result fed back to LLM as observation
  6. Repeat until goal reached or max iterations exceeded
```

### Iteration cap

Max 12 iterations per track. Prevents infinite loops on model error or confusion.

### Goal-driven, not step-driven

The LLM receives a high-level goal (e.g., "analyze this track and build a remix") rather than a fixed step list. The LLM chooses the order and which operations to call.

## Failure and Fallback Behavior

### Atomic Chat failure → Ollama fallback

The Ollama adapter already implements this: if Atomic Chat raises, the adapter catches the exception and falls back to native Ollama (`adapters/ollama.py:588-589`). No agent-level change needed.

### `atomic_chat_enabled: false`

When the flag is `false` (config/ports.json), `_use_atomic_chat()` returns `False` and all calls go directly to Ollama. The LLM loop is unaware of which backend serves it — the adapter handles routing transparently.

### Tool call failure

If a tool call returns an error:
1. LLM receives the error as an observation
2. LLM may retry with corrected parameters, try a different tool, or abort
3. After 3 consecutive failed iterations on the same track, the loop aborts and returns a partial result with errors logged

### Max iterations exceeded

If the loop reaches 12 iterations without completing the goal, it aborts and returns a partial result. This prevents runaway model calls.

### Model unresponsive

If the model doesn't respond within 300s (per-request timeout), the loop aborts with a timeout error.

## State Management

State is persisted to `output/agent-state/{session_id}.json` via `AgentState` (existing). New fields added for the LLM loop:

| Field | Type | Description |
|-------|------|-------------|
| `llm_driver` | string | `"atomic_chat"` or `"ollama"` — which backend served the model |
| `llm_iterations` | integer | Number of LLM iterations performed |
| `llm_tool_calls` | array | List of `{tool, args, result, error}` entries |
| `llm_aborted` | boolean | True if the loop aborted before completion |

## Acceptance Test (T-AGT-02)

**One track driven analyze → plan by model tool-calls, timed against the Ollama path.**

1. Select a track with existing analysis data
2. Run the LLM loop: goal = "analyze this track and preview a remix"
3. Measure: time to first tool call, total wall time, iterations used
4. Run the same goal through the deterministic pipeline (no LLM) on the same track
5. Compare: both should produce a valid remix preview; LLM path may use different tool ordering but must reach the same outcome

**Success criteria:**
- LLM loop completes within 12 iterations
- Remix preview is returned with valid WAV output path
- Total wall time within 2x of deterministic path
- No silent fallback confusion (llm_driver field correctly records which backend served)

## Files

| File | Change |
|------|--------|
| `packages/backend/app/agents/nma_agent.py` | Add `run_llm_loop()` method: goal-driven tool-calling loop over NMAApiClient |
| `packages/backend/app/agents/agent_state.py` | Add `llm_driver`, `llm_iterations`, `llm_tool_calls`, `llm_aborted` fields |
| `docs/knowledge-library/custom-agent-design.md` | Reference this spec from the agent overview |

## Non-Goals (v1)

- Multi-turn conversation with the user (single-shot goal only)
- Model self-critique / refinement loop
- Parallel tool calls (sequential only)
- Video rendering (pipeline stops at remix preview)
