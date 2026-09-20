# Backend App Modules

This directory groups the FastAPI backend by **responsibility domain** so agents can locate business logic, API routes, and adapters quickly.

## Module Layout

| Directory | Purpose |
|-----------|---------|
| `api/` | REST route definitions (jobs, health, audio, outputs) |
| `core/` | Port manager, health monitor, SQLite setup, CORS, tracing, RequestID middleware |
| `models/` | Pydantic schemas and data models |
| `services/` | Business logic: job orchestration, audio, blender, CUDA, 3D gen, VRAM, go gateway/worker clients |
| `adapters/` | External service wrappers: ComfyUI, Ollama, Blender, Unity, music-gen |
| `sse/` | SSE event handler (canonical real-time events path) |
| `websocket/` | Legacy WebSocket shim returning `426` — use SSE instead |
| `queue/` | Job queue implementation (DLQ + metrics + exponential backoff retries) |
| `diagnostics/` | Resource and health diagnostics |
| `utils/` | Shared helpers |
| `tests/` | Backend test suite |
| `output/` | Backend-generated outputs |
| `storage/` | Runtime storage (queue, temp, backups) |
| `transcriptions/` | Generated transcription data |

## Entry Point

- `main.py` — FastAPI app factory and startup wiring.

## Conventions

- Keep API routes thin; place business logic in `services/`.
- Pydantic models in `models/` are the single source of truth for schemas.
- Prefer SSE (`GET /api/events`) over WebSocket for real-time updates.
