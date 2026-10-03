---
tags:
  - technical
aliases:
  - Backend Debugging Guide
  - Debugging Patterns
  - Troubleshooting
cssclasses:
  - technical-guide
date: 2026-09-29
---

# Backend Debugging & ComfyUI Integration Findings

> Date: 2026-09-29 (updated tags to new hierarchical system)
> Author: Kilo (AI Assistant)
> Status: Active — SSE is canonical; legacy `ws://…/ws` returns 426

## Playbook: "Port occupied but server won't start" (Windows, 2026-09-07)

Symptom: `manage-servers.ps1` reports _Backend: STOPPED_ yet _port 8000 occupied_; starting fails forever.

1. **Map listeners to processes:** `scripts\check_ports.ps1` (LISTENING port → PID → process name).
2. **Watch for stale sockets:** `netstat -ano` can show LISTENING entries whose PID no longer exists (uvicorn `--reload` children orphaned after their reloader parent died). `Stop-Service` in `manage-servers.ps1` now kills the reloader parent (`app.main:app` cmdline match) first, then reaps listeners in up to 3 passes.
3. **Health-probe timeouts matter:** `/api/health` probes adapters live (a down ComfyUI alone took ~2.1 s to answer). A 2 s probe timeout reports false STOPPED — the script now allows 6 s.
4. **Sticky port:** the backend itself (`main.py` + `port_manager.resolve_port`) detects a healthy instance already on the resolved port and exits instead of spawning a duplicate — don't "fix" port drift by force-killing a responding server.
5. **Vite variant:** if the frontend port is listening but unreachable on `127.0.0.1`, suspect an IPv6-only bind caused by a compiled `vite.config.js` shadowing `vite.config.ts` (see `frontend-build-pipeline.md` §7.6).

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
2. Check `output/logs/app.log` for INFO level messages
3. Check `output/logs/error.log` for ERROR level messages
4. Check `output/logs/backend.log` for uvicorn stdout capture
5. Add `logger.error("message", exc_info=True)` to exception handlers

**Note:** The logging configuration captures print statements to `backend.log`, not `app.log`. Use `print()` for quick debugging, `logger.info()` for permanent logging.

---

## ComfyUI API Integration

### Key Endpoints

| Endpoint               | Method | Purpose                              |
| ---------------------- | ------ | ------------------------------------ |
| `/prompt`              | POST   | Submit workflow, returns `prompt_id` |
| `/prompt`              | GET    | Get queue status                     |
| `/queue`               | GET    | Detailed queue view                  |
| `/history`             | GET    | Full execution history               |
| `/history/{prompt_id}` | GET    | Results for specific prompt          |
| `/view`                | GET    | Download output files                |
| `/system_stats`        | GET    | Server status                        |

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

### SSE Debugging Patterns

#### EventSource won't connect

```javascript
// Check browser console for EventSource errors
const es = new EventSource("/api/events");
es.onerror = () => console.error("SSE error", es.readyState);
// readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
```

#### Missed events during reconnect

```javascript
// Backend now supports Last-Event-ID replay
// Frontend captures lastEventId automatically
es.onmessage = (event) => {
  if (event.lastEventId) {
    localStorage.setItem("sse_last_id", event.lastEventId);
  }
};
```

#### Cross-tab sync issues

```javascript
// Check BroadcastChannel support
const channel = new BroadcastChannel("notifications");
channel.onmessage = (e) => console.log("Sync:", e.data);
```

#### Priority routing not working

```bash
# Check SSE event payload
curl -N http://localhost:8000/api/events
# Should include "priority": "urgent" | "high" | "medium" | "low"
```

---

## Model Management

### VRAM Requirements (8GB GTX 1070 Ti)

| Model                                  | Size   | VRAM  | Status     |
| -------------------------------------- | ------ | ----- | ---------- |
| mm_sd15_v3.safetensors                 | 798MB  | ~1GB  | ✅ Works   |
| v1-5-pruned-emaonly.safetensors        | 4068MB | ~4GB  | ✅ Works   |
| hunyuan3d-dit-v2-mini                  | 3643MB | ~4GB  | ✅ Works   |
| wan2.2_ti2v_5B_fp16.safetensors        | 9536MB | ~16GB | ❌ Deleted |
| umt5_xxl_fp8_e4m3fn_scaled.safetensors | 6424MB | ~8GB  | ❌ Deleted |

