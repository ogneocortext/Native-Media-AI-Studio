# 3D Rendering Pipeline - Technical Knowledge Library

**Purpose:** AI agent reference for the Native Media AI Studio 3D rendering system  
**Last Updated:** 2026-08-25 — CUDA 12.4 / Nsight / Audio 0.85 conf / Video 3.16MB / Queue 90% frame / 3D Ready  
**Audience:** AI agents, developers, automated systems

---

## System Architecture

### Service Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NATIVE MEDIA AI STUDIO                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Frontend (Vite + React)                                                    │
│  ├── Port: 5173                                                             │
│  ├── API Proxy: /api → :8000                                                │
│  ├── SSE: EventSource → :8000/api/events                                    │
│  └── Features: Dashboard, Music Video, 3D Studio, Image Generation         │
│                                                                             │
│  Backend (FastAPI + uvicorn)                                                │
│  ├── Port: 8000                                                             │
│  ├── SSE: /api/events (Server-Sent Events)                                  │
│  ├── Routes: /api/jobs, /api/health, /api/integrations, /api/data          │
│  └── Services: Queue, Audio Analysis, Blender, CUDA, Gen3D                 │
│                                                                             │
│  ComfyUI                                                                    │
│  ├── Port: 8188                                                             │
│  ├── Models: hunyuan3d-2mini (diffusion_models)                            │
│  └── API: /system_stats, /history, /queue                                  │
│                                                                             │
│  Blender MCP                                                                │
│  ├── Addon: "Interface: Blender MCP"                                        │
│  ├── Protocol: v4                                                           │
│  ├── Capabilities: execute_code, get_scene_info, get_object_info           │
│  └── Connection: localhost (WebSocket)                                      │
│                                                                             │
│  Hardware                                                                   │
│  ├── GPU: NVIDIA GeForce GTX 1070 Ti (8GB VRAM, sm_61 Pascal, 19 SMs)      │
│  ├── CUDA: 12.4 (nvcc V12.4.99) / Driver 582.66 CUDA 13.0 compat            │
│  ├── PyTorch: 2.5.1+cu124 (comfyui-cuda) / 2.6.0+cu124 (venv)                │
│  └── Profilers: Nsight Systems 2026.1.3 + Nsight Compute 2026.2.0           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Environment Paths

```python
# Critical paths for AI agents
PATHS = {
    # Project
    "project_root": "<your-project-root>",
    "frontend": "<your-project-root>/packages/frontend",
    "backend": "<your-project-root>/packages/backend",
    
    # Python environments
    "backend_venv": "<your-project-root>/venv/Scripts/python.exe",
    "comfyui_conda": "<your-comfyui-conda-env>/Scripts/python.exe",
    
    # ComfyUI
    "comfyui_root": "<your-comfyui-root>",
    "hunyuan3d_model": "<your-comfyui-root>/models/diffusion_models/hunyuan3d-2mini",
    
    # Output
    "output_dir": "<your-project-root>/output",
    "generated_3d": "<your-project-root>/output/generated_3d",
    "logs": "<your-project-root>/output/logs",
    
    # Blender
    "blender_executable": "<your-blender-path>/blender.exe",
}
```

---

## API Reference

### Health & Status

```bash
# Backend health
GET http://localhost:8000/api/health
# Response: {"status": "healthy", "backend": "online", "adapters": {...}}

# GPU snapshot
GET http://localhost:8000/api/health/gpu
# Response: {"available": true, "name": "...", "memory_used_mb": ..., ...}

# 3D generation status
GET http://localhost:8000/api/health/3d/status
# Response: {"available": true, "model_exists": true, "generated_count": 0}

# ComfyUI system stats
GET http://localhost:8188/system_stats
# Response: {"system": {...}, "devices": [...]}
```

### 3D Generation

