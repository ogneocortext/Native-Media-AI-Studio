# Native Media AI Studio — Project Guidelines (v3)

> **Last Updated:** 2026-09-05
> **Status:** Active Development (Phase 1+2 — Music Video Wizard, 2D/LRC Visualizer, 3D Gen, Unity/Blender/Remotion)
> **Purpose:** Living specification and implementation guide for the creative production environment.

---

## 1. Project Vision & Core Principles

**Native Media AI Studio** is a full-stack, AI-powered creative workstation for generating music-driven media, images, and visualizers. It is designed as an integrated desktop environment rather than a collection of scattered scripts.

### 1.1 Non-Goals (What This Is NOT)
To maintain velocity and respect hardware limits, the following are strictly **out of scope** for Phase 1:
- Cloud deployments or Kubernetes configurations.
- Multi-user authentication or role-based access control (Single-user trust model only).
- Heavy external dependencies like Redis or Docker (unless absolutely necessary).
- Running multiple massive models concurrently in VRAM.

---

## 2. Hardware Constraints & Decisions Already Made

Design conservatively for a **local Windows machine** with constrained resources:

| Resource | Constraint |
|----------|------------|
| **CPU** | Ryzen 5 5500-class (6 cores) |
| **GPU** | GTX 1070 Ti — 8GB VRAM |
| **RAM** | 32GB |

### 2.1 Locked Implementation Choices
To prevent decision fatigue, the following stack choices are finalized:
- **Frontend:** React + Vite, Zustand for state management, Tailwind for styling.
 - **Backend:** FastAPI, SSE (`GET /api/events`, `sse-starlette`) for live events — WebSocket `/ws` is a legacy 426 shim.
 - **Queue/Persistence:** SQLite for lightweight job tracking, JSON sidecars for output metadata.
 - **Visuals:** Three.js / `@react-three/fiber` + Canvas2D (`Canvas2DVisualizer` bars/waveform/radial) + Remotion; WebGL accelerated.
 - **Integrations:** API adapters for local ComfyUI, Ollama, Blender MCP (port 9876), Unity MCP (port 7800).

---

## 3. Core Data Models & Contracts

Defining these contracts upfront ensures seamless frontend-backend communication.

### 3.1 Job Queue Model
All generations pass through a unified queue with the following schema:
```json
{
  "job_id": "uuid",
  "type": "image_generation | audio_analysis | character_render",
  "status": "PENDING | RUNNING | COMPLETED | FAILED | CANCELLED",
  "payload": { "prompt": "...", "config": {} },
  "progress": 0.45,
  "result_path": "/output/images/job_id.png",
  "error": null,
  "created_at": "timestamp"
}
```

### 3.2 Real-Time Events (SSE)
The backend pushes real-time updates to the UI via **Server-Sent Events** (`GET /api/events`, `sseService.ts`):
- `job.queued`, `job.started`, `job.progress`, `job.completed`, `job.failed`
- `system.health_changed` (e.g., ComfyUI went offline)
- `system.resource_warning` (e.g., High VRAM usage)
- Legacy `ws://…/ws` returns `426` — use SSE `events_url`/`sse_url` from `config/ports.json`.

### 3.3 Output Directory & Metadata
Outputs must be strictly organized. Every generated media file gets a JSON sidecar:
- `output/images/2026-04-21_143022.png`
- `output/images/2026-04-21_143022.json` (Contains `job_id`, `prompt`, `seed`, `model`, `generation_time`)

---

## 4. Required Architecture & Monorepo Structure

```text
Native-Media-AI-Studio/
├── packages/frontend/    # React/Vite UI (port 5173) + Remotion video-editor (8080)
├── packages/backend/     # FastAPI Server (port 8000) — ComfyUI on 8188
│   ├── app/api/          # REST routes (jobs, health, audio, outputs, docs, sse)
│   ├── app/sse/          # SSE handler (canonical); app/websocket/ is legacy shim
│   ├── app/core/         # Port manager, Health monitor, SQLite setup
│   ├── app/services/     # Job orchestration, audio, blender, cuda, gen3d, vram_manager
│   ├── app/diagnostics/  # resources / health diagnostics
│   └── app/adapters/     # ComfyUI, Ollama, Blender, Unity wrappers
├── shared/               # TypeScript types (Job, QueueStats, OutputFile, ...)
├── config/               # ports.json (dynamic) + settings.json
├── output/               # Generative outputs (images, video, audio, generated_3d) — gitignored
├── tools/                # MCP bridges (unity-mcp-bridge.mjs, vision.mjs) + demos
└── scripts/              # start-studio.ps1, manage-servers.ps1
```

### 4.1 Dynamic Port System
To avoid conflicts, the app must resolve ports at startup:
1. Attempt to bind default ports (Backend: `8000`, Frontend: `5173`).
2. If occupied, safely kill orphaned Python processes from previous crashes.
3. If still occupied, increment port number.
4. Write final configuration to `config/ports.json` for the UI to consume before mounting.

