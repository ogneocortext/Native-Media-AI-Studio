# API Reference

> **Base URL:** `http://localhost:8000`
> **Last Updated:** 2026-09-05 (SSE, audio covers, duplicate detection)

## Jobs

### List all jobs

```
GET /api/jobs?status={status}
```

Optional `status` filter: `pending`, `queued`, `running`, `completed`, `failed`, `cancelled`.

### Create a job

```
POST /api/jobs
Content-Type: application/json

{
  "job_type": "music_video",
  "params": {
    "audio_path": "output/audio/abc123_song.mp3",
    "audio_filename": "song.mp3",
    "visualization": {
      "style": "abstract",
      "duration": "full",
      "resolution": "1080p",
      "fps": 30,
      "color_scheme": "auto",
      "quality": "standard"
    },
    "style_template": "cyberpunk_neon",
    "beat_markers": [{"time": 0.5, "intensity": "high", "type": "beat"}]
  },
  "max_retries": 3
}
```

### Get job details

```
GET /api/jobs/{job_id}
```

### Cancel a job

```
POST /api/jobs/{job_id}/cancel
```

### Retry a failed job

```
POST /api/jobs/{job_id}/retry
```

### Delete a job

```
DELETE /api/jobs/{job_id}
```

### Get queue statistics

```
GET /api/jobs/stats
```

### Clear completed jobs

```
POST /api/jobs/clear-completed
```

---

## Audio

### Upload an audio file

```
POST /api/audio/upload
Content-Type: multipart/form-data

file: <binary audio data>
```

Supported formats: MP3, WAV, FLAC, OGG, M4A, WMA, AAC. Max size: 500 MB.

**Response:**

```json
{
  "success": true,
  "filename": "my_song.mp3",
  "stored_path": "D:/.../output/audio/abc123_my_song.mp3",
  "size_bytes": 5242880,
  "message": "Audio file uploaded successfully (5120 KB)"
}
```

### List uploaded audio files

```
GET /api/audio/files
```

### Analyze audio (real)

```
POST /api/audio/analyze
Content-Type: multipart/form-data
file: <binary>

→ 200 {
  "tempo_bpm": 97.5,
  "duration_seconds": 234.12,
  "beat_count": 336,
  "beat_times": [20.329, 20.944, ...],
  "onset_times": [...],
  "energy_curve": [0.12, 0.34, ...], // 100 pts 0-1
  "confidence": 0.365,
  "sections": [{"type":"intro","start":0.0,"end":29.5,"energy":0.2}, ...], // 8 energy-aware, beat-snapped
  "stored_path": "D:/.../output/audio/85a406ef_...mp3",
  "job_id": "85a406ef"
}
```

No mocks — fails with `503 librosa not installed` or `500 Analysis failed` and surfaces in wizard.

### Get analysis result

```
GET /api/audio/analysis/{job_id}
```

Returns JSON analysis result with beat times, tempo, amplitude envelope.

### Generate video section (real queue)

```
POST /api/video/generate-section
{
  "prompt": "Medium shot ...",
  "negative_prompt": "blurry",
  "steps": 15, "cfg_scale": 7.0, "seed": 42,
  "section": "intro", "duration": 15.5,
  "vertical_first": false,
  "audio_path": "D:/.../output/audio/85a406ef_...mp3",
  "audio_filename": "Take the Crown.mp3"
}
→ 200 { "success": true, "job_id": "bd1b3516-...", "output_path": "output/video/intro_bd1b...mp4", "section": "intro" }
→ Poll GET /api/jobs/{job_id} until status completed/failed
```

---

## Outputs

### List all outputs

```
GET /api/outputs?file_type={type}&search={query}&limit={n}&offset={n}
```

### Get recent outputs

```
GET /api/outputs/recent?limit={n}
```

### Get outputs by type

```
GET /api/outputs/{file_type}
```

Where `file_type` is `images`, `video`, or `audio`.

### Outputs — covers, rename, duplicates (new)

Audio files with embedded art (ID3 `attached pic`, FLAC `PICTURE`) are extracted via FFmpeg on scan to `audio/{stem}.jpg` and returned as `cover_image: "audio/...jpg"` (skip-list prevents `*.jpg` sidecars from appearing as standalone images).

```
GET /api/outputs/duplicates/groups?quick=true&limit=50
→ [{"hash":"a1b2c3d4e5f6...", "count":3, "size_bytes": 5638824, "wasted_bytes": 11277648, "files": [{"filename":"f3a608e2_...mp3","relative_path":"audio/f3a...","size_bytes":..., "created_at":"..."}, ...]}, ...]
```

```
POST /api/outputs/{file_path}/rename
{"new_name": "My Renamed Track.mp3"}
→ 200 { "new_path": "audio/My Renamed Track.mp3" }  // also renames .json + cover .jpg sidecars
```

