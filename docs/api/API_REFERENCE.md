# API Reference

> **Base URL:** `http://localhost:8000`
> **Last Updated:** August 2026

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
    {"pid": 1234, "name": "blender.exe", "used_mb": 2048, "kind": "compute"}
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

## WebSocket

### Connect
```
ws://localhost:8000/ws
```

### Message types received
- `job.queued` — Job added to queue
- `job.started` — Job started processing
- `job.progress` — Progress update (0.0 to 1.0)
- `job.completed` — Job finished successfully
- `job.failed` — Job failed with error
- `job.cancelled` — Job was cancelled
- `system.health_changed` — Health status changed
- `heartbeat` — Keep-alive ping (every 30s)
