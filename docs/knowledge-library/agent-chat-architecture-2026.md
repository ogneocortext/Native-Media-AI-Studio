---
tags:
  - ai
  - agent
  - architecture
  - documentation
  - Agent Chat Architecture
aliases:
  - Agent Chat Architecture 2026
  - AgentChat Pipeline
cssclasses:
  - documentation
  - technical-guide
date: 2026-11-06
type: concept
---

# Agent Chat Architecture — Native Media AI Studio (2026-11-06)

> How the in-app agent chat works end to end: skill discovery, tool
definition conversion, the streaming tool-execution loop, SSE event
protocol, and the fallback heuristics that keep small local models
reliable. Verified against source, not just docs.

## Components

| Layer | File | Role |
|---|---|---|
| Chat UI (agent) | `packages/frontend/src/features/agent-chat/AgentChat.tsx` | Skill discovery, tool-def conversion, message rendering, inline media |
| Chat UI (plain) | `packages/frontend/src/features/ollama-chat/OllamaChat.tsx` | Simpler chat surface over the same stream parser |
| API client | `packages/frontend/src/services/api/ollama.ts` | `ollamaChatStream()` + `parseOllamaStream()` async generator |
| Chat endpoint | `packages/backend/app/api/integrations_generation.py` → `POST /api/integrations/ollama/chat` | Adapter selection, tool normalization, SSE event loop |
| Skills API | `packages/backend/app/api/mcp_skills.py` | `GET /api/mcp/skills/list|get|/{skill}/{path}`, `POST /api/mcp/execute-tool` |
| Skills content | `tools/mcp/skills/<name>/SKILL.md` | `audio`, `blender`, `comfyui`, `context`, `remix`, `vision` |
| LLM adapters | `packages/backend/app/adapters/` (`ollama`, `atomic-chat`) | `adapter.chat()` streams Ollama `/api/chat` deltas; `execute_tool_call` runs backend tools |
| Sub-agent (separate) | `packages/backend/app/api/sub_agent.py` | `POST /api/sub-agent/run` + `GET /stream/{task_id}` — ReAct loop, **not** the chat path |

## Request flow

1. **Skill discovery** — `AgentChat` calls `GET /api/mcp/skills/list` on
   mount and again at submit time if the cache is empty. `_discover_skills()`
   scans `tools/mcp/skills/*/SKILL.md`, parses YAML frontmatter
   (name/description/version/server/tools/tags) and lists `references/*.md`
   as resources. Skills dir resolution tries `PROJECT_ROOT`-relative and
   absolute candidates — the backend can run from different cwds.
2. **Tool conversion** — each skill becomes an Ollama tool definition and
   is passed as `tools` on the chat request.
3. **Chat request** — `POST /api/integrations/ollama/chat` with
   `{message, model, history, think, stream: true, max_tool_calls: 5,
   options, system, tools}`.
4. **Adapter selection** — `config.atomic_chat_enabled` routes through the
   `atomic-chat` adapter (Qwen) when healthy, else falls back to `ollama`
   (default `gemma4:e2b-it-qat`). Tool *execution* always goes through the
   `ollama` adapter regardless — tools are backend operations, not model
   operations.
5. **SSE stream** — `EventSourceResponse` yields typed events (below).
   The backend runs the tool loop itself: model emits `tool_calls` →
   backend executes via `tool_adapter.execute_tool_call` → appends
   assistant+tool messages → re-invokes the model — up to
   `max_tool_calls` (default 5).

## SSE event protocol

| event | data | meaning |
|---|---|---|
| `connected` | `{status:"streaming"}` | stream open |
| `content` | `{content, thinking}` | streamed deltas; `thinking` sets `saw_thinking` |
| `tool_calls` | `{tool_calls:[{name, arguments}]}` | model requested tool(s); backend executes immediately |
| `tool_result` | `{name, result}` | `ExecuteToolResponse`-shaped `{success, result|error}` — frontend renders media inline from `result` |
| `done` | `{content, model, tool_calls}` on completion chunk, or `{status:"complete"}` when the loop exhausts | final answer; `content` is the accumulated stream, not the (empty) done-chunk |
| `error` | `{message, model}` | no-response guard or failure |

Client side, `parseOllamaStream()` yields these as an async iterable;
`AgentChat` switches on `event.type` (`connected`/`content`/`tool_calls`/
`tool_result`/`done`/`error`).

## Reliability heuristics (measured, keep them)

- **Tool_calls arrive in non-done chunks** on Ollama 0.40.2 — handled
  wherever they appear so calls are never dropped.
- **Auto system prompt**: when tools are sent without a `system` prompt,
  the backend injects one listing every callable tool — a vague prompt +
  several tools otherwise produces hundreds of thinking tokens and zero
  output (measured on gemma4:e2b-it-qat).
- **Single-tool narrowing**: if the user message literally names exactly
  one registered tool, `tools` is narrowed to it.
- **Named-tool text fallback**: if the model *describes* a tool instead
  of calling it and produces no content, the backend executes the single
  explicitly-named tool once (`fallback_executed` guard prevents
  double-execution). `depth=N` in the message maps to `args.depth`
  (capped at 6).
- **No-response guard**: empty final content + zero tool calls →
  `error` event with a rephrase hint (distinguishes "thought but no
  answer" via `saw_thinking`).

## Skills ↔ tools

`POST /api/mcp/execute-tool` dispatches by `tool_name` — observed names
include `list_audio_library`, `analyze_audio`, `create_music_video_plan`,
`generate_image`, `generate_video`, `analyze_image`, `suggest_3d_prompt`,
`generate_3d_concept`, `plan_blender_script`, `remix_list_sources`,
`remix_probe`, `remix_from_prompt` (list is non-exhaustive — read the
`elif` chain in `mcp_skills.py` for the live set). Skill `SKILL.md`
files are also fetchable as resources (`skill://<name>/SKILL.md`,
`skill://<name>/references/<file>.md`) so the model can read usage docs
on demand.

## AgentChat UI specifics

- `SKILL_LABELS` maps skill names to friendly labels ("Image Generation",
  "3D Rendering", "Audio Analysis", "Visual Analysis", "Remix / Mashup",
  "Context Search") with a title-case fallback.
- Tool results carrying image/video paths render **inline** in the
  message stream (`IMAGE_EXTENSIONS`/`VIDEO_EXTENSIONS` sniffing).
- Collapsible "About this agent" panel explains the skill/tool loop.
- `handleRetry` re-populates the input with the last user message for
  tool-call retries (user WIP area — verify before relying on details).

## Related

- [[custom-agent-design]] — agent design notes
- [[agent-llm-loop-spec-2026-10]] — LLM decision-loop spec over `NMAApiClient`
- [[programmatic-tool-calling-2026]] — PTC patterns from Factory Droid
- [[mcp-contracts-2026]] — canonical tool schemas
- [[integration-ollama]] — Ollama adapter details
- `app/api/sub_agent.py` — separate task/ReAct API (`/api/sub-agent/run` + SSE), do not confuse with the chat path
