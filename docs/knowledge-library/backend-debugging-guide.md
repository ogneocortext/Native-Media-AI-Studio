# Backend Debugging & ComfyUI Integration Findings

> Date: 2026-09-05 (updated — SSE supersedes WebSocket)
> Author: Kilo (AI Assistant)
> Status: Active — SSE is canonical; legacy `ws://…/ws` returns 426

## Overview

This document captures findings from debugging the Native Media AI Studio backend, specifically around ComfyUI integration, image generation, and API reliability.

---

## Issue: 500 Internal Server Error on Image Generation

### Symptom

`POST /api/integrations/comfyui/generate` returned `500 Internal Server Error` consistently.

### Root Cause

The endpoint had a problematic import inside the function body:

```python
# OLD CODE (BROKEN)
@router.post("/{service_name}/generate")
async def generate_image(service_name: str, request: ImageGenerationRequest) -> dict:
    from ..core.database import get_db_conn  # <-- THIS CAUSED THE ISSUE
    adapter = adapter_registry.get(service_name)
    ...
```

The `from ..core.database import get_db_conn` import inside the function was causing a circular import or initialization issue that resulted in a 500 error. The import was unused and should have been at the module level or removed entirely.

### Fix

Removed the unused import from the function body:

```python
# NEW CODE (WORKING)
@router.post("/{service_name}/generate")
async def generate_image(service_name: str, request: ImageGenerationRequest) -> dict:
    adapter = adapter_registry.get(service_name)
    ...
```

### Debugging Technique

When FastAPI returns 500 without a clear error message:

1. Add `print()` statements at key points in the code
2. Check `logs/app.log` for INFO level messages
3. Check `logs/error.log` for ERROR level messages
4. Check `output/logs/backend.log` for uvicorn stdout capture
5. Add `logger.error("message", exc_info=True)` to exception handlers

**Note:** The logging configuration captures print statements to `backend.log`, not `app.log`. Use `print()` for quick debugging, `logger.info()` for permanent logging.

---