```bash
# Generate 3D model from text
POST http://localhost:8000/api/health/3d/generate
Content-Type: application/json

{
    "prompt": "a futuristic robot",
    "output_name": "my_robot",
    "steps": 15,
    "seed": 42
}

# Response: {"success": true, "model_path": "..."}
```

### Blender MCP (via MCP protocol)

```python
# Get scene info
blender_get_scene_info()

# Get object info
blender_get_object_info(object_name="Cube")

# Execute Python code in Blender
blender_execute_blender_code(code="""
import bpy
bpy.ops.mesh.primitive_uv_sphere_add(radius=2, location=(0, 0, 0))
""")

# Get viewport screenshot
blender_get_viewport_screenshot()
```

### ComfyUI (via comfyui-mcp)

```python
# Generate image
comfyui_generate_image(action="image", prompt="...", width=512, height=512)

# Check queue status
comfyui_queue(action="status", prompt_id="...")

# Get generation history
comfyui_get_history(action="list")
```

---

## Service Management

### Starting Services

```powershell
# Backend
$venvPython = "D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\venv\Scripts\python.exe"
Start-Process -FilePath $venvPython -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" -WindowStyle Hidden

# ComfyUI
$comfyuiPython = "D:\conda-envs\comfyui-cuda\Scripts\python.exe"
Start-Process -FilePath $comfyuiPython -ArgumentList "main.py","--port","8188","--disable-pinned-memory" -WorkingDirectory "D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI" -WindowStyle Hidden

# Frontend
$nodeExe = "$env:APPDATA\fnm\aliases\default\node.exe"
$viteJs = "D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\frontend\node_modules\vite\bin\vite.js"
Start-Process -FilePath $nodeExe -ArgumentList "`"$viteJs`"", "--port", "5173" -WorkingDirectory "D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\frontend" -WindowStyle Hidden
```

### Checking Service Health

```powershell
# Check if ports are listening
Get-NetTCPConnection -LocalPort 8000,8188,5173 -State Listen

# Test backend API
Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing

# Test ComfyUI
Invoke-WebRequest -Uri "http://localhost:8188/system_stats" -UseBasicParsing
```

---

## Data Models

### Job Model

```python
{
    "id": "uuid",
    "job_type": "image_generate" | "video_generate" | "3d_generate" | "audio_analyze",
    "status": "pending" | "running" | "completed" | "failed" | "cancelled",
    "params": {...},
    "result": {...},
    "progress": 0.0-1.0,
    "created_at": "ISO timestamp",
    "updated_at": "ISO timestamp"
}
```

### Audio Analysis Result

```python
{
    "tempo_bpm": 120.0,
    "beat_timestamps": [0.0, 0.5, 1.0, 1.5, ...],
    "sections": [
        {"type": "intro", "start": 0.0, "end": 12.5, "energy": 0.3},
        {"type": "verse", "start": 12.5, "end": 38.0, "energy": 0.5},
        {"type": "chorus", "start": 38.0, "end": 63.5, "energy": 0.9},
    ],
    "duration_seconds": 180.0,
    "key": "C major",
    "energy_curve": [0.1, 0.2, 0.3, ...],
    "valence": 0.8,
    "danceability": 0.7
}
```

### 3D Generation Request

```python
{
    "prompt": "string - description of the 3D object",
    "output_name": "string - filename without extension",
    "steps": 15,  # 5-50, lower = faster
    "seed": 42    # -1 for random
}
```

### 3D Generation Result

```python
{
    "success": true,
    "model_path": "D:\\...\\output\\generated_3d\\my_robot.glb",
    "stdout": "3D model saved to: ..."
}
```

---

## GPU Constraints & Optimization — 2026 Updates

### Blender 5.1 / 5.2 Notes (web synthesis Aug 2026)
- **5.1:** +10% GPU render (various scenes), +20% CPU Windows, AMD HIP RT default — upgrade path.
- **Backend select:** RTX→OptiX (30-50% over CUDA), GTX 1070 Ti→CUDA; set `Device→GPU Compute`; CPU+GPU only if CPU high-core.
- **EEVEE Next:** screen-space raytracing overhaul + Fast GI; ray-traced shadows/GI slower → enable selectively; if viewport <24 fps, decimate (Collapse general, Un-Subdivide only if subdivided) + instances.
- **Shader/Geo:** remove custom split normals, merge by distance, UDIM atlases.

### GTX 1070 Ti (8GB VRAM) Limits — Revised

| Task | Max Resolution | Notes |
|------|---------------|-------|
| Image Generation | 512x512 | 768x768 possible with --disable-pinned-memory |
| 3D Generation (Hunyuan3D-2mini) | Default | Optimized for 8GB ~5GB |
| Video Generation — Wan 2.2 5B | 480p 832×480 ✅ | 6-8GB fits; 720p tight, needs GGUF+offload |
| Video Generation — Wan 2.2 14B | 720p | 24GB+ — cloud only (A6000 48GB) |
| AnimateDiff/SVD | 512x512 16f | 12GB comfortable, 8GB limited |
| Blender Rendering | 1080p | EEVEE Next real-time; Cycles 128 samples |

### VRAM Management

```bash
# Start ComfyUI with memory optimization
python main.py --port 8188 --disable-pinned-memory