> See [[pascal-gpu-optimization-2026|Pascal GPU Optimization 2026]] for environment
> variables, torch version caps, and SDPA backend requirements on sm_61.

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
- `logger.info()` → written to `output/logs/app.log`
- `logger.error()` → written to `output/logs/error.log`
- ComfyUI-specific logs → `output/logs/comfyui.log`

Every line carries two correlation ids, so a failure can be followed without
reconstructing it from timestamps:

```
[request_id] [job_id] message
```

- **`request_id`** — the HTTP request, set by `RequestIDMiddleware`.
- **`job_id`** — the job being executed, set by `JobProcessor` for one job's
  lifetime via `job_context(job.id)`.

They are separate because **a job outlives the request that created it.**
Enqueue happens under a request id; claiming, the handler, retries and
dead-lettering all run in the processor's own context with no request to inherit
from. Before this, `rg <job-id>` matched the enqueue line and *nothing after it* —
which is why 233 empty-params `image_generation` rows could not be traced to any
caller.

Follow a whole job with:

```bash
rg "<job-id>" output/logs/          # everything that job did
rg "NO params" output/logs/         # every job enqueued unrunnable
```

`enqueue()` logs a params fingerprint (`keys=...`, `n_params=N`) rather than
values, so dropped input is visible at origin without dumping prompts or file
paths into the log. An empty `params` is a `WARNING` there, at the point of
creation, rather than something the reaper notices minutes later (D31).

Inside a handler you do not need to pass the id around: `job_context` is a
ContextVar, so any logger picks it up. It restores the previous value on exit —
including when the handler raises — because the processor reuses one task for
every job it runs.

### 5. ComfyUI API Format

The workflow JSON must be in API format (node IDs as keys), not UI format (includes positional data).

### 6. Never abandon a ComfyUI prompt

A waiter that raises on timeout and walks away leaves the prompt running inside
ComfyUI. Each abandonment permanently lengthens the FIFO queue for later jobs —
including the retry of the job that just timed out — so failures compound instead
of clearing. Any exit that is not success must cancel the prompt
(`_cu.cancel_prompt`). See D29.

### 7. `DELETE /queue` is not supported

Cancelling a prompt is `GET /queue` to locate it, then
`POST /queue {"delete": [prompt_id]}`. On this ComfyUI build `DELETE /queue`
returns **405 Method Not Allowed**. An implementation using it looks correct,
passes unit tests against a mocked session, and silently does nothing against the
real service — verify wire-level behaviour against a live call, not a mock.

### 8. A queued prompt is not a slow prompt

If a prompt is still in the queue, elapsed time is being spent behind other
people's work, not on this job. Timing out there cancels a job that never ran.
The image waiter extends its deadline once for this reason.

### 9. Never hold a lock across a resource wait

`asyncio.Lock` is not reentrant, and holding one across a slow wait blocks every
other user of it. The VRAM manager waited up to 120 s for GPU memory while holding
the lock that guards the begin/end of *every* workload, so a 3D request running
low on VRAM stalled audio analysis for two minutes. Waits belong outside the lock;
the lock protects only short bookkeeping. See D30.

### 10. Check before sleeping

A poll loop that sleeps *then* tests charges the interval to every outcome,
including "already finished", and lets the timeout overshoot its own budget.
Sleep `min(interval, time_remaining)` and test first.

### 11. A test that cannot fail is worse than no test

A lock-contention test written against a local stand-in class passed even with
the fix reverted, because it never called the code under test. Assert against the
real method, and add a companion test proving the old shape really did misbehave
so the main test cannot pass for the wrong reason.

---

## Playbook: "ComfyUI is slow / unreliable" (2026-10-02)

Measure before believing it. On 2026-10-02 ComfyUI looked unreliable for a year;
it was actually completing images in a median of 10.8 s while the client waited
300 s and then left the work behind.

```python
# 1. How long does ComfyUI ACTUALLY take? (its own history, not our logs)
import json, urllib.request
h = json.load(urllib.request.urlopen("http://127.0.0.1:8188/history", timeout=25))
durs = []
for pid, e in h.items():
    start = end = None
    for kind, payload in e.get("status", {}).get("messages", []):
        if kind == "execution_start":   start = payload.get("timestamp")
        elif kind in ("execution_success", "execution_error"): end = payload.get("timestamp")
    if start and end: durs.append(((end - start) / 1000.0, pid))
vals = sorted(d for d, _ in durs)
print("n=%d min=%.1fs median=%.1fs max=%.1fs" % (
    len(vals), vals[0], vals[len(vals)//2], vals[-1]))

# 2. Is the queue backed up, and is it OURS?
q = json.load(urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=15))
print("running=%d pending=%d" % (len(q["queue_running"]), len(q["queue_pending"])))
```

