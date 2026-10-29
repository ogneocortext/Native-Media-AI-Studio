# Subagent Layer Architecture

> **Last Updated:** 2026-10-29
> **Status:** Active
> **Purpose:** Document the architecture and design decisions for the local Qwen sub-agent system

## Overview

The subagent layer provides a local autonomous agent that can execute tools (read files, search code, run gates/tests, execute commands) to help review, fix, and improve the codebase. It consists of:

1. **Backend API** (`packages/backend/app/api/sub_agent.py`) - REST + SSE endpoints
2. **Frontend UI** (`packages/frontend/src/features/sub-agent/SubAgentChat.tsx`) - Chat interface
3. **Agent Harness** (`tools/qwen_subagent/`) - ReAct loop with tool definitions
4. **Model Reliability** (`tools/model-reliability/`) - Session outcome tracking

## Architecture Decisions

### D1: SSE vs Polling

**Decision:** Use Server-Sent Events (SSE) for real-time streaming instead of HTTP polling.

**Rationale:**
- SSE provides true server-to-client push with automatic reconnection
- Lower latency: events stream immediately vs 2s polling interval
- Browser-native: EventSource API is built-in and reliable
- Better for long-running tasks: no need to poll at fixed intervals

**Why polling was originally used:**
- Early concerns about React StrictMode remounting and CORS preflight
- Vite dev-proxy buffering issues with long-lived streams

**Resolution:**
- SSE is implemented properly with event-specific listeners
- Frontend cleans up EventSource on unmount
- EventSource automatically handles reconnection

### D2: Task Cancellation

**Decision:** Implement task cancellation via `POST /api/sub-agent/cancel/{task_id}`.

**Rationale:**
- Users need ability to stop long-running agent tasks
- Cancel button was present in UI but had no backend support
- Graceful cancellation prevents resource waste

**Implementation:**
- Backend sets `cancelled` flag in task store
- Agent coroutine checks flag before starting and after completion
- SSE sends `agent_cancelled` event to notify frontend
- Frontend closes EventSource and updates UI

### D3: Event Type Mapping

**Decision:** Standardize SSE event types between backend and frontend.

**Event Types:**
- `agent_output` - Agent iteration/tool result text
- `agent_done` - Task completed successfully
- `agent_error` - Task failed with error
- `agent_cancelled` - Task cancelled by user

**Rationale:**
- Previous implementation had mismatched event types
- Frontend was polling with incorrect type mapping
- Clear, typed events prevent confusion

### D4: Model Reliability Logging

**Decision:** Log every subagent session outcome to `tools/model-reliability/observed.jsonl`.

**Rationale:**
- Per AGENTS.md D21: append one line per session to observed.jsonl
- This is the only handoff state a new agent cannot rebuild
- Enables `score.py` to rank models by actual performance
- Follows project's reliability tracking pattern

**Implementation:**
- `_log_session_outcome()` function writes JSONL entries
- Logs on both success and failure
- Uses `utf-8-sig` encoding to handle BOM (see score.py)
- Non-blocking: logging failures don't break the endpoint

**Entry Format:**
```json
{
  "date": "2026-10-29",
  "model": "qwen3.5:4b",
  "route": "subagent",
  "worked": true,
  "note": "Task completed successfully via sub-agent (task_id: abc123)"
}
```

### D5: Error Handling

**Decision:** Include detailed error context in SSE events.

**Rationale:**
- Previous errors only had short messages
- Debugging requires stack traces and context
- Frontend can display detailed errors to users

**Implementation:**
- Capture full traceback in `error_detail` field
- Include error details in SSE events
- Frontend displays `error_detail` when available

### D6: Task Store

**Decision:** Use in-memory task store with asyncio lock.

**Rationale:**
- Simple for local development
- No external dependencies (Redis/DB)
- Sufficient for single-user local use

**Limitations:**
- Tasks lost on server restart
- Not scalable for multi-user production
- Should be replaced with Redis/DB in production

**Task Fields:**
- `task_id` - UUID prefix
- `status` - running/completed/failed/cancelled
- `result` - Final agent response
- `error` - Error message
- `error_detail` - Full traceback
- `created_at` - ISO timestamp
- `iterations` - List of iteration outputs
- `model` - Model used
- `cancelled` - Cancellation flag

### D7: SSE Manager Filtering

**Status:** **Not yet implemented**

**Issue:** Current SSE manager broadcasts all events to all connected clients.

**Needed Improvement:**
- Filter events by `task_id` so clients only receive their own task events
- Implement per-task queues or topic-based routing
- Prevents cross-client event leakage

**Current Workaround:**
- Frontend filters events by checking `task_id` in received data
- Backend sends `task_id` in every event payload

### D8: Tool Selection

**Decision:** Keep tool set small and focused (6 tools).

**Tools:**
1. `read_file` - Read file contents
2. `list_directory` - List directory entries
3. `grep_search` - Search file contents
4. `run_gates` - Run project gate suite
5. `run_pytest` - Run backend tests
6. `run_cmd` - Allow-listed commands (python, pnpm, node, npm, npx, curl)

**Rationale:**
- Small tool set improves reliability on 4B models
- Covers essential codebase operations
- Allow-list prevents arbitrary command execution
- Path sandboxing keeps operations within repo

## Security Considerations

### Path Sandboxing
- All paths resolved relative to repo root
- `_safe_path()` prevents directory traversal
- Absolute paths rejected

### Command Allow-List
- Only specific binaries allowed
- No shell operators (`|`, `&&`, `;`)
- Commands run without `shell=True`

### No File Deletion
- Tools are read-only except for `run_gates --fix`
- No destructive operations exposed

## Model Configuration

### Default Model
- `qwen3.5:4b` - Default, already loaded
- Smaller but faster

### Fallback Model
- `qwen3:8b` - Better reasoning, still fits 8GB VRAM
- Used if default fails

### Model Selection
- Frontend allows model selection
- Backend uses selected model or default
- Model logged to reliability tracker

## Future Improvements

1. **SSE Task Filtering** - Implement per-task event routing
2. **Persistent Task Store** - Replace in-memory with Redis/DB
3. **Tool Results Caching** - Cache file reads and search results
4. **Progress Indicators** - More granular progress for long tasks
5. **Task History** - Persist task history across sessions
6. **Collaborative Tasks** - Support multiple concurrent users

## Testing

### Manual Testing Steps
1. Start backend server
2. Open SubAgentChat UI
3. Submit a task (e.g., "run the ruff gate")
4. Verify SSE events stream in real-time
5. Cancel a running task
6. Verify cancellation works
7. Check `observed.jsonl` for new entry
8. Verify error handling with invalid input

### Automated Testing
- TODO: Add backend endpoint tests
- TODO: Add frontend component tests
- TODO: Add SSE integration tests

## References

- AGENTS.md - Project agent rules and model reliability tracking
- tools/qwen_subagent/ - Agent harness implementation
- tools/model-reliability/ - Model reliability tracking
- docs/architecture/provider-notes.md - Provider behavior notes