```
POST /api/outputs/bulk-delete
{"paths": ["audio/a...mp3", "video/b...mp4"]}
→ 200 { "deleted": [...], "failed": [], "deleted_count": 2 }
```

### Delete an output (now also removes sidecars)

```
DELETE /api/outputs/{file_path}
```

Removes file + `file.json`/`file.mp3.json` + cover `file.jpg` sidecars if inside `output/`.

---

## Health & System

### Ping

```
GET /api/ping
```

### Health check

```
GET /api/health
```

### Service status

```
GET /api/services/status
```

### Render health (system resources)

```
GET /api/render/health
```

---

## Image Generation

### Generate image (direct)

```
POST /api/integrations/{backend}/generate
Content-Type: application/json

{
  "prompt": "cyberpunk cityscape",
  "negative_prompt": "blurry, low quality",
  "steps": 20,
  "cfg_scale": 7.0,
  "width": 512,
  "height": 512,
  "seed": -1,
  "sampler": "Euler a"
}
```

`backend` can be `comfyui` or `sd_webui`.

### Queue image job

```
POST /api/integrations/{backend}/job
Content-Type: application/json

{
  "prompt": "cyberpunk cityscape",
  "steps": 20,
  "cfg_scale": 7.0,
  "width": 512,
  "height": 512
}
```

---

## GPU & 3D Generation

### GPU Snapshot

```
GET /api/health/gpu
```

Returns real-time GPU stats including VRAM, utilization, temperature, and per-process breakdown.

**Response:**

```json
{
  "available": true,
  "name": "NVIDIA GeForce GTX 1070 Ti",
  "memory_used_mb": 7881,
  "memory_free_mb": 311,
  "memory_total_mb": 8192,
  "memory_percent": 96.2,
  "gpu_utilization": 38,
  "memory_controller_utilization": 26,
  "temperature_c": 45,
  "processes": [
    { "pid": 1234, "name": "blender.exe", "used_mb": 2048, "kind": "compute" }
  ]
}
```

### 3D Generation Status

```
GET /api/health/3d/status
```

Returns 3D generation service status and model availability.

### Generate 3D Model

```
POST /api/health/3d/generate
Content-Type: application/json

{
  "prompt": "a futuristic robot",
  "output_name": "robot_model",
  "steps": 15,
  "seed": 42
}
```

Generates a 3D model from text prompt using Hunyuan3D-2mini. Returns `{success, model_path}`.

---

## Real-Time Events (SSE — canonical)

### Connect

```
GET http://localhost:8000/api/events
Accept: text/event-stream
# Browser: const es = new EventSource('/api/events'); es.onmessage = (e) => { JSON.parse(e.data) }
```

Legacy `ws://localhost:8000/ws` returns `426 Upgrade Required` (compat shim for old clients) — use SSE `events_url`/`sse_url` from `config/ports.json`. Vite proxy `/ws` entry is legacy compat.

### Event types received

- `job.queued` — Job added to queue
- `job.started` — Job started processing
- `job.progress` — Progress update (0.0 to 1.0)
- `job.completed` — Job finished successfully
- `job.failed` — Job failed with error
- `job.cancelled` — Job was cancelled
- `system.health_changed` — Health status changed
- `system.resource_warning` — VRAM/resource warning (`system.resource_warning`)
- `heartbeat` — Keep-alive ping (every 30s)

## Transcription & Lyrics

### Transcribe audio → LRC (Whisper/WhisperX)

```
POST /api/transcription/transcribe
Content-Type: multipart/form-data
file: <audio>  (+ optional model/language params)

GET /api/transcription/transcript/lrc/{filename:path}         → LRC text
GET /api/transcription/transcript/lrc-word/{filename:path}    → word-level JSON
GET /api/transcription/transcript/{filename:path}             → raw transcript JSON
```

### Lyrics CRUD

```
GET  /api/lyrics/track/{track_id}                  → lyrics for a track
POST /api/lyrics/track/{track_id}  {lrc: string}   → save lyrics
GET  /api/lyrics/by-filename/{filename:path}       → lyrics by audio filename
POST /api/lyrics/import-lrc  (multipart LRC file)
GET  /api/lyrics/tracks-with-lyrics                → tracks that have lyrics
GET  /api/lyrics/visual-preset/{track_id}          → visual preset per track
POST /api/lyrics/visual-preset/{track_id}          → save preset mapping
```

LRC sync surfaced via `useLrcSync` + `Canvas2DVisualizer`/`VisualizerScene`/`KineticLyricOverlay`; parser fixes `offset`/multi-stamp/60.00 rollover at `services/lyricsParser.py:8` + `lyricsParser.ts:84`.

