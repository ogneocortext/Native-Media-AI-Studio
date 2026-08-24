# 3D Rendering Pipeline - Technical Knowledge Library

**Purpose:** AI agent reference for the Native Media AI Studio 3D rendering system  
**Last Updated:** 2026-08-24  
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
│  ├── WS Proxy: /ws → :8000/ws                                              │
│  └── Features: Dashboard, Music Video, 3D Studio, Image Generation         │
│                                                                             │
│  Backend (FastAPI + uvicorn)                                                │
│  ├── Port: 8000                                                             │
│  ├── WebSocket: /ws                                                         │
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
│  ├── GPU: NVIDIA GeForce GTX 1070 Ti (8GB VRAM)                            │
│  ├── CUDA: 12.4                                                             │
│  └── PyTorch: 2.5.1+cu124                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Environment Paths

```python
# Critical paths for AI agents
PATHS = {
    # Project
    "project_root": r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio",
    "frontend": r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\frontend",
    "backend": r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\backend",
    
    # Python environments
    "backend_venv": r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\venv\Scripts\python.exe",
    "comfyui_conda": r"D:\conda-envs\comfyui-cuda\Scripts\python.exe",
    
    # ComfyUI
    "comfyui_root": r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI",
    "hunyuan3d_model": r"D:\Backup of Important Data for Windows 11 Upgrade\ComfyUI\models\diffusion_models\hunyuan3d-2mini",
    
    # Output
    "output_dir": r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output",
    "generated_3d": r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\generated_3d",
    "logs": r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\logs",
    
    # Blender
    "blender_executable": r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
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

## Vision Analysis (Ollama)

### The Problem

The `vision-mcp` tool fails with `Ollama API error: 400` when images are too large. This is a known limitation of Ollama's vision API — large base64 payloads get rejected before the model even processes them.

### The Solution

Use the custom `tools/vision_analyze.py` script which resizes images before sending to Ollama:

```bash
# Analyze a screenshot
python tools/vision_analyze.py screenshot.png "Describe the UI"

# Analyze with specific model
python tools/vision_analyze.py screenshot.png "What errors are visible?" qwen3-vl:2b
```

### How It Works

1. Resizes image to max 600px (width or height)
2. Converts to JPEG at 60% quality
3. Sends base64 to Ollama's `/api/chat` endpoint
4. Returns the model's analysis

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

- **Max image dimension**: 600px (larger = 400 error)
- **Format**: JPEG (PNG also works but larger)
- **Timeout**: 180s for large images
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

*This document is maintained for AI agent consumption. Update when architecture changes.*