## ComfyUI API Integration

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/prompt` | POST | Submit workflow, returns `prompt_id` |
| `/prompt` | GET | Get queue status |
| `/queue` | GET | Detailed queue view |
| `/history` | GET | Full execution history |
| `/history/{prompt_id}` | GET | Results for specific prompt |
| `/view` | GET | Download output files |
| `/system_stats` | GET | Server status |

### Workflow Submission Format

```python
payload = {
    "prompt": {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 42,
                "steps": 20,
                "cfg": 7.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "v1-5-pruned-emaonly.safetensors"}
        },
        # ... more nodes
    },
    "client_id": "optional-uuid"
}
```

### Response Format

```json
{
    "prompt_id": "uuid-here",
    "number": 1,
    "node_errors": {}
}
```

If `node_errors` is not empty, the workflow validation failed.

---

## Adapter Connection Reuse

### Problem

Each API call created a new `aiohttp.ClientSession()`, causing:
- Thread leak (13,856+ threads)
- Health check timeouts (10+ seconds)
- Event loop blocking

### Solution

Single shared session per adapter instance:

```python
class ComfyUIAdapter:
    def __init__(self):
        self._session = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(limit=5, ttl_dns_cache=300),
                timeout=aiohttp.ClientTimeout(total=30),
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
```

---

## Memory Leaks Fixed

### Queue Manager

**Problem:** `_jobs` grew unbounded - completed jobs never auto-removed.

**Fix:** Auto-cleanup after 100 completed jobs:

```python
async def _auto_cleanup_unlocked(self):
    terminal_jobs = [j for j in self._jobs.values()
                     if j.status in (COMPLETED, FAILED, CANCELLED)]
    terminal_jobs.sort(key=lambda j: j.completed_at)
    to_remove = terminal_jobs[:len(terminal_jobs) // 2]
    for job in to_remove:
        del self._jobs[job.id]
```

### Resource Monitor

**Problem:** `_last_warnings` dict grew unbounded.

**Fix:** Cleanup stale entries during broadcast.

---

## Progress Tracking Architecture

### Backend Endpoints (current)

1. `POST /api/integrations/comfyui/generate` - Returns `prompt_id` immediately
2. `GET /api/jobs/{job_id}` - Poll queue job (legacy `/progress/{prompt_id}` / `/result/{prompt_id}` merged into unified queue)
3. `GET /api/events` - SSE stream for `job.progress` / `job.completed` (preferred over polling) — `packages/backend/app/sse/handler.py` + `packages/frontend/src/services/sseService.ts`

### Frontend Flow (current)

1. User clicks Generate → `POST /api/integrations/comfyui/generate` or `POST /api/video/generate-section`
2. Backend creates `Job` (queue) and returns `job_id`/`prompt_id`
3. Frontend either (a) polls `GET /api/jobs/{job_id}` every 1.2s **or** (b) listens to `GET /api/events` SSE for `job.progress`
4. SSE `job.progress` shows real step progress (e.g., "Step 5/20") via `Queue.tsx` + `jobStore.ts`
5. On `job.completed`, result `output_path`/`model_path` is read from job + `GET /api/outputs`

### ComfyUI Progress Data

The `/queue` endpoint returns:
```json
{
    "queue_running": [[prompt_id, data], ...],
    "queue_pending": [[prompt_id, data], ...]
}
```

---

## Model Management

### VRAM Requirements (8GB GTX 1070 Ti)

| Model | Size | VRAM | Status |
|-------|------|------|--------|
| mm_sd15_v3.safetensors | 798MB | ~1GB | ✅ Works |
| v1-5-pruned-emaonly.safetensors | 4068MB | ~4GB | ✅ Works |
| hunyuan3d-dit-v2-mini | 3643MB | ~4GB | ✅ Works |
| wan2.2_ti2v_5B_fp16.safetensors | 9536MB | ~16GB | ❌ Deleted |
| umt5_xxl_fp8_e4m3fn_scaled.safetensors | 6424MB | ~8GB | ❌ Deleted |

### Model Paths

- Checkpoints: `ComfyUI/models/checkpoints/`
- Motion modules: `ComfyUI/models/animatediff/`
- Motion LoRAs: `ComfyUI/models/animatediff_motion_lora/`
- Text encoders: `ComfyUI/models/text_encoders/`
- VAEs: `ComfyUI/models/vae/`

---

## Common Pitfalls

### 1. Circular Imports

Never import inside FastAPI endpoint functions. Use module-level imports only.

### 2. Blocking the Event Loop

Use `await asyncio.sleep()` not `time.sleep()` in async functions.

### 3. Session Management

Always reuse `aiohttp.ClientSession` instances. Creating new sessions per request causes thread leaks.

### 4. Logging Configuration

- `print()` → captured to `output/logs/backend.log`
- `logger.info()` → written to `logs/app.log`
- `logger.error()` → written to `logs/error.log`
- ComfyUI-specific logs → `logs/comfyui.log`

### 5. ComfyUI API Format

The workflow JSON must be in API format (node IDs as keys), not UI format (includes positional data).

---

## Server Management

### Scripts

- `scripts/manage-servers.ps1` - Start/stop/restart/status
- `scripts/start-studio.ps1` - Start all services (backend + frontend + ComfyUI)

### Ports

- Backend: 8000
- Frontend: 5173
- ComfyUI: 8188
- Ollama: 11434

### Health Checks

The backend checks adapter health on startup and broadcasts via SSE (`GET /api/events`, `sseService.ts`). Health status is shown in the sidebar. Legacy `ws://127.0.0.1:8000/ws` is a compat shim that returns `426` for HTTP `GET` and `101` only for WebSocket upgrade — new code must use SSE.

---

## Future Improvements

1. ~~**WebSocket Progress** - Replace polling with WebSocket for real-time updates~~ ✅ **Done (2026-09): SSE `GET /api/events`** replaces polling + legacy WebSocket — see `docs/api/API_REFERENCE.md` §Real-Time Events and `packages/backend/app/sse/handler.py`
2. **Batch Generation** - Support multiple seeds in one request
3. **Image-to-Image** - Add img2img support
4. **Inpainting** - Add mask-based inpainting
5. **Model Switching** - Hot-swap models without restart
6. **Queue Management** - Priority queue for urgent jobs