# Check VRAM usage
GET http://localhost:8000/api/health/gpu
# Response includes: memory_used_mb, memory_free_mb, memory_total_mb, memory_percent
```

### Common OOM Solutions

1. Reduce resolution (512x512 instead of 1024x1024)
2. Use --disable-pinned-memory flag
3. Close other GPU applications
4. Use smaller models (Hunyuan3D-2mini instead of full)
5. Generate one at a time (don't batch)

### CUDA Toolkit & Programming Guide — 2026-08-25 Research

> Source: [`https://docs.nvidia.com/cuda/cuda-programming-guide/index.html`](https://docs.nvidia.com/cuda/cuda-programming-guide/index.html) (v13.3 displayed; project uses **Toolkit 12.4 / `nvcc V12.4.99` / Driver `582.66` CUDA 13.0 compat**).
> **Pin archive for this project:** `https://docs.nvidia.com/cuda/archive/12.4.0/cuda-c-programming-guide/` — v13.x drops Pascal `sm_61` entirely (`packages/backend/requirements-torch.txt:30`).

#### Hardware pin (GTX 1070 Ti — Pascal `sm_61`)

- **Do not upgrade toolkit to 13.x** — no `sm_61` kernels will build. Keep `CUDA_HOME=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4` and `TORCH_CUDA_ARCH_LIST=6.1` when building extensions (`requirements-torch.txt:24`).
- **No Tensor Cores, no `sm_80+` features.** `torch.compile()` unsupported on Pascal (`environment.yml:115`). Stay `float32` for `torch.stft`/`torch.fft` in `app/services/cuda/processor.py:98`.
- Torch wheels bundle their own runtime (`cu121` index, `torch 2.5.1+cu121` / `2.6.0+cu124` verified); system toolkit only needed for **custom kernel builds**.

#### What is worth reading for this project

| Guide section | Why it matters here | File refs |
|---|---|---|
| **Part 2.5 Asynchronous Execution + 4.2 CUDA Graphs + 4.3 Stream-Ordered Allocator** | Biggest win: `processor.py:92` is sync per-call (`as_tensor` → `stft` → `.cpu()`). Overlapping `CudaAudioAnalyzer` + `CudaImageProcessor` with `torch.cuda.Stream()` and capturing repeated `analyze()` in `CUDAGraph` would cut batch latency. PyTorch already uses stream-ordered alloc internally. | `app/services/cuda/processor.py:77` |
| **Part 2.6 / 4.1 Unified Memory + 5.2 Environment Variables** | Debug OOM without code change: `CUDA_VISIBLE_DEVICES=0`, `CUDA_LAUNCH_BLOCKING=1`, `compute-sanitizer`. Complements `vram_manager.py:80` + `GET /api/health/gpu`. | `app/services/vram_manager.py:80` |
| **Part 1 Programming Model + 5.1 Compute Capabilities** | Explains occupancy/memory model behind librosa→torch port. Confirms Pascal limits. | `tools/analyze_and_sync.py:44` (still CPU `beat_track`) |
| **Part 2.2 Intro to CUDA Python** | More relevant than C++ Ch.2.1 if you port beat-tracking beyond PyTorch (`numba`/`cupy`). | — |
| **Part 3.5 Tour of Features → Nsight Systems** | System-level timeline for the full pipeline (`analyze_and_sync.py` + ComfyUI). Installed: `Nsight Systems 2026.1.3` — see below. | — |