## ComfyUI Process Management

```
GET  /api/comfyui/status           → managed ComfyUI status
POST /api/comfyui/start?port=8188
POST /api/comfyui/stop
POST /api/comfyui/restart
POST /api/comfyui/update           → git pull + requirements reinstall (when local)
GET  /api/comfyui/version
```

Native ComfyUI HTTP API is also directly reachable at `http://127.0.0.1:8188` (`/prompt`, `/queue`, `/history`, `/view`, `/system_stats`).

## Docs & Knowledge Library

```
GET /api/docs/list?search={q}&vault_only={bool}   → list vault + guide docs
GET /api/docs/file?path=knowledge-library/index.md → raw markdown / JSON
GET /api/docs/vault                                → vault-only shortcut
GET /api/docs/manifest  → agent.manifest.json
GET /api/docs/prompts   → prompts.json
GET /api/docs/codebase  → codebase.json
GET /api/docs/api-registry → api-registry.json
GET /api/docs/mcp-registry → mcp-registry.json
GET /api/docs/bootstrap → single-call bootstrap (manifest + codebase + API + MCP + vault index)
GET /api/docs/search?q={q}                        → ranked full-text search
GET /api/docs/structure?depth={n}                 → directory tree
```

Frontend `Documentation.tsx` renders these live; JSON badges + copy buttons.

## Logs

```
GET  /api/logs/                         → log file info (rotation: 10MB × 5)
GET  /api/logs/{log_name}?lines={n}     → tail (app.log, error.log, comfyui.log, queue.log, ollama.log)
POST /api/logs/clear                    → clear all logs
POST /api/logs/frontend                 → ingest frontend console logs
```

## Data — Tracks / Prompts / Visuals / Sessions / Preferences

```
GET    /api/data/tracks/?search=&status=&artist=&limit=         → list tracks (CSV import via POST /api/data/tracks/import)
POST   /api/data/tracks/  |  PATCH /api/data/sessions/{id} | DELETE /api/data/{prompt_id}
GET    /api/data/  (prompts, favorite/use toggles)
GET    /api/data/audio/ | visuals/ | sessions/ | preferences/
PUT    /api/data/preferences/{key}
```

Frontend `TrackManager` + `StoryboardPage` consume these.

## Audio — Extended

Beyond `POST /api/audio/analyze` + `GET /api/audio/analysis/{job_id}` documented above:

```
POST /api/audio/analyze-cuda          → CUDA-accelerated variant
GET  /api/audio/analysis/by-filename/{filename} → cached result by original filename (Three.js beat timeline)
GET  /api/audio/file/{filename:path}  → serve raw audio file
POST /api/audio/separate              → stem separation (vocals/drums/bass/other → stems/)
GET  /api/audio/stems/{filename:path}
POST /api/audio/ensure-analysis       → ensure cached analysis else trigger
POST /api/audio/analyze-all           → batch analyze library
```

## Health — Extended

Beyond `GET /api/health` + `GET /api/health/gpu`:

```
GET  /api/health/gpu/processes         → per-process VRAM via Windows Performance Counters (GeForce WDDM, no admin)
GET  /api/health/ffmpeg                → FFmpeg 8.1 probe
GET  /api/health/3d/models             → list Hunyuan3D/Wan 2.2 model availability
POST /api/health/3d/generate-image     → image-to-3D variant
GET  /api/health/diagnostics           → full diagnostics
GET  /api/health/diagnostics/services
GET  /api/health/diagnostics/system    → CPU/RAM/disk + system memory breakdown
POST /api/health/diagnostics/memory/cleanup
GET  /api/health/context               → agent context snapshot
POST /api/health/context
GET  /api/health/ollama/models         → loaded Ollama models + VRAM
POST /api/health/ollama/clear-activity
GET  /api/ping
```

---

## Error Handling

**Format:**

```json
{
  "detail": "Error message",
  "status_code": 500
}
```

**Common Errors:**
| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters or file type |
| 404 | Not Found - Resource does not exist |
| 413 | Payload Too Large - File exceeds size limit |
| 500 | Internal Server Error - Processing failed |
| 503 | Service Unavailable - Required dependency missing |

---

## Agent Guidelines

### Best Practices

 - Always URL-encode filenames when using them in API paths
 - Handle multipart/form-data for file uploads (don't set Content-Type header manually)
 - Check job status before attempting to retrieve results
 - Use SSE (`GET /api/events`) for real-time updates instead of polling; `ws://…/ws` is a legacy shim
 - Cache analysis results to avoid re-analyzing the same file

### Rate Limiting

No rate limiting for local development.

### Retry Strategy

Exponential backoff for 5xx errors, max 3 retries.
