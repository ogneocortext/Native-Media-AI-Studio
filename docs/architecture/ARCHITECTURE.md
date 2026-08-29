# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │Dashboard │ │Music Video│ │ Media Lib│ │ Visualizer (Three)│  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────────┘  │
│         │              │           │               │            │
│         └──────────────┴───────────┴───────────────┘            │
│                              │                                   │
│                    Zustand Stores + API Client                   │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │ HTTP + SSE
                               │

┌──────────────────────────────┼───────────────────────────────────┐
│                    Backend (FastAPI)                              │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                      API Routers                            │  │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ /api/jobs│ │/api/audio│ │/api/outputs│ │/api/health │  │  │
│  │  └─────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                    Job Queue Manager                        │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Job Processor (Threaded)                 │  │  │
│  │  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ │  │  │
│  │  │  │AudioAnalysis│ │ MusicVideo   │ │ ImageGen     │ │  │  │
│  │  │  │  Handler    │ │  Handler     │ │  Handler     │ │  │  │
│  │  │  └─────────────┘ └──────────────┘ └──────────────┘ │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                    Data Layer                               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐  │  │
│  │  │ SQLite   │ │  Output  │ │  Config (ports.json)     │  │  │
│  │  │ Database │ │  Files   │ │                          │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │               External Adapters                            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                  │  │
│  │  │ ComfyUI  │ │ Ollama   │ │ Unity    │                  │  │
│  │  └──────────┘ └──────────┘ └──────────┘                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Music Video Pipeline

```
Audio Upload          Analysis           Job Queue          Rendering
─────────────        ─────────          ──────────          ──────────
                       
User selects    →    File saved     →   Job created    →   Audio analysis
audio file           to output/audio    with params          (librosa)
                       
Upload via      →    Librosa         →   Job queued     →   FFmpeg renders
multipart form       extracts beats      in SQLite           frames with
                     tempo, onset                          visualization
                                                           filters
                                                        →
                                                   Frames + audio
                                                   composited into
                                                   final MP4
```

## Job Lifecycle

```
CREATED → QUEUED → RUNNING → COMPLETED
                         ↘
                          FAILED → RETRYING → QUEUED
                                   ↘
                                    CANCELLED
```

## Data Flow

1. **Frontend** uploads audio via `POST /api/audio/upload`
2. **Backend** stores file, returns `stored_path`
3. **Frontend** creates job via `POST /api/jobs` with `stored_path` in params
4. **Queue Manager** enqueues job, broadcasts `job.queued` via SSE
5. **Job Processor** picks up job, calls appropriate handler
6. **Handler** processes job, updates progress via SSE
7. **On completion**, output file is saved to `output/video/` or `output/previews/`
8. **Frontend** receives `job.completed` with output path via SSE

## Media Data Alignment Principle

**Rule:** All media-derived data (track lists, filenames, BPM, duration, metadata) must come from the media library API (`/api/audio/files` and `/api/audio/analysis`). No hardcoded track lists, filenames, or metadata in frontend code.

This ensures the frontend always reflects what's actually in the library, eliminates duplicate sources of truth, and removes stale hardcoded values.

### Aligned Components
- `features/three-js-studio/ThreeJSStudio.tsx` — Uses `listAudioFiles()` for track dropdown; BPM from analysis API
- `features/visualizer/Visualizer.tsx` — Uses `listAudioFiles()` for track selection
- `features/audio-analysis/AudioAnalysisPage.tsx` — Uses `listAudioFiles()` for track listing

### Misaligned Components (Needs Refactor)
_(None — all components now source media data from the library API)_

## Key Components

### Frontend Stores (Zustand)
- `jobStore` — Job queue state, SSE connection
- `healthStore` — System health, adapter status
- `outputStore` — Generated media files, filters
- `gpuStore` — GPU snapshot polling
- `uiStore` — Shared UI state (focus mode toggle)

### Three.js Studio
- **Paste Code Panel** — Insert AI-generated JavaScript or JSON directly into the 3D scene. Supports `function applyScene(scene, camera, renderer) { ... }` or JSON scene descriptions.
- **Focus Mode** — Hides all UI (sidebar, header, panels, drawer, playback controls) for unobstructed canvas view. Toggle via header button or `Escape` key. Canvas auto-resizes to fill viewport.
- **Media Data** — Track list sourced from `listAudioFiles()` API; BPM/duration from analysis API. No hardcoded track data.

### Visualizer
- **Focus Mode** — Hides all UI with floating controls overlay (record, save, exit). Toggle via header button or `Escape` key.
- **Video Recording** — Captures canvas via `MediaRecorder` API (VP9/VP8/WebM fallback). Saves to `.webm` file.
- **Track Metadata** — Dropdown shows BPM and duration fetched from analysis API.
- **Object URL Cleanup** — Properly revokes `URL.createObjectURL` to prevent memory leaks.

### Backend API
- `/api/audio/files` — Deduplicated file listing (by display name, strips hash prefix)
- `/api/audio/analysis/by-filename/{filename}` — Cached analysis lookup by filename
- `/api/audio/` — Database-backed listing with optional `distinct` parameter
- `save_audio_file` — Prevents duplicate entries by checking existing filenames
- `cleanup_old_system_resources` — Purges system snapshots older than 7 days

### Backend Services
- `AudioAnalyzer` — Librosa-based feature extraction
- `MusicVideoHandler` — FFmpeg video rendering with visualization filters
- `ImageGenerationHandler` — ComfyUI integration
- `ComfyUIWorkflowHandler` — Custom workflow execution

### Database Schema (SQLite)
- `jobs` — Job records with status, progress, params, results
- `job_events` — Event log for auditing