#### What to skip on this GPU

`4.6 Green Contexts`, `4.10 Pipelines`, `4.11 Async Copies`, `4.12 Cluster Launch Control`, `2.4 Tile Kernels` — require `sm_80+` (Ampere/Hopper). They compile on 12.4 but fault or are no-ops on `sm_61`.

#### Nsight Systems — installed (verified 2026-08-25) — **now on PATH**

```powershell
nsys --version
# → 2026.1.3.243 (User PATH: ...\Nsight Systems 2026.1.3\target-windows-x64)
ncu --version
# → 2026.2.0.0   (User PATH: ...\Nsight Compute 2026.2.0)

# GUI
& "C:\Program Files\NVIDIA Corporation\Nsight Systems 2026.1.3\host-windows-x64\nsys-ui.exe"
```

**WDDM / GeForce caveat (hit today):** `nsys profile --trace=cuda` returns `No CUDA events collected` on this GTX 1070 Ti WDDM setup without Admin. Diagnostics in `_DIAGNOSTIC_EVENT` showed CUPTI `cupti64_133.dll` loaded but flushed with zero events. `nsys status --environment` → `Sampling Environment: Fail` when not elevated.

**Workaround that works without Admin — `torch.profiler` (used 2026-08-25):**

```powershell
$env:PYTHONPATH="packages/backend"
.\venv\Scripts\python.exe output/logs/_torch_profiler.py  # generates output/logs/torch-prof-trace.json
```

Trace: `output/logs/torch-prof-trace.json` (10 MB, open in `chrome://tracing` or `https://ui.perfetto.dev`).

**Real profile — `CudaAudioAnalyzer.analyze()` on 30s audio (venv `torch 2.6.0+cu124`, GTX 1070 Ti):**

| Kernel | Self CUDA | % | Note |
|---|---|---|---|
| `aten::abs` | 127 ms | 28% | `magnitude = torch.abs(stft)` dominates — `processor.py:109` |
| `aten::abs` (2nd, 60s file) | 95 ms | 37% | Same hotspot scaled |
| `aten::hann_window` | 22 ms | 8.8% | Allocates new window each call |
| `aten::mm` / `aten::matmul` | 54 ms | 12% | Only in viz/matmul path |
| `aten::stft` | ~9 ms | 2% | Surprisingly cheap — not bottleneck |
| **Total** | **~452 ms self CUDA / 451 ms CPU** | — | `cuda_audio_analyze` wall 303 ms for 30s file; 254 ms for 60s file |

**Findings applied to `app/services/cuda/processor.py`:**
- Hotspot is *not* `torch.stft` — it's the downstream `abs`/`pow`/`hann_window` chain. Caching `hann_window` and fusing `magnitude ** 2` would shave ~30 ms.
- `n_frames=1292` for 30s @ 22050/512 matches librosa; pipeline spends ~24s wall in `tools/analyze_and_sync.py:44` (`librosa.beat.beat_track` on CPU) — GPU STFT saves <0.5s there. Biggest win is parallelizing beat tracking or batching multiple files with `torch.cuda.Stream` + `CUDAGraph`, not micro-optimizing STFT.
- `CudaImageProcessor` `aten::_upsample_bilinear2d_aa` 12 ms — `antialias=True` costs; drop if not needed.

