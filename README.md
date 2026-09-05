# Native Media AI Studio

A full-stack AI-powered creative production environment for music-driven media generation, image workflows, video creation, and narrative scene rendering.

## Features

- **Guided Music Video Wizard** — 5-step flow (Upload → Analyze → Style → Generate per-section → Export 16:9 + 9:16) with energy-aware sections, beat-synced cuts, and vertical-first safe zones
- **Real Audio Analysis** — `librosa` beat/tempo/onset + RMS energy curve → 8 sections with `energy 0.2-1.0`, beat_times, confidence, and `stored_path` (no mocks)
- **Video Generation (Real)** — `POST /api/video/generate-section` queues `MUSIC_VIDEO` jobs via `queue_manager` → `MusicVideoHandler` (FFmpeg 8.1 `testsrc` + `geq` filter) polling via `GET /api/jobs/{id}`
- **Media Library — File Management** — Grid/list views with **embedded cover art** (FFmpeg extracts `attached pic` from MP3/FLAC → `audio/*.jpg`), **play inline** (`<video controls>` / `<audio controls>` + cover), **rename** (`POST /api/outputs/{path}/rename`), **delete** (removes `.json` + cover sidecar), **bulk delete**, and **duplicate detection** (`GET /api/outputs/duplicates/groups` by hash)
- **3D Scene Generation** — Blender MCP integration for building 3D stages, characters, and beat-synced animation (now LRC `isPhraseStart`/`sectionProgress` reactive via `LrcVizController` + `PostFX` bloom)
- **Unity MCP** — Direct Unity Editor control for scene creation, GameObjects, animation, and rendering
- **3D Model Creation** — Text/image-to-3D via Hunyuan3D-2mini (optimized for 8GB VRAM) + Wan 2.2 5B 480p fits 8GB
- **GPU Audio Analysis** — CUDA-accelerated FFT via `app.services.cuda` with CPU librosa fallback
- **2D Canvas Visualizer (2026)** — `Canvas2DVisualizer` 3 modes `bars/waveform/radial` (PixiJS 8/p5.js-inspired, Canvas2D + Web Audio, LRC phrase flash, 2026 visual-flux/Waviz methods) toggled `3D/FX/2D`
- **Responsive Sidebar** — Collapsible + mobile drawer (`<900px` or portrait) with backdrop, `min-h-0` scroll, health `max-h-[22vh]`
- **Track Manager** — Table view for pairing prompts and lyrics to tracks with persistent storage
- **Storyboards** — Visual scene planning per track with prompts, lyrics, and 3D Studio integration (`/storyboards)
- **AI Visual Generation** — ComfyUI integration with style previews, prompt transformation, and audio-reactive visualization
- **Image Generation** — Text-to-image via ComfyUI with model selector (SD 1.5, Hunyuan3D)
- **Video Generation** — Text/image-to-video via ComfyUI with model selector (Wan 2.2, Kandinsky 5, AnimateDiff)
- **Video Editor** — Remotion-powered studio for audio-reactive music videos
- **Log Viewer** — Centralized logs with analytics dashboard (pie charts, timelines, sparklines), system diagnostics (RAM gauge, per-process memory breakdown), and Ollama model VRAM monitor
- **Queue System** — Job management with real-time SSE status, bulk clear for failed/completed jobs, auto-cleanup of old completed jobs (keeps most recent 100)
- **GPU Monitoring** — Real-time VRAM, utilization, temperature, per-process breakdown, and Ollama model tracker with one-click VRAM offload
- **Database Persistence** — SQLite storage for prompts, audio metadata, AI visuals, and generation sessions
- **GPU Monitoring** — Real-time VRAM, utilization, temperature, and per-process breakdown via `/api/health/gpu`
- **Obsidian Vault** — `docs/knowledge-library/.obsidian/snippets/nstudio-*.css` (pro, immersive, callouts, tables, headers)

## Recent Changes

- **Async Refactoring & VRAM Management (2026-09-05)** — Fixed asyncio refactoring in GPU monitoring and VRAM management using `asyncio.to_thread()`, corrected VRAM offload/reload function calls, enhanced ComfyUI error handling with queue status checks and timeout detection, updated documentation
- **2026 2D + LRC-Driven Visuals (2026-09-02)** — Added `Canvas2DVisualizer.tsx` 3 modes `bars/waveform/radial` (Canvas2D + Web Audio, LRC `isPhraseStart/sectionProgress` reactive, 2026 visual-flux/Waviz methods), fixed LRC `offset`/multi-stamp/`60.00` drift (`lyricsParser.py`/`lyricsParser.ts`/`useLrcSync`), wired 3D `VisualizerScene`/`ShaderVisualizer`/`PostFX` to `lrcSync`, added `AIPresetGallery` browse + `storage/visualizer_presets` persistence, hardened Ollama (`keep_alive 5m`, startup unload, manual `Enhance with AI`)
- **Final Sweep & Hardening** — Fixed missing `import asyncio`, unreachable OOM prevention, refactored to single `asyncio.run()`, enhanced AI code sanitization (strips eval/fetch/setInterval/event listeners), made checkpoint names configurable across backend and MCP
- **Security & Reliability Sweep** — Added fetch timeouts/`res.ok` checks to all MCP servers, fixed WebSocket origin validation, fixed TOCTOU race in queue manager, added threading lock to output cache, fixed PowerShell script errors (undefined functions, broken paths), fixed pnpm workspace config
- **Bug Sweep & Code Quality** — Fixed 18 issues across backend, frontend, and config: removed duplicate imports, fixed deprecated asyncio API, removed debug prints/memory leaks, corrected TypeScript package names, standardized config paths, added ESLint rules
- **Memory Leak Fixes** — Queue manager auto-cleans completed/failed jobs (keeps most recent 100), resource monitor cleans stale warning entries
- **Adapter Connection Reuse** — ComfyUI and Ollama adapters now reuse a single `aiohttp.ClientSession` per instance, eliminating a thread leak that caused health checks to time out
- **Health Check Timeouts** — Added per-adapter (8s) and global (10s) timeouts to prevent health checks from hanging

## Hardware Targets

| Resource  | Specification                                 |
| --------- | --------------------------------------------- |
| CPU       | Ryzen 5 5500-class (6 cores)                  |
| GPU       | GTX 1070 Ti (8GB VRAM)                        |
| RAM       | 32GB                                          |
| Execution | Serial/queue-based (no excessive parallelism) |

## Project Structure

```
Native-Media-AI-Studio/
├── config/                 # Shared configuration (ports, settings, tracks)
├── docs/                   # All documentation
├── packages/               # Monorepo packages
│   ├── frontend/           # React + Vite UI (port 5173)
│   │   └── src/features/   # Feature-based modules
│   │       ├── ai-tools/         # AI chat + tool registry
│   │       ├── image-generation/ # ComfyUI image gen
│   │       ├── music-video/      # Music video wizard (types + steps)
│   │       ├── settings/         # App settings
│   │       ├── video-generation/ # ComfyUI video gen
│   │       └── visualizer/       # 3D audio visualizer (types + hooks + scene)
│   ├── backend/            # FastAPI backend (port 8000)
│   │   └── app/api/        # Modular API routes
│   │       ├── integrations_config.py    # Config/settings endpoints
│   │       ├── integrations_generation.py # ComfyUI/Ollama/VRAM/Audio
│   │       ├── integrations_music_video.py # Music video endpoints
│   │       └── integrations_misc.py      # CUDA/system/misc endpoints
│   └── video-editor/       # Remotion video editor (port 3000)
├── scripts/                # Server management scripts
├── shared/                 # Shared TypeScript types
├── tools/                  # External tool integrations
├── .vscode/                # VS Code settings
├── package.json            # Root package.json (pnpm workspace)
├── pnpm-workspace.yaml     # PNPM workspace config
├── README.md
├── CHANGELOG.md
└── pyproject.toml          # Root Python config
```

## Quick Start

### Prerequisites

- **Python 3.11+** (via Conda recommended for GPU support)
- **Node.js 20+**
- **pnpm 9+** (`npm install -g pnpm@9`)
- **ComfyUI** installed at your location here
- **Conda environment** `comfyui-cuda` with PyTorch CUDA support

### Start All Services

```powershell
# Start everything (backend, frontend, ComfyUI, video editor)
pnpm start

# Or with PowerShell directly
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1
```

### Manage Individual Services

```powershell
# Check status of all services
pnpm servers status

# Start/stop specific services
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action start -Services comfyui
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action stop -Services frontend

# Restart a service
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-servers.ps1 -Action restart -Services backend
```

### GPU Pipeline (CUDA 12.4 / GTX 1070 Ti)

```powershell
# GPU audio analysis (torch.stft on CUDA)
python -c "from app.services.cuda import cuda_audio; import numpy as np; print(cuda_audio.analyze(np.random.randn(22050)))"

# 3D model generation (Hunyuan3D-2mini)
# POST /api/health/3d/generate {"prompt": "a robot", "steps": 15}

# GPU monitoring
curl http://localhost:8000/api/health/gpu
```

See [GPU Pipeline Guide](docs/guides/GPU_PIPELINE.md) for full documentation.

```bash
# Development
pnpm dev                 # Start frontend
pnpm dev:backend         # Backend (Python)
pnpm dev:comfyui         # ComfyUI
pnpm dev:video           # Video editor

# Build
pnpm build               # Build all pnpm workspace packages

# Database
pnpm db:migrate          # Initialize SQLite database
```

## Services

| Service      | Port | Description                   |
| ------------ | ---- | ----------------------------- |
| Backend      | 8000 | FastAPI + WebSockets + SQLite |
| Frontend     | 5173 | React + Vite UI               |
| ComfyUI      | 8188 | AI image/video generation     |
| Video Editor | 3000 | Remotion studio               |

## API Endpoints

| Endpoint                                  | Method   | Description                                                                                                               |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`                             | GET      | Service health status                                                                                                     |
| `/api/health/gpu`                         | GET      | Real VRAM/util/temps (GTX 1070 Ti)                                                                                        |
| `/api/health/diagnostics/memory`          | GET      | System memory breakdown + top RAM processes                                                                               |
| `/api/health/ollama/models`               | GET      | Currently loaded Ollama models with VRAM usage                                                                            |
| `/api/integrations/comfyui/checkpoints`   | GET      | List available checkpoint models                                                                                          |
| `/api/integrations/music-video/styles`    | GET      | Music video visual styles                                                                                                 |
| `/api/integrations/music-video/templates` | GET      | Video generation workflow templates                                                                                       |
| `/api/integrations/vram/offload-ollama`   | POST     | Unload Ollama models to free VRAM                                                                                         |
| `/api/audio/upload`                       | POST     | Upload audio (500 MB, MP3/WAV/FLAC) → `stored_path`                                                                       |
| `/api/audio/analyze`                      | POST     | Real `librosa` analyze → `tempo_bpm`, `beat_times[800]`, `energy_curve[100]`, `sections[8]`                               |
| `/api/audio/files`                        | GET      | List uploaded audio                                                                                                       |
| `/api/video/generate-section`             | POST     | Queue `MUSIC_VIDEO` section (`prompt`, `audio_path`, `duration`, `vertical_first`) → `job_id` (poll `GET /api/jobs/{id}`) |
| `/api/outputs`                            | GET      | List outputs (`?file_type`/`search`/`limit`) with `cover_image` for audio (`audio/*.jpg` extracted)                       |
| `/api/outputs/recent`                     | GET      | Recent outputs                                                                                                            |
| `/api/outputs/duplicates/groups`          | GET      | Duplicate groups by hash (`?quick=true` 1MB) → `hash`, `wasted_bytes`                                                     |
| `/api/outputs/{file_type}`                | GET      | `images`/`video`/`audio` filtered                                                                                         |
| `/api/outputs/{path}`                     | DELETE   | Delete file + sidecars (`.json`, cover `.jpg`)                                                                            |
| `/api/outputs/{path}/rename`              | POST     | Rename file + sidecars (`{new_name}`)                                                                                     |
| `/api/outputs/bulk-delete`                | POST     | Bulk delete `{paths: string[]}`                                                                                           |
| `/api/jobs`                               | GET/POST | Job queue management                                                                                                      |
| `/api/jobs/{id}`                          | GET      | Poll job (`status`, `progress`, `output_path`)                                                                            |
| `/api/data/tracks/`                       | GET/POST | Track library CRUD                                                                                                        |
| `/api/data/prompts/`                      | GET/POST | Prompt storage                                                                                                            |
| `/api/data/visuals/`                      | GET      | AI-generated visuals                                                                                                      |
| `/api/data/sessions/`                     | GET      | Generation sessions                                                                                                       |
| `/api/data/preferences/`                  | GET/PUT  | User preferences                                                                                                          |
| `/ws`                                     | WS       | WebSocket real-time events (`job.progress`, `job.completed`)                                                              |

## Database

SQLite database at `packages/backend/storage/studio.db` with tables:

- **tracks** — Music library with prompts, lyrics, visual styles

Track data is imported from `docs/track-prompts-lyrics.csv` via `POST /api/data/tracks/import-csv`. The frontend fetches tracks from the backend API at runtime, falling back to embedded CSV data if the backend is unavailable.

- **prompts** — Reusable generation prompts with tags and categories
- **audio_files** — Audio metadata (duration, BPM, key, genre)
- **ai_visuals** — Generated image records with parameters
- **generation_sessions** — Full workflow tracking
- **user_preferences** — UI defaults and settings

## Configuration

Environment variables:

| Variable        | Default  | Description              |
| --------------- | -------- | ------------------------ |
| `BACKEND_PORT`  | 8000     | Backend server port      |
| `FRONTEND_PORT` | 5173     | Frontend dev server port |
| `COMFYUI_PORT`  | 8188     | ComfyUI port             |
| `VIDEO_PORT`    | 3000     | Video editor port        |
| `OUTPUT_DIR`    | ./output | Output directory         |

## Documentation

- [CHANGELOG.md](./CHANGELOG.md) - Version history
- [config/tracks.json](./config/tracks.json) - Track library data

## License

Private project.
