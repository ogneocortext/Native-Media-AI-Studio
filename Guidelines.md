# Native Media AI Studio — Project Guidelines (v2)

> **Last Updated:** August 2026  
> **Status:** Active Development (Phase 1 + Music Video Workflow)  
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
- **Backend:** FastAPI, WebSockets for live events.
- **Queue/Persistence:** SQLite for lightweight job tracking, JSON sidecars for output metadata.
- **Visuals:** Three.js / WebGL for in-app preview rendering.
- **Integrations:** API adapters for local SD WebUI, ComfyUI, and Ollama.

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

### 3.2 WebSocket Events
The backend pushes real-time updates to the UI via WebSockets:
- `job.queued`, `job.started`, `job.progress`, `job.completed`, `job.failed`
- `system.health_changed` (e.g., ComfyUI went offline)
- `system.resource_warning` (e.g., High VRAM usage)

### 3.3 Output Directory & Metadata
Outputs must be strictly organized. Every generated media file gets a JSON sidecar:
- `output/images/2026-04-21_143022.png`
- `output/images/2026-04-21_143022.json` (Contains `job_id`, `prompt`, `seed`, `model`, `generation_time`)

---

## 4. Required Architecture & Monorepo Structure

```text
Native-Media-AI-Studio/
├── frontend/             # React/Vite UI
├── backend/              # FastAPI Server
│   ├── api/              # REST routes & WebSocket handlers
│   ├── core/             # Port manager, Health monitor, SQLite setup
│   ├── services/         # Job orchestration & Queue workers
│   └── adapters/         # SD WebUI, ComfyUI, Ollama wrappers
├── shared/               # TypeScript types generated from Pydantic
├── config/               # default.yaml, integrations.yaml, ports.json
├── output/               # Generative outputs (images, video, audio)
└── scripts/              # start.bat, cleanup.ps1
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
- **AC2:** If SD WebUI crashes, the frontend UI badge updates from "Online" to "Offline" within 5 seconds via WebSocket.

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
```bash
scripts\start.bat
```

### Code Standards
- **Backend:** Pydantic models must be the single source of truth for schemas. Keep API routes thin; place business logic in `/services`.
- **Frontend:** No hardcoded API URLs. Always read from `ports.json` or Vite env vars.
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

## Appendix: Deferred / Future Scope (Phase 2+)

*Features not yet implemented.*

- **Real-time Audio Reactivity:** Live visualization that reacts to audio playback in real-time
- **Lyric Video Generation:** Auto-timed lyric overlays synced to vocal tracks
- **Album Art Generation:** AI-generated cover art from audio mood analysis
- **Advanced Video Effects:** Chromatic aberration, motion blur, film grain overlays
- **Custom ComfyUI Workflow Integration:** Full ComfyUI node graph execution for video generation