Then correlate: if `/api/jobs` shows 0 active backend jobs while ComfyUI has a
deep queue, the backlog is orphaned — not in flight. Compare queue numbers against
`len(history)`: entries numbered just past the history length were submitted and
never collected.

Interpretation:

| Symptom | Likely cause |
|---|---|
| Queue deep, backend idle, ids absent from backend logs | Orphaned prompts (pre-D29, or another client) |
| Median fast but client times out | Client timeout too short for the queue position, or no cancellation (D29) |
| One prompt running, CPU rising, never finishes | Genuinely slow job — check model and VRAM pressure |
| `vram_free` under ~1.3 GB | VRAM contention; see the VRAM manager notes |

Clearing someone else's backlog is a deliberate act, not an automatic one — those
prompts may be real work from another tool. Cancel by id only when you know whose
they are.

---

## Playbook: "the queue says healthy but nothing is happening" (2026-10-02)

`/api/health/queue` now reports `stranded_running_jobs` and folds it into
`is_healthy`. Before that, a fully wedged queue reported healthy: 25 jobs sat in
`running` with `current_job_id: null` and `processing_rate_per_min: 0.0`.

If `stranded_running_jobs > 0`, jobs were left `RUNNING` by a process that died.
They are reclaimed automatically on the next reaper tick (60 s) or restart —
requeued if they have retry budget and are runnable, dead-lettered otherwise.

Two cases the age-based reaper still cannot distinguish, both tracked as Q6:

- A legitimately long job (a Wan video render) can be reclaimed after 15 minutes,
  because there is no heartbeat or lease — only age.
- A job with empty `params` can never succeed, so it is dead-lettered rather than
  retried. If these keep appearing, the enqueue path is dropping parameters; 233
  such rows predate the fix.

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

### Orphaned reloaders (2026-10-02)

`manage-servers.ps1 -Action status` reports **orphaned reloaders** — `uvicorn --reload`
(watchfiles) supervisors whose server child has died. The supervisor survives, waiting
for the next file change, because killing the child directly does not stop it.

They were invisible until this was added: `Get-ServiceStatus` only inspects the port,
and an orphan holds none, so the service read as `STOPPED` and `status` printed a clean
board while the process tree leaked.

Prefer `manage-servers.ps1 -Action stop` over killing PIDs by hand — the managed stop
matches on `app.main:app`, which catches the supervisor, whereas an ad-hoc
`Stop-Process` against the child leaves it running. This matters during debugging,
where killing the uvicorn child is the natural thing to do.

---

## Image Output Integrity (2026-10-02)

`ImageGenerationHandler.save_output` refuses to let a job report success without a
real image. Two cases raise instead of completing:

- **No image data at all.** Previously this only logged a warning and returned an
  output path anyway, so the job was stored as `completed` with `output_path: null`
  alongside a plausible-looking seed and step count. The UI renders completed jobs as
  finished work, which made that a false claim about work that never ran.
- **An image smaller than 8×8 px.** The adapters' `_mock_generate` emits a 1×1 PNG;
  storing it made a single pixel look like a render.

The threshold reads the PNG `IHDR` dimensions, not file size. A size threshold was
tried first and rejected: a legitimate 64×64 flat render compresses to ~98 bytes and
is indistinguishable from a placeholder by size, whereas its dimensions are
unambiguous. `MOCK_GENERATION` is unset in this project, so the mock path should
never produce real output — a 1×1 file on disk is a historical artefact from when
mock output was still written on service failure (42 such files remain under
`output/images`, all dated 2026-09-21 to 2026-09-26).

---

## Future Improvements

1. ~~**WebSocket Progress** - Replace polling with WebSocket for real-time updates~~ ✅ **Done (2026-09): SSE `GET /api/events`** replaces polling + legacy WebSocket — see `docs/api/API_REFERENCE.md` §Real-Time Events and `packages/backend/app/sse/handler.py`
2. **Batch Generation** - Support multiple seeds in one request
3. **Image-to-Image** - Add img2img support
4. **Inpainting** - Add mask-based inpainting
5. **Model Switching** - Hot-swap models without restart
6. **Queue Management** - Priority queue for urgent jobs