To get full `nsys` CUDA timeline (requires Admin):
```powershell
# Run PowerShell as Administrator, then:
nsys profile --trace=cuda,nvtx --force-overwrite=true -o output/logs/nsys-audio-admin `
  .\venv\Scripts\python.exe tools/analyze_and_sync.py output/audio/796d0367-65fa-4c60-a720-9e0ed6f56b51.wav
nsys stats --report cuda_api_sum output/logs/nsys-audio-admin.nsys-rep
# Or open .nsys-rep in nsys-ui.exe
```

#### Applied fixes 2026-08-25 (verified)

- **GPU health fallback**: `app/diagnostics/resources.py:541` + `app/services/vram_manager.py:109` now fallback to `torch.cuda.mem_get_info`/`get_device_properties` when `pynvml` fails (System Python hardcodes `NVSMI/nvml.dll` missing on WDDM; ghost workers `PIDs 20460/37124` blocked restart). Also patched `C:\...\Python311\Lib\site-packages\pynvml.py:641` to `System32\nvml.dll`. Verified `GET /api/health/gpu` `available:true 3782/8192 MB` + `GET /api/integrations/cuda/status` `available:true GTX 1070 Ti` after `venv` restart `PID 23524`.
- **Frontend endpoint**: `packages/frontend/src/services/api.ts:607` corrected `/api/health/integrations/cuda/status` 404 → `/api/integrations/cuda/status` with fallback; banner now `role=status` shows `CUDA Available` + VRAM badge + `fallback` badge, `GPU on/off` toggle, `CPU Mode` fallback text. `AudioAnalysisPage.tsx:100` adds `previewUrl`/`validateFile`/`audio` preview, `fileError`, `border-dashed` states, beats sampled to ≤80, `Select all`, `filtered/paged` library empty states (`No files match + Clear filter`), `aria-*`.
- **Integration fix**: `packages/backend/app/api/integrations_generation.py:19` defined `ImageGenerationRequest`/`VideoGenerationRequest` locally (was `NameError`), cleared `__pycache__`, backend now starts.
- **Confidence**: `app/services/audio_analyzer.py:224` windowed onset (`p85` ±1) + regularity (`CV`) + dynamic → `0.28→0.85` on `182s 143BPM` (`0.86-0.88` on `5` library files)
- **Video**: `music_video_handler.py:231` `showspectrum rate` → `Option not found` fix, `QueueList.tsx:109` renders `<video>` via `/output/video/{file}` + `Download`/`Open`, `crf 23 preset fast` (`772MB→3.16MB 5s`), `-t duration` (was full `4:24` → `timeout`), palette by `section`/`energy`
- **Queue progress**: `music_video_handler.py:316` stream `stderr` `\r` `frame=` → `0.5→1.0` `Rendering frame X/Y (Z%)` (was `50%` stuck), verified `6s` `50%→85% 125/180→97% 170/180→100%`
- **3D UX**: `gen3d/service.py:24` `..core`→`...core` (`500→200`), `Generation3DPage.tsx` auto-load `status`/`history`, `elapsed` timer, `wordCount`, model cards `VRAM`/`time`, `steps` slider, progress `elapsed/~est`, `Recent Models` `.glb`
- **UX verified**: `output/logs/playwright-test/` `audio-ux.spec.ts` 4/4 + `gen3d-improved.spec.ts` 2/2 + `studio.spec.ts` 3/3 + `queue-video` 2/2 pass, `frontend build` 516 KB gzip ok.

---

## Blender Scene Builder

### Available Methods

```python
from app.services.blender.builder import BlenderSceneBuilder

builder = BlenderSceneBuilder(
    render_engine="CYCLES",  # or "EEVEE"
    resolution=(1920, 1080),
    fps=24
)

