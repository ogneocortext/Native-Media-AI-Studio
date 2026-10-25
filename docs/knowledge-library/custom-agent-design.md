---
tags:
  - ai
  - agent
  - documentation
  - architecture
aliases:
  - Custom Agent Design
  - NMA Agent Design
cssclasses:
  - agent-guide
date: 2026-10-24
type: tracker
---

# Custom Agent Design — Native Media AI Studio

> [!info] Purpose
> Design specification for a custom agent that integrates with the Native
> Media AI Studio app. The agent orchestrates the full music video creation
> pipeline through the backend REST API, following D21 agent handoff
> portability rules.

---

## Agent Overview

The **NMA Agent** (`packages/backend/app/agents/nma_agent.py`) is a custom
agent class that drives music video creation through the backend API:

```
audio file → analysis → music generation → plan → remix → video
```

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Model-agnostic** (D21) | Behavioral instructions, no model-specific prompt hacks |
| **File-based state** (D21) | State files in `output/agent-state/` for handoffs |
| **Commit attribution** | All commits carry `Co-authored-by` trailer |
| **Gate enforcement** | All project gates must pass |
| **API-driven** | All actions through backend `/api/...` endpoints |

---

## Agent Class: `NMAAgent`

**File:** `packages/backend/app/agents/nma_agent.py`

### Constructor

```python
agent = NMAAgent(session_id="my-session", api_base="http://127.0.0.1:8000")
```

- `session_id` — Optional session ID for state tracking. Auto-generated if omitted.
- `api_base` — Backend API base URL (default: `http://127.0.0.1:8000`).

### Main Method: `create_music_video`

```python
result = agent.create_music_video(
    audio_file="path/to/track.mp3",
    style="cinematic",
    lyrics="",
    build_remix=True,
)
```

**Pipeline phases:**

| Phase | Action | API Endpoint |
|-------|--------|--------------|
| 1. Analyze | Extract BPM, beats, sections, energy | `POST /api/audio/analysis` |
| 2. Generate | ACE-Step music generation | `POST /api/music-gen/generate` |
| 3. Plan | Build mashup recipe from analysis | `POST /api/audio/remix/preview` |
| 4. Build | Render remix stems | `POST /api/audio/remix/build` |
| 5. Enhance | Master the remix | `POST /api/audio/remix/{name}/enhance` |

**Returns:**
```json
{
  "session_id": "nma-agent-20261024-123456",
  "phases": {
    "analysis": {...},
    "music": {...},
    "plan": {...},
    "remix": {...}
  },
  "state_file": "output/agent-state/nma-agent-20261024-123456.json"
}
```

### Convenience Function: `run_pipeline`

```python
from app.agents.nma_agent import run_pipeline
result = run_pipeline("path/to/audio.mp4", style="cinematic")
```

---

## Agent State: `AgentState`

**File:** `packages/backend/app/agents/agent_state.py`

State is persisted to `output/agent-state/{session_id}.json` for agent
handoffs. Any agent landing fresh can read the latest state file and resume.

**State fields:**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Unique session identifier |
| `created_at` | string | ISO timestamp of creation |
| `updated_at` | string | ISO timestamp of last update |
| `phase` | string | `init` \| `analyzing` \| `generating` \| `rendering` \| `complete` \| `failed` |
| `audio_file` | string | Analyzed audio filename |
| `analysis` | object | Audio analysis result (BPM, beats, sections) |
| `plan` | object | Remix recipe plan |
| `generated_assets` | array | List of generated media assets |
| `video_path` | string | Final video path (when available) |
| `errors` | array | Error history (last 50) |
| `warnings` | array | Warning history (last 50) |

**Class methods:**

- `AgentState.list_sessions()` — List all saved session IDs
- `AgentState.latest()` — Load the most recent session

---

## API Client: `NMAApiClient`

**File:** `packages/backend/app/agents/api_client.py`

Wraps all backend API endpoints with consistent error handling:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `health()` | `GET /api/health` | Backend health status |
| `audio_upload(path)` | `POST /api/audio/upload` | Upload audio file |
| `audio_analyze(filename)` | `POST /api/audio/analysis` | Analyze audio |
| `audio_list()` | `GET /api/outputs` | List all outputs |
| `music_gen_status()` | `GET /api/music-gen/status` | Check ACE-Step status |
| `music_gen_start(engine)` | `POST /api/music-gen/start` | Start generation service |
| `music_gen_generate(style, lyrics, output_name)` | `POST /api/music-gen/generate` | Generate music |
| `music_gen_audio(name)` | — | Get playable audio URL |
| `remix_list()` | `GET /api/audio/remix/` | List remixes |
| `remix_preview(recipe)` | `POST /api/audio/remix/preview` | Preview recipe |
| `remix_build(recipe)` | `POST /api/audio/remix/build` | Build remix |
| `remix_enhance(name)` | `POST /api/audio/remix/{name}/enhance` | Master remix |
| `media_list()` | `GET /api/outputs` | List media files |
| `media_delete(path)` | `DELETE /api/outputs/{path}` | Delete media |
| `media_rename(path, new_name)` | `POST /api/outputs/{path}/rename` | Rename media |

All methods raise `NMAApiError` on non-2xx responses.

---

## Usage Examples

### Basic Pipeline

```python
from app.agents.nma_agent import NMAAgent

agent = NMAAgent(session_id="my-video-001")
result = agent.create_music_video(
    audio_file="output/audio/my-track.mp3",
    style="cinematic",
    lyrics="",
    build_remix=True,
)

print(f"Session: {result['session_id']}")
print(f"Phase: {result['phases']}")
print(f"State: {result['state_file']}")
```

### Quick Pipeline

```python
from app.agents.nma_agent import run_pipeline

result = run_pipeline("output/audio/track.mp3", style="electronic")
```

### Resume from Previous Session

```python
from app.agents.agent_state import AgentState

# Load the most recent session
state = AgentState.latest()
if state:
    print(f"Resuming: {state.get('phase')}")
    print(f"Audio: {state.get('audio_file')}")
    print(f"Assets: {len(state.get('generated_assets', []))}")
```

### Check Agent Status

```python
agent = NMAAgent(session_id="existing-session")
status = agent.status()
# {
#   "session_id": "...",
#   "phase": "complete",
#   "audio_file": "output/audio/track.mp3",
#   "has_analysis": True,
#   "has_plan": True,
#   "generated_assets": 3,
#   "errors": 0,
#   "warnings": 1,
#   "state_file": "output/agent-state/...json"
# }
```

---

## Integration with Existing Tools

The agent works alongside existing repo tooling:

| Tool | Purpose |
|------|---------|
| `tools/agent-contribution-report.py` | Per-agent commit attribution |
| `tools/run-gates.py` | All project gates (docs, ruff, type, lint, pytest) |
| `tools/check-import-cycles.py` | Import cycle detection |
| `tools/snapshot-audio-routes.py` | Route registration check |
| `tools/model-reliability/score.py` | Model reliability scoring |

---

## Commit Convention

All agent commits must carry the `Co-authored-by` trailer:

```
Co-authored-by: NMA Agent <nma-agent@native-media-ai.studio>
```

Pre-commit hooks enforce this. Use `python tools/agent-contribution-report.py --check` before pushing.

---

## Related Docs

- [AGENTS.md](../AGENTS.md) — Project agent guidelines
- [[docs/architecture/decision-log.md]] — D21 agent handoff portability
- [[docs/architecture/provider-notes.md]] — Per-model field notes
- [[docs/knowledge-library/index.md]] — Knowledge library entry

---

*Last updated: 2026-10-24*