---

## 5. Phase 1 Scope & Acceptance Criteria

### Feature 1: Bootstrap & Shell
- **AC1:** Running `./scripts/start.bat` boots both frontend and backend successfully.
- **AC2:** App auto-detects and resolves port conflicts, saving state to `ports.json`.
- **AC3:** UI shell loads with a persistent navigation sidebar and active health indicators.

### Feature 2: Health & Diagnostics
- **AC1:** `GET /api/health` returns aggregate status of the backend and all configured adapters.
 - **AC2:** If ComfyUI/Ollama crashes, the frontend health badge updates from "Online" to "Offline" within 5 seconds via SSE (`GET /api/events`).

### Feature 3: Universal Job Queue
- **AC1:** User can submit an image generation job, which enters `PENDING` state.
- **AC2:** Queue executes jobs serially (1 at a time) to prevent VRAM overflow.
- **AC3:** User can cancel a `RUNNING` job and retry a `FAILED` job from the UI.

### Feature 4: External Integrations (Adapters)
- **AC1:** Abstract `BaseAdapter` class exists.
- **AC2:** SD WebUI adapter successfully translates the app's internal job payload into SD WebUI's API format.
- **AC3:** Jobs generated via adapters correctly save to the `output/` folder with JSON sidecars.

### Feature 5: Visualizer Foundation
- **AC1:** Three.js canvas loads in a dedicated workspace tab.
- **AC2:** Base scene supports basic camera controls (orbit, pan, zoom) holding 30fps.
- **AC3:** Canvas accepts dummy audio data to trigger basic scale/color reactions.

---

## 6. Development Workflow & Standards

### Starting the App
```powershell
pnpm start  # or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-studio.ps1
pnpm servers status
```

### Code Standards
- **Backend:** Pydantic models must be the single source of truth for schemas. Keep API routes thin; place business logic in `/services`.
- **Frontend:** No hardcoded API URLs. Always read from `ports.json` or Vite env vars. Health/SSE calls fall back to direct backend URL when proxy is down.
- **Testing:** Focus on backend unit tests for the Queue and Port Manager. E2E tests are secondary for Phase 1.

---

## 7. Music Video Workflow

### 7.1 Audio Upload
Audio files are uploaded via `POST /api/audio/upload` with multipart form data. Files are stored in `output/audio/` with UUID-prefixed names to prevent collisions. Supported formats: MP3, WAV, FLAC, OGG, M4A, WMA, AAC (max 500 MB).

### 7.2 Audio Analysis
Uploaded audio is analyzed using librosa for:
- **Tempo (BPM)** detection
- **Beat times** and beat frames
- **Onset detection** for granular timing
- **Amplitude envelope** (waveform visualization data)
- **Spectral features** (centroid, rolloff, bandwidth)

### 7.3 Video Generation
Music video jobs support 4 visualization styles:
- **Abstract** — Flowing color fields driven by audio
- **Waveform** — Classic oscilloscope-style visualization
- **Particles** — Swirling particle system
- **Geometric** — Sharp geometric shapes pulsing to beat

Plus 5 color schemes: auto, warm, cool, neon, monochrome.

### 7.4 Preview Generation
Preview jobs render a 5-second 720p draft at 24fps. This provides quick feedback before committing to a full render.

### 7.5 Job Progress
The UI tracks progress through stages:
1. Upload (0-100%)
2. Audio analysis (0-100%)
3. Video rendering (0-100%)
4. Completion with output path

---

## Appendix: Phase 2 Status (formerly Deferred)

The following were deferred in v2 and have since shipped — kept here for traceability:

- **Real-time Audio Reactivity:** ✅ `Canvas2DVisualizer` bars/waveform/radial + `VisualizerScene`/`ShaderVisualizer` + `PostFX` bloom (LRC `isPhraseStart`/`sectionProgress` reactive)
- **Lyric Video / Kinetic Typography:** ✅ 8 genre presets via `anime.js` + `Theatre.js` Studio panel + LRC `offset`/multi-stamp parser + WhisperX transcription
- **Album Art / Cover Extraction:** ✅ FFmpeg `attached pic` → `audio/*.jpg` sidecar, returned as `cover_image` in `GET /api/outputs`
- **Custom ComfyUI Workflow Integration:** ✅ `comfyui-mcp` custom workflows, Hunyuan3D-2mini (Wan 2.2 5B 480p fits 8GB) + ComfyUI-Hunyuan3DWrapper

Remaining future scope (Phase 3+):
- **Advanced Video Effects:** Chromatic aberration, motion blur, film grain overlays (partially done via `PostFX` but not full Remotion `@remotion/effects` chain)
- **Multi-user / Cloud:** Still out of scope per §1.1