# Generate scene scripts
builder.clear_scene()           # Clear default scene
builder.create_stage()          # Create concert stage
builder.add_character()         # Add character with rig
builder.add_prop()              # Add prop/scenery
builder.setup_camera()          # Position camera
builder.setup_lighting()         # Configure lights
builder.animate_to_beats()      # Beat-synced animation
```

### Scene Components

```python
# Stage types
STAGE_TYPES = [
    "concert_platform",
    "club_interior",
    "outdoor_festival",
    "abstract_void",
    "custom"
]

# Lighting setups
LIGHTING_SETUPS = [
    "dynamic_rig",      # Beat-synced moving lights
    "static_ambient",   # Constant ambient
    "spotlight",        # Single spotlight
    "neon_glow",        # Neon/cyberpunk
    "natural"           # Sunlight/moonlight
]

# Camera presets
CAMERA_PRESETS = [
    "cinematic_24mm",
    "wide_angle",
    "telephoto",
    "fisheye",
    "orbit"
]
```

---

## Audio Analysis Service

### CUDA Processor

```python
from app.services.cuda.processor import CUDAProcessor

processor = CUDAProcessor()

# Analyze audio file
result = processor.analyze("path/to/audio.mp3")
# Returns: tempo, beats, spectral features, onset envelope

# Generate FFT visualization
viz = processor.generate_fft_visualization("path/to/audio.mp3")
```

### Audio Features Extracted

| Feature | Description | Use Case |
|---------|-------------|----------|
| tempo_bpm | Beats per minute | Animation speed |
| beat_timestamps | Beat positions | Cut timing |
| onset_strength | Note onsets | Visual events |
| spectral_centroid | Brightness | Color mapping |
| spectral_rolloff | Bass/treble | Energy mapping |
| zero_crossing_rate | Noisiness | Texture choice |
| mfcc | Timbre | Instrument detection |
| chroma | Harmony | Color palette |

---

## Frontend Components

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `Studio3D.tsx` | `features/studio3d/` | 3D generation UI |
| `MusicVideo.tsx` | `features/music-video/` | Music video creation |
| `HealthPage.tsx` | `features/health/` | System diagnostics |
| `Dashboard.tsx` | `features/dashboard/` | Main entry point |
| `api.ts` | `services/` | Backend API client |
| `portConfig.ts` | `services/` | Dynamic port configuration |

### Adding a New Feature Page

1. Create component in `src/features/my-feature/MyFeature.tsx`
2. Add route in `App.tsx`:
   ```tsx
   <Route path="/my-feature" element={<MyFeature />} />
   ```
3. Add sidebar link in `components/layout/Sidebar.tsx`
4. Add API functions in `services/api.ts`

---

## Common Operations

### Generate a 3D Model

```bash
# Via API
curl -X POST http://localhost:8000/api/health/3d/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a futuristic robot", "steps": 15}'

# Via frontend
# Navigate to /studio-3d, enter prompt, click "Generate 3D Model"
```

### Create a Blender Scene

```python
# Via Blender MCP
blender_execute_blender_code(code="""
import bpy
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
bpy.ops.object.light_add(type='SUN', location=(5, 5, 10))
""")
```

### Check System Health

```bash
# All services
curl http://localhost:8000/api/health | python -m json.tool

# GPU only
curl http://localhost:8000/api/health/gpu | python -m json.tool

# ComfyUI
curl http://localhost:8188/system_stats | python -m json.tool
```

---

## Error Codes & Troubleshooting

### Backend Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `{"success": false, "error": "3D generation service not available"}` | Model or env missing | Check paths in `gen3d/service.py` |
| `{"error": "CONNECTION_ERROR"}` | ComfyUI down | Start ComfyUI on port 8188 |
| `GPU data unavailable` | nvidia-ml-py missing | `pip install nvidia-ml-py3` |

### ComfyUI Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Model not found` | Wrong path | Check `hunyuan3d-2mini` exists |
| `CUDA out of memory` | VRAM exhausted | Reduce resolution, close apps |
| `Import error` | Missing dependency | Install in comfyui-cuda env |

### Blender MCP Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Could not connect` | Addon disabled | Enable in Preferences > Add-ons |
| `Server not running` | MCP stopped | Click "Start MCP Server" in sidebar |
| `Protocol version mismatch` | Outdated addon | Run `uvx blender-mcp install-addon` |

---

## Development Notes

### Adding a New API Endpoint

1. Create route file in `packages/backend/app/api/`
2. Register in `packages/backend/app/main.py`:
   ```python
   from .api import my_new_route
   app.include_router(my_new_route.router)
   ```
3. Add frontend API function in `packages/frontend/src/services/api.ts`

### Adding a New Service

1. Create service in `packages/backend/app/services/my_service/`
2. Create `__init__.py` with singleton instance
3. Import and use in API routes

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_BACKEND_URL` | `http://127.0.0.1:8000` | Frontend API target |
| `VITE_BACKEND_PORT` | `8000` | Backend port |
| `VITE_FRONTEND_PORT` | `5173` | Frontend port |
| `COMFYUI_PATH` | (auto) | ComfyUI installation |
| `CUDA_VISIBLE_DEVICES` | `0` | GPU device index |

---

## GPU Per-Process Memory Monitoring

### Backend Endpoint

`GET /api/health/gpu/processes` returns per-process GPU memory usage via Windows Performance Counters (`win32pdh`).

### Response Format

```json
{
  "processes": [
    {"pid": 7408, "name": "llama-server.exe", "mem_mb": 2047},
    {"pid": 15440, "name": "wallpaper32.exe", "mem_mb": 1115},
    ...
  ],
  "count": 30
}
```

### How It Works

1. Opens a PDH query to `\GPU Process Memory(*)\Dedicated Usage`
2. Collects query data and iterates instances (`pid_<PID>_luid_...`)
3. Extracts PID from instance name, filters out invalid/sentinel values
4. Resolves process names from PIDs via `GetModuleFileNameExA`
5. Returns list sorted by memory descending

### Why Not NVML?

NVML's `nvidia-smi --query-compute-apps=used_memory` requires accounting mode (`nvidia-smi -am 1`) which needs admin privileges and is only reliably supported on Quadro/Tesla GPUs. On GeForce with WDDM, it returns `[N/A]`.

Windows Performance Counters work without admin on all WDDM GPUs (GeForce, Quadro, RTX).

### Frontend Display

The GPU card in System Health fetches from both `/api/health/gpu` (total VRAM, utilization, temperature) and `/api/health/gpu/processes` (per-process breakdown), then displays the top 8 processes by memory usage with human-readable formatting (MB/GB).

## Vision Analysis (Ollama)

### The Problem

The `vision-mcp` tool fails with `Ollama API error: 400` when images are too large. This is a known limitation of Ollama's vision API — large base64 payloads get rejected before the model even processes them.

### The Solution

Use `tools/mcp/vision.mjs` which resizes images via sharp before sending to Ollama:

```bash
# Analyze a screenshot
node tools/mcp/vision.mjs analyze screenshot.png "Describe the UI"

# Analyze with specific model
node tools/mcp/vision.mjs analyze screenshot.png "What errors are visible?" --model qwen3-vl:2b

# Compare two screenshots
node tools/mcp/vision.mjs compare before.png after.png

# Diff two versions
node tools/mcp/vision.mjs diff old.png new.png
```

### How It Works

1. Resizes image to max 1024px using sharp (or 640px with `--low` for text-dense UI)
2. Converts to JPEG at 80% quality (~80KB output)
3. Sends base64 to Ollama's `/api/generate` endpoint
4. Returns the model's analysis

Default model: `gemma4:e2b-it-qat`. Override with `--model` or `VISION_MODEL` env var.

### Available Vision Models

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `qwen3-vl:2b` | 2B | Fast | Good |
| `qwen3-vl:4b` | 4B | Medium | Better |
| `gemma4:e2b-it-qat` | 2B | Fast | Good |

### Direct API Usage

```python
import base64, json, urllib.request
from PIL import Image
import io

img = Image.open("screenshot.png")
img.thumbnail((600, 600), Image.LANCZOS)
buf = io.BytesIO()
img.save(buf, format="JPEG", quality=60)
b64 = base64.b64encode(buf.getvalue()).decode()

body = json.dumps({
    "model": "qwen3-vl:2b",
    "messages": [{"role": "user", "content": "Describe this", "images": [b64]}],
    "stream": False
})

req = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=body.encode(), headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req, timeout=180)
result = json.loads(resp.read())
print(result["message"]["content"])
```

### Key Constraints

- **Max image dimension**: 1200px (larger works but diminishing returns)
- **Format**: JPEG at 70% quality (PNG also works but larger)
- **Timeout**: 180s per attempt, 3 retries
- **Ollama must be running**: `ollama serve`

---

## YouTube Publishing Checklist

Before uploading any video to AI-generated music video to YouTube:

- [ ] Video renders without errors
- [ ] Audio is synchronized with visuals
- [ ] Cuts land on musical events (not random)
- [ ] Chorus has peak visual impact
- [ ] Character consistency maintained (if applicable)
- [ ] Scene consistency maintained (if applicable)
- [ ] Subtitles/lyrics aligned (if lyric video)
- [ ] Export format correct (H.264 MP4)
- [ ] Resolution appropriate (1080p minimum)
- [ ] Thumbnail created (hook moment + title)
- [ ] Title optimized for search
- [ ] Description includes timestamps
- [ ] Tags include genre, artist, mood
- [ ] First 3 seconds are highest-hook moment

---

## 3D Audio Visualizer

### Overview

The Visualizer page (`/visualizer`) is a real-time 3D audio visualizer built with Three.js (@react-three/fiber). It analyzes audio frequencies using the Web Audio API's AnalyserNode and maps them to 3D geometry transformations.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Visualizer Page                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────┐  ┌───────────────────────────┐  │
│  │   3D Canvas (Three.js)│  │   Control Panel           │  │
│  │   - AudioReactiveShape│  │   - Track selector        │  │
│  │   - ParticleField     │  │   - File upload           │  │
│  │   - OrbitControls     │  │   - Demo mode toggle      │  │
│  │   - FPSCounter        │  │   - BPM slider            │  │
│  └───────────────────────┘  │   - Background color      │  │
│                             │   - Visual theme          │  │
│  ┌───────────────────────┐  └───────────────────────────┘  │
│  │   Frequency Spectrum   │                                  │
│  │   - Bass/Mid/Treble   │                                  │
│  │   - Beat detection    │                                  │
│  └───────────────────────┘                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Frequency Mapping

| Frequency Range | Target | Effect |
|-----------------|--------|--------|
| 20-250 Hz (Bass) | Icosahedron scale | Geometry expansion pulse |
| 250 Hz-2 kHz (Mids) | Material color | Chromatic HSL shift |
| 2 kHz+ (Treble) | Rotation speed | Axial rotation increase |

### Components

- **AudioReactiveShape**: Icosahedron mesh that scales with bass and shifts color with mids
- **ParticleField**: 250 particles rotating slowly in the background
- **FPSCounter**: Displays current FPS with color-coded performance indicator
- **OrbitControls**: Mouse interaction for camera rotation/zoom

### Audio Sources

1. **Real Audio**: Upload MP3/WAV/FLAC/OGG/M4A or select from media library
2. **Demo Mode**: Synthesized sine waves at configurable BPM (60-180)

### API Integration

- `listAudioFiles()`: Fetches available tracks from backend
- Audio files served at `/api/audio/file/{filename}`

---

*This document is maintained for AI agent consumption. Update when architecture changes.*
